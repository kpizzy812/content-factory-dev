/**
 * P0-18: Telegram-бот «разбирал» чужие ролики, которых не видел.
 *
 * Старое поведение: на ссылку уходил один запрос в Anthropic с голым URL и
 * промптом «проанализируй видео по ссылке» (server/utils/telegram/analyzer.ts),
 * без транскрибации и кадров, плюс «Отвечай на русском» в промпте и
 * language:'русский' у создаваемой идеи. ТЗ (docs/SPEC.md, «Telegram-бот» →
 * «Анализ чужих роликов») требует ровно обратного: транскрибация на нужном
 * языке, разбор структуры и объяснение, почему залетело.
 *
 * Здесь проверяется, что бот идёт через reference-pipeline (реальная
 * транскрибация), язык берётся из расшифровки, а при выключенных платных API и
 * в mock-режиме реальных вызовов нет и пользователь получает внятный текст.
 *
 * Сьюта чистая: ни БД, ни сети. reference-pipeline и messaging замоканы,
 * auto-import'ы (prisma, processIdea, $fetch) подменены в globalThis.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { processVideoUrl } from "~~/server/utils/telegram/bot"
import type { ReferenceBreakdown } from "~~/shared/types/reference"

// ───────────────────────── моки модулей ─────────────────────────

const sentMessages: string[] = []

vi.mock("~~/server/utils/telegram/messaging", () => ({
  sendMessage: async (_token: string, _chatId: string, text: string) => {
    sentMessages.push(text)
    return { messageId: sentMessages.length, success: true }
  },
  editMessage: async () => ({ messageId: 1, success: true }),
}))

vi.mock("~~/server/utils/telegram/commands", () => ({
  handleCommand: async () => {},
}))

interface PipelineState {
  /** id идей, для которых реально запускали разбор с транскрибацией. */
  analyzed: number[]
  /** Сколько слотов concurrency взяли и сколько отпустили. */
  acquired: number
  released: number
  /** Разрешать ли брать слот (имитация занятой очереди). */
  slotAvailable: boolean
  /** Заставить pipeline упасть. */
  failWith: string | null
}

const pipeline: PipelineState = {
  analyzed: [],
  acquired: 0,
  released: 0,
  slotAvailable: true,
  failWith: null,
}

const TRANSCRIPT_TEXT = "I tried this app for thirty days and here is what happened"

function buildBreakdown(): ReferenceBreakdown {
  return {
    version: "test",
    mediaType: "video",
    transcript: {
      fullText: TRANSCRIPT_TEXT,
      segments: [{ start: 0, duration: 3, text: TRANSCRIPT_TEXT }],
      source: "whisper",
      language: "en",
    },
    sceneTimeline: [
      {
        order: 1,
        startMarker: "0:00",
        duration: "3s",
        action: "крупный план лица",
        purpose: "хук",
        onScreenText: null,
        visualCues: "резкий зум",
        emotionalTone: "любопытство",
        cameraWork: null,
      },
    ],
    narrativeMechanics: {
      hookType: "провокационный вопрос",
      hookDescription: "первые слова обещают результат за 30 дней",
      bodyMechanic: "хронология эксперимента с промежуточными замерами",
      ctaMechanic: "предложение повторить эксперимент и написать в директ",
      emotionalArc: ["интерес", "сомнение", "доверие"],
      pacing: "склейка каждые 1.5 секунды",
      narrativeTemplate: "experiment-log",
      transformationArc: null,
    },
    visualPatterns: {
      colorPalette: ["#101010"],
      lighting: "мягкий контровой",
      cameraStyle: "ручная камера",
      composition: "крупный план по центру",
      textOverlayStyle: "жирные субтитры по центру",
      aesthetic: "домашний влог",
      effects: ["зум-панч"],
    },
    subtitleMechanics: {
      hasSubtitles: true,
      style: "bold",
      placement: "center",
      rhythm: "по слову",
      textSize: "крупный",
      colorScheme: "белый с обводкой",
    },
    appIntegrationPattern: null,
    abstractedPatterns: [
      {
        name: "Обещание измеримого результата",
        category: "hook",
        abstractDescription: "конкретный срок и измеримый итог в первых словах",
        applicationGuide: "поставить срок и метрику в первую фразу",
        strength: 92,
      },
      {
        name: "Хронология с промежуточными точками",
        category: "narrative",
        abstractDescription: "зритель остаётся ради следующей контрольной точки",
        applicationGuide: "разбить тело на отметки времени",
        strength: 80,
      },
    ],
    originalityGuide: {
      safeToReuse: ["структура хронологии"],
      mustTransform: ["конкретные формулировки"],
      requireOriginal: ["визуальный ряд"],
      transformationSuggestions: ["сменить нишу эксперимента"],
      targetOriginalityScore: 0.8,
    },
    confidence: 0.77,
    dataAvailability: {
      hasTranscript: true,
      hasTimedSegments: true,
      hasThumbnail: true,
      hasDescription: true,
      metadataRichness: "rich",
    },
  }
}

vi.mock("~~/server/utils/reference-pipeline", () => ({
  analyzeIdeaReference: async (ideaId: number) => {
    pipeline.analyzed.push(ideaId)
    if (pipeline.failWith) throw new Error(pipeline.failWith)
    return { breakdown: buildBreakdown(), transcriptExtracted: true, errors: [] }
  },
  tryAcquireAnalysisSlot: () => {
    if (!pipeline.slotAvailable) return false
    pipeline.acquired += 1
    return true
  },
  releaseAnalysisSlot: () => { pipeline.released += 1 },
}))

// ───────────────────────── подмена auto-import'ов ─────────────────────────

const PATCHED_GLOBALS = ["prisma", "processIdea", "$fetch"] as const

const savedGlobals = new Map<string, { present: boolean, value: unknown }>()

function setGlobal(name: string, value: unknown): void {
  const holder = globalThis as unknown as Record<string, unknown>
  if (!savedGlobals.has(name)) {
    savedGlobals.set(name, { present: name in holder, value: holder[name] })
  }
  holder[name] = value
}

/** Возвращаем globalThis как было: соседние сьюты проверяют auto-import'ы. */
function restoreGlobals(): void {
  const holder = globalThis as unknown as Record<string, unknown>
  for (const name of PATCHED_GLOBALS) {
    const saved = savedGlobals.get(name)
    if (!saved) continue
    if (saved.present) holder[name] = saved.value
    else delete holder[name]
  }
  savedGlobals.clear()
}

interface DbState {
  /** Данные, с которыми создали идею — по ним видно захардкоженный язык. */
  createdIdeas: Array<Record<string, unknown>>
  /** Апдейты идеи: referenceStatus running/failed. */
  ideaUpdates: Array<Record<string, unknown>>
  /** Сколько раз звали быстрый метаданный проход. */
  processIdeaCalls: number
  /** Сколько раз кто-то полез в сеть. */
  fetchCalls: string[]
}

const db: DbState = { createdIdeas: [], ideaUpdates: [], processIdeaCalls: 0, fetchCalls: [] }

const NEW_IDEA_ID = 4242

function installGlobals(): void {
  setGlobal("prisma", {
    telegramChat: { findUnique: async () => ({ chatId: "1", userId: 9 }) },
    idea: {
      findFirst: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        db.createdIdeas.push({ ...data })
        return { id: NEW_IDEA_ID, ...data }
      },
      update: async ({ data }: { data: Record<string, unknown> }) => {
        db.ideaUpdates.push({ ...data })
        return { id: NEW_IDEA_ID }
      },
    },
    ideaOperatorAction: { create: async () => ({ id: 1 }) },
    telegramCommandAudit: { create: async () => ({ id: 1 }) },
  })

  setGlobal("processIdea", async () => { db.processIdeaCalls += 1 })

  setGlobal("$fetch", async (url: string) => {
    db.fetchCalls.push(url)
    throw new Error(`в тесте сеть запрещена: ${url}`)
  })
}

const VIDEO_URL = "https://www.tiktok.com/@someone/video/12345"

const savedEnv: Record<string, string | undefined> = {}

function setEnv(name: string, value: string | undefined): void {
  if (!(name in savedEnv)) savedEnv[name] = process.env[name]
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

beforeEach(() => {
  sentMessages.length = 0
  db.createdIdeas.length = 0
  db.ideaUpdates.length = 0
  db.processIdeaCalls = 0
  db.fetchCalls.length = 0
  pipeline.analyzed.length = 0
  pipeline.acquired = 0
  pipeline.released = 0
  pipeline.slotAvailable = true
  pipeline.failWith = null
  installGlobals()
})

afterEach(() => {
  restoreGlobals()
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  for (const key of Object.keys(savedEnv)) delete savedEnv[key]
})

function enableRealAnalysis(): void {
  setEnv("ENABLE_PAID_APIS", "true")
  setEnv("ANTHROPIC_API_KEY", "sk-test")
  setEnv("ANTHROPIC_MOCK_MODE", undefined)
}

describe("P0-18: Telegram-бот разбирает ролик по транскрибации, а не по одной ссылке", () => {
  it("прогоняет ссылку через reference-pipeline и цитирует расшифровку", async () => {
    enableRealAnalysis()

    await processVideoUrl("token", "42", VIDEO_URL)
    await vi.waitFor(() => expect(sentMessages.length).toBe(2))

    // Главное: разбор построен на реальном прогоне с транскрибацией.
    expect(pipeline.analyzed).toEqual([NEW_IDEA_ID])
    // Старый путь ходил в Anthropic напрямую с голым URL — сети быть не должно.
    expect(db.fetchCalls).toEqual([])

    const analysisText = sentMessages[1]!
    expect(analysisText).toContain(TRANSCRIPT_TEXT)
    expect(analysisText).toContain("первые слова обещают результат за 30 дней")
    expect(analysisText).toContain("предложение повторить эксперимент")
    expect(analysisText).toContain("домашний влог")
    expect(analysisText).toContain("Почему залетело")
    expect(analysisText).toContain("Обещание измеримого результата")

    // Слот concurrency берётся и отпускается — телеграм не пробивает лимит.
    expect(pipeline.acquired).toBe(1)
    expect(pipeline.released).toBe(1)
  })

  it("язык берётся из транскрибации, а не прибит русским при создании идеи", async () => {
    enableRealAnalysis()

    await processVideoUrl("token", "42", VIDEO_URL)
    await vi.waitFor(() => expect(sentMessages.length).toBe(2))

    const created = db.createdIdeas[0]!
    expect(created.language).not.toBe("русский")
    expect(created.language ?? null).toBeNull()

    // Язык распознанной речи виден пользователю.
    expect(sentMessages[1]).toContain("язык en")
  })

  it("метаданный проход идёт до глубокого разбора, чтобы не затереть расшифровку", async () => {
    enableRealAnalysis()

    await processVideoUrl("token", "42", VIDEO_URL)
    await vi.waitFor(() => expect(sentMessages.length).toBe(2))

    expect(db.processIdeaCalls).toBe(1)
    expect(pipeline.analyzed.length).toBe(1)
  })

  it("mock-режим Anthropic: ни сети, ни платных вызовов, но пользователь получает причину", async () => {
    setEnv("ENABLE_PAID_APIS", "true")
    setEnv("ANTHROPIC_API_KEY", "sk-test")
    setEnv("ANTHROPIC_MOCK_MODE", "true")

    await processVideoUrl("token", "42", VIDEO_URL)

    expect(pipeline.analyzed).toEqual([])
    expect(db.processIdeaCalls).toBe(0)
    expect(db.fetchCalls).toEqual([])
    expect(sentMessages).toHaveLength(1)
    expect(sentMessages[0]).toContain("ANTHROPIC_MOCK_MODE")
  })

  it("выключенные платные API: идея сохраняется, но разбор не выдумывается", async () => {
    setEnv("ENABLE_PAID_APIS", "false")
    setEnv("ANTHROPIC_API_KEY", "sk-test")
    setEnv("ANTHROPIC_MOCK_MODE", undefined)

    await processVideoUrl("token", "42", VIDEO_URL)

    expect(pipeline.analyzed).toEqual([])
    expect(db.fetchCalls).toEqual([])
    expect(db.createdIdeas).toHaveLength(1)
    expect(sentMessages).toHaveLength(1)
    expect(sentMessages[0]).toContain("ENABLE_PAID_APIS")
  })

  it("очередь занята: отказ с объяснением вместо молчания и без прогона", async () => {
    enableRealAnalysis()
    pipeline.slotAvailable = false

    await processVideoUrl("token", "42", VIDEO_URL)
    await vi.waitFor(() => expect(sentMessages.length).toBe(2))

    expect(pipeline.analyzed).toEqual([])
    expect(pipeline.released).toBe(0)
    expect(sentMessages[1]).toContain("очередь занята")
  })

  it("падение пайплайна: пользователь получает ошибку, идея помечается failed, слот освобождается", async () => {
    enableRealAnalysis()
    pipeline.failWith = "yt-dlp: видео недоступно"

    await processVideoUrl("token", "42", VIDEO_URL)
    await vi.waitFor(() => expect(sentMessages.length).toBe(2))

    expect(sentMessages[1]).toContain("yt-dlp: видео недоступно")
    expect(pipeline.released).toBe(1)
    expect(db.ideaUpdates.some(u => u.referenceStatus === "failed")).toBe(true)
  })
})
