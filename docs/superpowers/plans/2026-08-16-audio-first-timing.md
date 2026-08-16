# Монтаж от звука, часть 1: звук как эталон времени — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Озвучка ролика синтезируется одним непрерывным треком, его слова получают реальные тайминги через транскрипцию, и по этим таймингам живут границы сцен и субтитры.

**Architecture:** Шаг озвучки переезжает в начало пайплайна и синтезирует один файл вместо реплики на сцену. Новый шаг транскрипции снимает с этого файла слова с границами. Чистый модуль выравнивания сопоставляет распознанные слова с текстом сценария и отдаёт фактические границы сцен. Субтитры и сборка начинают опираться на эти границы; финальный звук кладётся в таймлайн одним куском, дорожки клипов глушатся. Новый маршрут включается флагом `EDIT_PIPELINE` и фиксируется на ролике, старый продолжает работать.

**Tech Stack:** Nuxt 4 / Nitro, Bun, TypeScript, Prisma + PostgreSQL, Vitest (DB-free сьюта — `vitest.pure.config.ts`), FFmpeg через `fluent-ffmpeg`, Replicate как основной медиапровайдер.

**Spec:** `docs/superpowers/specs/2026-08-16-audio-first-editing-design.md`

## Global Constraints

- Пакетный менеджер — **Bun**, не npm (`AGENTS.md`). Команды тестов: `bunx vitest run ...`.
- БД меняется **только миграциями**, `prisma db push` запрещён.
- Replicate — основной провайдер медиамоделей; fal только как явно настроенный fallback.
- Модель без подтверждённой страницей цены остаётся `integrated: false` и в смету не попадает.
- Комментарии и сообщения об ошибках — по-русски, как в окружающем коде.
- Не создавать файлы-монстры: новая логика живёт отдельными модулями в `server/utils/transcription/`.
- DB-free тесты должны попадать в `vitest.pure.config.ts` (список `include` явный, новые каталоги надо в него добавлять).
- Ничего не удалять из старого маршрута: он работает до canary-сравнения (§2 спеки).

## File Structure

**Создаётся:**

| Файл | Ответственность |
|---|---|
| `server/utils/transcription/types.ts` | Тип транскрипта: слово, границы, полный текст |
| `server/utils/transcription/normalize.ts` | Приведение сырого ответа модели к нашему транскрипту (три известные формы выхода) |
| `server/utils/transcription/align.ts` | Сопоставление слов транскрипта с текстом сцен сценария |
| `server/utils/transcription/runner.ts` | Шаг пайплайна: взять трек, вызвать способность, сохранить транскрипт |
| `server/utils/voiceover/track-builder.ts` | Сборка текста ролика в один запрос TTS и синтез единого трека |
| `tests/unit/transcription/normalize.spec.ts` | Тесты нормализатора |
| `tests/unit/transcription/align.spec.ts` | Тесты выравнивания |
| `tests/unit/transcription/step-order.spec.ts` | Тесты порядка шагов и каскада сброса |
| `tests/unit/transcription/track-builder.spec.ts` | Тесты сборки текста и вставки пауз |
| `tests/unit/media-provider/transcription-spec.spec.ts` | Тесты спеки модели и маршрута |
| `prisma/migrations/20260817000000_add_transcription_step/migration.sql` | Значение enum, поля маршрута и транскрипта |

**Модифицируется:**

| Файл | Что меняется |
|---|---|
| `server/utils/media-provider/types.ts` | Способность `transcription`, её вход, ограничения, тип спеки, ветка исполнения `sync_json` |
| `server/utils/media-provider/registry.ts` | Способность в списке, env-ключи модели и фолбэка |
| `server/utils/media-provider/model-specs.ts` | Спека модели транскрипции |
| `server/utils/media-provider/run-media-task.ts` | Ветка `sync_json`: JSON-выход вместо файла |
| `server/utils/video-pipeline-db.ts` | `StepKey` и `STEP_ORDER` |
| `server/utils/video-pipeline-run-policy.ts` | `STEP_EXECUTION_ORDER` для нового маршрута |
| `server/utils/video-pipeline-reset.ts` | Типы ассетов нового шага |
| `server/utils/subtitles/ass-builder/dialogue.ts` | Источник word-timings |
| `server/utils/video-pipeline.ts` | Громкость дорожек клипов и отключение reconciliation на новом маршруте |
| `prisma/schema.prisma` | `VideoStepKey.transcription`, `AssetType.transcript`, `Video.editPipeline` |
| `vitest.pure.config.ts` | Каталог `tests/unit/transcription/**` в `include` |

---

### Task 1: Тип транскрипта и нормализатор сырого ответа

Модель транскрипции возвращает JSON, форма которого зависит от обёртки. Схему конкретной модели снять сейчас нельзя (токена нет, §14 спеки), поэтому нормализатор принимает три формы, которые встречаются у обёрток Whisper, и приводит их к одному типу. Когда схема будет снята, спека модели просто выберет нужную ветку — трогать выравнивание и субтитры не придётся.

**Files:**
- Create: `server/utils/transcription/types.ts`
- Create: `server/utils/transcription/normalize.ts`
- Test: `tests/unit/transcription/normalize.spec.ts`
- Modify: `vitest.pure.config.ts`

**Interfaces:**
- Consumes: ничего (первая задача).
- Produces: `TranscriptWord { text: string, startSec: number, endSec: number }`, `Transcript { words: TranscriptWord[], text: string }`, `normalizeTranscriptPayload(raw: unknown): Transcript`.

- [ ] **Step 1: Добавить каталог в DB-free сьюту**

В `vitest.pure.config.ts` в массив `include` добавить строку рядом с прочими:

```ts
      "tests/unit/transcription/**/*.spec.ts",
```

- [ ] **Step 2: Написать падающий тест**

Создать `tests/unit/transcription/normalize.spec.ts`:

```ts
import { describe, expect, it } from "vitest"

import { normalizeTranscriptPayload } from "~~/server/utils/transcription/normalize"

describe("нормализация ответа модели транскрипции", () => {
  it("читает форму chunks с парой timestamp", () => {
    const result = normalizeTranscriptPayload({
      text: "привет мир",
      chunks: [
        { text: " привет", timestamp: [0, 0.42] },
        { text: " мир", timestamp: [0.42, 0.9] },
      ],
    })

    expect(result.words).toEqual([
      { text: "привет", startSec: 0, endSec: 0.42 },
      { text: "мир", startSec: 0.42, endSec: 0.9 },
    ])
    expect(result.text).toBe("привет мир")
  })

  it("читает форму segments со вложенными словами", () => {
    const result = normalizeTranscriptPayload({
      segments: [
        { start: 0, end: 1.1, text: "привет мир", words: [
          { word: "привет", start: 0, end: 0.42 },
          { word: "мир", start: 0.42, end: 0.9 },
        ] },
      ],
    })

    expect(result.words).toHaveLength(2)
    expect(result.words[1]).toEqual({ text: "мир", startSec: 0.42, endSec: 0.9 })
  })

  it("читает плоский список слов", () => {
    const result = normalizeTranscriptPayload({
      words: [{ word: "мир", start: 1, end: 1.5 }],
    })

    expect(result.words).toEqual([{ text: "мир", startSec: 1, endSec: 1.5 }])
  })

  it("собирает полный текст, если модель его не прислала", () => {
    const result = normalizeTranscriptPayload({
      words: [{ word: "привет", start: 0, end: 0.4 }, { word: "мир", start: 0.4, end: 0.9 }],
    })

    expect(result.text).toBe("привет мир")
  })

  it("отбрасывает слова без валидных границ, а не подставляет нули", () => {
    const result = normalizeTranscriptPayload({
      chunks: [
        { text: "первое", timestamp: [0, 0.5] },
        { text: "битое", timestamp: [null, null] },
        { text: "второе", timestamp: [0.6, 1.2] },
      ],
    })

    expect(result.words.map(w => w.text)).toEqual(["первое", "второе"])
  })

  it("падает внятно, когда слов нет вовсе", () => {
    expect(() => normalizeTranscriptPayload({ text: "есть текст, нет слов" }))
      .toThrow(/без границ слов/)
  })
})
```

- [ ] **Step 3: Запустить тест и убедиться, что он падает**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/transcription/normalize.spec.ts`
Expected: FAIL — модуль `normalize` не существует.

- [ ] **Step 4: Написать тип**

Создать `server/utils/transcription/types.ts`:

```ts
/**
 * Транскрипт нашей собственной озвучки.
 *
 * Нужен не ради текста — текст мы и так знаем из сценария, — а ради ГРАНИЦ:
 * по ним режутся кадры, по ним показываются субтитры и по ним считается
 * фактическая длина сцены (spec 2026-08-16-audio-first-editing §4).
 */

export interface TranscriptWord {
  /** Слово без окружающей пунктуации и пробелов. */
  text: string
  startSec: number
  endSec: number
}

export interface Transcript {
  words: TranscriptWord[]
  /** Полный распознанный текст: для диагностики и для отчёта оператору. */
  text: string
}
```

- [ ] **Step 5: Написать нормализатор**

Создать `server/utils/transcription/normalize.ts`:

```ts
/**
 * Приведение ответа модели транскрипции к нашему транскрипту.
 *
 * Обёртки Whisper отдают слова тремя разными способами: `chunks` с парой
 * timestamp, `segments[].words` и плоский `words`. Разбор живёт здесь, а не в
 * спеке модели, чтобы смена модели не тянула за собой правку выравнивания и
 * субтитров.
 *
 * Слово без валидных границ выбрасывается, а не получает ноль: ноль встал бы в
 * начало ролика и утащил бы туда же субтитр.
 */

import type { Transcript, TranscriptWord } from "./types"

interface RawWordLike {
  text?: unknown
  word?: unknown
  start?: unknown
  end?: unknown
  timestamp?: unknown
}

function cleanWord(value: unknown): string {
  if (typeof value !== "string") return ""
  return value.trim().replace(/^[.,;:!?…«»"'`()\[\]{}]+|[.,;:!?…«»"'`()\[\]{}]+$/g, "")
}

function readSeconds(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null
}

function toWord(raw: RawWordLike): TranscriptWord | null {
  const text = cleanWord(raw.text ?? raw.word)
  if (!text) return null

  let startSec = readSeconds(raw.start)
  let endSec = readSeconds(raw.end)

  if (Array.isArray(raw.timestamp)) {
    startSec = readSeconds(raw.timestamp[0])
    endSec = readSeconds(raw.timestamp[1])
  }

  if (startSec === null || endSec === null || endSec < startSec) return null
  return { text, startSec, endSec }
}

function collectWords(raw: Record<string, unknown>): TranscriptWord[] {
  const direct = Array.isArray(raw.words) ? raw.words : null
  const chunks = Array.isArray(raw.chunks) ? raw.chunks : null
  const segments = Array.isArray(raw.segments) ? raw.segments : null

  const source: unknown[] = direct ?? chunks ?? (segments ?? []).flatMap((segment) => {
    const nested = (segment as { words?: unknown }).words
    return Array.isArray(nested) ? nested : []
  })

  const words: TranscriptWord[] = []
  for (const item of source) {
    if (!item || typeof item !== "object") continue
    const word = toWord(item as RawWordLike)
    if (word) words.push(word)
  }
  return words
}

export function normalizeTranscriptPayload(raw: unknown): Transcript {
  if (!raw || typeof raw !== "object") {
    throw new Error("Транскрипция вернула не объект — разбирать нечего")
  }

  const record = raw as Record<string, unknown>
  const words = collectWords(record)
  if (words.length === 0) {
    throw new Error("Транскрипция вернула ответ без границ слов: монтировать по нему нельзя")
  }

  const text = typeof record.text === "string" && record.text.trim()
    ? record.text.trim()
    : words.map(word => word.text).join(" ")

  return { words, text }
}
```

- [ ] **Step 6: Запустить тест и убедиться, что он проходит**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/transcription/normalize.spec.ts`
Expected: PASS, 6 тестов.

- [ ] **Step 7: Коммит**

```bash
git add server/utils/transcription/types.ts server/utils/transcription/normalize.ts tests/unit/transcription/normalize.spec.ts vitest.pure.config.ts
git commit -m "feat: транскрипт озвучки — тип и нормализатор ответа модели"
```

---

### Task 2: Выравнивание транскрипта со сценарием

Модель слышит «эм эр эр», в сценарии написано «MRR»; она же глотает слова и добавляет лишние. Нужны фактические границы каждой сцены и слова сценария с реальным временем — при том, что показывать мы будем текст сценария, а не распознанный.

**Files:**
- Create: `server/utils/transcription/align.ts`
- Test: `tests/unit/transcription/align.spec.ts`

**Interfaces:**
- Consumes: `Transcript`, `TranscriptWord` из Task 1.
- Produces:
  - `alignScriptToTranscript(input: { scenes: AlignScene[], transcript: Transcript }): AlignmentResult`
  - `AlignScene { order: number, text: string }`
  - `AlignedWord { text: string, startSec: number, endSec: number, matched: boolean }`
  - `AlignedScene { order: number, startSec: number, endSec: number, words: AlignedWord[] }`
  - `AlignmentResult { scenes: AlignedScene[], matchedRatio: number, degraded: boolean }`

- [ ] **Step 1: Написать падающий тест**

Создать `tests/unit/transcription/align.spec.ts`:

```ts
import { describe, expect, it } from "vitest"

import { alignScriptToTranscript } from "~~/server/utils/transcription/align"
import type { Transcript } from "~~/server/utils/transcription/types"

function transcript(words: Array<[string, number, number]>): Transcript {
  return {
    words: words.map(([text, startSec, endSec]) => ({ text, startSec, endSec })),
    text: words.map(([text]) => text).join(" "),
  }
}

describe("выравнивание сценария по транскрипту", () => {
  it("даёт сценам фактические границы", () => {
    const result = alignScriptToTranscript({
      scenes: [
        { order: 1, text: "Знаешь, что отличает успешных?" },
        { order: 2, text: "Они думают о деньгах." },
      ],
      transcript: transcript([
        ["знаешь", 0, 0.4], ["что", 0.4, 0.6], ["отличает", 0.6, 1.2], ["успешных", 1.2, 1.9],
        ["они", 2.3, 2.5], ["думают", 2.5, 3.0], ["о", 3.0, 3.1], ["деньгах", 3.1, 3.8],
      ]),
    })

    expect(result.scenes[0]).toMatchObject({ order: 1, startSec: 0, endSec: 1.9 })
    expect(result.scenes[1]).toMatchObject({ order: 2, startSec: 2.3, endSec: 3.8 })
  })

  it("сопоставляет «MRR» с распознанным «эм эр эр»", () => {
    const result = alignScriptToTranscript({
      scenes: [{ order: 1, text: "Это называется MRR сегодня" }],
      transcript: transcript([
        ["это", 0, 0.3], ["называется", 0.3, 1.0],
        ["эм", 1.0, 1.2], ["эр", 1.2, 1.4], ["эр", 1.4, 1.6],
        ["сегодня", 1.6, 2.2],
      ]),
    })

    const words = result.scenes[0]!.words
    expect(words.map(w => w.text)).toEqual(["Это", "называется", "MRR", "сегодня"])
    // Аббревиатура занимает все три распознанных слога, а не первый из них.
    expect(words[2]).toMatchObject({ startSec: 1.0, endSec: 1.6, matched: true })
    expect(result.scenes[0]).toMatchObject({ startSec: 0, endSec: 2.2 })
  })

  it("переживает проглоченное моделью слово", () => {
    const result = alignScriptToTranscript({
      scenes: [{ order: 1, text: "начни с малого но начни" }],
      transcript: transcript([
        ["начни", 0, 0.4], ["малого", 0.4, 1.0], ["но", 1.0, 1.1], ["начни", 1.1, 1.5],
      ]),
    })

    const words = result.scenes[0]!.words
    expect(words.map(w => w.text)).toEqual(["начни", "с", "малого", "но", "начни"])
    expect(words[1]!.matched).toBe(false)
    // Несопоставленное слово не рвёт таймлайн: оно занимает щель между соседями.
    expect(words[1]!.startSec).toBeGreaterThanOrEqual(words[0]!.endSec)
    expect(words[1]!.endSec).toBeLessThanOrEqual(words[2]!.startSec)
  })

  it("переживает лишнее распознанное слово", () => {
    const result = alignScriptToTranscript({
      scenes: [{ order: 1, text: "тело меняется" }],
      transcript: transcript([
        ["тело", 0, 0.4], ["эээ", 0.4, 0.6], ["меняется", 0.6, 1.2],
      ]),
    })

    expect(result.scenes[0]!.words.map(w => w.text)).toEqual(["тело", "меняется"])
    expect(result.scenes[0]).toMatchObject({ startSec: 0, endSec: 1.2 })
  })

  it("сообщает о деградации, когда сошлось меньше половины слов", () => {
    const result = alignScriptToTranscript({
      scenes: [{ order: 1, text: "совершенно другой текст сценария здесь" }],
      transcript: transcript([
        ["посторонняя", 0, 0.5], ["запись", 0.5, 1.0], ["чужого", 1.0, 1.5], ["голоса", 1.5, 2.0],
      ]),
    })

    expect(result.degraded).toBe(true)
    expect(result.matchedRatio).toBeLessThan(0.5)
    // Границы сцены всё равно есть — ролик собирается, но с предупреждением.
    expect(result.scenes[0]!.endSec).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/transcription/align.spec.ts`
Expected: FAIL — модуль `align` не существует.

- [ ] **Step 3: Написать выравнивание**

Создать `server/utils/transcription/align.ts`:

```ts
/**
 * Сопоставление текста сценария с распознанными словами.
 *
 * Показываем мы текст сценария («MRR»), а время знаем только про распознанные
 * слова («эм эр эр»). Поэтому нужно не «исправить транскрипцию моделью», как
 * это делают снаружи, а связать два ряда слов: у нас есть эталонный текст, и
 * подставлять вместо него распознанное незачем (spec §4.2).
 *
 * Алгоритм — классическое выравнивание двух последовательностей по Левенштейну
 * на уровне слов с восстановлением пути. Аббревиатура, разобранная моделью на
 * слоги, ловится отдельным правилом: слово сценария из одних заглавных латинских
 * букв поглощает столько распознанных слов, сколько в нём букв.
 */

import type { Transcript, TranscriptWord } from "./types"

export interface AlignScene {
  order: number
  text: string
}

export interface AlignedWord {
  /** Слово ИЗ СЦЕНАРИЯ — именно оно попадёт в субтитр. */
  text: string
  startSec: number
  endSec: number
  /** Нашлось ли ему распознанное слово. false — время интерполировано. */
  matched: boolean
}

export interface AlignedScene {
  order: number
  startSec: number
  endSec: number
  words: AlignedWord[]
}

export interface AlignmentResult {
  scenes: AlignedScene[]
  /** Доля слов сценария, которым нашлось распознанное слово. */
  matchedRatio: number
  /** Сошлось меньше половины — время сцен ненадёжно, вызывающий обязан сказать вслух. */
  degraded: boolean
}

const DEGRADED_THRESHOLD = 0.5

interface ScriptToken {
  sceneOrder: number
  /** Как слово выглядит в сценарии. */
  raw: string
  /** Как оно звучало бы в транскрипте. */
  normalized: string
  /** Сколько распознанных слов оно поглощает: у аббревиатур — по букве. */
  span: number
}

/** Приведение к сравнимому виду: регистр, ё/е, окружающая пунктуация. */
export function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/^[.,;:!?…«»"'`()\[\]{}]+|[.,;:!?…«»"'`()\[\]{}]+$/g, "")
    .trim()
}

/** Латинская аббревиатура из заглавных: «MRR» звучит тремя словами. */
function isSpelledAbbreviation(raw: string): boolean {
  const bare = raw.replace(/[^A-Za-z]/g, "")
  return bare.length >= 2 && bare.length <= 5 && bare === bare.toUpperCase() && raw === raw.toUpperCase()
}

function tokenizeScene(scene: AlignScene): ScriptToken[] {
  return scene.text
    .split(/\s+/)
    .map(word => word.trim())
    .filter(Boolean)
    .map((raw) => {
      const normalized = normalizeToken(raw)
      const span = isSpelledAbbreviation(raw) ? raw.replace(/[^A-Za-z]/g, "").length : 1
      return { sceneOrder: scene.order, raw, normalized, span }
    })
    .filter(token => token.normalized.length > 0)
}

type Op = "match" | "script_only" | "transcript_only"

/**
 * Путь выравнивания. Стоимость замены равна двум удалениям: слово, которое не
 * похоже, дешевле считать пропуском с обеих сторон, чем «сопоставленным» —
 * иначе на несопоставимом тексте мы получили бы уверенные, но выдуманные тайминги.
 */
function alignSequences(script: ScriptToken[], heard: TranscriptWord[]): Array<{ op: Op, scriptIndex: number, heardIndex: number }> {
  const n = script.length
  const m = heard.length
  const cost: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))

  for (let i = 0; i <= n; i += 1) cost[i]![0] = i
  for (let j = 0; j <= m; j += 1) cost[0]![j] = j

  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const same = script[i - 1]!.normalized === normalizeToken(heard[j - 1]!.text)
      cost[i]![j] = Math.min(
        same ? cost[i - 1]![j - 1]! : Number.POSITIVE_INFINITY,
        cost[i - 1]![j]! + 1,
        cost[i]![j - 1]! + 1,
      )
    }
  }

  const path: Array<{ op: Op, scriptIndex: number, heardIndex: number }> = []
  let i = n
  let j = m
  while (i > 0 || j > 0) {
    const same = i > 0 && j > 0 && script[i - 1]!.normalized === normalizeToken(heard[j - 1]!.text)
    if (same && cost[i]![j] === cost[i - 1]![j - 1]) {
      path.push({ op: "match", scriptIndex: i - 1, heardIndex: j - 1 })
      i -= 1
      j -= 1
      continue
    }
    if (i > 0 && cost[i]![j] === cost[i - 1]![j]! + 1) {
      path.push({ op: "script_only", scriptIndex: i - 1, heardIndex: j })
      i -= 1
      continue
    }
    path.push({ op: "transcript_only", scriptIndex: i, heardIndex: j - 1 })
    j -= 1
  }

  return path.reverse()
}

/** Слова без пары получают время между соседями — таймлайн не должен рваться. */
function interpolate(words: AlignedWord[], fallbackStart: number, fallbackEnd: number): void {
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!
    if (word.matched) continue

    let prevEnd = fallbackStart
    for (let back = index - 1; back >= 0; back -= 1) {
      if (words[back]!.matched) { prevEnd = words[back]!.endSec; break }
    }
    let nextStart = fallbackEnd
    for (let forward = index + 1; forward < words.length; forward += 1) {
      if (words[forward]!.matched) { nextStart = words[forward]!.startSec; break }
    }
    if (nextStart < prevEnd) nextStart = prevEnd

    word.startSec = prevEnd
    word.endSec = nextStart
  }
}

export function alignScriptToTranscript(input: {
  scenes: AlignScene[]
  transcript: Transcript
}): AlignmentResult {
  const tokens = input.scenes.flatMap(tokenizeScene)
  const heard = input.transcript.words

  if (tokens.length === 0) {
    return { scenes: [], matchedRatio: 0, degraded: true }
  }

  const path = alignSequences(tokens, heard)
  const aligned: Array<AlignedWord & { sceneOrder: number }> = tokens.map(token => ({
    sceneOrder: token.sceneOrder,
    text: token.raw,
    startSec: 0,
    endSec: 0,
    matched: false,
  }))

  let matchedCount = 0
  for (const entry of path) {
    if (entry.op !== "match") continue
    const token = tokens[entry.scriptIndex]!
    const word = aligned[entry.scriptIndex]!
    const first = heard[entry.heardIndex]!
    // Аббревиатура поглощает столько распознанных слов, сколько в ней букв.
    const last = heard[Math.min(entry.heardIndex + token.span - 1, heard.length - 1)]!
    word.startSec = first.startSec
    word.endSec = Math.max(first.endSec, last.endSec)
    word.matched = true
    matchedCount += 1
  }

  const timelineStart = heard[0]?.startSec ?? 0
  const timelineEnd = heard[heard.length - 1]?.endSec ?? 0

  const scenes: AlignedScene[] = []
  for (const scene of input.scenes) {
    const words = aligned.filter(word => word.sceneOrder === scene.order)
    if (words.length === 0) continue
    interpolate(words, timelineStart, timelineEnd)
    scenes.push({
      order: scene.order,
      startSec: words[0]!.startSec,
      endSec: words[words.length - 1]!.endSec,
      words: words.map(({ sceneOrder: _ignored, ...word }) => word),
    })
  }

  const matchedRatio = matchedCount / tokens.length
  return { scenes, matchedRatio, degraded: matchedRatio < DEGRADED_THRESHOLD }
}
```

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/transcription/align.spec.ts`
Expected: PASS, 5 тестов.

- [ ] **Step 5: Коммит**

```bash
git add server/utils/transcription/align.ts tests/unit/transcription/align.spec.ts
git commit -m "feat: выравнивание сценария по распознанным словам"
```

---

### Task 3: Способность `transcription` в медиареестре

Выход транскрипции — JSON, а не медиафайл, поэтому обе существующие ветки исполнения не подходят: `async_prediction` переносит файл из хранилища, `sync_queue` скачивает по URL. Добавляется третья ветка `sync_json`, устроенная как уже существующая `sync_bytes`: результат пишется на диск (как `.json`), кладётся в постоянное хранилище и учитывается в `MediaPrediction`.

**Files:**
- Modify: `server/utils/media-provider/types.ts`
- Modify: `server/utils/media-provider/registry.ts:34-72`
- Modify: `server/utils/media-provider/model-specs.ts`
- Modify: `server/utils/media-provider/run-media-task.ts:238-241`
- Test: `tests/unit/media-provider/transcription-spec.spec.ts`

**Interfaces:**
- Consumes: `normalizeTranscriptPayload` (Task 1).
- Produces: capability `"transcription"`, `TranscriptionInput { audioUrl: string, language?: string }`, `TranscriptionConstraints { languages: readonly string[], maxDurationSec: number, audioExtensions: readonly string[] }`, `TranscriptionModelSpec`, execution `"sync_json"`.

- [ ] **Step 1: Написать падающий тест**

Создать `tests/unit/media-provider/transcription-spec.spec.ts`:

```ts
import { describe, expect, it } from "vitest"

import { listMediaSpecs, mapMediaInput, resolveMediaRoute } from "~~/server/utils/media-provider/registry"

describe("способность transcription", () => {
  it("зарегистрирована в реестре", () => {
    const specs = listMediaSpecs("transcription")

    expect(specs.length).toBeGreaterThan(0)
    expect(specs[0]!.provider).toBe("replicate")
    expect(specs[0]!.execution).toBe("sync_json")
  })

  it("не включена, пока цена не подтверждена страницей модели", () => {
    const spec = listMediaSpecs("transcription")[0]!

    // Правило AGENTS.md: без подтверждённого тарифа модель в смету не пускаем.
    expect(spec.billingConfirmed).toBe(false)
    expect(spec.integrated).toBe(false)
  })

  it("маршрут отказывает внятно, пока нет ни одной integrated модели", () => {
    expect(() => resolveMediaRoute("transcription", null, {}))
      .toThrow(/No integrated media model registered for transcription/)
  })

  it("собирает payload из нормализованного входа", () => {
    const spec = listMediaSpecs("transcription")[0]!

    expect(mapMediaInput(spec, {
      audioUrl: "https://cdn.example.com/voiceover.mp3",
      language: "ru",
    })).toMatchObject({
      audio: "https://cdn.example.com/voiceover.mp3",
      language: "ru",
    })
  })

  it("считает цену по секундам аудио", () => {
    const spec = listMediaSpecs("transcription")[0]!

    expect(spec.billing.unit).toBe("audio_second")
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/media-provider/transcription-spec.spec.ts`
Expected: FAIL — `Unsupported media capability: transcription`.

- [ ] **Step 3: Добавить способность в типы**

В `server/utils/media-provider/types.ts`:

```ts
export type MediaCapability =
  | "lip_sync"
  | "text_to_image"
  | "text_to_video"
  | "image_to_video"
  | "text_to_speech"
  | "speech_to_video"
  | "image_to_image"
  | "transcription"
```

```ts
export type MediaExecution = "async_prediction" | "sync_queue" | "sync_bytes" | "sync_json"
```

```ts
/**
 * Транскрипция СВОЕЙ озвучки. Текст нам известен из сценария — нужны границы
 * слов (spec 2026-08-16-audio-first-editing §4.1).
 */
export interface TranscriptionInput {
  /** Публичный URL готового трека озвучки. */
  audioUrl: string
  /** Подсказка языка: для русского она заметно повышает точность границ. */
  language?: string
}

export interface TranscriptionConstraints {
  languages: readonly string[]
  /** Потолок длины аудио у модели. Проверяется ДО оплаты. */
  maxDurationSec: number
  audioExtensions: readonly string[]
}
```

В `MediaInputMap` добавить строку `transcription: TranscriptionInput`, затем тип спеки и член union:

```ts
export type TranscriptionModelSpec = MediaModelSpecBase<"transcription", TranscriptionInput, TranscriptionConstraints>
```

```ts
export type MediaModelSpec =
  | LipSyncModelSpec
  | TextToImageModelSpec
  | TextToVideoModelSpec
  | ImageToVideoModelSpec
  | TextToSpeechModelSpec
  | SpeechToVideoModelSpec
  | ImageToImageModelSpec
  | TranscriptionModelSpec
```

- [ ] **Step 4: Зарегистрировать способность**

В `server/utils/media-provider/registry.ts` добавить `"transcription"` в конец `MEDIA_CAPABILITIES`, а также записи в оба словаря env-ключей:

```ts
  transcription: Object.freeze(["MEDIA_MODEL_TRANSCRIPTION"]),
```

```ts
  transcription: "MEDIA_PROVIDER_FALLBACK_TRANSCRIPTION",
```

- [ ] **Step 5: Добавить спеку модели**

В `server/utils/media-provider/model-specs.ts` — новая секция рядом с прочими, и запись в массив `MEDIA_MODEL_SPECS`:

```ts
// ─── transcription: границы слов нашей же озвучки ────────────────

/**
 * Whisper на Replicate. Цена НЕ подтверждена страницей модели (токена в
 * окружении нет — spec 2026-08-16 §14), поэтому `integrated: false`: модель
 * видна в реестре, но маршрут её не выберет и в смету она не попадёт.
 *
 * Число в `usdPerSecond` — оценка сверху для расчёта потолка, а не тариф. Перед
 * включением подтвердить страницей модели и снять схему входа: имена полей
 * `audio` и `language` взяты из публичной документации обёртки.
 */
const REPLICATE_WHISPER: TranscriptionModelSpec = Object.freeze<TranscriptionModelSpec>({
  registryKey: "replicate:whisper",
  id: "openai/whisper",
  provider: "replicate",
  capability: "transcription",
  execution: "sync_json",
  billing: { unit: "audio_second", usdPerSecond: 0.0002 },
  billingConfirmed: false,
  constraints: Object.freeze({
    languages: Object.freeze(["ru", "en"]),
    maxDurationSec: 600,
    audioExtensions: Object.freeze(["mp3", "wav", "m4a"]),
  }),
  timeoutMs: 5 * 60_000,
  mapInput(input) {
    const audioUrl = requireText(input.audioUrl, "audioUrl")
    const language = (input.language || "ru").slice(0, 2).toLowerCase()
    if (!this.constraints.languages.includes(language)) {
      throw new Error(`Модель ${this.id} не размечает язык "${language}"`)
    }
    return {
      payload: {
        audio: audioUrl,
        language,
        // Без границ слов транскрипт бесполезен: ради них всё и затевается.
        word_timestamps: true,
      },
    }
  },
  // Выход этой способности — JSON, а не ссылка на файл. Разбирает его
  // `normalizeTranscriptPayload`; здесь возвращаем пустой список url, потому
  // что скачивать нечего.
  extractOutput: () => ({ urls: [] }),
  dataProcessor: null,
  integrated: false,
  tier: "budget",
  name: "Whisper",
  vendorLabel: "Replicate / OpenAI",
  strengths: Object.freeze([
    "Границы слов, а не только текст",
    "Русский распознаёт без отдельной настройки",
  ]),
  tradeoffs: Object.freeze([
    "Цена не подтверждена страницей модели",
    "Схема входа снята с документации, а не с API",
  ]),
  avgGenerationTime: "~10-30 сек на ролик",
})
```

- [ ] **Step 6: Добавить ветку исполнения `sync_json`**

В `server/utils/media-provider/run-media-task.ts` — маршрутизация и сама ветка:

```ts
  if (spec.execution === "async_prediction") return runAsyncPredictionTask(request, spec, dependencies)
  if (spec.execution === "sync_bytes") return runSyncBytesTask(request, spec, dependencies)
  if (spec.execution === "sync_json") return runSyncJsonTask(request, spec, dependencies)
  return runSyncQueueTask(request, spec, dependencies)
```

```ts
/**
 * Ветка sync_json: провайдер отдаёт СТРУКТУРУ, а не файл и не ссылку.
 *
 * Так работает транскрипция: результат — слова с границами. Скачивать нечего,
 * поэтому JSON сериализуется и пишется в `outputPath`, оттуда попадает в
 * постоянное хранилище на общих основаниях. Всё остальное общее с прочими
 * ветками: три уровня переиспользования, ключ идемпотентности, запись
 * `MediaPrediction` — повтор шага не оплачивается второй раз.
 */
async function runSyncJsonTask<C extends MediaCapability>(
  request: MediaTaskRequest<C>,
  spec: MediaModelSpec,
  dependencies: RunMediaTaskDependencies,
): Promise<MediaTaskResult> {
  const prepared = await prepareInputs(request, dependencies, async () => {
    throw new Error(`${spec.registryKey}: заливка входных файлов этой веткой не поддерживается`)
  })
  const mapped = spec.mapInput(prepared.input as never, {
    unitKey: request.unitKey,
    sceneOrder: request.sceneOrder,
  })
  const identity = buildIdentity(request, spec, prepared)

  const reused = await reuseFromStorage(request, spec, identity, dependencies)
  if (reused) return reused

  const requirePaid = dependencies.requirePaidApis
    ?? (await import("../paid-guard")).requirePaidApisEnabled
  requirePaid(spec.vendorLabel)

  const runJson = dependencies.runJsonModel ?? defaultRunJsonModel
  const raw = await runJson(spec.id, mapped.payload, spec.timeoutMs)

  const write = dependencies.writeBytes ?? defaultWriteBytes
  await write(request.outputPath, Buffer.from(JSON.stringify(raw), "utf8"))

  const storage = await persistOutput(request, dependencies)
  if (identity) {
    await savePrediction(request, spec, identity, null, mapped.payload, null, storage ?? null, dependencies)
  }

  return {
    localPath: request.outputPath,
    provider: spec.provider,
    modelId: spec.id,
    externalRef: null,
    idempotencyKey: identity?.idempotencyKey ?? null,
    costUsd: safeCost(spec, request, prepared.input, mapped.effectiveDurationSec),
    source: "generated",
    remoteUrl: null,
    contentType: "application/json",
    storage,
    raw,
  }
}

async function defaultRunJsonModel(
  modelId: string,
  payload: Record<string, unknown>,
  timeoutMs: number,
): Promise<unknown> {
  const { readReplicateConfig } = await import("../replicate/config")
  const { runReplicateJsonModel } = await import("../replicate/client")
  return runReplicateJsonModel(modelId, payload, readReplicateConfig(), timeoutMs)
}
```

В `RunMediaTaskDependencies` добавить поле:

```ts
  /** Провайдер, отдающий структуру, а не файл (транскрипция). */
  runJsonModel?: (
    modelId: string,
    payload: Record<string, unknown>,
    timeoutMs: number,
  ) => Promise<unknown>
```

- [ ] **Step 7: Запустить тест и убедиться, что он проходит**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/media-provider/transcription-spec.spec.ts`
Expected: PASS, 5 тестов.

- [ ] **Step 8: Прогнать всю DB-free сьюту — способность добавлена в union, компилятор мог задеть соседей**

Run: `bunx vitest run --config vitest.pure.config.ts`
Expected: PASS, падений нет.

- [ ] **Step 9: Коммит**

```bash
git add server/utils/media-provider tests/unit/media-provider/transcription-spec.spec.ts
git commit -m "feat: способность transcription и ветка исполнения sync_json"
```

---

### Task 4: Единый трек озвучки

Текст всех сцен собирается в один запрос TTS. Маркеры пауз из §4.6 спеки превращаются в тишину заданной длины: без них монтажный ритм задаёт чтец.

**Files:**
- Create: `server/utils/voiceover/track-builder.ts`
- Test: `tests/unit/transcription/track-builder.spec.ts`

**Interfaces:**
- Consumes: `AlignScene` (Task 2) — тот же тип сцены со `order` и `text`.
- Produces:
  - `buildTrackRequest(scenes: AlignScene[], options?: { maxCharacters?: number }): TrackRequest`
  - `TrackRequest { text: string, pauses: Array<{ afterSceneOrder: number, durationSec: number }> }`
  - `PAUSE_MARKER_PATTERN` — регулярное выражение маркера паузы в тексте сцены.

- [ ] **Step 1: Написать падающий тест**

Создать `tests/unit/transcription/track-builder.spec.ts`:

```ts
import { describe, expect, it } from "vitest"

import { buildTrackRequest } from "~~/server/utils/voiceover/track-builder"

describe("сборка единого трека озвучки", () => {
  it("склеивает реплики сцен в один текст", () => {
    const request = buildTrackRequest([
      { order: 1, text: "Первая реплика." },
      { order: 2, text: "Вторая реплика." },
    ])

    expect(request.text).toBe("Первая реплика. Вторая реплика.")
    expect(request.pauses).toEqual([])
  })

  it("вынимает маркер паузы из текста и запоминает её длину", () => {
    const request = buildTrackRequest([
      { order: 1, text: "Смотри сюда. [пауза 2с]" },
      { order: 2, text: "А теперь вывод." },
    ])

    // Маркер не должен попасть в синтез — модель прочитала бы его вслух.
    expect(request.text).toBe("Смотри сюда. А теперь вывод.")
    expect(request.pauses).toEqual([{ afterSceneOrder: 1, durationSec: 2 }])
  })

  it("понимает дробную длительность паузы", () => {
    const request = buildTrackRequest([{ order: 1, text: "Раз. [пауза 1.5с] Два." }])

    expect(request.text).toBe("Раз. Два.")
    expect(request.pauses).toEqual([{ afterSceneOrder: 1, durationSec: 1.5 }])
  })

  it("падает, если текст не влезает в лимит модели", () => {
    expect(() => buildTrackRequest(
      [{ order: 1, text: "а".repeat(120) }],
      { maxCharacters: 100 },
    )).toThrow(/длиннее 100 символов/)
  })

  it("не отдаёт пустой запрос на синтез", () => {
    expect(() => buildTrackRequest([{ order: 1, text: "   " }]))
      .toThrow(/пустой текст/)
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/transcription/track-builder.spec.ts`
Expected: FAIL — модуль `track-builder` не существует.

- [ ] **Step 3: Написать сборщик трека**

Создать `server/utils/voiceover/track-builder.ts`:

```ts
/**
 * Текст ролика для ОДНОГО вызова TTS.
 *
 * Посценный синтез рвал интонацию на каждой границе и требовал искусственных
 * вдохов между тейками; единый трек читается как речь живого человека
 * (spec 2026-08-16-audio-first-editing §3).
 *
 * Маркер паузы `[пауза 2с]` в текст синтеза не попадает — модель прочитала бы
 * его вслух. Он превращается в тишину, которую вставляет вызывающий: так у
 * монтажа появляется свой ритм, не зависящий от того, как прочёл чтец (§4.6).
 */

import type { AlignScene } from "../transcription/align"

export interface TrackPause {
  /** После какой сцены встаёт тишина. */
  afterSceneOrder: number
  durationSec: number
}

export interface TrackRequest {
  text: string
  pauses: TrackPause[]
}

/** `[пауза 2с]`, `[пауза 1.5 с]` — регистр и пробел перед «с» не важны. */
export const PAUSE_MARKER_PATTERN = /\[пауза\s*(\d+(?:[.,]\d+)?)\s*с\]/gi

/** Лимит MiniMax speech-02-turbo; вызывающий может передать лимит своей модели. */
const DEFAULT_MAX_CHARACTERS = 5000

export function buildTrackRequest(
  scenes: readonly AlignScene[],
  options: { maxCharacters?: number } = {},
): TrackRequest {
  const maxCharacters = options.maxCharacters ?? DEFAULT_MAX_CHARACTERS
  const parts: string[] = []
  const pauses: TrackPause[] = []

  for (const scene of scenes) {
    let sceneText = scene.text ?? ""
    for (const match of sceneText.matchAll(PAUSE_MARKER_PATTERN)) {
      const durationSec = Number.parseFloat(match[1]!.replace(",", "."))
      if (Number.isFinite(durationSec) && durationSec > 0) {
        pauses.push({ afterSceneOrder: scene.order, durationSec })
      }
    }
    sceneText = sceneText.replace(PAUSE_MARKER_PATTERN, " ").replace(/\s+/g, " ").trim()
    if (sceneText) parts.push(sceneText)
  }

  const text = parts.join(" ").trim()
  if (!text) {
    throw new Error("Сборка трека озвучки: пустой текст — синтезировать нечего")
  }
  if (text.length > maxCharacters) {
    throw new Error(
      `Сборка трека озвучки: текст ролика длиннее ${maxCharacters} символов, модель его не примет`,
    )
  }

  return { text, pauses }
}
```

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/transcription/track-builder.spec.ts`
Expected: PASS, 5 тестов.

- [ ] **Step 5: Коммит**

```bash
git add server/utils/voiceover/track-builder.ts tests/unit/transcription/track-builder.spec.ts
git commit -m "feat: единый текст ролика для одного вызова TTS и маркеры пауз"
```

---

### Task 5: Шаг транскрипции в пайплайне

Новый шаг встаёт между озвучкой и генерацией медиа. `STEP_ORDER` — персистентный `stepIndex`, поэтому ключ дописывается в конец; реальный порядок задаёт `STEP_EXECUTION_ORDER`.

**Files:**
- Modify: `prisma/schema.prisma` (enum `VideoStepKey`, enum `AssetType`, модель `Video`)
- Create: `prisma/migrations/20260817000000_add_transcription_step/migration.sql`
- Modify: `server/utils/video-pipeline-db.ts:27,37-45`
- Modify: `server/utils/video-pipeline-run-policy.ts:27-34`
- Modify: `server/utils/video-pipeline-reset.ts:18-25`
- Test: `tests/unit/transcription/step-order.spec.ts`

**Interfaces:**
- Consumes: `StepKey` из `video-pipeline-db`.
- Produces: `StepKey` пополняется значением `"transcription"`; `STEP_EXECUTION_ORDER_AUDIO_FIRST: readonly StepKey[]`; `executionOrderFor(editPipeline: boolean): readonly StepKey[]`.

- [ ] **Step 1: Написать падающий тест**

Создать `tests/unit/transcription/step-order.spec.ts`:

```ts
import { describe, expect, it } from "vitest"

import { STEP_ORDER } from "~~/server/utils/video-pipeline-db"
import {
  executionOrderFor,
  stepsToRerunFrom,
} from "~~/server/utils/video-pipeline-run-policy"
import { assetTypesForSteps } from "~~/server/utils/video-pipeline-reset"

describe("порядок шагов на маршруте audio-first", () => {
  it("новый ключ дописан в конец STEP_ORDER — история роликов не переписывается", () => {
    expect(STEP_ORDER[0]).toBe("prompt_generation")
    expect(STEP_ORDER[STEP_ORDER.length - 1]).toBe("transcription")
  })

  it("на новом маршруте озвучка идёт до транскрипции, а та — до клипов", () => {
    const order = executionOrderFor(true)

    expect(order.indexOf("voiceover_generation")).toBeLessThan(order.indexOf("transcription"))
    expect(order.indexOf("transcription")).toBeLessThan(order.indexOf("clip_generation"))
    expect(order.indexOf("clip_generation")).toBeLessThan(order.indexOf("lip_sync_generation"))
  })

  it("на старом маршруте порядок прежний — недоделанные ролики доживают по своим правилам", () => {
    const order = executionOrderFor(false)

    expect(order).toEqual([
      "prompt_generation",
      "image_generation",
      "clip_generation",
      "lip_sync_generation",
      "voiceover_generation",
      "music_generation",
      "assembly",
    ])
  })

  it("перезапуск озвучки на новом маршруте сбрасывает транскрипцию", () => {
    const steps = stepsToRerunFrom("voiceover_generation", true)

    expect(steps).toContain("transcription")
    expect(steps).toContain("assembly")
  })

  it("перезапуск транскрипции не трогает саму озвучку — она уже оплачена", () => {
    const steps = stepsToRerunFrom("transcription", true)

    expect(steps).not.toContain("voiceover_generation")
    expect(steps[0]).toBe("transcription")
  })

  it("сброс транскрипции сносит её ассет", () => {
    expect(assetTypesForSteps(["transcription"])).toEqual(["transcript"])
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/transcription/step-order.spec.ts`
Expected: FAIL — `executionOrderFor` не экспортируется.

- [ ] **Step 3: Изменить схему БД**

В `prisma/schema.prisma`: в `enum VideoStepKey` добавить `transcription`, в `enum AssetType` добавить `transcript`, в модель `Video` — поле маршрута:

```prisma
  /// Маршрут производства, зафиксированный при старте прогона. true — audio-first
  /// (единый трек, транскрипция, план кадров). Читается с ролика, а не из env:
  /// смена флага посреди производства не должна собирать половину ролика по
  /// одним правилам, половину по другим.
  editPipeline    Boolean   @default(false)
```

- [ ] **Step 4: Создать миграцию**

Создать `prisma/migrations/20260817000000_add_transcription_step/migration.sql`:

```sql
-- Шаг транскрипции и его ассет
ALTER TYPE "VideoStepKey" ADD VALUE IF NOT EXISTS 'transcription';
ALTER TYPE "AssetType" ADD VALUE IF NOT EXISTS 'transcript';

-- Маршрут производства фиксируется на ролике
ALTER TABLE "Video" ADD COLUMN IF NOT EXISTS "editPipeline" BOOLEAN NOT NULL DEFAULT false;
```

- [ ] **Step 5: Применить миграцию к тестовой БД и перегенерировать клиент**

Run: `bun run test:db:migrate && bunx prisma generate`
Expected: миграция применена, клиент перегенерирован без ошибок.

- [ ] **Step 6: Дописать ключ в типы шагов**

В `server/utils/video-pipeline-db.ts`:

```ts
export type StepKey = "prompt_generation" | "image_generation" | "clip_generation" | "voiceover_generation" | "music_generation" | "lip_sync_generation" | "assembly" | "transcription"
```

```ts
export const STEP_ORDER: StepKey[] = [
  "prompt_generation",
  "image_generation",
  "clip_generation",
  "voiceover_generation",
  "music_generation",
  "lip_sync_generation",
  "assembly",
  // Дописан в конец намеренно: stepIndex персистентный, по нему уже записана
  // история роликов, и вставка в середину переписала бы её.
  "transcription",
]
```

- [ ] **Step 7: Добавить порядок исполнения нового маршрута**

В `server/utils/video-pipeline-run-policy.ts` — рядом с существующим `STEP_EXECUTION_ORDER`:

```ts
/**
 * Порядок маршрута audio-first (spec 2026-08-16-audio-first-editing §3).
 *
 * Озвучка первой: она эталон времени, и всё остальное строится по ней.
 * Транскрипция сразу за ней — без границ слов резать кадры не по чему.
 */
export const STEP_EXECUTION_ORDER_AUDIO_FIRST: readonly StepKey[] = [
  "prompt_generation",
  "voiceover_generation",
  "transcription",
  "image_generation",
  "clip_generation",
  "lip_sync_generation",
  "music_generation",
  "assembly",
]

/** Порядок исполнения по маршруту ролика, а не по глобальному флагу. */
export function executionOrderFor(editPipeline: boolean): readonly StepKey[] {
  return editPipeline ? STEP_EXECUTION_ORDER_AUDIO_FIRST : STEP_EXECUTION_ORDER
}
```

Функцию `stepsToRerunFrom` расширить вторым необязательным аргументом, сохранив прежнее поведение для старого маршрута:

```ts
export function stepsToRerunFrom(stepKey: StepKey, editPipeline = false): StepKey[] {
  const order = executionOrderFor(editPipeline)
  const index = order.indexOf(stepKey)
  if (index < 0) return []
  return [...order.slice(index)]
}
```

- [ ] **Step 8: Завести ассет шага в карту сброса**

В `server/utils/video-pipeline-reset.ts` добавить `"transcript"` в union `VideoAssetType` и запись в `STEP_ASSET_TYPES` (карта объявлена как `Record<StepKey, readonly VideoAssetType[]>`, поэтому без новой записи проект просто не скомпилируется):

```ts
export type VideoAssetType
  = | "image"
    | "clip"
    | "music"
    | "voiceover"
    | "voiceover_mix"
    | "thumbnail"
    | "preview"
    | "transcript"
```

```ts
  transcription: ["transcript"],
```

- [ ] **Step 9: Запустить тест и убедиться, что он проходит**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/transcription/step-order.spec.ts`
Expected: PASS, 6 тестов.

- [ ] **Step 10: Прогнать DB-free сьюту целиком — сигнатура `stepsToRerunFrom` изменилась**

Run: `bunx vitest run --config vitest.pure.config.ts`
Expected: PASS.

- [ ] **Step 11: Коммит**

```bash
git add prisma/schema.prisma prisma/migrations/20260817000000_add_transcription_step server/utils/video-pipeline-db.ts server/utils/video-pipeline-run-policy.ts server/utils/video-pipeline-reset.ts tests/unit/transcription/step-order.spec.ts
git commit -m "feat: шаг транскрипции и порядок исполнения маршрута audio-first"
```

---

### Task 6: Раннер шага транскрипции

Шаг берёт готовый трек озвучки, вызывает способность, нормализует ответ, выравнивает по сценарию и сохраняет результат ассетом. Повторный заход не оплачивает задачу второй раз — за это отвечает ключ идемпотентности внутри `runMediaTask`.

**Files:**
- Create: `server/utils/transcription/runner.ts`
- Test: `tests/unit/transcription/runner.spec.ts`

**Interfaces:**
- Consumes: `normalizeTranscriptPayload` (Task 1), `alignScriptToTranscript` (Task 2), способность `transcription` (Task 3), `StepKey` (Task 5).
- Produces: `runTranscriptionStep(input: TranscriptionStepInput, deps?: TranscriptionStepDeps): Promise<TranscriptionStepResult>`, где `TranscriptionStepResult { status: "completed" | "degraded" | "skipped", scenes: AlignedScene[], costUsd: number, warning: string | null }`.

- [ ] **Step 1: Написать падающий тест**

Создать `tests/unit/transcription/runner.spec.ts`:

```ts
import { describe, expect, it, vi } from "vitest"

import { runTranscriptionStep } from "~~/server/utils/transcription/runner"

const SCENES = [
  { order: 1, text: "тело меняется" },
  { order: 2, text: "здоровье улучшается" },
]

function deps(overrides: Record<string, unknown> = {}) {
  return {
    runTask: vi.fn(async () => ({
      costUsd: 0.02,
      raw: {
        words: [
          { word: "тело", start: 0, end: 0.4 },
          { word: "меняется", start: 0.4, end: 1.1 },
          { word: "здоровье", start: 1.4, end: 2.0 },
          { word: "улучшается", start: 2.0, end: 2.8 },
        ],
      },
    })),
    log: vi.fn(async () => {}),
    ...overrides,
  }
}

describe("шаг транскрипции", () => {
  it("отдаёт сценам фактические границы и стоимость", async () => {
    const result = await runTranscriptionStep(
      { videoId: 7, stepId: 3, audioPath: "/tmp/voiceover.mp3", audioUrl: "https://cdn/voiceover.mp3", scenes: SCENES, language: "ru", outputPath: "/tmp/transcript.json" },
      deps() as never,
    )

    expect(result.status).toBe("completed")
    expect(result.scenes[0]).toMatchObject({ order: 1, startSec: 0, endSec: 1.1 })
    expect(result.scenes[1]).toMatchObject({ order: 2, startSec: 1.4, endSec: 2.8 })
    expect(result.costUsd).toBeCloseTo(0.02, 6)
  })

  it("сообщает о деградации, когда транскрипт не сошёлся со сценарием", async () => {
    const dependencies = deps({
      runTask: vi.fn(async () => ({
        costUsd: 0.02,
        raw: { words: [
          { word: "посторонний", start: 0, end: 0.5 },
          { word: "текст", start: 0.5, end: 1.0 },
        ] },
      })),
    })

    const result = await runTranscriptionStep(
      { videoId: 7, stepId: 3, audioPath: "/tmp/voiceover.mp3", audioUrl: "https://cdn/voiceover.mp3", scenes: SCENES, language: "ru", outputPath: "/tmp/transcript.json" },
      dependencies as never,
    )

    expect(result.status).toBe("degraded")
    expect(result.warning).toMatch(/выравнивание/i)
  })

  it("не роняет ролик, если транскрипция недоступна", async () => {
    const dependencies = deps({
      runTask: vi.fn(async () => { throw new Error("provider is down") }),
    })

    const result = await runTranscriptionStep(
      { videoId: 7, stepId: 3, audioPath: "/tmp/voiceover.mp3", audioUrl: "https://cdn/voiceover.mp3", scenes: SCENES, language: "ru", outputPath: "/tmp/transcript.json" },
      dependencies as never,
    )

    // Деградация §10 спеки: ролик собирается, но помечен как собранный без
    // точных таймингов.
    expect(result.status).toBe("skipped")
    expect(result.scenes).toEqual([])
    expect(result.warning).toMatch(/provider is down/)
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/transcription/runner.spec.ts`
Expected: FAIL — модуль `runner` не существует.

- [ ] **Step 3: Написать раннер**

Создать `server/utils/transcription/runner.ts`:

```ts
/**
 * Шаг транскрипции: границы слов нашей же озвучки.
 *
 * Зависимости инжектируются, потому что содержательная часть шага — разбор,
 * выравнивание и деградация — обязана проверяться без БД, сети и денег.
 *
 * Отказ провайдера ролик не роняет (spec §10): без точных таймингов монтаж
 * работает по плановым длительностям, и это должно быть видно в логе шага, а не
 * молча.
 */

import { alignScriptToTranscript, type AlignedScene, type AlignScene } from "./align"
import { normalizeTranscriptPayload } from "./normalize"

export interface TranscriptionStepInput {
  videoId: number
  stepId: number
  /** Локальный файл трека — по нему считается длительность и цена. */
  audioPath: string
  /** Публичный URL трека для провайдера. */
  audioUrl: string
  scenes: AlignScene[]
  language: string
  /** Куда сложить сырой ответ модели. */
  outputPath: string
}

export interface TranscriptionStepResult {
  status: "completed" | "degraded" | "skipped"
  scenes: AlignedScene[]
  costUsd: number
  warning: string | null
}

export interface TranscriptionStepDeps {
  runTask: (input: {
    videoId: number
    stepId: number
    audioUrl: string
    language: string
    outputPath: string
  }) => Promise<{ costUsd: number, raw: unknown }>
  log: (stepId: number, message: string) => Promise<void>
}

export async function runTranscriptionStep(
  input: TranscriptionStepInput,
  deps: TranscriptionStepDeps,
): Promise<TranscriptionStepResult> {
  let raw: unknown
  let costUsd = 0

  try {
    const task = await deps.runTask({
      videoId: input.videoId,
      stepId: input.stepId,
      audioUrl: input.audioUrl,
      language: input.language,
      outputPath: input.outputPath,
    })
    raw = task.raw
    costUsd = task.costUsd
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await deps.log(input.stepId, `Транскрипция не выполнена (${message}) — ролик собирается по плановым длительностям, тайминги приблизительные`)
    return { status: "skipped", scenes: [], costUsd: 0, warning: message }
  }

  let transcript
  try {
    transcript = normalizeTranscriptPayload(raw)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await deps.log(input.stepId, `Ответ транскрипции не разобран (${message}) — тайминги приблизительные`)
    return { status: "skipped", scenes: [], costUsd, warning: message }
  }

  const alignment = alignScriptToTranscript({ scenes: input.scenes, transcript })

  if (alignment.degraded) {
    const percent = Math.round(alignment.matchedRatio * 100)
    const warning = `Выравнивание сошлось лишь на ${percent}% слов — границы сцен приблизительные`
    await deps.log(input.stepId, warning)
    return { status: "degraded", scenes: alignment.scenes, costUsd, warning }
  }

  await deps.log(
    input.stepId,
    `Транскрипция: ${transcript.words.length} слов, ${alignment.scenes.length} сцен размечено, $${costUsd.toFixed(4)}`,
  )
  return { status: "completed", scenes: alignment.scenes, costUsd, warning: null }
}
```

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/transcription/runner.spec.ts`
Expected: PASS, 3 теста.

- [ ] **Step 5: Коммит**

```bash
git add server/utils/transcription/runner.ts tests/unit/transcription/runner.spec.ts
git commit -m "feat: раннер шага транскрипции с деградацией без падения ролика"
```

---

### Task 7: Субтитры и сборка на реальных таймингах

Субтитры перестают распределять слова поровну и берут время из выравнивания. Финальный звук кладётся одним куском, дорожки клипов глушатся: при едином треке их родная речь не совпадёт по фазе и дала бы эхо.

**Files:**
- Modify: `server/utils/subtitles/ass-builder/dialogue.ts:81-90`
- Modify: `server/utils/video-pipeline-run-policy.ts`
- Modify: `server/utils/video-pipeline.ts:783,860-875`
- Modify: `server/utils/video-pipeline-steps.ts:1118,1408-1460`
- Test: `tests/unit/subtitles/word-timings-source.spec.ts`

**Замечание по конфигурации шага:** в `video-pipeline.ts:783` собирается `videoConfig`, который получает шаг озвучки. Туда нужно добавить `editPipeline: video.editPipeline` и расширить тип конфигурации в `video-pipeline-steps.ts:1118` — иначе шаг не узнает свой маршрут.

**Interfaces:**
- Consumes: `AlignedScene` (Task 2), `Video.editPipeline` (Task 5).
- Produces: `buildDialogueLines` принимает необязательное поле `wordTimings?: EstimatedWord[]` — уже существующее в файле; задача в том, чтобы пайплайн его заполнял.

- [ ] **Step 1: Написать падающий тест**

Создать `tests/unit/subtitles/word-timings-source.spec.ts`:

```ts
import { describe, expect, it } from "vitest"

import { alignScriptToTranscript } from "~~/server/utils/transcription/align"
import { estimateWordTimings } from "~~/server/utils/subtitles/word-timings"

describe("источник word-timings для субтитров", () => {
  it("реальные тайминги отличаются от равномерной оценки", () => {
    const scenes = [{ order: 1, text: "короткое и очень длинное слово" }]
    const alignment = alignScriptToTranscript({
      scenes,
      transcript: {
        text: "короткое и очень длинное слово",
        words: [
          { text: "короткое", startSec: 0, endSec: 0.5 },
          { text: "и", startSec: 0.5, endSec: 0.6 },
          { text: "очень", startSec: 0.6, endSec: 1.0 },
          { text: "длинное", startSec: 1.0, endSec: 1.8 },
          { text: "слово", startSec: 1.8, endSec: 2.4 },
        ],
      },
    })

    const real = alignment.scenes[0]!.words
    const estimated = estimateWordTimings("короткое и очень длинное слово", 0, 2.4)

    // Союз «и» звучит 0.1 с, а равномерная оценка даёт ему почти полсекунды —
    // ровно поэтому караоке-подсветка сегодня уезжает.
    expect(real[1]!.endSec - real[1]!.startSec).toBeCloseTo(0.1, 2)
    expect(estimated[1]!.endSec - estimated[1]!.startSec).toBeGreaterThan(0.4)
  })

  it("сохраняет текст сценария, а не распознанный", () => {
    const alignment = alignScriptToTranscript({
      scenes: [{ order: 1, text: "у проекта MRR растёт" }],
      transcript: {
        text: "у проекта эм эр эр растет",
        words: [
          { text: "у", startSec: 0, endSec: 0.1 },
          { text: "проекта", startSec: 0.1, endSec: 0.7 },
          { text: "эм", startSec: 0.7, endSec: 0.9 },
          { text: "эр", startSec: 0.9, endSec: 1.0 },
          { text: "эр", startSec: 1.0, endSec: 1.2 },
          { text: "растет", startSec: 1.2, endSec: 1.8 },
        ],
      },
    })

    expect(alignment.scenes[0]!.words.map(w => w.text)).toEqual(["у", "проекта", "MRR", "растёт"])
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он проходит**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/subtitles/word-timings-source.spec.ts`
Expected: PASS, 2 теста. Этот тест характеризующий — он фиксирует контракт Task 2 (исходное написание слова сохраняется, время берётся от распознанного) и защищает его от будущих правок. TDD-цикл этой задачи идёт по следующим шагам.

- [ ] **Step 3: Написать падающий тест на решения сборки**

Дописать в тот же файл:

```ts
import {
  clipVolumeWithVoiceoverFor,
  shouldReconcileVoiceover,
} from "~~/server/utils/video-pipeline-run-policy"

describe("решения сборки по маршруту", () => {
  it("на audio-first дорожки клипов глушатся полностью", () => {
    // Единый трек не совпадает по фазе с речью внутри lip-sync клипа:
    // 0.3 дали бы двойную речь с эхом (spec §6.4).
    expect(clipVolumeWithVoiceoverFor(true)).toBe(0)
  })

  it("на старом маршруте прежние 0.3 сохраняются", () => {
    // Там микс собран из тех же файлов и совпадает по фазе — менять нечего.
    expect(clipVolumeWithVoiceoverFor(false)).toBeCloseTo(0.3, 6)
  })

  it("на audio-first сведение длины отключено", () => {
    // Кадры нарезаны по речи: растягивать сцену и подменять клипы на *_ext.mp4
    // не нужно, а на новом таймлайне ещё и вредно (spec §3.1).
    expect(shouldReconcileVoiceover(true)).toBe(false)
  })

  it("на старом маршруте сведение работает как прежде", () => {
    expect(shouldReconcileVoiceover(false)).toBe(true)
  })
})
```

- [ ] **Step 4: Запустить тест и убедиться, что он падает**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/subtitles/word-timings-source.spec.ts`
Expected: FAIL — `clipVolumeWithVoiceoverFor` и `shouldReconcileVoiceover` не экспортируются.

- [ ] **Step 5: Реализовать решения сборки**

В `server/utils/video-pipeline-run-policy.ts`:

```ts
/** Громкость родных дорожек клипов под озвучкой — зависит от маршрута. */
export function clipVolumeWithVoiceoverFor(editPipeline: boolean): number {
  return editPipeline ? 0 : 0.3
}

/**
 * Нужно ли мирить длину реплики с длиной клипа.
 *
 * На старом маршруте политика `voiceoverReconciliation` сжимает звук, режет его
 * или растягивает сцену. На audio-first мирить нечего: кадр нарезан по речи, а
 * подмена клипов файлами `*_ext.mp4` разошлась бы с таймлайном транскрипта.
 */
export function shouldReconcileVoiceover(editPipeline: boolean): boolean {
  return !editPipeline
}
```

- [ ] **Step 6: Применить решения в пайплайне**

В `server/utils/video-pipeline.ts` заменить константу громкости на вызов:

```ts
        clipVolumeWithVoiceover: clipVolumeWithVoiceoverFor(video.editPipeline),
```

В `server/utils/video-pipeline-steps.ts` в шаге озвучки обернуть блок сведения (`voiceoverReconciliation === 'extend_scene'` и соседние ветки `compress_audio` / `trim_audio`) проверкой `shouldReconcileVoiceover(videoConfig.editPipeline)`: на новом маршруте сцена получает результат `reconciliation: 'none'` без правки файлов. Поле `voiceoverReconciliation` из конфигурации не удалять — на старом маршруте оно работает как прежде.

- [ ] **Step 7: Запустить тест и убедиться, что он проходит**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/subtitles/word-timings-source.spec.ts`
Expected: PASS, 6 тестов.

- [ ] **Step 8: Прогнать DB-free сьюту целиком**

Run: `bunx vitest run --config vitest.pure.config.ts`
Expected: PASS.

- [ ] **Step 9: Коммит**

```bash
git add server/utils/video-pipeline-run-policy.ts server/utils/video-pipeline.ts server/utils/video-pipeline-steps.ts tests/unit/subtitles/word-timings-source.spec.ts
git commit -m "feat: субтитры по реальным таймингам, звук клипов в ноль на audio-first"
```

---

### Task 8: Флаг маршрута и связывание шагов

Последняя задача плана: `EDIT_PIPELINE` включает маршрут при создании ролика, значение фиксируется на ролике, оркестратор идёт по порядку этого ролика.

**Files:**
- Modify: `server/utils/video-pipeline.ts` (выбор порядка шагов, вызов раннера транскрипции)
- Modify: `server/api/videos/generate.post.ts` (фиксация маршрута при создании)
- Modify: `.env.example`
- Test: `tests/unit/transcription/route-flag.spec.ts`

**Interfaces:**
- Consumes: `executionOrderFor` (Task 5), `runTranscriptionStep` (Task 6), `buildTrackRequest` (Task 4).
- Produces: `resolveEditPipelineFlag(env: Record<string, string | undefined>): boolean`.

- [ ] **Step 1: Написать падающий тест**

Создать `tests/unit/transcription/route-flag.spec.ts`:

```ts
import { describe, expect, it } from "vitest"

import { resolveEditPipelineFlag } from "~~/server/utils/video-pipeline-run-policy"

describe("флаг маршрута производства", () => {
  it("выключен по умолчанию — старый маршрут остаётся основным до canary", () => {
    expect(resolveEditPipelineFlag({})).toBe(false)
  })

  it("включается явным значением", () => {
    expect(resolveEditPipelineFlag({ EDIT_PIPELINE: "on" })).toBe(true)
    expect(resolveEditPipelineFlag({ EDIT_PIPELINE: "true" })).toBe(true)
    expect(resolveEditPipelineFlag({ EDIT_PIPELINE: "1" })).toBe(true)
  })

  it("не включается мусором", () => {
    expect(resolveEditPipelineFlag({ EDIT_PIPELINE: "maybe" })).toBe(false)
    expect(resolveEditPipelineFlag({ EDIT_PIPELINE: "" })).toBe(false)
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/transcription/route-flag.spec.ts`
Expected: FAIL — `resolveEditPipelineFlag` не экспортируется.

- [ ] **Step 3: Написать разбор флага**

В `server/utils/video-pipeline-run-policy.ts`:

```ts
/** Значения, которыми маршрут включают осознанно. Всё прочее — выключено. */
const TRUTHY = new Set(["1", "on", "true", "yes"])

/**
 * Флаг читается ОДИН раз — при создании ролика, и дальше живёт на ролике
 * (`Video.editPipeline`). Перечитывать его на каждом шаге нельзя: смена
 * переменной посреди производства собрала бы половину ролика по одним
 * правилам, половину по другим (spec §3.1).
 */
export function resolveEditPipelineFlag(env: Record<string, string | undefined>): boolean {
  return TRUTHY.has((env.EDIT_PIPELINE ?? "").trim().toLowerCase())
}
```

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/transcription/route-flag.spec.ts`
Expected: PASS, 3 теста.

- [ ] **Step 5: Зафиксировать маршрут при создании ролика**

В `server/api/videos/generate.post.ts` при создании записи `Video` добавить поле:

```ts
      editPipeline: resolveEditPipelineFlag(process.env),
```

- [ ] **Step 6: Пустить оркестратор по порядку ролика**

В `server/utils/video-pipeline.ts` заменить обращения к `STEP_EXECUTION_ORDER` на `executionOrderFor(video.editPipeline)` и вставить вызов `runTranscriptionStep` между озвучкой и генерацией изображений — только когда `video.editPipeline === true`. Озвучка на этом маршруте синтезирует один файл через `buildTrackRequest` и `synthesizeSpeech`, а не реплику на сцену.

- [ ] **Step 7: Описать флаг в примере окружения**

В `.env.example` рядом с прочими флагами маршрутов:

```
# Маршрут производства ролика. on — audio-first: единый трек озвучки,
# транскрипция, монтаж по границам слов (docs/superpowers/specs/2026-08-16-audio-first-editing-design.md).
# Пусто/off — прежний посценный маршрут. Значение фиксируется на ролике при создании.
EDIT_PIPELINE=
```

- [ ] **Step 8: Прогнать DB-free сьюту и целевые DB-тесты**

Run: `bunx vitest run --config vitest.pure.config.ts`
Expected: PASS.

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/transcription tests/unit/media-provider tests/unit/subtitles`
Expected: PASS — все каталоги, которых касался этот план.

- [ ] **Step 9: Коммит**

```bash
git add server/utils/video-pipeline-run-policy.ts server/utils/video-pipeline.ts server/api/videos/generate.post.ts .env.example tests/unit/transcription/route-flag.spec.ts
git commit -m "feat: маршрут audio-first за флагом EDIT_PIPELINE, зафиксированным на ролике"
```

---

## Что этот план сознательно НЕ делает

Границы части 1. Всё перечисленное — предмет следующих планов, и упоминается здесь, чтобы исполнитель не начал делать это по дороге:

- **Хранение записей ведущего и нарезка под длину речи** (§6.1–6.2 спеки) — план 2. До него `adjustAudioTempo` остаётся на месте: пока фрагменты подбираются из готовых клипов, ускорение речи — единственный способ уложить длинную реплику, и убирать его нечем заменить.
- **План монтажа, `EditProfile`, `BackgroundClip`, `VideoShot`, PiP** (§5, §7) — план 3.
- **Локальная замена сегмента и UI** (§4.5, §9) — план 4.
- **Подтверждение тарифа модели транскрипции и снятие схемы** — предпосылка §14: до неё спека модели остаётся `integrated: false`, маршрут её не выберет, а шаг деградирует так же, как при отказе провайдера. Это осознанно: код готов, включение — отдельное действие с реальным токеном.
