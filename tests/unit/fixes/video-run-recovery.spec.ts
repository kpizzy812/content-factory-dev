/**
 * Регрессия P1-15: прерванные видео-прогоны должны подхватываться сами.
 *
 * Рестарт процесса (деплой, падение воркера) убивал runVideoPipeline на середине,
 * и ролик навсегда оставался в промежуточном статусе: очередь такие записи не
 * смотрит, а блокировка снимается только в finally умершего процесса. Оператор
 * ходил и жал «возобновить» руками.
 *
 * Проверяем обе половины фикса: чистое правило отбора кандидатов и startup-плагин,
 * который его исполняет. DB-free — prisma и сам пайплайн подменены.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import {
  planStalledVideoRecovery,
  RESUMABLE_VIDEO_STATUSES,
  STALLED_VIDEO_ABANDON_MS,
  STALLED_VIDEO_IDLE_MS,
  STALLED_VIDEO_STALE_LOCK_MS,
  type StalledVideoCandidate,
} from "../../../server/utils/video-pipeline-run-policy"

const NOW = Date.UTC(2026, 7, 7, 12, 0, 0)
const MINUTE = 60_000

function ago(ms: number): Date {
  return new Date(NOW - ms)
}

/** Здоровый висяк: статус промежуточный, никто не трогал час, блокировки нет. */
function candidate(patch: Partial<StalledVideoCandidate> = {}): StalledVideoCandidate {
  return {
    id: 1,
    status: "generating_clips",
    isLocked: false,
    lockedAt: null,
    startedAt: ago(60 * MINUTE),
    createdAt: ago(65 * MINUTE),
    updatedAt: ago(60 * MINUTE),
    ...patch,
  }
}

function plan(candidates: StalledVideoCandidate[], limit?: number) {
  return planStalledVideoRecovery(candidates, { now: NOW, ...(limit === undefined ? {} : { limit }) })
}

describe("P1-15: правило отбора прерванных прогонов", () => {
  it("поднимает ролик, застрявший в промежуточном статусе", () => {
    expect(plan([candidate()])).toEqual([
      { videoId: 1, action: "resume", reason: "interrupted", releaseStaleLock: false },
    ])
  })

  it("берёт все промежуточные статусы, включая pending", () => {
    const candidates = RESUMABLE_VIDEO_STATUSES.map((status, index) =>
      candidate({ id: index + 1, status }))

    const actions = plan(candidates, candidates.length).map(d => d.action)

    // pending — самый частый висяк: запись создана, пайплайн запущен
    // fire-and-forget, процесс умер до первого шага.
    expect(RESUMABLE_VIDEO_STATUSES).toContain("pending")
    expect(actions).toEqual(candidates.map(() => "resume"))
  })

  it("не трогает терминальные статусы", () => {
    const terminal = ["completed", "failed", "timeout", "canceled", "file_missing"]

    const decisions = plan(terminal.map((status, index) => candidate({ id: index + 1, status })))

    // Автоперезапуск упавшего ролика — это бесконечная оплата заведомо
    // сломанного. Ручная кнопка у оператора остаётся.
    expect(decisions.every(d => d.action === "skip" && d.reason === "terminal_status")).toBe(true)
  })

  it("не трогает ролик, который меняли только что", () => {
    const decisions = plan([candidate({ updatedAt: ago(STALLED_VIDEO_IDLE_MS - MINUTE) })])

    expect(decisions[0]).toMatchObject({ action: "skip", reason: "recent_activity" })
  })

  it("не трогает ролик под живой блокировкой", () => {
    const decisions = plan([candidate({ isLocked: true, lockedAt: ago(STALLED_VIDEO_STALE_LOCK_MS - MINUTE) })])

    // lockedAt не heartbeat, а штамп владения: до истечения порога считаем, что
    // за роликом крутится честный (пусть и долгий) прогон.
    expect(decisions[0]).toMatchObject({ action: "skip", reason: "locked" })
  })

  it("срывает протухшую блокировку мёртвого прогона", () => {
    const decisions = plan([candidate({ isLocked: true, lockedAt: ago(STALLED_VIDEO_STALE_LOCK_MS + MINUTE) })])

    // Без срыва runVideoPipeline внутри возобновления бросит «уже запущен», и
    // осиротевшая блокировка держала бы ролик вечно.
    expect(decisions[0]).toEqual({
      videoId: 1,
      action: "resume",
      reason: "interrupted",
      releaseStaleLock: true,
    })
  })

  it("считает блокировку без штампа владения сиротой", () => {
    const decisions = plan([candidate({ isLocked: true, lockedAt: null })])

    expect(decisions[0]).toMatchObject({ action: "resume", releaseStaleLock: true })
  })

  it("не трогает ролик активного workflow-прогона", () => {
    const blocking = ["pending", "running", "cancelled"]

    const decisions = plan(blocking.map((workflowRunStatus, index) =>
      candidate({ id: index + 1, workflowRunStatus })))

    // Нода видео при повторном исполнении run'а создаёт НОВЫЙ Video —
    // параллельное возобновление старого означало бы двойную оплату.
    expect(decisions.every(d => d.action === "skip" && d.reason === "workflow_run_active")).toBe(true)
  })

  it("поднимает сироту завершённого workflow-прогона", () => {
    const decisions = plan([candidate({ workflowRunStatus: "failed" })])

    expect(decisions[0]).toMatchObject({ action: "resume" })
  })

  it("хоронит ролик с исчерпанными попытками шага", () => {
    const decisions = plan([candidate({ hasExhaustedStep: true })])

    expect(decisions[0]).toMatchObject({ action: "abandon", reason: "attempts_exhausted" })
  })

  it("хоронит фантом, который висит слишком долго", () => {
    const decisions = plan([candidate({
      startedAt: ago(STALLED_VIDEO_ABANDON_MS + MINUTE),
      updatedAt: ago(60 * MINUTE),
    })])

    expect(decisions[0]).toMatchObject({ action: "abandon", reason: "too_old" })
  })

  it("меряет возраст не начавшегося прогона от создания записи", () => {
    const decisions = plan([candidate({
      status: "pending",
      startedAt: null,
      createdAt: ago(STALLED_VIDEO_ABANDON_MS + MINUTE),
    })])

    expect(decisions[0]).toMatchObject({ action: "abandon", reason: "too_old" })
  })

  it("живая блокировка сильнее любого повода похоронить", () => {
    const decisions = plan([candidate({
      isLocked: true,
      lockedAt: ago(MINUTE),
      hasExhaustedStep: true,
      startedAt: ago(STALLED_VIDEO_ABANDON_MS + MINUTE),
    })])

    // Иначе долгий, но работающий прогон получил бы failed прямо посреди работы.
    expect(decisions[0]).toMatchObject({ action: "skip", reason: "locked" })
  })

  it("ограничивает число возобновлений за проход", () => {
    const candidates = Array.from({ length: 5 }, (_, index) => candidate({ id: index + 1 }))

    const decisions = plan(candidates, 2)

    expect(decisions.filter(d => d.action === "resume").map(d => d.videoId)).toEqual([1, 2])
    expect(decisions.slice(2).every(d => d.action === "skip" && d.reason === "batch_limit")).toBe(true)
  })

  it("недавно поднятый ролик не занимает место в партии", () => {
    const decisions = plan([
      candidate({ id: 1, recentlyDispatched: true }),
      candidate({ id: 2 }),
    ], 1)

    // Иначе пятёрка «вечных» кандидатов навсегда заслонила бы остальные висяки.
    expect(decisions).toEqual([
      { videoId: 1, action: "skip", reason: "recently_dispatched", releaseStaleLock: false },
      { videoId: 2, action: "resume", reason: "interrupted", releaseStaleLock: false },
    ])
  })

  it("недавно поднятый фантом всё равно хоронится", () => {
    const decisions = plan([candidate({
      recentlyDispatched: true,
      startedAt: ago(STALLED_VIDEO_ABANDON_MS + MINUTE),
    })])

    expect(decisions[0]).toMatchObject({ action: "abandon", reason: "too_old" })
  })

  it("лимит партии не мешает похоронить фантомов", () => {
    const decisions = plan([
      candidate({ id: 1 }),
      candidate({ id: 2, hasExhaustedStep: true }),
    ], 1)

    // Пометка — дешёвый UPDATE без походов в провайдеров, откладывать её незачем.
    expect(decisions).toEqual([
      { videoId: 1, action: "resume", reason: "interrupted", releaseStaleLock: false },
      { videoId: 2, action: "abandon", reason: "attempts_exhausted", releaseStaleLock: false },
    ])
  })
})

// ─── Плагин ──────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  resumeVideoPipeline: vi.fn(async (_videoId: number) => {}),
  forceReleaseLock: vi.fn(async (_videoId: number) => {}),
}))

vi.mock("../../../server/utils/video-pipeline", () => ({
  resumeVideoPipeline: mocks.resumeVideoPipeline,
}))

// Приведение клипов под concat идёт до озвучки и трогает ffmpeg — в тесте
// файлов нет, поэтому пути возвращаются как есть.
vi.mock("../../../server/utils/render", () => ({
  normalizeSceneClips: async (paths: string[]) => [...paths],
}))

vi.mock("../../../server/utils/video-pipeline-db", () => ({
  forceReleaseLock: mocks.forceReleaseLock,
}))

interface VideoRow {
  id: number
  status: string
  isLocked: boolean
  lockedAt: Date | null
  startedAt: Date | null
  createdAt: Date
  updatedAt: Date
  run: { status: string } | null
  steps: Array<{ attemptCount: number, maxAttempts: number }>
}

function row(patch: Partial<VideoRow> = {}): VideoRow {
  return {
    id: 1,
    status: "generating_clips",
    isLocked: false,
    lockedAt: null,
    startedAt: new Date(Date.now() - 60 * MINUTE),
    createdAt: new Date(Date.now() - 65 * MINUTE),
    updatedAt: new Date(Date.now() - 60 * MINUTE),
    run: null,
    steps: [],
    ...patch,
  }
}

const videoRows: VideoRow[] = []
const findMany = vi.fn(async () => videoRows)
const updateMany = vi.fn(async () => ({ count: 1 }))
const logAgent = vi.fn(async () => {})

interface TrackedCall { key: string, label: string, intervalMs: number, tick: () => unknown }
const trackedCalls: TrackedCall[] = []
const trackedInterval = vi.fn((key: string, label: string, intervalMs: number, tick: () => unknown) => {
  trackedCalls.push({ key, label, intervalMs, tick })
  return { unref: vi.fn() }
})

let startPlugin: (nitro: { hooks: { hook: (name: string, fn: () => void) => void } }) => void
let savedGlobals: Array<readonly [string, unknown]> = []
let savedEnv: Array<readonly [string, string | undefined]> = []

/** Дожидается асинхронного первого прохода, запущенного плагином через void. */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve()
  await new Promise(resolve => setTimeout(resolve, 0))
}

beforeAll(async () => {
  const globals = globalThis as unknown as Record<string, unknown>
  savedGlobals = [
    ["defineNitroPlugin", globals.defineNitroPlugin],
    ["trackedInterval", globals.trackedInterval],
    ["prisma", globals.prisma],
    ["logAgent", globals.logAgent],
  ]
  globals.defineNitroPlugin = (handler: unknown) => handler
  globals.trackedInterval = trackedInterval
  globals.prisma = { video: { findMany, updateMany } }
  globals.logAgent = logAgent

  const module = await import("../../../server/plugins/video-recovery")
  startPlugin = module.default as never
})

afterAll(() => {
  const globals = globalThis as unknown as Record<string, unknown>
  for (const [key, value] of savedGlobals) {
    if (value === undefined) delete globals[key]
    else globals[key] = value
  }
})

beforeEach(() => {
  savedEnv = (["SCHEDULERS_ENABLED", "VIDEO_RECOVERY_ENABLED"] as const)
    .map(key => [key, process.env[key]] as const)
  for (const [key] of savedEnv) delete process.env[key]
  videoRows.length = 0
  trackedCalls.length = 0
  trackedInterval.mockClear()
  findMany.mockClear()
  updateMany.mockClear()
  logAgent.mockClear()
  mocks.resumeVideoPipeline.mockClear()
  mocks.forceReleaseLock.mockClear()
})

afterEach(() => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

function start() {
  startPlugin({ hooks: { hook: vi.fn() } })
}

describe("P1-15: плагин восстановления видео", () => {
  it("поднимается, когда SCHEDULERS_ENABLED не задан", async () => {
    expect(process.env.SCHEDULERS_ENABLED).toBeUndefined()

    start()
    await flush()

    // Семантика соседних плагинов: выключено только при явном false.
    expect(trackedCalls).toEqual([
      { key: "video-recovery", label: expect.any(String), intervalMs: 5 * 60_000, tick: expect.any(Function) },
    ])
  })

  it("молчит при SCHEDULERS_ENABLED=false", async () => {
    process.env.SCHEDULERS_ENABLED = "false"

    start()
    await flush()

    expect(trackedInterval).not.toHaveBeenCalled()
    expect(findMany).not.toHaveBeenCalled()
  })

  it("имеет собственный рубильник", async () => {
    process.env.VIDEO_RECOVERY_ENABLED = "false"

    start()
    await flush()

    expect(trackedInterval).not.toHaveBeenCalled()
    expect(findMany).not.toHaveBeenCalled()
  })

  it("первый проход идёт сразу после старта, не дожидаясь тика", async () => {
    videoRows.push(row())

    start()
    await flush()

    // Рестарт процесса и есть основной повод для этой задачи — ждать 5 минут нечего.
    expect(mocks.resumeVideoPipeline).toHaveBeenCalledWith(1)
  })

  it("спрашивает у БД только промежуточные статусы и ограниченную партию", async () => {
    start()
    await flush()

    const args = findMany.mock.calls[0]?.[0] as unknown as {
      where: { status: { in: string[] } }
      take: number
      orderBy: { updatedAt: string }
    }
    expect(args.where.status.in).toEqual([...RESUMABLE_VIDEO_STATUSES])
    expect(args.take).toBeGreaterThan(0)
    // Самые залежавшиеся вперёд: лимит партии должен доставаться им.
    expect(args.orderBy).toEqual({ updatedAt: "asc" })
  })

  it("срывает протухшую блокировку перед возобновлением", async () => {
    videoRows.push(row({
      isLocked: true,
      lockedAt: new Date(Date.now() - STALLED_VIDEO_STALE_LOCK_MS - MINUTE),
    }))

    start()
    await flush()

    expect(mocks.forceReleaseLock).toHaveBeenCalledWith(1)
    expect(mocks.resumeVideoPipeline).toHaveBeenCalledWith(1)
  })

  it("не трогает ролик под живой блокировкой", async () => {
    videoRows.push(row({ isLocked: true, lockedAt: new Date(Date.now() - MINUTE) }))

    start()
    await flush()

    expect(mocks.forceReleaseLock).not.toHaveBeenCalled()
    expect(mocks.resumeVideoPipeline).not.toHaveBeenCalled()
  })

  it("считает попытки исчерпанными по шагам и помечает ролик, а не запускает", async () => {
    videoRows.push(row({ steps: [{ attemptCount: 3, maxAttempts: 3 }] }))

    start()
    await flush()

    expect(mocks.resumeVideoPipeline).not.toHaveBeenCalled()
    const args = updateMany.mock.calls[0]?.[0] as unknown as {
      where: { id: number, status: { in: string[] } }
      data: { status: string, errorMessage: string }
    }
    expect(args.where.id).toBe(1)
    // Фильтр по статусу — чтобы не затереть ролик, который как раз ожил.
    expect(args.where.status.in).toEqual([...RESUMABLE_VIDEO_STATUSES])
    // Именно failed: ручное возобновление принимает failed/canceled, timeout запер бы ролик.
    expect(args.data.status).toBe("failed")
    expect(args.data.errorMessage).toBeTruthy()
  })

  it("не подхватывает один и тот же ролик повторно на следующем тике", async () => {
    videoRows.push(row())

    start()
    await flush()
    expect(mocks.resumeVideoPipeline).toHaveBeenCalledTimes(1)

    await trackedCalls[0]!.tick()
    await flush()

    // Возобновление асинхронное: следующий проход видит ту же запись и без
    // защиты запустил бы платный пайплайн вторично.
    expect(mocks.resumeVideoPipeline).toHaveBeenCalledTimes(1)
  })

  it("падение возобновления не роняет проход и не мешает остальным", async () => {
    videoRows.push(row({ id: 1 }), row({ id: 2 }))
    mocks.resumeVideoPipeline.mockImplementationOnce(async () => {
      throw new Error("провайдер недоступен")
    })

    start()
    await flush()

    expect(mocks.resumeVideoPipeline).toHaveBeenCalledTimes(2)
    expect(logAgent).toHaveBeenCalledWith(
      'video-recovery',
      'error',
      expect.stringContaining("Не удалось возобновить видео 1"),
      expect.anything(),
    )
  })
})
