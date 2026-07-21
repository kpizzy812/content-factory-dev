/**
 * POST /api/scenes/:id/generate-reference
 *
 * Генерирует эталонный кадр сцены через fal.ai (FLUX Schnell / Dev),
 * сохраняет в GCS под zavodcamp/apps/{appId}/scenes/{sceneId}/refs/{sha1}.{ext}
 * и создаёт SceneReferenceImage запись + fire-and-forget AI vision разметку.
 *
 * Body: { prompt: string, modelId?: string, kind?: 'mood'|'shot'|'environment'|'other', aspect?: 'square'|'portrait'|'landscape' }
 * Defaults: modelId='fal-ai/flux/schnell', kind='mood', aspect='portrait' (9:16 для TikTok/Reels).
 *
 * См. подробности в characters/[id]/generate-reference.post.ts — логика идентична,
 * отличия только в таблице/StorageKeys/KINDS/default aspect.
 */
import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { falRequest } from "~~/server/utils/fal"
import { isMockUrl, generateMockPlaceholder } from "~~/server/utils/mock/fal-mock"
import { getStorageDriver } from "~~/server/utils/storage"
import { StorageKeys } from "~~/server/utils/storage/keys"
import { storageKeyToLegacyUrl } from "~~/server/utils/storage/download-to-storage"
import { scheduleScenePhotoAnalysis } from "~~/server/utils/agents/character-photo-analyzer"
import { IMAGE_MODELS } from "~~/server/utils/video-models"
import { logServiceCost } from "~~/server/utils/balance/cost-ledger"

interface FalImageResult {
  images?: Array<{
    url: string
    content_type?: string
    width?: number
    height?: number
  }>
}

const KINDS = ["mood", "shot", "environment", "other"] as const
type SceneKind = (typeof KINDS)[number]

const ASPECTS = {
  square: { width: 1024, height: 1024 },
  portrait: { width: 1024, height: 1820 },
  landscape: { width: 1820, height: 1024 },
} as const

const ALLOWED_MODEL_IDS = new Set(IMAGE_MODELS.map((m) => m.id))
const DEFAULT_MODEL_ID = "fal-ai/flux/schnell"

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")
  if (!id) throw createError({ statusCode: 400, message: "id обязателен" })

  const scene = await prisma.scene.findUnique({
    where: { id },
    select: { id: true, appId: true },
  })
  if (!scene) throw createError({ statusCode: 404, message: "Сцена не найдена" })

  const user = await requireScopedAccess(event, {
    permissions: ["canRunAgent"],
    moduleSlug: "script-generator",
    appId: scene.appId,
  })

  const body = await readBody<{
    prompt?: string
    modelId?: string
    kind?: string
    aspect?: string
  }>(event)

  const prompt = (body?.prompt ?? "").trim()
  if (!prompt) {
    throw createError({ statusCode: 400, message: "Поле `prompt` обязательно" })
  }
  if (prompt.length > 2000) {
    throw createError({ statusCode: 400, message: "Поле `prompt` слишком длинное (>2000)" })
  }

  const modelId = body?.modelId ?? DEFAULT_MODEL_ID
  if (!ALLOWED_MODEL_IDS.has(modelId)) {
    throw createError({
      statusCode: 400,
      message: `Неизвестная модель: ${modelId}. Допустимые: ${[...ALLOWED_MODEL_IDS].join(", ")}.`,
    })
  }
  const model = IMAGE_MODELS.find((m) => m.id === modelId)!

  const kind = (body?.kind ?? "mood") as SceneKind
  if (!KINDS.includes(kind)) {
    throw createError({ statusCode: 400, message: `Неизвестный kind: ${kind}` })
  }

  const aspectKey = (body?.aspect ?? "portrait") as keyof typeof ASPECTS
  if (!(aspectKey in ASPECTS)) {
    throw createError({ statusCode: 400, message: `Неизвестный aspect: ${aspectKey}` })
  }
  const imageSize = ASPECTS[aspectKey]

  const result = await falRequest<FalImageResult>(modelId, {
    prompt,
    image_size: imageSize,
    num_images: 1,
  })

  const image = result?.images?.[0]
  if (!image?.url) {
    throw createError({
      statusCode: 502,
      message: "fal.ai не вернул URL изображения",
    })
  }

  let buffer: Buffer
  if (isMockUrl(image.url)) {
    const tmp = await mkdtemp(path.join(tmpdir(), "gen-ref-scene-"))
    const tmpFile = path.join(tmp, "out.png")
    try {
      await generateMockPlaceholder(image.url, tmpFile)
      buffer = await readFile(tmpFile)
    } finally {
      await rm(tmp, { recursive: true, force: true }).catch(() => {})
    }
  } else {
    const response = await $fetch.raw(image.url, {
      responseType: "arrayBuffer",
    } as Parameters<typeof $fetch>[1])
    buffer = Buffer.from(response._data as ArrayBuffer)
  }

  const mimeType = image.content_type ?? "image/png"
  const ext = MIME_TO_EXT[mimeType.toLowerCase()] ?? "png"

  const sha1 = createHash("sha1").update(buffer).digest("hex").slice(0, 16)
  const storageKey = StorageKeys.sceneReferenceImage(scene.appId, scene.id, sha1, ext)
  const fileUrl = storageKeyToLegacyUrl(storageKey)

  const existing = await prisma.sceneReferenceImage.findUnique({
    where: { sceneId_sha1: { sceneId: scene.id, sha1 } },
  })
  if (existing) {
    return {
      data: {
        reference: existing,
        deduplicated: true,
      },
    }
  }

  const storage = getStorageDriver()
  await storage.uploadBuffer(storageKey, buffer, { contentType: mimeType })

  const megapixels = (imageSize.width * imageSize.height) / 1_000_000
  const costUsd = Number((megapixels * model.pricing.base).toFixed(6))

  const created = await prisma.sceneReferenceImage.create({
    data: {
      sceneId: scene.id,
      kind,
      fileUrl,
      storageKey,
      storageProvider: storage.providerName,
      sha1,
      mimeType,
      bytes: buffer.length,
      width: image.width ?? imageSize.width,
      height: image.height ?? imageSize.height,
      uploadedById: user.id,
      generationPrompt: prompt,
      generationModel: modelId,
      generationCostUsd: costUsd,
    },
  })

  await logServiceCost({
    service: "fal.ai",
    model: modelId,
    costUsd,
    userId: user.id,
    action: "image_generation",
    metadata: { sceneId: scene.id, kind, sha1, aspect: aspectKey },
  })

  scheduleScenePhotoAnalysis(created.id)

  return {
    data: {
      reference: created,
      deduplicated: false,
    },
  }
})
