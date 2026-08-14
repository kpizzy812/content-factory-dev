/**
 * Перцептивный отпечаток ГОТОВОГО ролика и проверка похожести перед публикацией.
 *
 * ПОЧЕМУ модуль появился: docs/PROJECT_CONTEXT.md п.7 требует не только
 * содержательной вариативности, но и отдельным пунктом — «проверки похожести
 * перед публикацией». В проекте perceptual hash до этого считался только на
 * ВХОДЕ библиотеки ведущего (`server/utils/presenter/**`), то есть от исходной
 * записи при нарезке. Готовый ролик перед публикацией не сравнивался ни с чем,
 * и серия визуально однотипных роликов спокойно уходила в аккаунт — ровно тот
 * сценарий блокировок, ради которого пункт и написан.
 *
 * ПОЧЕМУ здесь только чистые функции: сам dHash считает
 * `presenter/perceptual-hash.ts` (переиспользуем, а не пишем второй), кадры
 * достаёт ffmpeg в `video-uniqueness.ts`. Расстояние Хэмминга, агрегация по
 * кадрам и вердикт живут отдельно, поэтому проверяются тестом без ffmpeg,
 * без БД и без сети.
 *
 * ЧЕМ ЭТО НЕ ЯВЛЯЕТСЯ: это не косметическая уникализация
 * (`server/api/videos/[id]/uniqify.post.ts`). П.4 и п.7 ТЗ прямо говорят, что
 * микросдвиги яркости, скорости и кропа уникальностью не считаются. Здесь мы
 * ничего не «крутим» — только измеряем готовый ролик и блокируем дубль.
 */

import {
  DEFAULT_SIMILARITY_THRESHOLD,
  hammingDistance,
} from '../presenter/perceptual-hash'
import type { QualityCheck } from './severity'
import { makeQualityCheck } from './severity'

/**
 * Версия схемы отпечатка. Пишется рядом с хешами, чтобы при смене алгоритма
 * старые записи было видно и они не сравнивались с новыми как равные.
 */
export const VIDEO_FINGERPRINT_VERSION = 'dhash9x8-v1'

/**
 * Порог совпадения одного кадра в битах (из 64).
 *
 * ОТКУДА: `presenter/perceptual-hash.ts: DEFAULT_SIMILARITY_THRESHOLD` — тот же
 * порог уже принят на входе библиотеки ведущего. Один порог на проект намеренно:
 * «похожий кадр» обязан значить одно и то же на входе и на выходе, иначе
 * фрагмент, отброшенный при нарезке как дубль, вернулся бы в готовом ролике как
 * «уникальный». Эмпирика оттуда же: кадры одной сцены расходятся на единицы бит,
 * разные сцены — на десятки.
 */
export const FINGERPRINT_FRAME_DISTANCE_BITS = DEFAULT_SIMILARITY_THRESHOLD

/**
 * Сколько кадров из трёх должно совпасть, чтобы считать ролик дублем.
 *
 * ОТКУДА: одно совпадение из трёх — это, как правило, общий брендовый кадр
 * (заставка, одинаковая посадка ведущего в той же студии), и блокировать по нему
 * всю партию нельзя. Два и больше означают, что совпали и завязка, и развитие
 * ролика — п.7 называет это повтором «одинаковых пикселей, движений,
 * последовательности сцен», то есть уже дубль.
 */
export const FINGERPRINT_DUPLICATE_FRAME_QUORUM = 2

/**
 * Сколько последних публикаций сравниваем с кандидатом.
 *
 * ОТКУДА: `MAX_DAILY_LIMIT = 50` в `server/api/factory/batches/index.post.ts:14` —
 * верхняя граница суточной квоты одного аккаунта. Окно в 50 последних публикаций
 * гарантирует, что новый ролик сверяется как минимум с сутками выпуска этого
 * аккаунта при максимальном лимите.
 */
export const FINGERPRINT_HISTORY_LIMIT = 50

/**
 * Отступ от краёв ролика при выборе кадров.
 *
 * ПОЧЕМУ не ровно 0 и не ровно `duration`: начало и конец почти всегда уходят в
 * фейд или чёрный кадр. Хеш чёрного прямоугольника совпадёт у всех роликов
 * подряд и превратил бы проверку в генератор ложных блокировок.
 */
export const FINGERPRINT_EDGE_MARGIN_SEC = 0.5

/** Ключи чеков quality gate, которые формирует этот модуль. */
export const FINGERPRINT_CHECK_KEY = 'uniqueness_fingerprint'
export const SIMILARITY_CHECK_KEY = 'uniqueness_similarity'
export const OPENING_CHECK_KEY = 'uniqueness_opening'

/** Первый кадр, середина, последний. Обложка считается отдельно от них. */
export type FingerprintFrameLabel = 'first' | 'middle' | 'last'

export interface FingerprintTimestamp {
  label: FingerprintFrameLabel
  atSec: number
}

export interface FingerprintFrame extends FingerprintTimestamp {
  /** dHash 9x8 в виде 16 hex-символов. */
  hash: string
}

export interface VideoFingerprint {
  version: string
  durationSec: number | null
  frames: FingerprintFrame[]
  /**
   * Последовательность хешей по сетке кадров — то, как отпечаток строят
   * площадки. Пустая у записей, сделанных до появления сетки: такие продолжают
   * сравниваться по трём опорным кадрам.
   */
  grid: string[]
  /**
   * Хеш обложки. Отдельным полем, потому что обложка — не обязательно кадр
   * ролика (её генерируют отдельным ассетом), а п.7 требует «разные первые
   * кадры И обложки».
   */
  coverHash: string | null
  computedAt: string
}

const HEX_HASH = /^[0-9a-f]{16}$/
const FRAME_LABELS: FingerprintFrameLabel[] = ['first', 'middle', 'last']

export function isFingerprintHash(value: unknown): value is string {
  return typeof value === 'string' && HEX_HASH.test(value)
}

/**
 * Точки съёма кадров по длительности ролика.
 * Пустой массив для некорректной длительности — вызывающий код обязан отдать
 * это наружу как «отпечаток не посчитан», а не как «всё хорошо».
 */
export function pickFingerprintTimestamps(durationSec: number): FingerprintTimestamp[] {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return []
  // На коротком ролике фиксированные 0.5с съели бы всю середину, поэтому отступ
  // ограничен десятой частью длительности.
  const margin = Math.min(FINGERPRINT_EDGE_MARGIN_SEC, durationSec / 10)
  const clamp = (value: number) => Math.round(Math.max(0, Math.min(durationSec, value)) * 100) / 100
  return [
    { label: 'first', atSec: clamp(margin) },
    { label: 'middle', atSec: clamp(durationSec / 2) },
    { label: 'last', atSec: clamp(durationSec - margin) },
  ]
}

/**
 * Шаг сетки кадров в секундах.
 *
 * ОТКУДА: платформы сэмплируют кадры с интервалом порядка 1-2 секунд и строят
 * отпечаток как последовательность их хешей. Две секунды — верхняя граница
 * этого диапазона: она вдвое дешевле по числу кадров и всё ещё ловит смену
 * плана, ради которой сетка и нужна.
 */
export const DEFAULT_FINGERPRINT_GRID_STEP_SEC = 2

/**
 * Потолок числа кадров сетки на ролик.
 *
 * Каждый кадр — это байты в Json чека и работа ffmpeg. Наш формат — 70-90
 * секунд, то есть штатно выходит 35-45 точек; потолок нужен, чтобы случайно
 * поданный часовой файл не превратил проверку в отдельную задачу.
 */
export const FINGERPRINT_GRID_MAX_FRAMES = 120

/**
 * Какая доля совпавших кадров сетки означает дубль.
 *
 * ОТКУДА: пара совпадений на длинной сетке — это общая заставка и одинаковая
 * посадка ведущего в той же студии, и блокировать по ним партию нельзя. Две
 * трети последовательности совпасть случайно уже не могут: это тот самый повтор
 * «одинаковых пикселей, движений, последовательности сцен» из п.7.
 */
export const FINGERPRINT_GRID_DUPLICATE_RATIO = 2 / 3

/**
 * Минимум сравнимых кадров, ниже которого доля ничего не значит.
 * На двух кадрах «две трети» вырождаются в «один из двух».
 */
export const FINGERPRINT_GRID_MIN_FRAMES = 5

/**
 * Точки съёма кадров по сетке. Отступ от краёв тот же, что у опорных кадров:
 * фейд и чёрный кадр совпадут у всех роликов подряд.
 */
export function pickFingerprintGridTimestamps(
  durationSec: number,
  stepSec: number = DEFAULT_FINGERPRINT_GRID_STEP_SEC,
): number[] {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return []
  if (!Number.isFinite(stepSec) || stepSec <= 0) return []

  const margin = Math.min(FINGERPRINT_EDGE_MARGIN_SEC, durationSec / 10)
  const points: number[] = []
  for (let at = margin; at < durationSec - margin / 2; at += stepSec) {
    points.push(Math.round(at * 100) / 100)
    if (points.length >= FINGERPRINT_GRID_MAX_FRAMES) break
  }
  // Ролик короче шага сетки всё равно обязан дать точку: иначе он окажется
  // «не проверенным» вместо «проверенного по одному кадру».
  if (points.length === 0) points.push(Math.round(margin * 100) / 100)
  return points
}

export interface GridComparison {
  comparedFrames: number
  matchedFrames: number
  /** Доля совпавших среди сравнимых. null — сравнивать было нечего. */
  ratio: number | null
  isDuplicate: boolean
}

/**
 * Сравнение двух сеток позиция к позиции по общему префиксу.
 *
 * ПОЧЕМУ префикс, а не выравнивание по времени: сетка строится одним шагом от
 * одного отступа, поэтому индекс уже означает «столько-то секунд от начала».
 * Ролики разной длины сопоставимы ровно там, где оба существуют.
 *
 * Негодный хеш пропускается: сетку считает ffmpeg, и один неудачный кадр не
 * повод отменять проверку остальных.
 */
export function compareFingerprintGrids(
  candidate: readonly string[],
  previous: readonly string[],
  options: { thresholdBits?: number, ratio?: number } = {},
): GridComparison {
  const threshold = options.thresholdBits ?? FINGERPRINT_FRAME_DISTANCE_BITS
  const requiredRatio = options.ratio ?? FINGERPRINT_GRID_DUPLICATE_RATIO
  const length = Math.min(candidate.length, previous.length)

  let comparedFrames = 0
  let matchedFrames = 0
  for (let index = 0; index < length; index += 1) {
    const a = candidate[index]!
    const b = previous[index]!
    if (!isFingerprintHash(a) || !isFingerprintHash(b)) continue
    comparedFrames += 1
    if (hammingDistance(a, b) <= threshold) matchedFrames += 1
  }

  const ratio = comparedFrames > 0 ? matchedFrames / comparedFrames : null
  return {
    comparedFrames,
    matchedFrames,
    ratio,
    isDuplicate: comparedFrames >= FINGERPRINT_GRID_MIN_FRAMES
      && ratio !== null
      && ratio >= requiredRatio,
  }
}

export interface BuildFingerprintInput {
  frames: Array<{ label: FingerprintFrameLabel; atSec: number; hash: string }>
  /** Хеши по сетке, в порядке возрастания времени. */
  grid?: readonly string[]
  coverHash?: string | null
  durationSec?: number | null
  /** Только для тестов: обычно берётся текущее время. */
  computedAt?: string
}

/**
 * Собирает отпечаток, отбрасывая мусорные хеши. Битый хеш лучше потерять, чем
 * положить в историю: он навсегда сломал бы сравнение для всех следующих роликов.
 */
export function buildVideoFingerprint(input: BuildFingerprintInput): VideoFingerprint {
  const seen = new Set<FingerprintFrameLabel>()
  const frames: FingerprintFrame[] = []
  for (const frame of input.frames) {
    if (!FRAME_LABELS.includes(frame.label) || seen.has(frame.label)) continue
    if (!isFingerprintHash(frame.hash)) continue
    seen.add(frame.label)
    frames.push({ label: frame.label, atSec: Number(frame.atSec) || 0, hash: frame.hash })
  }
  const duration = Number(input.durationSec)
  return {
    version: VIDEO_FINGERPRINT_VERSION,
    durationSec: Number.isFinite(duration) && duration > 0 ? Math.round(duration * 100) / 100 : null,
    frames,
    // Битые хеши отбрасываются так же, как у опорных кадров: попав в историю,
    // такой хеш навсегда сломал бы сравнение для следующих роликов.
    grid: (input.grid ?? []).filter(isFingerprintHash),
    coverHash: isFingerprintHash(input.coverHash) ? input.coverHash : null,
    computedAt: input.computedAt ?? new Date().toISOString(),
  }
}

/**
 * Чтение отпечатка из Json (`FactoryQualityReview.checks`). Всё, что не похоже на
 * отпечаток, превращается в null — история должна молча пропускать чужие записи,
 * а не ронять гейт.
 */
export function parseVideoFingerprint(value: unknown): VideoFingerprint | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const rawFrames = Array.isArray(raw.frames) ? raw.frames : []
  const frames: FingerprintFrame[] = []
  for (const item of rawFrames) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const entry = item as Record<string, unknown>
    const label = String(entry.label ?? '') as FingerprintFrameLabel
    if (!FRAME_LABELS.includes(label)) continue
    if (!isFingerprintHash(entry.hash)) continue
    frames.push({ label, atSec: Number(entry.atSec) || 0, hash: entry.hash })
  }
  const coverHash = isFingerprintHash(raw.coverHash) ? raw.coverHash : null
  const grid = Array.isArray(raw.grid) ? raw.grid.filter(isFingerprintHash) : []
  if (frames.length === 0 && !coverHash && grid.length === 0) return null
  const duration = Number(raw.durationSec)
  return {
    version: typeof raw.version === 'string' && raw.version ? raw.version : VIDEO_FINGERPRINT_VERSION,
    durationSec: Number.isFinite(duration) && duration > 0 ? duration : null,
    frames,
    grid,
    coverHash,
    computedAt: typeof raw.computedAt === 'string' ? raw.computedAt : '',
  }
}

/**
 * Достаёт сохранённый отпечаток из `FactoryQualityReview.checks`.
 *
 * ПОЧЕМУ отпечаток живёт в значении чека, а не в отдельной колонке: менять схему
 * БД в этой работе нельзя, а у Video и VideoAsset нет свободного Json-поля
 * (`Video.analysisData` целиком перезаписывается анализатором креативов в
 * `video-content-analyzer.ts:423`). `FactoryQualityReview.checks` пишет ровно этот
 * гейт, у строки уже есть `videoId`, `appId` и `stage` — то есть всё, что нужно
 * для выборки истории.
 */
export function extractFingerprintFromChecks(checks: unknown): VideoFingerprint | null {
  if (!Array.isArray(checks)) return null
  for (const item of checks) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const entry = item as Record<string, unknown>
    if (entry.key !== FINGERPRINT_CHECK_KEY) continue
    const value = entry.value
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    return parseVideoFingerprint((value as Record<string, unknown>).fingerprint)
  }
  return null
}

export interface FingerprintCompareOptions {
  thresholdBits?: number
  quorum?: number
}

export interface FingerprintComparison {
  /** Позиции, где кадры разошлись не более чем на порог. */
  matchedFrames: FingerprintFrameLabel[]
  /** Расстояния по позициям, где хеши есть у обоих отпечатков. */
  distances: Partial<Record<FingerprintFrameLabel, number>>
  /** Наименьшее расстояние среди сравнимых кадров. null — сравнивать было нечего. */
  minDistance: number | null
  comparedFrames: number
  coverMatched: boolean
  firstFrameMatched: boolean
  /** Результат сравнения по сетке кадров — пустой у записей без сетки. */
  grid: GridComparison
  isDuplicate: boolean
}

/**
 * Сравнение двух отпечатков.
 *
 * ПОЧЕМУ кадры сопоставляются позиция к позиции (first↔first, middle↔middle,
 * last↔last), а не «каждый с каждым»: у говорящей головы в одной студии любой
 * кадр похож на любой, и перекрёстное сравнение выдавало бы дубль на каждом
 * ролике. Позиционное сравнение ловит именно то, что описано в п.7 — повтор
 * последовательности и монтажа, когда «меняются только губы и субтитры».
 */
export function compareFingerprints(
  candidate: VideoFingerprint,
  previous: VideoFingerprint,
  options: FingerprintCompareOptions = {},
): FingerprintComparison {
  const threshold = options.thresholdBits ?? FINGERPRINT_FRAME_DISTANCE_BITS
  const quorum = options.quorum ?? FINGERPRINT_DUPLICATE_FRAME_QUORUM
  const previousByLabel = new Map(previous.frames.map(frame => [frame.label, frame]))

  const matchedFrames: FingerprintFrameLabel[] = []
  const distances: Partial<Record<FingerprintFrameLabel, number>> = {}
  let comparedFrames = 0
  for (const frame of candidate.frames) {
    const other = previousByLabel.get(frame.label)
    if (!other) continue
    comparedFrames += 1
    const distance = hammingDistance(frame.hash, other.hash)
    distances[frame.label] = distance
    if (distance <= threshold) matchedFrames.push(frame.label)
  }

  const coverMatched = Boolean(
    candidate.coverHash
    && previous.coverHash
    && hammingDistance(candidate.coverHash, previous.coverHash) <= threshold,
  )
  const values = Object.values(distances) as number[]
  // Сетка — второй, более близкий к площадке признак: она ловит повтор всей
  // последовательности, а не только трёх опорных точек. Вердикт объединяется
  // по «или»: дубль по любому из признаков остаётся дублем.
  const grid = compareFingerprintGrids(candidate.grid ?? [], previous.grid ?? [], {
    thresholdBits: threshold,
  })
  return {
    matchedFrames,
    distances,
    minDistance: values.length > 0 ? Math.min(...values) : null,
    comparedFrames,
    coverMatched,
    firstFrameMatched: matchedFrames.includes('first') || coverMatched,
    grid,
    isDuplicate: matchedFrames.length >= quorum || grid.isDuplicate,
  }
}

export interface FingerprintHistoryEntry {
  /** id ролика, с которым сравниваем. Нужен оператору, чтобы найти дубль. */
  videoId: number | null
  /** Аккаунт публикации — для сообщения «повтор в этом же аккаунте». */
  socialAccountId?: number | null
  publishedAt?: string | null
  fingerprint: VideoFingerprint
}

export interface UniquenessMatch extends FingerprintComparison {
  videoId: number | null
  socialAccountId: number | null
  publishedAt: string | null
}

export interface UniquenessComparison {
  comparedCount: number
  /** Совпадения, дотянувшие до кворума, — это блокирующие дубли. */
  duplicates: UniquenessMatch[]
  /** Совпал первый кадр или обложка — п.7 «разные первые кадры и обложки». */
  openingMatches: UniquenessMatch[]
  /** Самое близкое из всех сравнений — для диагностики в отчёте гейта. */
  closest: UniquenessMatch | null
}

/**
 * Прогон кандидата по истории публикаций. Чистая функция: историю грузит
 * вызывающий код.
 */
export function findFingerprintDuplicates(
  candidate: VideoFingerprint,
  history: FingerprintHistoryEntry[],
  options: FingerprintCompareOptions = {},
): UniquenessComparison {
  const duplicates: UniquenessMatch[] = []
  const openingMatches: UniquenessMatch[] = []
  let closest: UniquenessMatch | null = null
  let comparedCount = 0

  for (const entry of history) {
    const comparison = compareFingerprints(candidate, entry.fingerprint, options)
    if (comparison.comparedFrames === 0 && !comparison.coverMatched) continue
    comparedCount += 1
    const match: UniquenessMatch = {
      ...comparison,
      videoId: entry.videoId ?? null,
      socialAccountId: entry.socialAccountId ?? null,
      publishedAt: entry.publishedAt ?? null,
    }
    if (match.isDuplicate) duplicates.push(match)
    if (match.firstFrameMatched) openingMatches.push(match)
    if (
      match.minDistance !== null
      && (closest === null || closest.minDistance === null || match.minDistance < closest.minDistance)
    ) {
      closest = match
    }
  }

  return { comparedCount, duplicates, openingMatches, closest }
}

/**
 * Результат контура похожести. По образцу `PolicyJudgeOutcome`: неудача — это
 * ДАННЫЕ для гейта, а не исключение, иначе оператор не увидел бы остальные чеки.
 */
export type VideoUniquenessOutcome =
  | { status: 'ok'; fingerprint: VideoFingerprint; comparison: UniquenessComparison }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; error: string }

function describeMatch(match: UniquenessMatch): string {
  const target = match.videoId ? `video #${match.videoId}` : 'a previous publication'
  const frames = match.matchedFrames.length > 0 ? match.matchedFrames.join('/') : 'cover'
  const distance = match.minDistance === null ? 'n/a' : String(match.minDistance)
  return `${target} (frames: ${frames}, min distance: ${distance} bits)`
}

function describeMatches(matches: UniquenessMatch[], limit = 3): string {
  return matches.slice(0, limit).map(describeMatch).join('; ')
}

/**
 * Чеки quality gate по результату контура похожести.
 *
 * Три чека вместо одного, потому что у них разная природа:
 *   uniqueness_fingerprint — состояние контура И место хранения самого отпечатка;
 *   uniqueness_similarity  — блокирующий вердикт «это дубль»;
 *   uniqueness_opening     — предупреждение про первый кадр и обложку.
 *
 * ПОЧЕМУ первый кадр только предупреждение, а не блокировка: при съёмке в одной
 * студии одинаковая посадка ведущего в первом кадре — норма, и блокировать по ней
 * партию нельзя. Разнообразие ракурсов и фона — задача отбора фрагментов
 * (`presenter-source-selector`), а не финального гейта. Здесь оператор видит
 * жёлтый флаг и решает сам.
 */
export function buildUniquenessChecks(
  outcome: VideoUniquenessOutcome | null | undefined,
): QualityCheck[] {
  if (!outcome || outcome.status === 'failed') {
    const error = outcome?.status === 'failed' ? outcome.error : 'контур похожести не запускался'
    // Непосчитанный отпечаток — это НЕ зелёный свет: непроверенная уникальность
    // и есть тот риск, ради которого п.7 требует проверку перед публикацией.
    return [makeQualityCheck(
      FINGERPRINT_CHECK_KEY,
      false,
      `Perceptual fingerprint of the rendered video is missing, similarity is unverified: ${error}`,
      { severity: 'blocking', value: { status: 'failed' } },
    )]
  }

  if (outcome.status === 'skipped') {
    return [makeQualityCheck(
      FINGERPRINT_CHECK_KEY,
      false,
      `Similarity check is disabled: ${outcome.reason}`,
      { severity: 'warning', value: { status: 'skipped' } },
    )]
  }

  const { fingerprint, comparison } = outcome
  const checks: QualityCheck[] = [
    makeQualityCheck(
      FINGERPRINT_CHECK_KEY,
      fingerprint.frames.length > 0,
      fingerprint.frames.length > 0
        ? `Perceptual fingerprint computed from ${fingerprint.frames.length} frame(s) of the rendered video`
        : 'Perceptual fingerprint has no frames — similarity is unverified',
      {
        severity: 'blocking',
        // Значение чека — единственное место хранения отпечатка без миграции схемы.
        value: { status: 'ok', fingerprint, comparedCount: comparison.comparedCount },
      },
    ),
    makeQualityCheck(
      SIMILARITY_CHECK_KEY,
      comparison.duplicates.length === 0,
      comparison.duplicates.length === 0
        ? `Rendered video differs from the last ${comparison.comparedCount} published video(s)`
        : `Rendered video repeats already published content: ${describeMatches(comparison.duplicates)}`,
      {
        severity: 'blocking',
        value: {
          comparedCount: comparison.comparedCount,
          duplicates: comparison.duplicates.length,
          closestDistance: comparison.closest?.minDistance ?? null,
        },
      },
    ),
    makeQualityCheck(
      OPENING_CHECK_KEY,
      comparison.openingMatches.length === 0,
      comparison.openingMatches.length === 0
        ? 'Opening frame and cover differ from recent publications'
        : `Opening frame or cover repeats a recent publication: ${describeMatches(comparison.openingMatches)}`,
      { severity: 'warning', value: comparison.openingMatches.length },
    ),
  ]
  return checks
}
