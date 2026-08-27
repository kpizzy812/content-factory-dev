/**
 * Локальная замена куска трека озвучки.
 *
 * Инструмент починки, а не основной путь (spec §4.5). Оператор правит одну
 * фразу — синтезируется ТОЛЬКО она и вклеивается в трек по границам пауз.
 * Альтернатива — пересинтез всего трека, а он обесценивает все аватарные кадры
 * ролика: TTS ~$0.07, lip-sync ~$0.7, то есть правка слова стоила бы как новый
 * ролик.
 *
 * Точки реза ищутся по ТИШИНЕ, а не по границам выравнивания. Граница
 * выравнивания — это конец слова, то есть звук ещё идёт; рез там даёт щелчок.
 * Середина паузы оставляет запас тишины с обеих сторон.
 *
 * Обе точки реза притягиваются к границе кадра той же `snapSecToFrame`, что и
 * вырезка куска: по притянутым границам считается ключ переиспользования
 * (`segmentIdentity`), и дрожание в единицы миллисекунд там означает
 * переоплату lip-sync на весь ролик.
 *
 * Функция чистая: тишины приходят от `detectSilenceRanges`, процесс здесь не
 * запускается (по образцу `planPauseSplit` и `planSegmentCut`).
 */

import type { SilenceRange } from "../video-tools/silence-detect"
import { snapSecToFrame, trackEndFrame } from "./segment-cut"

/** Кроссфейд на стыке. Несколько миллисекунд: длиннее — съест начало слова. */
export const DEFAULT_SPLICE_CROSSFADE_SEC = 0.02

/**
 * Насколько далеко от границы сцены разрешено искать паузу.
 *
 * Дальше — это уже пауза соседней реплики, и вклейка по ней стёрла бы чужой
 * текст. Полсекунды примерно равны длине одного слова.
 */
const SILENCE_SEARCH_RADIUS_SEC = 0.6

export interface SpliceInput {
  /** Границы заменяемой сцены из выравнивания. */
  sceneStartSec: number
  sceneEndSec: number
  /** Измеренная ffprobe длительность трека. */
  trackDurationSec: number
  fps: number
  silences: readonly SilenceRange[]
  crossfadeSec?: number
}

export interface SplicePlan {
  /** Откуда вырезаем старое. */
  cutStartSec: number
  /** До какой секунды вырезаем. */
  cutEndSec: number
  crossfadeSec: number
  /** Нашлась ли пауза с каждой стороны. false — резали по границе сцены. */
  anchoredToSilence: { start: boolean, end: boolean }
}

/**
 * Середина ближайшей паузы в пределах радиуса поиска. null — такой паузы нет.
 *
 * Диапазон нулевой (и отрицательной) длины паузой не считается: тишины в нём
 * нет ни миллисекунды, а по расстоянию он способен побить настоящую паузу и
 * увести рез в середину слова. Нечисловые границы (разметка тишины
 * best-effort и переживает сериализацию в снапшот шага) по той же причине
 * отбрасываются до арифметики, а не после: `null` в паре даёт середину 0, и
 * рядом с началом трека такой «диапазон» прошёл бы по радиусу.
 */
function nearestSilenceMid(
  silences: readonly SilenceRange[],
  atSec: number,
  fps: number,
): number | null {
  let best: number | null = null
  let bestDistance = SILENCE_SEARCH_RADIUS_SEC

  for (const silence of silences) {
    if (!Number.isFinite(silence.startSec) || !Number.isFinite(silence.endSec)) continue
    if (silence.endSec <= silence.startSec) continue
    const mid = (silence.startSec + silence.endSec) / 2
    const distance = Math.abs(mid - atSec)
    // Строго ближайшая: без обновления порога сюда попала бы просто последняя
    // подошедшая пауза, то есть рез уехал бы в соседнюю реплику.
    if (distance <= bestDistance) {
      bestDistance = distance
      best = snapSecToFrame(mid, fps)
    }
  }

  return best
}

/**
 * Точки реза под вклейку. `null` — вклеивать некуда, вызывающий обязан
 * отказаться от замены, а не резать наугад.
 *
 * Отдельной проверки «конец сцены раньше начала» здесь нет намеренно: такой
 * интервал всегда схлопывается на проверке `cutEndSec <= cutStartSec` ниже.
 * Обе точки ищут паузу в одном и том же списке с одним и тем же радиусом, и
 * ближайшая к более раннему концу пауза не может оказаться правее ближайшей к
 * более позднему началу — развести перевёрнутый интервал в правильный порядок
 * паузам нечем. Дублирующая проверка выглядела бы как защита, но ни один вход
 * её бы не задел (проверено мутацией, отчёт Task 1).
 */
export function planSegmentSplice(input: SpliceInput): SplicePlan | null {
  const { fps, sceneEndSec, sceneStartSec, trackDurationSec } = input
  if (!Number.isFinite(trackDurationSec) || trackDurationSec <= 0) return null
  if (!Number.isFinite(sceneStartSec) || !Number.isFinite(sceneEndSec)) return null

  const trackEnd = trackEndFrame(trackDurationSec, fps)

  const startAnchor = nearestSilenceMid(input.silences, sceneStartSec, fps)
  const endAnchor = nearestSilenceMid(input.silences, sceneEndSec, fps)

  // За концом трека звука нет, до нуля его тоже нет: границы выравнивания
  // могут вылезти в обе стороны, а ffmpeg на такой рез отдаст пустой кусок.
  const cutStartSec = Math.max(0, startAnchor ?? snapSecToFrame(sceneStartSec, fps))
  const cutEndSec = Math.min(trackEnd, endAnchor ?? snapSecToFrame(sceneEndSec, fps))
  // Резать нечего: сцена схлопнулась после зажатия, целиком лежит за концом
  // трека или пришла перевёрнутой. Пустой интервал в ffmpeg — не «ничего», а
  // ошибка, и вклейка молча снесла бы кусок соседней реплики.
  if (cutEndSec <= cutStartSec) return null

  return {
    cutStartSec,
    cutEndSec,
    crossfadeSec: input.crossfadeSec ?? DEFAULT_SPLICE_CROSSFADE_SEC,
    anchoredToSilence: { start: startAnchor !== null, end: endAnchor !== null },
  }
}

/**
 * Граф `filter_complex` склейки: голова трека, новая фраза, хвост трека.
 *
 * Кроссфейд `acrossfade` вместо `concat` на стыках: даже при резе по тишине
 * уровни двух записей отличаются, и прямая склейка даёт слышимую ступеньку.
 * Вход 0 — исходный трек, вход 1 — пересинтезированная фраза.
 *
 * Пустые куски не создаются вовсе: `atrim=0:0` в concat это ошибка ffmpeg, а не
 * «ничего».
 *
 * Длительность результата отсюда НЕ выводится: `acrossfade` накладывает потоки
 * друг на друга, поэтому склейка короче суммы кусков на кроссфейд с каждого
 * стыка. Длительность склеенного трека меряется ffprobe заново (решение №5
 * плана) — сложением её считать нельзя.
 */
export function buildSpliceFilters(
  plan: SplicePlan,
  replacementDurationSec: number,
  trackDurationSec: number,
): string[] {
  const filters: string[] = []
  const labels: string[] = []

  const hasHead = plan.cutStartSec > 0
  const hasTail = plan.cutEndSec < trackDurationSec

  if (hasHead) {
    filters.push(`[0:a]atrim=0:${plan.cutStartSec.toFixed(3)},asetpts=N/SR/TB[head]`)
    labels.push("[head]")
  }

  filters.push(`[1:a]atrim=0:${replacementDurationSec.toFixed(3)},asetpts=N/SR/TB[mid]`)
  labels.push("[mid]")

  if (hasTail) {
    filters.push(
      `[0:a]atrim=${plan.cutEndSec.toFixed(3)}:${trackDurationSec.toFixed(3)},asetpts=N/SR/TB[tail]`,
    )
    labels.push("[tail]")
  }

  // Склейка попарно кроссфейдом: acrossfade принимает ровно два входа.
  let current = labels[0]!
  for (let index = 1; index < labels.length; index += 1) {
    const output = index === labels.length - 1 ? "[aout]" : `[mix${index}]`
    filters.push(
      `${current}${labels[index]}acrossfade=d=${plan.crossfadeSec.toFixed(3)}:c1=tri:c2=tri${output}`,
    )
    current = output
  }
  // Склеивать не с чем — фраза заменила трек целиком. Метка `[aout]` всё равно
  // обязана существовать: без неё ffmpeg нечего мапить в выходной файл.
  if (labels.length === 1) filters.push(`${current}anull[aout]`)

  return filters
}
