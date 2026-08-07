/**
 * Регрессия P0-1: разбор идеи не доходил до IdeaAnalysis.
 *
 * В processIdea() запись анализа ссылалась на переменную anthropicModel,
 * которой в области видимости не было. На каждом разборе это давало
 * ReferenceError внутри try/catch второго этапа: идея оставалась с
 * analysisStatus='failed', строка IdeaAnalysis не создавалась, и Модуль 2
 * (генерация сценария) не получал бриф ни по одной идее из раздела ТЗ
 * «База идей».
 *
 * Тест проверяет весь путь разбора: метаданные → базовый анализ → запись
 * IdeaAnalysis с непустой версией модели, причём версия берётся из того же
 * источника, что и модель фактического вызова (ANTHROPIC_MODEL), а не из
 * отдельного литерала.
 *
 * Сьюта чистая: ни БД, ни сети. Модули server/** ходят в prisma, $fetch и
 * requirePaidApisEnabled через auto-import Nuxt, поэтому фейки кладём в
 * globalThis до вызова, а внешние модули (метаданные, агент) подменяем vi.mock.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

// ───────────────────────── фикстуры внешних модулей ─────────────────────────

/** Общее состояние для фабрик vi.mock — они поднимаются выше объявлений. */
const mocked = vi.hoisted(() => ({
  /** Сколько раз звали структурированный анализ. */
  analyzerCalls: 0,
  analysisResult: {
    hookAnalysis: { type: "question", description: "вопрос в лоб", strength: 80 },
    sceneStructure: { estimatedDuration: "45 сек", scenes: [], narrativeArc: "storytime" },
    visualStyle: { colorTone: "тёплый", aesthetic: "minimal" },
    viralityReasons: { primaryReason: "боль зрителя", factors: [], replicability: 70 },
    summary: "Разбор по метаданным: заголовок, описание, хештеги.",
    confidence: 0.6,
  },
}))

vi.mock("~~/server/utils/video-metadata", () => ({
  // Метаданные фиксированы: этап 0 не должен ходить в сеть.
  fetchVideoMetadata: async () => ({
    title: "Три ошибки в утренней рутине",
    description: "Разбор привычек",
    authorName: "@reforma",
    thumbnailUrl: null,
    duration: "48",
    platform: "tiktok",
    viewCount: 120_000,
    hashtags: ["рутина", "привычки"],
    metadataSource: "og_tags",
  }),
}))

vi.mock("~~/server/utils/agents/idea-analyzer-agent", async (importOriginal) => {
  // Промпт-версию берём настоящую: она часть контракта записи анализа.
  const actual = await importOriginal<typeof import("~~/server/utils/agents/idea-analyzer-agent")>()
  return {
    ...actual,
    runIdeaAnalyzer: async () => {
      mocked.analyzerCalls += 1
      return mocked.analysisResult
    },
  }
})

// ───────────────────────── фейковые глобалы Nuxt ─────────────────────────

const PATCHED_GLOBALS = ["prisma", "$fetch", "requirePaidApisEnabled"] as const

const savedGlobals = new Map<string, unknown>()

function setGlobal(name: string, value: unknown): void {
  const holder = globalThis as unknown as Record<string, unknown>
  if (!savedGlobals.has(name)) savedGlobals.set(name, holder[name])
  holder[name] = value
}

function restoreGlobals(): void {
  const holder = globalThis as unknown as Record<string, unknown>
  for (const name of PATCHED_GLOBALS) {
    if (savedGlobals.has(name)) holder[name] = savedGlobals.get(name)
  }
  savedGlobals.clear()
}

const IDEA_ROW = {
  id: 7,
  sourceUrl: "https://www.tiktok.com/@reforma/video/1",
  language: "русский",
  title: null as string | null,
  platform: null as string | null,
  transcription: null as string | null,
}

const BASIC_ANALYSIS = {
  title: "Три ошибки в утренней рутине",
  hook: "Ты делаешь это каждое утро",
  body: "Разбор трёх привычек",
  cta: "Напиши кодовое слово в директ",
  visualStyle: "Съёмка от первого лица",
  whyViral: "Боль знакома аудитории",
}

interface UpsertCall {
  where: Record<string, unknown>
  create: Record<string, unknown>
  update: Record<string, unknown>
}

interface PipelineRun {
  ideaUpdates: Array<Record<string, unknown>>
  upserts: UpsertCall[]
  /** Модель, с которой реально ушёл запрос базового анализа. */
  requestedModels: string[]
}

/** Ставит фейки и возвращает журнал того, что пайплайн записал. */
function installFakes(): PipelineRun {
  const run: PipelineRun = { ideaUpdates: [], upserts: [], requestedModels: [] }

  setGlobal("prisma", {
    idea: {
      findUnique: async () => ({ ...IDEA_ROW }),
      update: async (args: { data: Record<string, unknown> }) => {
        run.ideaUpdates.push(args.data)
        return { ...IDEA_ROW }
      },
    },
    ideaAnalysis: {
      upsert: async (args: UpsertCall) => {
        run.upserts.push(args)
        return { id: 1 }
      },
    },
  })

  // Платный предохранитель в этом тесте не проверяем — он про ENV, а не про разбор.
  setGlobal("requirePaidApisEnabled", () => {})

  setGlobal("$fetch", async (_url: string, opts: { body?: { model?: string } }) => {
    run.requestedModels.push(String(opts?.body?.model ?? ""))
    return { content: [{ type: "text", text: JSON.stringify(BASIC_ANALYSIS) }] }
  })

  return run
}

const savedEnv: Record<string, string | undefined> = {
  ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
}

beforeEach(() => {
  mocked.analyzerCalls = 0
  // Ключ нужен, иначе pipeline обрывается до анализа. В сеть не ходим: $fetch — фейк.
  process.env.ANTHROPIC_API_KEY = "test-key-not-a-real-secret"
})

afterEach(() => {
  restoreGlobals()
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

// ───────────────────────────────── тесты ─────────────────────────────────

describe("разбор идеи доходит до IdeaAnalysis", () => {
  it("создаёт анализ с непустой версией модели и помечает идею completed", async () => {
    process.env.ANTHROPIC_MODEL = "claude-test-model-9"
    const run = installFakes()

    const { processIdea } = await import("~~/server/utils/idea-pipeline")
    const { IDEA_ANALYZER_PROMPT_VERSION } = await import("~~/server/utils/agents/idea-analyzer-agent")
    await processIdea(IDEA_ROW.id)

    // Второй этап действительно отработал, а не свалился в catch.
    expect(mocked.analyzerCalls).toBe(1)
    expect(run.upserts).toHaveLength(1)

    const upsert = run.upserts[0]!
    for (const branch of [upsert.create, upsert.update]) {
      expect(typeof branch.modelVersion).toBe("string")
      expect(String(branch.modelVersion).length).toBeGreaterThan(0)
      expect(branch.modelVersion).toBe("claude-test-model-9")
      expect(branch.promptVersion).toBe(IDEA_ANALYZER_PROMPT_VERSION)
      expect(branch.summary).toBe(mocked.analysisResult.summary)
    }

    // Версия совпадает с моделью фактического вызова — источник один.
    expect(run.requestedModels).toContain("claude-test-model-9")

    const statuses = run.ideaUpdates
      .map(d => d.analysisStatus)
      .filter((s): s is string => typeof s === "string")
    expect(statuses.at(-1)).toBe("completed")
    expect(statuses).not.toContain("failed")
  })

  it("без ANTHROPIC_MODEL пишет дефолтную модель, а не пустое значение", async () => {
    delete process.env.ANTHROPIC_MODEL
    const run = installFakes()

    const { processIdea } = await import("~~/server/utils/idea-pipeline")
    await processIdea(IDEA_ROW.id)

    expect(run.upserts).toHaveLength(1)
    const modelVersion = run.upserts[0]!.create.modelVersion
    expect(typeof modelVersion).toBe("string")
    // Литерал не фиксируем — важно, что версия непустая и это модель Claude,
    // та же, с которой ушёл запрос.
    expect(String(modelVersion)).toMatch(/^claude-/)
    expect(run.requestedModels).toContain(String(modelVersion))
  })

  it("повторный анализ пишет ту же версию модели, что и первичный разбор", async () => {
    process.env.ANTHROPIC_MODEL = "claude-test-model-9"

    const first = installFakes()
    const { processIdea, reanalyzeIdea } = await import("~~/server/utils/idea-pipeline")
    await processIdea(IDEA_ROW.id)
    restoreGlobals()

    const second = installFakes()
    await reanalyzeIdea(IDEA_ROW.id)

    expect(second.upserts).toHaveLength(1)
    expect(second.upserts[0]!.create.modelVersion).toBe(first.upserts[0]!.create.modelVersion)
  })
})
