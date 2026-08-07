/**
 * Тайминги сцен: раскладка субтитров и озвучки по реальным клипам.
 *
 * Логика вынесена отдельно от render.ts/video-pipeline-steps.ts, потому что это
 * чистая арифметика без ffmpeg/БД — её можно покрыть DB-free тестом, а раньше
 * она дублировалась в трёх местах (drawtext-ветка, ASS-ветка, voiceover) и
 * расходилась: субтитры выравнивались по позиции в отфильтрованном массиве, а
 * не по номеру сцены, поэтому одна сцена без текста сдвигала весь хвост.
 */

import type { SubtitlePlacement } from "~~/shared/types/story"

/** Субтитр сцены с ЯВНЫМ индексом сцены (0-based, позиция в videoPlan.scenes). */
export interface SceneSubtitleInput {
  /** Позиция сцены в videoPlan.scenes — совпадает с индексом клипа в clips[]. */
  sceneIndex: number
  text: string
  placement: SubtitlePlacement
  durationSec: number
}

/** Готовое окно показа субтитра на таймлайне финального ролика. */
export interface SubtitleWindow {
  sceneIndex: number
  startSec: number
  endSec: number
  text: string
  placement: SubtitlePlacement
}

/** Зазор в конце окна — чтобы субтитр гас до склейки со следующим клипом. */
const DEFAULT_GAP_SEC = 0.1

/**
 * Строит окна показа субтитров по реальным длительностям клипов.
 *
 * Основной режим (клипов больше одного): окно берётся у клипа с индексом
 * subtitle.sceneIndex — сцена без текста просто не даёт окна и НЕ сдвигает
 * соседей. Субтитр, для которого клипа нет (частичная генерация), отбрасывается.
 *
 * Фолбэк (0 или 1 клип): раскладываем последовательно по durationSec самих
 * субтитров — в один клип может быть смонтировано несколько реплик.
 */
export function buildSubtitleTimeline(
  clipDurations: number[],
  subtitles: SceneSubtitleInput[],
  opts?: { gapSec?: number },
): SubtitleWindow[] {
  const gap = opts?.gapSec ?? DEFAULT_GAP_SEC
  const usable = subtitles.filter(s => typeof s.text === "string" && s.text.trim().length > 0)
  if (usable.length === 0) return []

  if (clipDurations.length > 1) {
    // Префиксные суммы: старт сцены i = сумма длительностей клипов до неё.
    const starts: number[] = []
    let acc = 0
    for (const dur of clipDurations) {
      starts.push(acc)
      acc += dur
    }

    const windows: SubtitleWindow[] = []
    for (const sub of usable) {
      const idx = sub.sceneIndex
      const start = starts[idx]
      const clipDur = clipDurations[idx]
      if (start === undefined || clipDur === undefined) continue // клипа для сцены нет
      windows.push({
        sceneIndex: idx,
        startSec: start,
        endSec: Math.max(start, start + clipDur - gap),
        text: sub.text,
        placement: sub.placement,
      })
    }
    return windows
  }

  // Один клип (или ни одного): последовательная раскладка, с обрезкой по концу клипа.
  const totalLimit = clipDurations[0]
  const windows: SubtitleWindow[] = []
  let cursor = 0
  for (const sub of usable) {
    const dur = sub.durationSec > 0 ? sub.durationSec : 3
    const start = cursor
    if (totalLimit !== undefined && start >= totalLimit) break
    let end = start + dur - gap
    if (totalLimit !== undefined) end = Math.min(end, totalLimit)
    windows.push({
      sceneIndex: sub.sceneIndex,
      startSec: start,
      endSec: Math.max(start, end),
      text: sub.text,
      placement: sub.placement,
    })
    cursor += dur
  }
  return windows
}

/** Слот сцены на таймлайне клипов: где начинается и есть ли вообще клип. */
export interface SceneClipSlot {
  sceneIndex: number
  startSec: number
  /** null — клипа для этой сцены нет (частичная генерация / пропуск шага). */
  clipDurationSec: number | null
}

/**
 * Сопоставляет сцены плана и реальные клипы 1:1 по индексу.
 *
 * Раньше voiceover брал `clipDurations[i] ?? scene.durationSec`: если клипов
 * меньше, чем сцен, хвостовые сцены молча получали плановую длительность и
 * озвучка уезжала относительно картинки. Теперь отсутствие клипа видно явно.
 */
export function buildSceneClipTimeline(
  clipDurations: number[],
  sceneCount: number,
): SceneClipSlot[] {
  const slots: SceneClipSlot[] = []
  let acc = 0
  for (let i = 0; i < sceneCount; i++) {
    const clipDur = clipDurations[i]
    slots.push({
      sceneIndex: i,
      startSec: acc,
      clipDurationSec: clipDur ?? null,
    })
    if (clipDur !== undefined) acc += clipDur
  }
  return slots
}
