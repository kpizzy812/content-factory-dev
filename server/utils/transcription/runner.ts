/**
 * Шаг транскрипции: границы слов нашей же озвучки.
 *
 * Зависимости инжектируются, потому что содержательная часть шага — разбор,
 * выравнивание, деградация и сохранение — обязана проверяться без БД, сети и
 * денег.
 *
 * Отказ провайдера ролик не роняет (spec §10): без точных таймингов монтаж
 * работает по плановым длительностям, и это видно в логе шага, а не молча.
 */

import { alignScriptToTranscript, type AlignedScene, type AlignScene } from "./align"
import { normalizeTranscriptPayload } from "./normalize"

export interface TranscriptionStepInput {
  videoId: number
  stepId: number
  /** Локальный файл трека: по нему считается длительность и цена. */
  audioPath: string
  /** Публичный URL трека для провайдера. */
  audioUrl: string
  scenes: AlignScene[]
  language: string
  /** Куда сложить сырой ответ модели. */
  outputPath: string
}

export interface TranscriptionStepResult {
  status: "completed" | "degraded" | "skipped"
  scenes: AlignedScene[]
  costUsd: number
  warning: string | null
}

export interface TranscriptionStepDeps {
  runTask: (input: {
    videoId: number
    stepId: number
    audioPath: string
    audioUrl: string
    language: string
    outputPath: string
    /**
     * Текст, который в этом треке ЗВУЧИТ. Провайдеру он не обязателен (Whisper
     * распознаёт и без подсказки), но адаптер вправе им пользоваться: мок-режим
     * строит по нему детерминированный транскрипт вместо заглушки, а реальная
     * модель может принимать его как initial_prompt.
     */
    scenes: readonly AlignScene[]
  }) => Promise<{ costUsd: number, raw: unknown }>
  /** Сохранение выровненного транскрипта: без него повтор прогона теряет тайминги. */
  saveTranscript: (payload: {
    videoId: number
    scenes: AlignedScene[]
    matchedRatio: number
    localPath: string
  }) => Promise<void>
  log: (stepId: number, message: string) => Promise<void>
}

export async function runTranscriptionStep(
  input: TranscriptionStepInput,
  deps: TranscriptionStepDeps,
): Promise<TranscriptionStepResult> {
  let raw: unknown
  let costUsd = 0

  try {
    const task = await deps.runTask({
      videoId: input.videoId,
      stepId: input.stepId,
      audioPath: input.audioPath,
      audioUrl: input.audioUrl,
      language: input.language,
      outputPath: input.outputPath,
      scenes: input.scenes,
    })
    raw = task.raw
    costUsd = task.costUsd
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await deps.log(input.stepId, `Транскрипция не выполнена (${message}) — ролик собирается по плановым длительностям, тайминги приблизительные`)
    return { status: "skipped", scenes: [], costUsd: 0, warning: message }
  }

  let transcript
  try {
    transcript = normalizeTranscriptPayload(raw)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await deps.log(input.stepId, `Ответ транскрипции не разобран (${message}) — тайминги приблизительные`)
    return { status: "skipped", scenes: [], costUsd, warning: message }
  }

  const alignment = alignScriptToTranscript({ scenes: input.scenes, transcript })

  await deps.saveTranscript({
    videoId: input.videoId,
    scenes: alignment.scenes,
    matchedRatio: alignment.matchedRatio,
    localPath: input.outputPath,
  })

  if (alignment.degraded) {
    const percent = Math.round(alignment.matchedRatio * 100)
    const warning = `Выравнивание сошлось лишь на ${percent}% слов — границы сцен приблизительные`
    await deps.log(input.stepId, warning)
    return { status: "degraded", scenes: alignment.scenes, costUsd, warning }
  }

  await deps.log(
    input.stepId,
    `Транскрипция: ${transcript.words.length} слов, ${alignment.scenes.length} сцен размечено, $${costUsd.toFixed(4)}`,
  )
  return { status: "completed", scenes: alignment.scenes, costUsd, warning: null }
}
