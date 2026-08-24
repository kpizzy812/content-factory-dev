/**
 * Вырезка подотрезка готового видео под кадр монтажа.
 *
 * Зачем отдельно: в проекте вырезки `[a, b]` для видео не было вовсе.
 * `buildClipTrimArgs` (`render.ts`) режет только ОТ НУЛЯ, а единственная
 * произвольная вырезка — `buildPresenterCutArgs` в `presenter/ffmpeg-adapter.ts`
 * — принудительно масштабирует в 1080x1920 и заточена под запись ведущего.
 *
 * Чистая функция: собирает аргументы, процесс не запускает (по образцу
 * `buildStillClipArgs` в `./still-clip.ts`). Модуль НЕ импортирует
 * `./ffmpeg.ts`: тот на уровне модуля зовёт `setFfmpegPath`, и его появление в
 * графе ломает инвариант lip-sync.
 *
 * Семантика `-t` при немом источнике (`audioPresent: false`): `anullsrc`
 * (второй `-i`) — бесконечный генератор, но `-t` здесь стоит ПОСЛЕ обоих `-i`
 * и перед выходным файлом, поэтому ffmpeg трактует его как ВЫХОДНУЮ опцию —
 * она обрезает результат ровно по `durationSec` независимо от длины входов.
 * `-shortest` в этой связке избыточен (то же самое уже делает `-t`), но
 * оставлен для единообразия с `still-clip.ts`, где `-loop 1` на картинке тоже
 * бесконечен и работает по той же связке `-t` + `-shortest`.
 */

import { TIMELINE_FPS } from "~~/shared/types/video-runtime"

export interface ShotSubClipRequest {
  sourcePath: string
  startSec: number
  durationSec: number
  outputPath: string
  /** Есть ли у источника звуковая дорожка. Нет — синтезируем немую. */
  audioPresent: boolean
}

/** Кадр короче этого не существует: ffmpeg отдаёт пустой файл. */
const MIN_SUB_CLIP_SEC = 1 / TIMELINE_FPS

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0
}

export function buildShotSubClipArgs(request: ShotSubClipRequest): string[] {
  const startSec = Math.max(0, finiteOrZero(request.startSec))
  const durationSec = Math.max(MIN_SUB_CLIP_SEC, finiteOrZero(request.durationSec))

  const args = [
    "-y",
    // -ss ПЕРЕД -i: быстрый поиск по контейнеру. При обратном порядке ffmpeg
    // декодирует весь клип до точки реза, и на сорока кадрах это минуты.
    "-ss", startSec.toFixed(3),
    "-i", request.sourcePath,
  ]

  if (!request.audioPresent) {
    args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100")
  }

  args.push(
    "-t", durationSec.toFixed(3),
    // Пересчёт PTS обязателен: без него у вырезки остаётся исходный штамп
    // времени, и concat кладёт кадр не туда.
    "-vf", `setpts=PTS-STARTPTS,fps=${TIMELINE_FPS},format=yuv420p`,
    "-af", "asetpts=PTS-STARTPTS",
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
  )

  return args
}
