/**
 * Приведение длинной записи ведущего к единому виду перед хранением.
 *
 * Оригинал 4K60 не храним: в ролик уходит 1080p, а разница в объёме кратная
 * (spec §6.1). Но соотношение сторон СОХРАНЯЕМ — кроп в 9:16 при загрузке
 * уничтожил бы свободу кадрирования, ради которой запись и хранится: крупный
 * план, средний план и PiP-окно берутся из одного материала разными кропами, и
 * каждый такой кроп меняет последовательность перцептивных хэшей, то есть
 * работает на уникальность (docs/PROJECT_CONTEXT.md §7).
 *
 * Чистая функция без запуска процесса — по образцу `buildPresenterCutArgs`
 * в `ffmpeg-adapter.ts`: ошибка в порядке `-i`/`-vf` глазами не видна, а
 * стоит перекодирования гигабайтного файла впустую.
 */

/** Потолок большей стороны. 1080p в ролике, запас на кроп — 1920. */
export const RECORDING_MAX_SIDE = 1920

/** Частота нормализованной записи: та же, что у таймлайна сборки (TIMELINE_FPS). */
export const RECORDING_FPS = 30

export interface RecordingNormalizeOptions {
  maxSide?: number
  fps?: number
}

export function buildRecordingNormalizeArgs(
  inputPath: string,
  outputPath: string,
  options: RecordingNormalizeOptions = {},
): string[] {
  const maxSide = options.maxSide ?? RECORDING_MAX_SIDE
  const fps = options.fps ?? RECORDING_FPS

  // Рамка квадратная по большей стороне: и вертикальная, и горизонтальная
  // запись впишется в неё без обрезки, а `decrease` не увеличит маленький кадр.
  const scale = `scale=${maxSide}:${maxSide}:force_original_aspect_ratio=decrease`
    + ",scale=trunc(iw/2)*2:trunc(ih/2)*2"

  return [
    "-hide_banner",
    "-nostats",
    "-y",
    "-i", inputPath,
    "-vf", scale,
    "-r", String(fps),
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    outputPath,
  ]
}
