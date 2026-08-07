/**
 * POST /api/characters/:id/generate-reference
 *
 * Генерирует референс-изображение персонажа через fal.ai (FLUX Schnell / Dev),
 * сохраняет в GCS под zavodcamp/apps/{appId}/characters/{characterId}/{sha1}.{ext}
 * и создаёт CharacterReferenceImage запись + fire-and-forget AI vision разметку.
 *
 * Body: { prompt: string, modelId?: string, kind?: 'face'|'body'|'outfit'|'pose'|'other', aspect?: 'square'|'portrait'|'landscape' }
 * Defaults: modelId='fal-ai/flux/schnell', kind='face', aspect='square'.
 *
 * Dedup: повторный запрос с тем же контентом (по sha1) возвращает existing запись
 * без второй записи в БД и без повторной AI vision (idempotent).
 *
 * Permission: canRunAgent + moduleSlug='script-generator' + appId scope.
 * Cost: logServiceCost('fal.ai', modelId, costUsd) — AiAuditLog с action='external_api_call'.
 * Note: requirePaidApisEnabled вызывается ВНУТРИ falSubmit/falUploadFile в non-mock
 * пути. В FAL_MOCK_MODE=true мок отдаёт placeholder без guard — это правильно для тестов.
 */
import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { estimateMediaCost, resolveMediaModel } from "~~/server/utils/media-provider/registry"
import { runMediaTask } from "~~/server/utils/media-provider/run-media-task"
import { getStorageDriver } from "~~/server/utils/storage"
import { StorageKeys } from "~~/server/utils/storage/keys"
import { storageKeyToLegacyUrl } from "~~/server/utils/storage/download-to-storage"
import { scheduleCharacterPhotoAnalysis } from "~~/server/utils/agents/character-photo-analyzer"
import { IMAGE_MODELS } from "~~/server/utils/video-models"
import { logServiceCost } from "~~/server/utils/balance/cost-ledger"
import type { CharacterReferenceKind } from "~~/shared/types/character"

interface FalImageResult {
  images?: Array<{
    url: string
    content_type?: string
    width?: number
    height?: number
  }>
}

const KINDS: CharacterReferenceKind[] = ["face", "body", "outfit", "pose", "other"]
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

  const character = await prisma.character.findUnique({
    where: { id },
    select: { id: true, appId: true },
  })
  if (!character) throw createError({ statusCode: 404, message: "Персонаж не найден" })

  const user = await requireScopedAccess(event, {
    permissions: ["canRunAgent"],
    moduleSlug: "script-generator",
    appId: character.appId,
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
  // Спека модели вместо витрины: из неё берутся payload, разбор выхода и цена.
  const spec = resolveMediaModel("text_to_image", modelId)

  const kind = (body?.kind ?? "face") as CharacterReferenceKind
  if (!KINDS.includes(kind)) {
    throw createError({ statusCode: 400, message: `Неизвестный kind: ${kind}` })
  }

  const aspectKey = (body?.aspect ?? "square") as keyof typeof ASPECTS
  if (!(aspectKey in ASPECTS)) {
    throw createError({ statusCode: 400, message: `Неизвестный aspect: ${aspectKey}` })
  }
  const imageSize = ASPECTS[aspectKey]

  // Единая точка вызова медиазадачи. Скачивание в файл умеет и mock://-схему
  // (тот же generateMockPlaceholder), поэтому отдельной ветки под мок больше нет.
  const tmp = await mkdtemp(path.join(tmpdir(), "gen-ref-"))
  const tmpFile = path.join(tmp, "out.bin")
  let buffer: Buffer
  let task: Awaited<ReturnType<typeof runMediaTask>>
  try {
    task = await runMediaTask({
      capability: "text_to_image",
      spec,
      input: {
        prompt,
        width: imageSize.width,
        height: imageSize.height,
        count: 1,
      },
      unitKey: `character:${character.id}`,
      outputPath: tmpFile,
    })
    buffer = await readFile(tmpFile)
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {})
  }

  // Размеры кадра — поля витрины провайдера, их нет в нормализованном выходе.
  const image = (task.raw as FalImageResult | undefined)?.images?.[0]
  const mimeType = task.contentType ?? "image/png"
  const ext = MIME_TO_EXT[mimeType.toLowerCase()] ?? "png"

  const sha1 = createHash("sha1").update(buffer).digest("hex").slice(0, 16)
  const storageKey = StorageKeys.characterReferenceImage(character.appId, character.id, sha1, ext)
  const fileUrl = storageKeyToLegacyUrl(storageKey)

  // Dedup: если же запись с тем же sha1 уже есть — возвращаем её, не вызывая повторно
  // AI vision/cost log. Идемпотентность для повторных запросов с одинаковым промтом
  // (FLUX обычно даёт разные результаты, но мок всегда одинаковый — это и протестируем).
  const existing = await prisma.characterReferenceImage.findUnique({
    where: { characterId_sha1: { characterId: character.id, sha1 } },
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

  // Цена считается той же функцией, что и в пайплайне, по единице биллинга спеки.
  const megapixels = (imageSize.width * imageSize.height) / 1_000_000
  const costUsd = Number(estimateMediaCost(spec, { megapixels, images: 1 }).toFixed(6))

  const created = await prisma.characterReferenceImage.create({
    data: {
      characterId: character.id,
      kind,
      fileUrl,
      storageKey,
      storageProvider: storage.providerName,
      sha1,
      mimeType,
      bytes: buffer.length,
      width: image?.width ?? imageSize.width,
      height: image?.height ?? imageSize.height,
      uploadedById: user.id,
      generationPrompt: prompt,
      generationModel: modelId,
      generationCostUsd: costUsd,
    },
  })

  // Cost ledger: logServiceCost defensive (try/catch внутри)
  await logServiceCost({
    service: "fal.ai",
    model: modelId,
    costUsd,
    userId: user.id,
    action: "image_generation",
    metadata: { characterId: character.id, kind, sha1, aspect: aspectKey },
  })

  // Fire-and-forget AI vision: aiTags/aiCaption/aiVisualDescription заполнятся
  // через polling в UI как и для ручной загрузки.
  scheduleCharacterPhotoAnalysis(created.id)

  return {
    data: {
      reference: created,
      deduplicated: false,
    },
  }
})
