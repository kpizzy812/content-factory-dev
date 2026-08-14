/**
 * POST /api/characters/:id/reference-variations
 *
 * Делает из одного портрета персонажа набор кадров того же человека: другой
 * ракурс, одежда, обстановка и свет. Этап 5 спецификации
 * `docs/superpowers/specs/2026-08-14-avatar-pipeline.md`.
 *
 * Зачем: ротация портретов (`server/utils/avatar-source.ts`) выбирает наименее
 * использованный кадр, и без набора кадров все сцены ролика показывают одно и
 * то же лицо в одной позе — ровно тот дубль, который `docs/PROJECT_CONTEXT.md`
 * §7 описывает как «меняются только губы и субтитры». Сегодня набор приносит
 * заказчик, 5-10 фотографий человека. Отсюда — из одного кадра.
 *
 * Отличие от `generate-reference.post.ts`: тот рисует с нуля по промпту, здесь
 * промпт — ИНСТРУКЦИЯ правки существующего кадра, и модель обязана сохранить
 * лицо (способность `image_to_image`, FLUX Kontext).
 *
 * Body: { count?: number, sourceReferenceId?: string, modelId?: string,
 *         note?: string, startIndex?: number }
 * Defaults: count=4, источник — лучший портрет персонажа по правилам ротации,
 * модель — маршрут способности (`black-forest-labs/flux-kontext-dev`, $0.025/кадр).
 *
 * Идемпотентность: слот вариации — пара «исходный кадр + пресет». Повтор того
 * же слота тянет уже оплаченный результат из нашего хранилища и денег не стоит.
 *
 * Permission: canRunAgent + moduleSlug='script-generator' + appId scope.
 */
import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { pickAvatarPortrait } from "~~/server/utils/avatar-source"
import {
  MAX_REFERENCE_VARIATIONS,
  buildVariationIdentityScope,
  buildVariationPrompt,
  planReferenceVariations,
  type ReferenceVariationPreset,
} from "~~/server/utils/character-reference-variations"
import { listMediaSpecs, resolveMediaRoute } from "~~/server/utils/media-provider/registry"
import { detectReferenceMediaType } from "~~/server/utils/media-provider/reference-frame"
import { materializeReferenceFrame } from "~~/server/utils/media-provider/reference-frame-repository"
import { runMediaTask } from "~~/server/utils/media-provider/run-media-task"
import type { ImageToImageModelSpec } from "~~/server/utils/media-provider/types"
import { logServiceCost } from "~~/server/utils/balance/cost-ledger"
import { scheduleCharacterPhotoAnalysis } from "~~/server/utils/agents/character-photo-analyzer"
import { getStorageDriver } from "~~/server/utils/storage"
import { StorageKeys } from "~~/server/utils/storage/keys"
import { storageKeyToLegacyUrl } from "~~/server/utils/storage/download-to-storage"

const DEFAULT_COUNT = 4

/**
 * Модель выбирается только среди подключённых спек СВОЕЙ способности.
 * `text_to_image` сюда не годится принципиально: он рисует с нуля и референс не
 * принимает, то есть «тот же человек» превратился бы в незнакомца за наши деньги.
 */
const ALLOWED_MODEL_IDS = new Set(
  listMediaSpecs("image_to_image").filter(spec => spec.integrated).map(spec => spec.id),
)

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
    count?: number
    sourceReferenceId?: string
    modelId?: string
    note?: string
    startIndex?: number
  }>(event)

  const count = body?.count ?? DEFAULT_COUNT
  if (!Number.isInteger(count) || count < 1 || count > MAX_REFERENCE_VARIATIONS) {
    throw createError({
      statusCode: 400,
      message: `Поле count должно быть целым числом от 1 до ${MAX_REFERENCE_VARIATIONS}`,
    })
  }

  const note = body?.note?.trim() || null
  if (note && note.length > 500) {
    throw createError({ statusCode: 400, message: "Поле `note` слишком длинное (>500)" })
  }

  const modelId = body?.modelId?.trim()
  if (modelId && !ALLOWED_MODEL_IDS.has(modelId)) {
    throw createError({
      statusCode: 400,
      message: `Модель ${modelId} не умеет вариации портрета. Допустимые: ${[...ALLOWED_MODEL_IDS].join(", ")}.`,
    })
  }
  const route = resolveMediaRoute("image_to_image", modelId ?? null)
  const spec = route.primary as ImageToImageModelSpec

  const source = await resolveSourceReference(character.id, body?.sourceReferenceId?.trim() || null)

  // Смещение набора: повторный запуск обязан давать новые ракурсы, иначе
  // оператор оплачивает те же кадры ещё раз. Явное значение из тела запроса
  // побеждает — оно нужно, чтобы перегенерировать конкретный слот.
  const startIndex = Number.isInteger(body?.startIndex) && (body!.startIndex as number) >= 0
    ? (body!.startIndex as number)
    : await countGeneratedSlots(source.id)

  const presets = planReferenceVariations(count, { startIndex })

  const maxOrder = await prisma.characterReferenceImage.aggregate({
    where: { characterId: character.id },
    _max: { order: true },
  })

  const workDir = await mkdtemp(path.join(tmpdir(), "char-variation-"))
  const created: unknown[] = []
  const failed: Array<{ presetKey: string, error: string }> = []
  let totalCostUsd = 0

  try {
    const sourcePath = await materializeReferenceFrame(source.frame, workDir)
    if (!sourcePath) {
      throw createError({
        statusCode: 400,
        message: "Файл исходного кадра недоступен — генерировать вариации не из чего",
      })
    }

    for (const [index, preset] of presets.entries()) {
      try {
        const result = await generateVariation({
          preset,
          spec,
          note,
          source: { id: source.id, path: sourcePath, mimeType: source.frame.mimeType },
          character,
          workDir,
          order: (maxOrder._max.order ?? 0) + 1 + index,
          userId: user.id,
        })
        totalCostUsd += result.costUsd
        created.push(result)
      }
      catch (error) {
        // Один неудавшийся кадр не отменяет остальные и не отменяет уже
        // оплаченные: оператору важнее получить три кадра из четырёх.
        failed.push({ presetKey: preset.key, error: describeError(error) })
      }
    }
  }
  finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
  }

  return {
    data: {
      sourceReferenceId: source.id,
      modelId: spec.id,
      costUsd: Number(totalCostUsd.toFixed(6)),
      created,
      failed,
    },
  }
})

/**
 * Исходный кадр: явно указанный либо лучший портрет персонажа.
 *
 * Правило выбора — то же, что у ротации (`pickAvatarPortrait`): портрет лица,
 * дальше наименее использованный. Значит вариации делаются от того же кадра,
 * который сцены и берут.
 */
async function resolveSourceReference(characterId: string, requestedId: string | null) {
  const references = await prisma.characterReferenceImage.findMany({
    where: { characterId },
    select: {
      id: true,
      kind: true,
      order: true,
      storageKey: true,
      fileUrl: true,
      mimeType: true,
      usageCount: true,
      lastUsedAt: true,
    },
  })

  const picked = requestedId
    ? references.find(reference => reference.id === requestedId)
    : pickAvatarPortrait(references)

  if (!picked) {
    throw createError({
      statusCode: 400,
      message: requestedId
        ? `Кадр ${requestedId} не принадлежит этому персонажу`
        : "У персонажа нет ни одного кадра — вариации делать не из чего",
    })
  }

  return {
    id: picked.id,
    frame: {
      source: "character" as const,
      imageId: picked.id,
      appId: null,
      fileUrl: picked.fileUrl,
      storageKey: picked.storageKey,
      mimeType: detectReferenceMediaType(picked.mimeType, picked.fileUrl),
    },
  }
}

/**
 * Сколько слотов вариаций у этого исходника уже оплачено.
 *
 * Считаем по ключам идемпотентности, а не по записям кадров: кадр мог быть
 * удалён оператором, а prediction остался, и повтор такого слота денег не
 * стоит — значит и новым ракурсом он не является.
 */
async function countGeneratedSlots(sourceReferenceId: string): Promise<number> {
  const prefix = `image_to_image:v1:${buildVariationIdentityScope(sourceReferenceId, "")}`
  const predictions = await prisma.mediaPrediction.findMany({
    where: { idempotencyKey: { startsWith: prefix } },
    select: { idempotencyKey: true },
  })
  const slots = new Set(
    predictions.map(prediction => prediction.idempotencyKey.slice(prefix.length).split(":")[0]),
  )
  return slots.size
}

async function generateVariation(input: {
  preset: ReferenceVariationPreset
  spec: ImageToImageModelSpec
  note: string | null
  source: { id: string, path: string, mimeType: string }
  character: { id: string, appId: number }
  workDir: string
  order: number
  userId: number
}) {
  const prompt = buildVariationPrompt(input.preset, input.note)
  const outputPath = path.join(input.workDir, `${input.preset.key}.jpg`)

  const task = await runMediaTask({
    capability: "image_to_image",
    spec: input.spec,
    input: {
      // URL подставит runMediaTask после заливки файла: в ключ идемпотентности
      // идёт sha256 содержимого, а не временный адрес заливки.
      imageUrl: "",
      prompt,
      count: 1,
    },
    inputUploads: [
      { field: "imageUrl", path: input.source.path, contentType: input.source.mimeType },
    ],
    // Ролика у вариации нет — областью идемпотентности служит слот
    // «исходный кадр + пресет».
    identityScope: buildVariationIdentityScope(input.source.id, input.preset.key),
    unitKey: `character:${input.character.id}:${input.preset.key}`,
    outputPath,
  })

  const buffer = await readFile(task.localPath)
  const sha1 = createHash("sha1").update(buffer).digest("hex").slice(0, 16)

  // Тот же контент уже есть — второй записи не делаем и AI vision не зовём.
  // Kontext на одном seed повторяем, а мок так вообще всегда одинаков.
  const existing = await prisma.characterReferenceImage.findUnique({
    where: { characterId_sha1: { characterId: input.character.id, sha1 } },
  })
  if (existing) {
    return {
      presetKey: input.preset.key,
      deduplicated: true,
      costUsd: task.costUsd,
      reference: existing,
    }
  }

  const storageKey = StorageKeys.characterReferenceImage(
    input.character.appId,
    input.character.id,
    sha1,
    "jpg",
  )
  const storage = getStorageDriver()
  await storage.uploadBuffer(storageKey, buffer, { contentType: "image/jpeg" })

  const costUsd = Number(task.costUsd.toFixed(6))
  const created = await prisma.characterReferenceImage.create({
    data: {
      characterId: input.character.id,
      kind: input.preset.kind,
      fileUrl: storageKeyToLegacyUrl(storageKey),
      storageKey,
      storageProvider: storage.providerName,
      sha1,
      mimeType: "image/jpeg",
      bytes: buffer.length,
      order: input.order,
      uploadedById: input.userId,
      generationPrompt: prompt,
      generationModel: task.modelId,
      generationCostUsd: costUsd,
    },
  })

  await logServiceCost({
    service: task.provider,
    model: task.modelId,
    costUsd,
    userId: input.userId,
    action: "image_generation",
    metadata: {
      characterId: input.character.id,
      sourceReferenceId: input.source.id,
      presetKey: input.preset.key,
      sha1,
    },
  })

  scheduleCharacterPhotoAnalysis(created.id)

  return {
    presetKey: input.preset.key,
    deduplicated: false,
    costUsd,
    reference: created,
  }
}

function describeError(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error)
}
