/**
 * Приведение громкости закадрового голоса к цели (EBU R128).
 *
 * До этого голос уходил в микс как есть — `volume=1.0`. Измерено на одной
 * реплике: MiniMax отдаёт −25.8 LUFS, Fish −17.4, живая запись ведущей −22.6.
 * Разброс между моделями 8 LU: смена модели озвучки уводила громкость всей
 * партии, и заметил бы это зритель в ленте, а не оператор.
 *
 * Площадки всё равно нормализуют ролик к своим ~−14 LUFS: тихий поднимут
 * вместе с шумом, громкий прижмут. Прийти туда своими руками дешевле, чем
 * отдавать это их алгоритму.
 *
 * Компрессора здесь нет намеренно: обе модели отдают динамический диапазон
 * 0.7–0.9 LU против 12.8 LU у живой записи — они уже пережаты. Компрессор
 * сделал бы речь ещё мертвее, а мертвее это ровно та претензия, из-за которой
 * мы меняли модель.
 */

/** Цель доставки. −14 LUFS — то, к чему приводят TikTok, YouTube и Instagram. */
export const LOUDNESS_TARGET = Object.freeze({
  integratedLufs: -14,
  /** Запас до цифрового потолка: после сведения с музыкой пики складываются. */
  truePeakDb: -1.5,
  /** Диапазон не сжимаем: 11 LU — «не трогай, если уже уложился». */
  loudnessRangeLu: 11,
})

/**
 * Потолок лимитера в ЛИНЕЙНОЙ амплитуде: `alimiter` принимает её, а не
 * децибелы. Передать сюда «-1.5» значило бы задать отрицательный потолок.
 */
export const LIMITER_CEILING = Number((10 ** (LOUDNESS_TARGET.truePeakDb / 20)).toFixed(4))

/** Измеренные первым проходом значения. Строки, а не числа: ffmpeg ждёт их дословно. */
export interface LoudnormMeasurement {
  inputI: string
  inputTp: string
  inputLra: string
  inputThresh: string
  targetOffset: string
}

function targetParams(): string {
  return `I=${LOUDNESS_TARGET.integratedLufs}:TP=${LOUDNESS_TARGET.truePeakDb}`
    + `:LRA=${LOUDNESS_TARGET.loudnessRangeLu}`
}

/** Первый проход: ничего не меняет, печатает замер в JSON. */
export function buildLoudnormMeasureFilter(): string {
  return `loudnorm=${targetParams()}:print_format=json`
}

/**
 * Второй проход.
 *
 * С замером `loudnorm` работает линейно — ровный сдвиг усиления, форма речи
 * не трогается. Без замера остаётся однопроходный динамический режим: он
 * подгоняет громкость на ходу и может «дышать», зато не требует первого
 * прохода и не врёт о результате.
 */
export function buildLoudnormApplyFilter(measured: LoudnormMeasurement | null): string {
  if (!measured) return `loudnorm=${targetParams()}`
  return `loudnorm=${targetParams()}`
    + `:measured_I=${measured.inputI}`
    + `:measured_TP=${measured.inputTp}`
    + `:measured_LRA=${measured.inputLra}`
    + `:measured_thresh=${measured.inputThresh}`
    + `:offset=${measured.targetOffset}`
    + ":linear=true:print_format=summary"
}

/**
 * Предел усиления одной дорожки. Замер бывает мусорным (пустой файл, битые
 * метаданные), и без предела «−70 LUFS» превратилось бы в +56 дБ — вместо голоса
 * в ролике оказался бы усиленный шум.
 */
export const MAX_VOICE_GAIN_DB = 12

/**
 * Приведение громкости ОДНОЙ дорожки внутри микса — чистым усилением.
 *
 * `loudnorm` внутрь filter_complex ставить нельзя: он буферизует три секунды
 * входа и отдаёт их с нулевым PTS. На файле целиком это незаметно (уезжает всё
 * сразу), а на одной дорожке микса — уводит её вперёд относительно остальных.
 * Ролик 24: закадровый голос звучал на 3 секунды раньше картинки, фраза
 * начиналась на чужой сцене и обрывалась. Проверено на стенде тем же графом с
 * фильтром и без него.
 *
 * Линейный режим `loudnorm` — это и есть постоянное усиление, так что считаем
 * его сами: (цель − измеренное). У `volume` задержки нет.
 *
 * Без замера дорожка идёт как есть: выдумывать усиление не из чего, а общий
 * уровень ролика всё равно доводит второй проход по готовому файлу.
 */
export function buildVoiceGainFilter(measured: LoudnormMeasurement | null): string {
  const measuredI = measured ? Number.parseFloat(measured.inputI) : Number.NaN
  if (!Number.isFinite(measuredI)) return "volume=1.000"

  const raw = LOUDNESS_TARGET.integratedLufs - measuredI
  const gainDb = Math.max(-MAX_VOICE_GAIN_DB, Math.min(MAX_VOICE_GAIN_DB, raw))
  return `volume=${gainDb.toFixed(2)}dB`
}

/**
 * Разбор вывода первого прохода.
 *
 * Незаполненный или обрезанный замер даёт null, и вызывающий уходит на
 * однопроходный режим. Подставлять нули нельзя: ноль в `measured_I` означает
 * «на входе было 0 LUFS», и второй проход вывернул бы громкость до неслышимой.
 */
export function parseLoudnormMeasurement(stderr: string): LoudnormMeasurement | null {
  const start = stderr.lastIndexOf("{")
  const end = stderr.lastIndexOf("}")
  if (start < 0 || end <= start) return null

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(stderr.slice(start, end + 1)) as Record<string, unknown>
  }
  catch {
    return null
  }

  const read = (key: string): string | null => {
    const value = parsed[key]
    return typeof value === "string" && value.trim() ? value.trim() : null
  }

  const inputI = read("input_i")
  const inputTp = read("input_tp")
  const inputLra = read("input_lra")
  const inputThresh = read("input_thresh")
  const targetOffset = read("target_offset")
  if (!inputI || !inputTp || !inputLra || !inputThresh || !targetOffset) return null

  return { inputI, inputTp, inputLra, inputThresh, targetOffset }
}

/**
 * Первый проход по файлу озвучки. Best-effort: отказ ffmpeg означает null и
 * однопроходный режим на втором проходе, а не потерянную сборку — ролик без
 * идеальной громкости лучше, чем несобранный ролик.
 */
export async function measureLoudness(audioPath: string): Promise<LoudnormMeasurement | null> {
  const { spawn } = await import("node:child_process")
  const bin = process.env.FFMPEG_PATH || process.env.FFMPEG_BIN || "ffmpeg"

  return new Promise((resolve) => {
    let stderr = ""
    const proc = spawn(bin, [
      "-hide_banner", "-nostats",
      "-i", audioPath,
      "-af", buildLoudnormMeasureFilter(),
      "-f", "null", "-",
    ], { stdio: ["ignore", "ignore", "pipe"] })

    proc.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8") })
    proc.on("error", () => resolve(null))
    proc.on("close", () => resolve(parseLoudnormMeasurement(stderr)))
  })
}

/**
 * Двухпроходное приведение громкости ГОТОВОГО файла.
 *
 * Однопроходный `loudnorm` внутри filter_complex работает потоково и на
 * реальном материале промахивается: ролик 22 вышел на −12.7 LUFS при цели −14,
 * хотя фильтр в графе стоял. Точно попадает только замер по готовому звуку и
 * второй проход с измеренными значениями.
 *
 * Видеопоток копируется, поэтому проход дешёвый: перекодируется только звук.
 * Отказ на любом шаге возвращает false и оставляет исходный файл нетронутым —
 * ролик с неидеальной громкостью лучше, чем испорченный ролик.
 */
export async function normalizeFileLoudness(
  inputPath: string,
  outputPath: string,
): Promise<boolean> {
  const { spawn } = await import("node:child_process")
  const bin = process.env.FFMPEG_PATH || process.env.FFMPEG_BIN || "ffmpeg"

  const measured = await measureLoudness(inputPath)
  const args = [
    "-hide_banner", "-nostats", "-y",
    "-i", inputPath,
    "-af", buildLoudnormApplyFilter(measured),
    // Картинку не трогаем: она уже собрана и перекодировать её незачем.
    "-c:v", "copy",
    "-c:a", "aac", "-b:a", "192k",
    "-movflags", "+faststart",
    outputPath,
  ]

  return new Promise((resolve) => {
    const proc = spawn(bin, args, { stdio: ["ignore", "ignore", "ignore"] })
    proc.on("error", () => resolve(false))
    proc.on("close", code => resolve(code === 0))
  })
}
