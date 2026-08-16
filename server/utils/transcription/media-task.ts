/**
 * Продовая реализация `TranscriptionStepDeps["runTask"]` — клей поверх уже
 * готовых частей медиаконтура, без своей бизнес-логики.
 *
 * Спека берётся напрямую `listMediaSpecs("transcription")[0]`, а НЕ через
 * `resolveMediaRoute("transcription")`: единственная модель способности —
 * Whisper на Replicate — стоит в реестре с `integrated: false` (цена не
 * подтверждена страницей модели, spec §14), и `resolveMediaRoute` без явного
 * запроса модели такую спеку не отдаёт, а честно бросает
 * "No integrated media model registered for transcription".
 *
 * Длительность трека меряется здесь и уходит в `usage.audioSeconds`: у
 * `deriveUsage` (`run-media-task.ts`) для transcription намеренно пустая
 * ветка — длительность знает только вызывающий, смеривший файл ffprobe'ом.
 * Без явного `usage` цена посчиталась бы нулём.
 */

import { listMediaSpecs } from "../media-provider/registry"
import { runMediaTask } from "../media-provider/run-media-task"
import { StorageKeys } from "../storage/keys"
import { probeAudioDuration } from "../tts"
import { normalizeTranscriptPayload } from "./normalize"
import type { Transcript, TranscriptWord } from "./types"

export async function requestTranscription(input: {
  videoId: number
  stepId: number
  audioPath: string
  audioUrl: string
  language: string
  outputPath: string
}): Promise<{ costUsd: number, raw: unknown }> {
  const spec = listMediaSpecs("transcription")[0]
  if (!spec) {
    throw new Error("В реестре медиамоделей нет ни одной спеки способности transcription")
  }
  if (spec.capability !== "transcription") {
    // Реестр гарантирует порядок по способности (listMediaSpecs фильтрует сам),
    // но раз уж мы читаем constraints — сверяем честно, а не доверяем молча.
    throw new Error(`Реестр вернул спеку не той способности: ${spec.capability}`)
  }

  // Длительность — до вызова провайдера: и для цены, и для отказа до оплаты.
  const audioSeconds = await probeAudioDuration(input.audioPath)
  if (audioSeconds <= 0) {
    throw new Error(
      `Транскрипция ролика ${input.videoId}: не удалось измерить длительность трека `
      + `${input.audioPath} — ffprobe вернул 0`,
    )
  }
  if (audioSeconds > spec.constraints.maxDurationSec) {
    throw new Error(
      `Транскрипция ролика ${input.videoId}: трек длится ${audioSeconds.toFixed(1)} с, `
      + `а модель ${spec.id} принимает не больше ${spec.constraints.maxDurationSec} с — `
      + "транскрипция для этого ролика недоступна",
    )
  }

  const task = await runMediaTask({
    capability: "transcription",
    spec,
    input: { audioUrl: input.audioUrl, language: input.language },
    // Без videoId нет ключа идемпотентности — повтор оплатит задачу заново.
    videoId: input.videoId,
    stepId: input.stepId,
    unitKey: "transcript",
    outputPath: input.outputPath,
    usage: { audioSeconds },
    // Ключ хранилища транскрипта рядом с прочими ассетами ролика — это и есть
    // второй уровень переиспользования (reuseFromStorage по MediaPrediction).
    persist: { storageKey: StorageKeys.videoTranscript(input.videoId), contentType: "application/json" },
  })

  warnIfNotMonotonic(task.raw, input.videoId)

  return { costUsd: task.costUsd, raw: task.raw }
}

/**
 * Ни normalize.ts, ни align.ts не проверяют монотонность: следующее слово
 * обязано начинаться не раньше конца предыдущего, иначе align.ts, который
 * это молча предполагает, даёт странные границы сцен на кривом ответе
 * провайдера. Раннер и так работает по деградации, а не падению (spec §10),
 * поэтому здесь только диагностика в лог — не исключение.
 */
export function firstMonotonicityViolation(transcript: Transcript): TranscriptWord | null {
  for (let index = 1; index < transcript.words.length; index += 1) {
    const previous = transcript.words[index - 1]!
    const current = transcript.words[index]!
    if (current.startSec < previous.endSec) return current
  }
  return null
}

function warnIfNotMonotonic(raw: unknown, videoId: number): void {
  let transcript: Transcript
  try {
    transcript = normalizeTranscriptPayload(raw)
  } catch {
    // Раннер разберёт `raw` ещё раз и явно сообщит о проблеме разбора —
    // здесь дублировать это сообщение незачем.
    return
  }
  const violation = firstMonotonicityViolation(transcript)
  if (violation) {
    console.warn(
      `[media-task] транскрипция ролика ${videoId}: слово "${violation.text}" начинается раньше конца `
      + "предыдущего — тайминги провайдера немонотонны, выравнивание может дать неточные границы",
    )
  }
}
