/**
 * Кусок общего трека под одну сцену.
 *
 * На маршруте «монтаж от звука» речь ролика синтезирована ОДНИМ вызовом TTS
 * (§3), и именно этот трек лежит под таймлайном. Посценный синтез на таком
 * ролике вреден вдвойне: у модели TTS нет seed, вторая запись звучит иначе той,
 * что уже в сборке (губы разъезжаются со звуком), и платится она второй раз.
 * Поэтому звук сцены не синтезируется, а ВЫРЕЗАЕТСЯ из готового трека по
 * границам выравнивания (`transcription/align.ts`).
 *
 * Интервал сцены при этом не раздвигается ни вперёд, ни назад: соседняя секунда
 * трека — это чужая реплика, и губы, произносящие чужие слова, брак худший, чем
 * короткий кадр. Кусок короче минимума модели добивается ТИШИНОЙ (`apad`):
 * молчащие в хвосте губы выглядят естественно.
 *
 * Планирование границ и сборка аргументов ffmpeg — чистые функции без запуска
 * процесса (по образцу `planPauseSplit` в `insert-pauses.ts`, `buildStillClipArgs`
 * и `parseSilenceRangesFromStderr` в `video-tools/`): их видно тестом.
 *
 * Ключ переиспользования куска строится от ИНТЕРВАЛА и ОТПЕЧАТКА ТРЕКА, а не от
 * текста реплики (spec §4.4). Текст может не измениться при полностью
 * перезаписанном треке — и тогда ключ от текста подставил бы к свежему звуку
 * старые губы.
 */

import { createHash, randomUUID } from "node:crypto"
import { rename, unlink } from "node:fs/promises"
import { extname } from "node:path"
import ffmpeg from "fluent-ffmpeg"
import type { AlignedScene } from "../transcription/align"

/** Куда пришлось подвинуть длительность ради требований модели. */
export type SegmentClamp = "min" | "max" | false

export interface SegmentCut {
  /** Начало куска В ТРЕКЕ. */
  startSec: number
  /** Конец куска В ТРЕКЕ: реального звука дальше этой точки в куске нет. */
  endSec: number
  /**
   * Длительность ФАЙЛА, который получит модель: интервал плюс добивка тишиной.
   * Совпадает с `endSec - startSec`, пока добивки нет.
   */
  durationSec: number
  /** Сколько тишины добавлено в хвост, чтобы добрать минимум модели. */
  silencePadSec: number
  /**
   * Длительность подогнана под требования модели: `"max"` — интервал обрезан по
   * потолку, `"min"` — добит тишиной до минимума. Вызывающий обязан написать об
   * этом в лог, причём РАЗНЫМ текстом: обрезанный хвост речи и добитая тишина —
   * это разные новости.
   */
  clampedToModel: SegmentClamp
}

export interface SegmentCutInput {
  scene: Pick<AlignedScene, "order" | "startSec" | "endSec">
  /** Длительность общего трека: за неё кусок вылезать не имеет права. */
  trackDurationSec: number
  /** Частота кадров ролика; <= 0 — притягивать границы не к чему. */
  fps: number
  /** Требования lip-sync модели к длительности материала. */
  model: { minDurationSec: number, maxDurationSec: number }
}

/** Есть ли к чему притягивать границы: fps должен быть конечным и положительным. */
function usableFps(fps: number): boolean {
  return Number.isFinite(fps) && fps > 0
}

/**
 * Ближайшая граница кадра.
 *
 * Экспортируется не только ради вырезки: по притянутым границам считается и ключ
 * переиспользования сцены. Дрожание выравнивания в единицы миллисекунд даёт тот
 * же кадр и тот же байт в байт mp3 — менять из-за него ключ значит переоплачивать
 * lip-sync всего ролика на пустом месте.
 */
export function snapSecToFrame(sec: number, fps: number): number {
  return usableFps(fps) ? Math.round(sec * fps) / fps : sec
}

/** Граница кадра НЕ ПОЗЖЕ заданной секунды — для верхних потолков. */
function floorToFrame(sec: number, fps: number): number {
  return usableFps(fps) ? Math.floor(sec * fps) / fps : sec
}

/**
 * Конец трека, притянутый вниз к кадру: дальше него звука нет.
 * Длительность неизвестна — потолка нет вовсе (`Infinity`).
 *
 * Экспортируется по той же причине, что и `snapSecToFrame`: ключ переиспользования
 * обязан обрезать границы ровно так же, как вырезка, иначе дрожание границ ЗА
 * концом трека даст тот же кусок, но другой ключ.
 */
export function trackEndFrame(trackDurationSec: number, fps: number): number {
  return Number.isFinite(trackDurationSec) && trackDurationSec > 0
    ? floorToFrame(trackDurationSec, fps)
    : Number.POSITIVE_INFINITY
}

/**
 * Границы куска: от выравнивания, притянутые к кадру, обрезанные длиной трека и
 * подогнанные под диапазон длительности модели.
 *
 * Порядок именно такой. Сначала кадр — сборка режет видео по кадрам, и звук,
 * начатый в середине кадра, уезжает от картинки на полкадра уже на старте.
 * Потом трек — за его концом звука просто нет. И только потом модель: её
 * диапазон это ограничение инструмента, а не факт материала.
 *
 * Короткий кусок НЕ раздвигается по треку (см. шапку модуля) — недостающее
 * добирается тишиной. Пустой интервал не добивается вовсе: файл из одной тишины
 * это оплаченная съёмка молчащих губ, и вызывающий обязан такую сцену отклонить.
 */
export function planSegmentCut(input: SegmentCutInput): SegmentCut {
  const { fps, model, trackDurationSec } = input
  const trackEnd = trackEndFrame(trackDurationSec, fps)

  let startSec = Math.max(0, snapSecToFrame(input.scene.startSec, fps))
  let endSec = Math.min(snapSecToFrame(input.scene.endSec, fps), trackEnd)
  if (startSec > trackEnd) startSec = Math.max(0, trackEnd)
  if (endSec < startSec) endSec = startSec

  let clampedToModel: SegmentClamp = false
  let silencePadSec = 0
  const intervalSec = endSec - startSec

  if (Number.isFinite(model.maxDurationSec) && intervalSec > model.maxDurationSec) {
    // Вниз до кадра: округление вверх дало бы кусок длиннее потолка модели,
    // и провайдер отбил бы вызов уже после оплаты подготовки.
    endSec = floorToFrame(startSec + model.maxDurationSec, fps)
    clampedToModel = "max"
  } else if (Number.isFinite(model.minDurationSec) && intervalSec > 0 && intervalSec < model.minDurationSec) {
    silencePadSec = model.minDurationSec - intervalSec
    clampedToModel = "min"
  }

  return {
    startSec,
    endSec,
    durationSec: endSec - startSec + silencePadSec,
    silencePadSec,
    clampedToModel,
  }
}

export interface SegmentIdentityInput {
  videoId: number
  sceneOrder: number
  startSec: number
  endSec: number
  /**
   * Отпечаток самого трека. Пересинтезированный трек обязан обесценить все
   * ранее вырезанные куски: текст сцены при этом мог не измениться ни на букву.
   */
  trackFingerprint: string
  /**
   * Добивка тишиной. Обязательна там, где отпечаток идёт в ИМЯ ФАЙЛА: границы
   * при нижнем зажатии не двигаются, и модель с минимумом 2 с и модель с
   * минимумом 3 с дали бы одно имя для файлов разной длины — старый двухсекундный
   * mp3 переиспользовался бы там, где нужен трёхсекундный.
   *
   * В ключе переиспользования сцены не нужна: там минимум модели уже учтён её id.
   */
  silencePadSec?: number
}

/**
 * Отпечаток куска: ролик, сцена, границы с точностью до миллисекунды, трек и
 * добивка тишиной. Текста реплики здесь нет намеренно — см. шапку модуля.
 */
export function segmentIdentity(input: SegmentIdentityInput): string {
  return createHash("sha1")
    .update([
      input.videoId,
      input.sceneOrder,
      Math.round(input.startSec * 1000),
      Math.round(input.endSec * 1000),
      Math.round((input.silencePadSec ?? 0) * 1000),
      input.trackFingerprint,
    ].join(" "))
    .digest("hex")
}

export interface SegmentCutArgs {
  /** Опции ВХОДА: перемотка к началу куска. */
  inputOptions: string[]
  /** Аудиофильтры: добивка тишиной, если она нужна. Иначе пусто. */
  audioFilters: string[]
  /** Опции выхода: длина файла и кодек. */
  outputOptions: string[]
}

/**
 * Аргументы ffmpeg для вырезки куска. Чистая функция: процесс не запускается,
 * поэтому проверяется тестом целиком.
 *
 * `-ss` ставится ВХОДНЫМ параметром (быстрая перемотка), длина задаётся `-t`, а
 * не `-to`: после входной перемотки таймстемпы сбрасываются, и `-to` в разных
 * сборках ffmpeg считается то от начала файла, то от точки реза — на платном
 * шаге такой лотереи быть не должно.
 *
 * Добивка тишиной — `apad=whole_dur`, тот же приём тишины, что `anullsrc` в
 * `insert-pauses.ts`, но без склейки: хвост дополняется на месте.
 *
 * Поток перекодируется (libmp3lame), а не копируется: mp3-фрейм длится ~26 мс,
 * и копия резалась бы по границе фрейма, а не по границе кадра видео.
 */
export function buildSegmentCutArgs(cut: SegmentCut): SegmentCutArgs {
  return {
    inputOptions: ["-ss", cut.startSec.toFixed(3)],
    audioFilters: cut.silencePadSec > 0 ? [`apad=whole_dur=${cut.durationSec.toFixed(3)}`] : [],
    outputOptions: ["-t", cut.durationSec.toFixed(3), "-c:a", "libmp3lame", "-b:a", "192k", "-y"],
  }
}

export interface CutTrackSegmentResult {
  path: string
  /** Измерено на готовом файле, а не взято из плана: перекодировка даёт свой хвост. */
  durationSec: number
}

/**
 * Путь временного файла вырезки: случайный суффикс встаёт ПЕРЕД расширением,
 * а не после него.
 *
 * `buildSegmentCutArgs` не задаёт муксер (`-f`) явно — ffmpeg выбирает его по
 * расширению ВЫХОДНОГО пути. Суффикс после `.mp3` (`seg.mp3.tmp-<uuid>`)
 * лишает ffmpeg расширения вовсе, и настоящий процесс отказывается писать:
 * "Unable to choose an output format ... Error opening output file" — то есть
 * КАЖДЫЙ кусок трека молча уходил бы в отказ (`track_segment_failed`), и
 * маршрут «монтаж от звука» оставался бы без lip-sync целиком. Расширение
 * обязано остаться последним символом пути.
 *
 * Чистая функция — по образцу `buildSegmentCutArgs`: без отдельного теста эта
 * дыра видна только настоящему ffmpeg, а любой мок в тестах пишет по тому
 * пути, который ему дали, и такую ошибку не ловит.
 */
export function buildTempSegmentPath(outputPath: string): string {
  const ext = extname(outputPath)
  const base = ext ? outputPath.slice(0, -ext.length) : outputPath
  return `${base}.tmp-${randomUUID()}${ext}`
}

/**
 * Переименование с повтором: на Windows `rename` поверх файла, который в тот
 * же момент создаёт (или только что создал) параллельный прогон, изредка
 * падает `EPERM`/`EBUSY` — антивирус или файловый индексатор коротко держит
 * блокировку на только что записанном файле. POSIX этой проблемы не знает,
 * но повтор там безвреден, а отдельная ветка "только Windows" не окупала бы
 * себя. Любая другая ошибка (например `ENOENT` — временного файла нет)
 * пробрасывается немедленно, без единой лишней попытки.
 *
 * `renameFile` инжектируется по образцу `probeDuration` в `cutTrackSegment`:
 * три ветки (повтор после EPERM/EBUSY, исчерпание попыток, немедленный
 * проброс прочих ошибок) — гонка на реальной файловой системе, которую без
 * инъекции пришлось бы либо не проверять вовсе, либо ловить только на
 * Windows, когда повезёт.
 */
export async function renameWithRetry(
  from: string,
  to: string,
  attempts = 5,
  renameFile: (from: string, to: string) => Promise<void> = rename,
): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await renameFile(from, to)
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (attempt === attempts || (code !== "EPERM" && code !== "EBUSY")) throw err
      await new Promise(resolve => setTimeout(resolve, 25 * attempt))
    }
  }
}

/**
 * Вырезает кусок трека в отдельный файл по плану `buildSegmentCutArgs`.
 *
 * Пишет во ВРЕМЕННЫЙ файл рядом с `outputPath` (тот же том — переименование
 * между томами не атомарно) и переименовывает его в целевой путь ТОЛЬКО
 * после успешного замера длительности готового файла. Имя куска
 * контент-адресное, а `ensureTrackSegment` (`lip-sync-runner.ts`)
 * переиспользует его по факту существования файла на конечном пути: без
 * temp+rename оборванный процесс (SIGKILL, рестарт воркера) посреди ffmpeg
 * оставил бы недописанный mp3 под валидным именем НАВСЕГДА, и следующий
 * прогон отдал бы его в платный lip-sync — губы, произносящие обрубленную
 * фразу, за реальные деньги.
 *
 * Неудачный замер (`probeDuration` вернул `null`) — тоже падение: конечный
 * путь остаётся пустым, временный файл подчищается, а вызывающий получает
 * исключение и честно помечает сцену несинхронизированной. Подставлять
 * плановую длительность вместо измеренной здесь нельзя — тогда неизмеримый
 * (битый) файл молча сошёл бы за готовый кусок под тем же именем.
 *
 * Имя временного файла (`buildTempSegmentPath`) содержит случайный суффикс:
 * два параллельных прогона могут резать один и тот же кусок одновременно
 * (тот же ролик, тот же трек, повторный заход до завершения первого), и
 * общее имя дало бы одному прогону дописать чужой ещё не готовый временный
 * файл. С уникальным суффиксом каждый прогон пишет СВОЙ temp и переименовывает
 * его независимо; `rename` — одна атомарная операция ОС, поэтому конечный
 * путь в любой момент содержит либо старый файл, либо один из полностью
 * готовых новых — никогда огрызок. Переименование поверх файла, который
 * параллельно занял второй прогон (антивирус/индексатор Windows держит его
 * короткую долю секунды), ретраится — см. `renameWithRetry`.
 */
export async function cutTrackSegment(input: {
  trackPath: string
  outputPath: string
  cut: SegmentCut
  probeDuration: (path: string) => Promise<number | null>
}): Promise<CutTrackSegmentResult> {
  const { cut, outputPath, trackPath } = input
  const args = buildSegmentCutArgs(cut)
  const tempPath = buildTempSegmentPath(outputPath)

  try {
    await new Promise<void>((resolve, reject) => {
      const stderrTail: string[] = []
      const command = ffmpeg(trackPath).inputOptions(args.inputOptions)
      if (args.audioFilters.length > 0) command.audioFilters(args.audioFilters)
      command
        .outputOptions(args.outputOptions)
        .output(tempPath)
        .on("stderr", (line: string) => {
          stderrTail.push(line)
          if (stderrTail.length > 20) stderrTail.shift()
        })
        .on("end", () => resolve())
        .on("error", (err: Error) => {
          const tail = stderrTail.slice(-10).join("\n")
          reject(new Error(
            `Не удалось вырезать кусок ${cut.startSec.toFixed(3)}-${cut.endSec.toFixed(3)}с из трека ${trackPath}: ${err.message}`
            + (tail ? `\n--- stderr ---\n${tail}` : ""),
          ))
        })
        .run()
    })

    // Замер ДО переименования и именно у временного файла — ради этого
    // порядка всё и затевалось (см. докстринг). Провал замера здесь — тоже
    // падение, а не повод подставить плановую длительность.
    const measured = await input.probeDuration(tempPath)
    if (measured === null) {
      throw new Error(
        `Кусок трека ${cut.startSec.toFixed(3)}-${cut.endSec.toFixed(3)}с из ${trackPath} вырезан, но его длительность не измеряется — файл повреждён, в конечный путь не переименовываю`,
      )
    }

    await renameWithRetry(tempPath, outputPath)
    return { path: outputPath, durationSec: measured }
  } catch (err) {
    // Подчистка временного файла не должна маскировать исходную ошибку своей:
    // не удалось удалить (temp мог не появиться вовсе, если упал сам ffmpeg) —
    // наружу всё равно уходит причина падения вырезки/замера, а не ошибка unlink.
    await unlink(tempPath).catch(() => {})
    throw err
  }
}
