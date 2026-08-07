/**
 * Регрессия на P0-7 и P1-9: перцептивный отпечаток ГОТОВОГО ролика и блокирующая
 * проверка похожести перед публикацией.
 *
 * Дефект. Требование docs/PROJECT_CONTEXT.md п.7 — система обязана обеспечивать
 * содержательную вариативность, и отдельным пунктом: «проверка похожести перед
 * публикацией». Фактически perceptual hash считался только на ВХОДЕ библиотеки
 * ведущего (`server/utils/presenter/**`, при нарезке исходников). Готовый ролик
 * перед публикацией не сравнивался ни с чем: финальная стадия гейта смотрела
 * только `status`, `format` и длительность. Ролик, повторяющий вчерашний кадр в
 * кадр, проходил гейт со вердиктом pass — ровно тот сценарий блокировок, ради
 * которого пункт и написан.
 *
 * Что закрыто:
 *   1) отпечаток отрендеренного файла по трём кадрам (первый, середина,
 *      последний) плюс отдельный хеш обложки, с сохранением в отчёте гейта;
 *   2) блокирующий чек сравнения с последними N опубликованными роликами.
 *
 * DB-free: чистые функции + раннер с подменёнными зависимостями. Ни ffmpeg, ни
 * prisma, ни сети — отдельный тест проверяет это эмпирически.
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { evaluateFactoryQuality } from '~~/server/utils/content-quality-gate'
import {
  FINGERPRINT_DUPLICATE_FRAME_QUORUM,
  FINGERPRINT_FRAME_DISTANCE_BITS,
  FINGERPRINT_HISTORY_LIMIT,
  SIMILARITY_CHECK_KEY,
  buildUniquenessChecks,
  buildVideoFingerprint,
  compareFingerprints,
  extractFingerprintFromChecks,
  findFingerprintDuplicates,
  parseVideoFingerprint,
  pickFingerprintTimestamps,
  type FingerprintHistoryEntry,
  type VideoFingerprint,
} from '~~/server/utils/quality/video-fingerprint'
import {
  runVideoUniquenessCheck,
  type VideoUniquenessDependencies,
} from '~~/server/utils/quality/video-uniqueness'

function words(count: number): string {
  return Array.from({ length: count }, (_, index) => `word${index}`).join(' ')
}

/** Судья policy-чека отработал и претензий не имеет — чистый фон для остальных проверок. */
const JUDGE_OK = {
  status: 'ok' as const,
  verdict: { verdict: 'pass' as const, violations: [], summary: 'нарушений нет' },
}

const FINAL_BASE = {
  stage: 'final' as const,
  policyJudge: JUDGE_OK,
  hypothesis: { id: 'h1', keyword: 'PLAN', cta: 'Send PLAN' },
  funnel: { id: 'f1', status: 'active', keyword: 'PLAN' },
  leadMagnet: { id: 'l1', status: 'approved' },
  scenario: { id: 1 },
  variant: {
    id: 2,
    hook: 'Your short videos may be losing leads before the CTA',
    cta: 'Send PLAN in the comments',
    fullScript: words(180),
    storyPlan: { scenes: [] },
    qualityScore: 82,
  },
  video: { status: 'completed', format: 'portrait', duration: 85 },
}

/** Хеш с точно заданным числом отличий от базового — так порог проверяется числом, а не «на глаз». */
function hashWith(base: bigint, flippedBits: number[]): string {
  let value = base
  for (const bit of flippedBits) value ^= 1n << BigInt(bit)
  return value.toString(16).padStart(16, '0')
}

const BASE_FIRST = 0x0f0f_0f0f_0f0f_0f0fn
const BASE_MIDDLE = 0x1234_5678_9abc_def0n
const BASE_LAST = 0xf0f0_f0f0_f0f0_f0f0n
const BASE_COVER = 0xaaaa_5555_aaaa_5555n

function fingerprint(options: {
  first?: string
  middle?: string
  last?: string
  cover?: string | null
} = {}): VideoFingerprint {
  return buildVideoFingerprint({
    durationSec: 85,
    frames: [
      { label: 'first', atSec: 0.5, hash: options.first ?? hashWith(BASE_FIRST, []) },
      { label: 'middle', atSec: 42.5, hash: options.middle ?? hashWith(BASE_MIDDLE, []) },
      { label: 'last', atSec: 84.5, hash: options.last ?? hashWith(BASE_LAST, []) },
    ],
    coverHash: options.cover === undefined ? hashWith(BASE_COVER, []) : options.cover,
    computedAt: '2026-08-07T00:00:00.000Z',
  })
}

/** Ролик про другое: все три кадра расходятся далеко за порог. */
function differentFingerprint(): VideoFingerprint {
  return fingerprint({
    first: hashWith(~BASE_FIRST & 0xffff_ffff_ffff_ffffn, []),
    middle: hashWith(~BASE_MIDDLE & 0xffff_ffff_ffff_ffffn, []),
    last: hashWith(~BASE_LAST & 0xffff_ffff_ffff_ffffn, []),
    cover: hashWith(~BASE_COVER & 0xffff_ffff_ffff_ffffn, []),
  })
}

function historyEntry(videoId: number, fp: VideoFingerprint): FingerprintHistoryEntry {
  return { videoId, socialAccountId: 7, publishedAt: '2026-08-06T10:00:00.000Z', fingerprint: fp }
}

describe('точки съёма кадров готового ролика', () => {
  it('берёт первый, середину и последний кадр с отступом от краёв', () => {
    const points = pickFingerprintTimestamps(85)
    expect(points.map(point => point.label)).toEqual(['first', 'middle', 'last'])
    // Отступ 0.5с: ровно нулевой и ровно последний кадр почти всегда чёрные,
    // и их хеш совпал бы у всех роликов подряд.
    expect(points[0]!.atSec).toBeCloseTo(0.5, 5)
    expect(points[1]!.atSec).toBeCloseTo(42.5, 5)
    expect(points[2]!.atSec).toBeCloseTo(84.5, 5)
  })

  it('на коротком ролике не съедает середину фиксированным отступом', () => {
    const points = pickFingerprintTimestamps(2)
    expect(points[0]!.atSec).toBeCloseTo(0.2, 5)
    expect(points[2]!.atSec).toBeCloseTo(1.8, 5)
    expect(points[0]!.atSec).toBeLessThan(points[1]!.atSec)
    expect(points[1]!.atSec).toBeLessThan(points[2]!.atSec)
  })

  it('не выдумывает точки при неизвестной длительности', () => {
    expect(pickFingerprintTimestamps(0)).toEqual([])
    expect(pickFingerprintTimestamps(Number.NaN)).toEqual([])
    expect(pickFingerprintTimestamps(-5)).toEqual([])
  })
})

describe('сравнение отпечатков', () => {
  it('считает расстояние Хэмминга по одинаковым позициям кадров', () => {
    const candidate = fingerprint({
      first: hashWith(BASE_FIRST, [0, 1, 2]),
      middle: hashWith(BASE_MIDDLE, Array.from({ length: 20 }, (_, index) => index)),
    })
    const comparison = compareFingerprints(candidate, fingerprint())
    expect(comparison.distances.first).toBe(3)
    expect(comparison.distances.middle).toBe(20)
    expect(comparison.distances.last).toBe(0)
    expect(comparison.comparedFrames).toBe(3)
    expect(comparison.minDistance).toBe(0)
  })

  it('не считает дублем ролик, у которого совпал только один кадр', () => {
    // Один общий кадр — это чаще всего брендовая заставка или одинаковая посадка
    // ведущего. Кворум ровно поэтому равен двум.
    const candidate = fingerprint({
      middle: hashWith(BASE_MIDDLE, Array.from({ length: 30 }, (_, index) => index)),
      last: hashWith(BASE_LAST, Array.from({ length: 30 }, (_, index) => index + 20)),
      cover: null,
    })
    const comparison = compareFingerprints(candidate, fingerprint())
    expect(comparison.matchedFrames).toEqual(['first'])
    expect(comparison.isDuplicate).toBe(false)
    expect(FINGERPRINT_DUPLICATE_FRAME_QUORUM).toBe(2)
  })

  it('считает дублем ролик, где совпали и завязка, и развитие', () => {
    const candidate = fingerprint({
      first: hashWith(BASE_FIRST, [0, 5]),
      middle: hashWith(BASE_MIDDLE, [3]),
      last: hashWith(BASE_LAST, Array.from({ length: 30 }, (_, index) => index)),
    })
    const comparison = compareFingerprints(candidate, fingerprint())
    expect(comparison.matchedFrames).toEqual(['first', 'middle'])
    expect(comparison.isDuplicate).toBe(true)
  })

  it('порог совпадения кадра — тот же, что на входе библиотеки ведущего', () => {
    expect(FINGERPRINT_FRAME_DISTANCE_BITS).toBe(6)
    const onThreshold = fingerprint({
      first: hashWith(BASE_FIRST, [0, 1, 2, 3, 4, 5]),
      middle: hashWith(BASE_MIDDLE, [0, 1, 2, 3, 4, 5]),
    })
    expect(compareFingerprints(onThreshold, fingerprint()).isDuplicate).toBe(true)

    const overThreshold = fingerprint({
      first: hashWith(BASE_FIRST, [0, 1, 2, 3, 4, 5, 6]),
      middle: hashWith(BASE_MIDDLE, [0, 1, 2, 3, 4, 5, 6]),
      last: hashWith(BASE_LAST, [0, 1, 2, 3, 4, 5, 6]),
      cover: null,
    })
    expect(compareFingerprints(overThreshold, fingerprint()).isDuplicate).toBe(false)
  })

  it('обложка сравнивается отдельно от кадров', () => {
    const candidate = differentFingerprint()
    const withSameCover = buildVideoFingerprint({
      durationSec: 85,
      frames: candidate.frames,
      coverHash: hashWith(BASE_COVER, [1]),
    })
    const comparison = compareFingerprints(withSameCover, fingerprint())
    expect(comparison.matchedFrames).toEqual([])
    expect(comparison.coverMatched).toBe(true)
    expect(comparison.firstFrameMatched).toBe(true)
    // Совпавшая обложка сама по себе не дубль — только повод для предупреждения.
    expect(comparison.isDuplicate).toBe(false)
  })
})

describe('прогон по истории публикаций', () => {
  it('находит дубль среди последних публикаций и запоминает, с каким роликом', () => {
    const history = [
      historyEntry(101, differentFingerprint()),
      historyEntry(102, fingerprint()),
    ]
    const comparison = findFingerprintDuplicates(
      fingerprint({ first: hashWith(BASE_FIRST, [7]), middle: hashWith(BASE_MIDDLE, [9]) }),
      history,
    )
    expect(comparison.comparedCount).toBe(2)
    expect(comparison.duplicates.map(match => match.videoId)).toEqual([102])
    expect(comparison.closest?.videoId).toBe(102)
  })

  it('пропускает роликов, с которыми нечего сравнивать', () => {
    const empty = parseVideoFingerprint({ frames: [], coverHash: null })
    expect(empty).toBeNull()
    const comparison = findFingerprintDuplicates(fingerprint(), [])
    expect(comparison.comparedCount).toBe(0)
    expect(comparison.duplicates).toEqual([])
  })

  it('окно истории покрывает сутки публикаций аккаунта на максимальной квоте', () => {
    // MAX_DAILY_LIMIT = 50 в server/api/factory/batches/index.post.ts.
    expect(FINGERPRINT_HISTORY_LIMIT).toBe(50)
  })
})

describe('чеки quality gate', () => {
  it('дубль — блокирующий чек, а не заметка', () => {
    const checks = buildUniquenessChecks({
      status: 'ok',
      fingerprint: fingerprint(),
      comparison: findFingerprintDuplicates(fingerprint(), [historyEntry(102, fingerprint())]),
    })
    const similarity = checks.find(check => check.key === SIMILARITY_CHECK_KEY)
    expect(similarity?.passed).toBe(false)
    expect(similarity?.severity).toBe('blocking')
    expect(similarity?.message).toContain('video #102')
  })

  it('непосчитанный отпечаток блокирует: «не проверили» это не «всё хорошо»', () => {
    const checks = buildUniquenessChecks({ status: 'failed', error: 'ffmpeg упал' })
    expect(checks).toHaveLength(1)
    expect(checks[0]!.passed).toBe(false)
    expect(checks[0]!.severity).toBe('blocking')
    expect(checks[0]!.message).toContain('ffmpeg упал')
  })

  it('выключенный контур даёт предупреждение, а не зелёный свет', () => {
    const checks = buildUniquenessChecks({ status: 'skipped', reason: 'выключено конфигом' })
    expect(checks[0]!.passed).toBe(false)
    expect(checks[0]!.severity).toBe('warning')
  })

  it('первый кадр и обложка — предупреждение, чтобы одна студия не валила партию', () => {
    const candidate = differentFingerprint()
    const withSameCover = buildVideoFingerprint({
      durationSec: 85,
      frames: candidate.frames,
      coverHash: hashWith(BASE_COVER, []),
    })
    const checks = buildUniquenessChecks({
      status: 'ok',
      fingerprint: withSameCover,
      comparison: findFingerprintDuplicates(withSameCover, [historyEntry(102, fingerprint())]),
    })
    const opening = checks.find(check => check.key === 'uniqueness_opening')
    expect(opening?.passed).toBe(false)
    expect(opening?.severity).toBe('warning')
    expect(checks.find(check => check.key === SIMILARITY_CHECK_KEY)?.passed).toBe(true)
  })
})

describe('финальная стадия гейта', () => {
  it('РЕГРЕССИЯ: ролик, повторяющий уже опубликованный, больше не проходит финальный гейт', () => {
    const result = evaluateFactoryQuality({
      ...FINAL_BASE,
      uniqueness: {
        status: 'ok',
        fingerprint: fingerprint(),
        comparison: findFingerprintDuplicates(fingerprint(), [historyEntry(102, fingerprint())]),
      },
    })
    // До фикса финальная стадия смотрела только status/format/duration и отдавала
    // pass — дубль уезжал в публикацию.
    expect(result.verdict).toBe('fail')
    expect(result.issues.some(issue => issue.startsWith(`${SIMILARITY_CHECK_KEY}:`))).toBe(true)
  })

  it('РЕГРЕССИЯ: неудача расчёта отпечатка тоже блокирует публикацию', () => {
    const result = evaluateFactoryQuality({
      ...FINAL_BASE,
      uniqueness: { status: 'failed', error: 'файл ролика не найден' },
    })
    expect(result.verdict).toBe('fail')
    expect(result.issues.some(issue => issue.startsWith('uniqueness_fingerprint:'))).toBe(true)
  })

  it('уникальный ролик проходит финальный гейт', () => {
    const result = evaluateFactoryQuality({
      ...FINAL_BASE,
      uniqueness: {
        status: 'ok',
        fingerprint: fingerprint(),
        comparison: findFingerprintDuplicates(fingerprint(), [historyEntry(102, differentFingerprint())]),
      },
    })
    expect(result.verdict).toBe('pass')
  })

  it('отпечаток сохраняется внутри отчёта гейта и читается обратно', () => {
    const source = fingerprint()
    const result = evaluateFactoryQuality({
      ...FINAL_BASE,
      uniqueness: {
        status: 'ok',
        fingerprint: source,
        comparison: findFingerprintDuplicates(source, []),
      },
    })
    // checks уходят в FactoryQualityReview.checks (Json) — это и есть хранилище
    // хеша опубликованного ролика без миграции схемы.
    const stored = extractFingerprintFromChecks(JSON.parse(JSON.stringify(result.checks)))
    expect(stored).not.toBeNull()
    expect(stored!.frames.map(frame => frame.hash)).toEqual(source.frames.map(frame => frame.hash))
    expect(stored!.coverHash).toBe(source.coverHash)
  })

  it('стадия сценария не требует отпечатка: готового файла ещё нет', () => {
    const result = evaluateFactoryQuality({ ...FINAL_BASE, stage: 'script', video: null })
    expect(result.verdict).toBe('pass')
    expect(result.checks.some(check => check.key.startsWith('uniqueness_'))).toBe(false)
  })
})

describe('раннер контура похожести', () => {
  const okDeps = (history: FingerprintHistoryEntry[]): VideoUniquenessDependencies => ({
    computeFingerprint: async () => fingerprint(),
    loadHistory: async () => history,
  })

  it('не бросает, когда отпечаток посчитать не удалось', async () => {
    const outcome = await runVideoUniquenessCheck(
      { appId: 1, video: { id: 5, storageKey: 'zavodcamp/videos/5.mp4' } },
      {
        computeFingerprint: async () => { throw new Error('ffmpeg недоступен') },
        loadHistory: async () => [],
      },
    )
    expect(outcome.status).toBe('failed')
    expect(outcome.status === 'failed' && outcome.error).toContain('ffmpeg недоступен')
  })

  it('не бросает и не выдаёт «чисто», когда история не поднялась', async () => {
    const outcome = await runVideoUniquenessCheck(
      { appId: 1, video: { id: 5, storageKey: 'zavodcamp/videos/5.mp4' } },
      {
        computeFingerprint: async () => fingerprint(),
        loadHistory: async () => { throw new Error('база недоступна') },
      },
    )
    expect(outcome.status).toBe('failed')
  })

  it('сообщает об отсутствии файла отдельно от ошибки ffmpeg', async () => {
    const outcome = await runVideoUniquenessCheck({ appId: 1, video: { id: 5 } }, okDeps([]))
    expect(outcome.status).toBe('failed')
    expect(outcome.status === 'failed' && outcome.error).toContain('нет файла')
  })

  it('исключает собственный ролик из истории и просит окно по умолчанию', async () => {
    const seen: Array<{ appId: number; excludeVideoId: number | null; limit: number }> = []
    await runVideoUniquenessCheck(
      { appId: 42, video: { id: 5, storageKey: 'zavodcamp/videos/5.mp4' } },
      {
        computeFingerprint: async () => fingerprint(),
        loadHistory: async (query) => { seen.push(query); return [] },
      },
    )
    expect(seen).toEqual([{ appId: 42, excludeVideoId: 5, limit: FINGERPRINT_HISTORY_LIMIT }])
  })

  it('выключенный конфигом контур отдаёт skipped, а не тихий pass', async () => {
    const outcome = await runVideoUniquenessCheck(
      { appId: 1, video: { id: 5, storageKey: 'zavodcamp/videos/5.mp4' }, enabled: false },
      okDeps([]),
    )
    expect(outcome.status).toBe('skipped')
  })

  it('на дубле в истории отдаёт ok с найденным совпадением', async () => {
    const outcome = await runVideoUniquenessCheck(
      { appId: 1, video: { id: 5, storageKey: 'zavodcamp/videos/5.mp4' } },
      okDeps([historyEntry(102, fingerprint())]),
    )
    expect(outcome.status).toBe('ok')
    expect(outcome.status === 'ok' && outcome.comparison.duplicates.map(item => item.videoId)).toEqual([102])
  })

  it('не ходит в сеть и не запускает процессов при подменённых зависимостях', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (() => { throw new Error('сетевой вызов в тесте') }) as typeof fetch
    try {
      const outcome = await runVideoUniquenessCheck(
        { appId: 1, video: { id: 5, storageKey: 'zavodcamp/videos/5.mp4' } },
        okDeps([]),
      )
      expect(outcome.status).toBe('ok')
    }
    finally {
      globalThis.fetch = originalFetch
    }
  })
})
