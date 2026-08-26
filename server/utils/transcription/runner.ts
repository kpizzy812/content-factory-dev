/**
 * Шаг транскрипции: границы слов нашей же озвучки.
 *
 * Зависимости инжектируются, потому что содержательная часть шага — разбор,
 * выравнивание, деградация и сохранение — обязана проверяться без БД, сети и
 * денег.
 *
 * На маршруте «монтаж от звука» транскрипция ОБЯЗАТЕЛЬНА (spec §4.1, §10):
 * без границ слов lip-sync не возьмёт звук ни одной сцены ведущего, и ролик
 * без честного отказа получил бы статус «готов» со склейкой одних перебивок
 * под непрерывную речь. Сам раннер при отказе провайдера или неразборчивом
 * ответе исключение не бросает — он лишь пишет причину в лог шага и
 * возвращает пустой результат; ронять шаг обязан вызывающий код
 * (`runVideoTranscription` в video-pipeline-steps.ts), который трактует
 * пустые `scenes` как отказ. Так содержательная часть шага проверяется без
 * исключений в юнит-тестах, а решение «падать ли» остаётся в одном месте.
 */

import { alignScriptToTranscript, type AlignedScene, type AlignScene } from "./align"
import { normalizeTranscriptPayload } from "./normalize"

export interface TranscriptionStepInput {
  videoId: number
  stepId: number
  /**
   * Локальный файл трека: по нему считается длительность и цена, и он же
   * уходит провайдеру — заливкой байтов (`inputUploads`), а не ссылкой из
   * хранилища. Ссылки на трек здесь больше нет: у локального драйвера
   * хранилища `getSignedDownloadUrl` отдаёт ОТНОСИТЕЛЬНЫЙ путь
   * (`/api/files/...`), который Replicate не может скачать — 422 при
   * создании задачи (canary 26.08.2026, `transcription-upload-report.md`).
   */
  audioPath: string
  scenes: AlignScene[]
  language: string
  /** Куда сложить сырой ответ модели. */
  outputPath: string
}

export interface TranscriptionStepResult {
  /**
   * "skipped" — провайдер отказал или ответ не разобран; всегда приходит с
   * `scenes: []`. Как «мягкая» деградация с продолжением сборки этот статус
   * не используется нигде: вызывающий код трактует пустые `scenes` как отказ
   * и роняет шаг честно (см. заголовок модуля), так что "skipped" здесь —
   * не более чем метка причины в возвращаемом объекте, а не исход, на
   * который где-то ветвятся.
   */
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
  /**
   * Регистрация СЫРОГО файла транскрипта в БД — вызывается, когда `runTask`
   * уже отработал (провайдер ответил, `runMediaTask` персистит output в
   * хранилище ДО того, как мы вообще пытаемся его разобрать), а разбор
   * (`normalizeTranscriptPayload`) провалился. Без неё уже оплаченный и
   * залитый файл остаётся в хранилище без строки VideoAsset — вне каскада
   * удаления ролика и вне orphan-scan (см. `persistTranscriptAsset` в
   * video-pipeline-steps.ts, которым по умолчанию и реализован этот колбэк).
   */
  persistRawAsset: (payload: { videoId: number, localPath: string }) => Promise<void>
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
      language: input.language,
      outputPath: input.outputPath,
      scenes: input.scenes,
    })
    raw = task.raw
    costUsd = task.costUsd
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await deps.log(input.stepId, `Транскрипция не выполнена (${message}) — на маршруте «монтаж от звука» шаг обязателен, вызывающий код провалит его честно`)
    return { status: "skipped", scenes: [], costUsd: 0, warning: message }
  }

  let transcript
  try {
    transcript = normalizeTranscriptPayload(raw)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // Файл уже в хранилище (см. TranscriptionStepDeps.persistRawAsset) — без
    // регистрации он там и останется сиротой. Сама регистрация — учёт, не
    // содержательная часть шага: сбой записи не должен прятать НАСТОЯЩУЮ
    // причину (неразобранный ответ) под своей ошибкой, поэтому только предупреждение в лог.
    try {
      await deps.persistRawAsset({ videoId: input.videoId, localPath: input.outputPath })
    } catch (assetError) {
      const assetMessage = assetError instanceof Error ? assetError.message : String(assetError)
      console.warn(`[transcription] не удалось зарегистрировать ассет неразобранного транскрипта видео ${input.videoId}: ${assetMessage}`)
    }
    await deps.log(input.stepId, `Ответ транскрипции не разобран (${message}) — шаг будет провален вызывающим кодом`)
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
