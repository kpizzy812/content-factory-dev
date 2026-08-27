/**
 * POST /api/characters/:id/clone-voice
 *
 * Клонирует голос ведущего по загруженному образцу (§9 спеки
 * `docs/superpowers/specs/2026-08-16-audio-first-editing-design.md`, Task 5
 * плана `2026-08-17-segment-replace-and-ui.md`). Переносит на сервер то, что
 * умел `scripts/clone-voice.ts`, вместе со всеми его проверками до оплаты.
 *
 * Body: multipart/form-data
 *   file            — образец, MP3/M4A/WAV, 10 с — 5 мин, меньше 20 МБ
 *   targetModel     — под какую TTS-модель обучать (по умолчанию speech-02-turbo)
 *   confirmUsd      — ПОДТВЕРЖДЕНИЕ СУММЫ, обязано быть равно цене спеки ($3).
 *                     Прямой перенос `--yes` из скрипта: без него ручка отвечает
 *                     400 и ничего не тратит
 *   noiseReduction / volumeNormalization — необязательные флаги модели
 *
 * Ответ: { data: { voiceId, targetModel, sampleSha1, costUsd, source } }, где
 * `source` честно говорит, платили ли мы: `cloned` — да, $3;
 * `reused_character`/`reused_storage` — нет, отдали уже оплаченное.
 *
 * Вся денежная логика (подтверждение, проверки, дедуп, разбор ответа, учёт)
 * живёт в `server/utils/media-provider/voice-clone.ts` и накрыта чистой сьютой.
 * Здесь остаётся то, что без HTTP не проверить: разбор multipart и права.
 *
 * Permission: canRunAgent + moduleSlug='script-generator' + appId scope —
 * как у остальных ручек, которые тратят деньги на персонажа.
 */
import {
  cloneCharacterVoice,
  VoiceCloneError,
} from "~~/server/utils/media-provider/voice-clone"

/** Дефолт целевой модели — та же, что в скрипте и в спеке озвучки. */
const DEFAULT_TARGET_MODEL = "speech-02-turbo"

function readTextField(parts: Awaited<ReturnType<typeof readMultipartFormData>>, name: string): string | null {
  const part = parts?.find(item => item.name === name && item.data && !item.filename)
  return part?.data?.toString("utf-8").trim() || null
}

function readBooleanField(parts: Awaited<ReturnType<typeof readMultipartFormData>>, name: string): boolean {
  const raw = readTextField(parts, name)?.toLowerCase()
  return raw === "true" || raw === "1" || raw === "on"
}

export default defineEventHandler(async (event) => {
  const characterId = getRouterParam(event, "id")
  if (!characterId) throw createError({ statusCode: 400, message: "id обязателен" })

  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: {
      id: true,
      appId: true,
      voiceId: true,
      voiceModelId: true,
      voiceSampleSha1: true,
    },
  })
  if (!character) throw createError({ statusCode: 404, message: "Персонаж не найден" })

  const user = await requireScopedAccess(event, {
    permissions: ["canRunAgent"],
    moduleSlug: "script-generator",
    appId: character.appId,
  })

  const parts = await readMultipartFormData(event)
  const filePart = parts?.find(part => part.filename && part.data?.length)
  if (!filePart) {
    throw createError({ statusCode: 400, message: "Образец голоса не получен: ожидается файл в multipart-теле" })
  }

  // confirmUsd читается как число: пустая строка и мусор дают NaN, а NaN не
  // равен цене — значит подтверждения не было, и это отказ, а не списание.
  const confirmUsd = Number(readTextField(parts, "confirmUsd"))

  try {
    const result = await cloneCharacterVoice({
      character,
      sample: {
        bytes: filePart.data,
        filename: filePart.filename ?? null,
        mimeType: filePart.type ?? null,
      },
      targetModel: readTextField(parts, "targetModel") ?? DEFAULT_TARGET_MODEL,
      confirmUsd,
      noiseReduction: readBooleanField(parts, "noiseReduction"),
      volumeNormalization: readBooleanField(parts, "volumeNormalization"),
      userId: user.id,
    })

    return {
      data: {
        voiceId: result.voiceId,
        targetModel: result.targetModel,
        sampleSha1: result.sampleSha1,
        costUsd: result.costUsd,
        source: result.source,
      },
    }
  } catch (error) {
    // Коды операции уже расставлены там, где принималось решение (415 формат,
    // 413 размер, 422 длительность, 400 подтверждение) — здесь только перевод
    // в ответ HTTP, без переосмысления причины.
    if (error instanceof VoiceCloneError) {
      throw createError({ statusCode: error.statusCode, message: error.message })
    }
    throw error
  }
})
