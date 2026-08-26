/**
 * Перебивка из неподвижного кадра.
 *
 * Картинка сцены превращается в клип нужной длины средствами ffmpeg. Платного
 * вызова к провайдеру здесь нет вовсе: кадр уже оплачен на шаге изображений
 * ($0.025 у flux-dev), тогда как та же перебивка через text-to-video стоила бы
 * $0.045 за каждую секунду.
 *
 * Движение берётся из общего набора планов (`shot-variation.ts`) — тем же
 * механизмом, что и смена плана внутри снятой сцены. Статичная картинка без
 * движения выглядит как заминка и ломает темп, поэтому план выбирается всегда.
 *
 * Звуковая дорожка обязательна: остальные клипы ролика идут со звуком, а немой
 * файл в concat сдвигает таймлайн и разводит субтитры с картинкой.
 */

import { buildShotVariationFilter, pickShotVariationPlan } from "./shot-variation"
import { TIMELINE_FPS } from "~~/shared/types/video-runtime"

export interface StillClipRequest {
  imagePath: string
  outputPath: string
  durationSec: number
  /**
   * Индекс, выбирающий план движения. На старом маршруте это индекс сцены, на
   * кадровом — номер ГРУППЫ кадров с одним фоном (`planShotVariationSlices`),
   * чтобы соседние перебивки различались, а куски одной группы — нет.
   */
  sceneIndex: number
  format: "portrait" | "landscape"
  /**
   * Смещение этого куска внутри общей траектории группы. Не задано — кусок
   * первый (и это единственное поведение старого маршрута).
   */
  variationOffsetSec?: number
  /**
   * Полная длина траектории группы. Не задана — траектория равна длине самого
   * клипа, то есть прежнее поведение «панорама целиком за один кадр».
   */
  variationSpanSec?: number
}

/** Минимальная длина перебивки: кадр короче секунды читается как артефакт склейки. */
const MIN_STILL_DURATION_SEC = 1

export function buildStillClipArgs(request: StillClipRequest): string[] {
  const target = request.format === "portrait"
    ? { w: 1080, h: 1920 }
    : { w: 1920, h: 1080 }
  const duration = Number.isFinite(request.durationSec) && request.durationSec > 0
    ? Math.max(MIN_STILL_DURATION_SEC, Math.round(request.durationSec * 100) / 100)
    : MIN_STILL_DURATION_SEC

  // Кадр сперва вписывается в формат с чёрными полями, и только потом получает
  // движение: иначе панорама поедет по полям, а не по картинке.
  const fit = `scale=${target.w}:${target.h}:force_original_aspect_ratio=decrease`
    + `,pad=${target.w}:${target.h}:-1:-1:color=black`
  // Траектория группы не может быть КОРОЧЕ самого клипа: иначе окно доедет до
  // края запаса раньше конца кадра и последние кадры замрут.
  const span = Number.isFinite(request.variationSpanSec) && (request.variationSpanSec ?? 0) > 0
    ? Math.max(request.variationSpanSec!, duration)
    : duration
  const motion = buildShotVariationFilter(
    pickShotVariationPlan(request.sceneIndex),
    target,
    span,
    request.variationOffsetSec ?? 0,
  )

  return [
    "-y",
    "-loop", "1",
    "-i", request.imagePath,
    "-f", "lavfi",
    "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-t", String(duration),
    "-vf", `${fit},${motion},fps=${TIMELINE_FPS},format=yuv420p`,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "22",
    "-profile:v", "high",
    "-level", "4.1",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "128k",
    "-ar", "44100",
    "-ac", "2",
    "-shortest",
    "-movflags", "+faststart",
    request.outputPath,
  ]
}
