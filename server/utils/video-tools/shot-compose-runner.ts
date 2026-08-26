/**
 * Запуск ffmpeg для композиции одного кадра — ведущий, фон, PiP.
 *
 * Отдельно от `shot-compose.ts` по той же причине, что и у остальных пар
 * `*-runner.ts` в этой директории: планирование — данные, проверяется без
 * процесса; здесь только spawn, временные файлы и разбор кода возврата.
 *
 * Три ветки `ShotComposition` используют уже готовые кирпичи Task 2/still-clip:
 *  - `presenter_full` → `renderShotSubClip` (Task 2) режет подотрезок кадра
 *    из уже приведённого к длине сцены клипа lip-sync;
 *  - `background_full` → неподвижный фон получает движение через
 *    `renderStillClip` (панорама уже там); видео-фон — тот же
 *    `renderShotSubClip`, с добивкой последним кадром, если источник короче
 *    кадра (`holdLastFrameFittedClip`) — сегодня это защитная ветка: видео
 *    фона генерируется НА ЭТОТ ЖЕ кадр (Task 4), и Kling квантует
 *    длительность вверх, а не вниз;
 *  - `pip` → фон и ведущий готовятся во временные файлы теми же двумя
 *    ветками, затем один `ffmpeg` с двумя `-i` и `-filter_complex` из
 *    `composition.pipFilters`, `-map "[vout]"`. Звук — синтетическая тишина
 *    (§6.4): третий вход `anullsrc`, замаплен ЯВНО — тем же приёмом, что
 *    `shot-cut.ts` (Task 2) объяснил докстрингом: implicit-выбор ffmpeg при
 *    совпадении числа каналов у обоих видео-входов может выбрать звук одного
 *    из временных файлов вместо синтетической тишины.
 */

import { spawn } from "node:child_process"
import { mkdir, rename, unlink } from "node:fs/promises"
import { dirname } from "node:path"

import type { ShotComposition } from "./shot-compose"
import type { ShotVariationSlice } from "./shot-variation"
import { renderShotSubClip } from "./shot-cut-runner"
import { renderStillClip } from "./still-clip-runner"
import { concatSafeVideoOutputOptions, holdLastFrameFittedClip, probeMediaDuration } from "../render"

export interface ShotComposeRequest {
  composition: ShotComposition
  outputPath: string
  format: "portrait" | "landscape"
}

/** Композиция кадра — самая тяжёлая операция модуля (crop+scale+geq+overlay). */
const SHOT_COMPOSE_TIMEOUT_MS = 180_000

const FFMPEG_BIN = process.env.FFMPEG_PATH || process.env.FFMPEG_BIN || "ffmpeg"

/** Кадр короче этого не существует — тот же порог, что у `shot-cut.ts`. */
const MIN_FRAME_GAP_SEC = 1 / 30

/**
 * Добивает файл до заказанной длины удержанием последнего кадра, если ffmpeg
 * выдал КОРОЧЕ (Important 3 финального ревью ветки).
 *
 * `-t`/`-shortest` — потолок, а не гарантия: живой замер ревьюера показал, что
 * вырезка `-t 2.000` из источника длиной 1.0с даёт файл 1.000000с и EXIT=0.
 * Кадр, вышедший короче своего интервала, укорачивает всю склейку: `amix
 * duration=first` режет речь по видеодорожке, вожжённые субтитры (они
 * адресуются временем ВИДЕО) уезжают вместе с картинкой, а ролик получает
 * статус «готов» — девятый путь §10.
 *
 * Защита была только у `background_full`; здесь она общая для ВСЕХ веток,
 * включая будущие. Звук трогать нельзя никогда (§8) — его и не трогаем:
 * дорожка кадра синтетическая (`anullsrc`), `buildClipHoldLastFrameArgs`
 * добивает её тишиной, а не растягивает.
 *
 * Длиннее заказанного не добиваем и не режем: усечение — единственный
 * измеренный отказ (дрейф штатных вырезок ревьюер намерил < 1 мс), а лишний
 * re-encode на каждом кадре стоит дороже, чем возможные лишние 30 мс хвоста.
 */
async function holdShortFileToDuration(path: string, targetSec: number): Promise<boolean> {
  const actualSec = await probeMediaDuration(path)
  if (actualSec === null || actualSec >= targetSec - MIN_FRAME_GAP_SEC) return false

  // `holdLastFrameFittedClip` не умеет писать в свой же вход — уводим короткий
  // файл в сторону, а результат кладём обратно на ожидаемый путь.
  const shortPath = `${path}.short.mp4`
  await rename(path, shortPath)
  try {
    await holdLastFrameFittedClip(shortPath, path, targetSec - actualSec)
  } finally {
    await unlink(shortPath).catch(() => {})
  }
  return true
}

/**
 * Полноэкранный фон: неподвижная картинка получает движение
 * (`renderStillClip`), готовое видео — обрезается/добивается до длины кадра.
 */
async function renderBackgroundFull(input: {
  backgroundPath: string
  backgroundIsStill: boolean
  durationSec: number
  variation: ShotVariationSlice
  outputPath: string
  format: "portrait" | "landscape"
}): Promise<void> {
  if (input.backgroundIsStill) {
    await renderStillClip({
      imagePath: input.backgroundPath,
      outputPath: input.outputPath,
      durationSec: input.durationSec,
      // Номер ГРУППЫ и кусок её траектории, а не номер кадра: одна картинка,
      // разрезанная на пять кадров, обязана ехать одним движением.
      sceneIndex: input.variation.index,
      variationOffsetSec: input.variation.offsetSec,
      variationSpanSec: input.variation.spanSec,
      format: input.format,
    })
    return
  }

  const actualSec = await probeMediaDuration(input.backgroundPath)
  if (actualSec !== null && actualSec < input.durationSec - MIN_FRAME_GAP_SEC) {
    // Источник короче кадра: сначала забираем всё, что есть, затем добиваем
    // нехватку удержанием последнего кадра — тот же приём, что подгон длины
    // клипа под трек (`render.ts`), только звук уже немой (`anullsrc`
    // из `renderShotSubClip`) и его не нужно отдельно добивать тишиной.
    const trimmedPath = `${input.outputPath}.trim.mp4`
    try {
      await renderShotSubClip({
        sourcePath: input.backgroundPath, startSec: 0, durationSec: actualSec, outputPath: trimmedPath,
      })
      await holdLastFrameFittedClip(trimmedPath, input.outputPath, input.durationSec - actualSec)
    } finally {
      await unlink(trimmedPath).catch(() => {})
    }
    return
  }

  // Источник не короче кадра (или неизмерим — тогда просто просим нужную
  // длину, `renderShotSubClip` сам обрежет по `-t`).
  await renderShotSubClip({
    sourcePath: input.backgroundPath, startSec: 0, durationSec: input.durationSec, outputPath: input.outputPath,
  })
}

/** Сырые аргументы наложения PiP — чистая сборка, отдельно от spawn ради читаемости. */
function buildPipOverlayArgs(input: {
  backgroundPath: string
  presenterPath: string
  filters: string[]
  durationSec: number
  outputPath: string
}): string[] {
  return [
    "-y",
    "-i", input.backgroundPath,
    "-i", input.presenterPath,
    // Синтетическая немая дорожка — БЕЗУСЛОВНО (§6.4), тем же приёмом, что
    // `shot-cut.ts`: implicit-автовыбор ffmpeg при совпадении числа каналов
    // между двумя видео-входами не заслуживает доверия (Task 2, ре-ревью).
    "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-filter_complex", input.filters.join(";"),
    "-map", "[vout]",
    "-map", "2:a:0",
    "-t", input.durationSec.toFixed(3),
    ...concatSafeVideoOutputOptions(),
    "-c:a", "aac",
    "-b:a", "128k",
    "-ar", "44100",
    "-ac", "2",
    "-shortest",
    input.outputPath,
  ]
}

async function runFfmpeg(args: string[], failMessage: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, args, { stdio: ["ignore", "ignore", "pipe"] })
    let stderr = ""

    const timer = setTimeout(() => {
      try { proc.kill("SIGKILL") }
      catch { /* процесс уже мёртв */ }
      reject(new Error(`ffmpeg: таймаут ${Math.round(SHOT_COMPOSE_TIMEOUT_MS / 1000)}s на композиции кадра`))
    }, SHOT_COMPOSE_TIMEOUT_MS)

    proc.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8") })
    proc.on("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    proc.on("close", (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(`${failMessage}: ffmpeg завершился с кодом ${code}: ${stderr.slice(-400)}`))
        return
      }
      resolve()
    })
  })
}

async function renderPip(
  composition: Extract<ShotComposition, { kind: "pip" }>,
  outputPath: string,
  format: "portrait" | "landscape",
): Promise<void> {
  const bgTemp = `${outputPath}.bg.mp4`
  const presenterTemp = `${outputPath}.presenter.mp4`
  try {
    await renderBackgroundFull({
      backgroundPath: composition.backgroundPath,
      backgroundIsStill: composition.backgroundIsStill,
      durationSec: composition.durationSec,
      variation: composition.variation,
      outputPath: bgTemp,
      format,
    })
    await renderShotSubClip({
      sourcePath: composition.presenterPath,
      startSec: composition.presenterOffsetSec,
      durationSec: composition.durationSec,
      outputPath: presenterTemp,
    })
    // Ведущий короче кадра здесь НЕ добивается намеренно, и это проверено
    // живым ffmpeg (Important 3, фикс-волна): `overlay` работает с
    // `eof_action=repeat` по умолчанию, то есть сам удерживает последний кадр
    // PiP-окна до конца ФОНА, а `-shortest` считает выходные потоки — [vout]
    // длится столько же, сколько фон. Замер: фон 3.000с + ведущий 1.000с тем
    // же графом дают выход 3.000000с. Отдельная добивка presenter-временника
    // была бы мёртвым кодом, а замри-добивка поверх готового наложения ещё и
    // заморозила бы заодно живой фон.
    const args = buildPipOverlayArgs({
      backgroundPath: bgTemp,
      presenterPath: presenterTemp,
      filters: composition.pipFilters,
      durationSec: composition.durationSec,
      outputPath,
    })
    await runFfmpeg(args, "Не удалось собрать PiP-композицию кадра")
  } finally {
    await unlink(bgTemp).catch(() => {})
    await unlink(presenterTemp).catch(() => {})
  }
}

/**
 * Собирает один кадр монтажа в один готовый файл по плану `planShotComposition`.
 *
 * Последним делом — замер готового файла и добивка удержанием кадра, если он
 * вышел короче заказанного (Important 3 финального ревью). Проверка стоит
 * ЗДЕСЬ, а не в каждой ветке: так её нельзя забыть в новой ветке композиции,
 * и она страхует даже те ветки, где добивка уже сделана внутри (`pip`,
 * `background_full`) — там она просто ничего не находит.
 */
export async function renderShotComposition(request: ShotComposeRequest): Promise<void> {
  await mkdir(dirname(request.outputPath), { recursive: true })
  const { composition } = request

  switch (composition.kind) {
    case "presenter_full":
      await renderShotSubClip({
        sourcePath: composition.presenterPath,
        startSec: composition.offsetSec,
        durationSec: composition.durationSec,
        outputPath: request.outputPath,
      })
      break
    case "background_full":
      await renderBackgroundFull({
        backgroundPath: composition.backgroundPath,
        backgroundIsStill: composition.backgroundIsStill,
        durationSec: composition.durationSec,
        variation: composition.variation,
        outputPath: request.outputPath,
        format: request.format,
      })
      break
    case "pip":
      await renderPip(composition, request.outputPath, request.format)
  }

  await holdShortFileToDuration(request.outputPath, composition.durationSec)
}
