# Монтаж от звука: единый трек и реальные тайминги — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ролик озвучивается одним непрерывным треком, границы сцен и субтитров берутся из реальных таймингов слов, а lip-sync получает куски этого трека вместо собственного посценного синтеза.

**Architecture:** Текст всех сцен — и реплики в кадре, и закадровые строки — сливается в один сценарный текст и синтезируется одним вызовом TTS. Новый шаг транскрипции снимает с трека слова с границами, чистый модуль выравнивания связывает их с текстом сценария. Оркестратор на новом маршруте вызывает шаги в другом порядке: озвучка и транскрипция идут первыми, lip-sync вырезает свой звук из общего трека, сборка кладёт трек целиком и глушит дорожки клипов. Маршрут включается флагом `EDIT_PIPELINE`, значение фиксируется на ролике, старый маршрут работает без изменений до canary-сравнения.

**Tech Stack:** Nuxt 4 / Nitro, Bun, TypeScript, Prisma + PostgreSQL 16, Vitest (DB-free сьюта — `vitest.pure.config.ts`), FFmpeg через `fluent-ffmpeg`, Replicate как основной медиапровайдер.

**Spec:** `docs/superpowers/specs/2026-08-16-audio-first-editing-design.md`

## Global Constraints

- Пакетный менеджер — **Bun**, не npm (`AGENTS.md`). Тесты: `bunx vitest run ...`.
- БД меняется **только миграциями**, `prisma db push` запрещён.
- Replicate — основной провайдер; fal только как явно настроенный fallback.
- Модель без цены, подтверждённой страницей модели, остаётся `integrated: false` и в смету не попадает.
- **Все долгие и платные операции идемпотентны и переживают рестарт процесса** (`AGENTS.md`). Повторный заход не платит второй раз и не теряет уже полученный результат.
- **Платные вызовы начинаются с одного canary job**; готовность интеграции не заявляется без реального или контрактного подтверждения (`AGENTS.md`).
- Комментарии и сообщения об ошибках — по-русски, как в окружающем коде.
- Не создавать файлы-монстры: новая логика живёт отдельными модулями в `server/utils/transcription/` и `server/utils/voiceover/`.
- DB-free тесты должны попадать в `vitest.pure.config.ts` — там явный `include`.
- Старый маршрут не ломается и не удаляется: он остаётся основным до canary-сравнения (§2 спеки).

## Что уже проверено фактически (не перепроверять)

Эти факты сняты с кода при подготовке плана — на них можно опираться:

- `ALTER TYPE ... ADD VALUE` в этом проекте уже применялся (`prisma/migrations/20260425070159_add_video_lip_sync/migration.sql`), Postgres 16 — ограничение «не в транзакции» неактуально. Но **использовать** новое значение enum в той же миграции нельзя.
- Алиас `~~/` работает в обоих vitest-конфигах; каталоги `tests/unit/media-provider/**` и `tests/unit/subtitles/**` уже в `include` pure-конфига, `tests/unit/transcription/**` — нет.
- `runReplicateJsonModel` **не существует**, синхронного вызова модели в `server/utils/replicate/client.ts` нет вовсе.
- `STEP_EXECUTION_ORDER` **не используется** в `video-pipeline.ts`: порядок исполнения там задан последовательностью вызовов, а массив влияет только на каскад сброса.
- `shared/types/video.ts` держит вторую, независимую копию `VideoStepKey` / `STEP_ORDER` / `STEP_LABELS` — именно она рисует таблицу шагов в UI (и в ней уже нет `lip_sync_generation`).
- `reuseFromStorage` в `run-media-task.ts:627-659` возвращает результат **без `raw`** — только материализует файл.
- `deriveUsage` в `run-media-task.ts:728-774` не имеет ветки для новых способностей: без неё цена посчитается как 0.

## File Structure

**Создаётся:**

| Файл | Ответственность |
|---|---|
| `server/utils/transcription/types.ts` | Тип транскрипта: слово, границы, полный текст |
| `server/utils/transcription/normalize.ts` | Сырой ответ модели → транскрипт (три известные формы) |
| `server/utils/transcription/align.ts` | Слова транскрипта ↔ слова сценария, границы сцен |
| `server/utils/transcription/runner.ts` | Шаг: вызвать способность, разобрать, выровнять, сохранить |
| `server/utils/transcription/media-task.ts` | Адаптер шага к `runMediaTask` (маршрут, usage, persist) |
| `server/utils/voiceover/script-merge.ts` | Слияние речи в кадре и закадровой в один сценарный текст |
| `server/utils/voiceover/track-builder.ts` | Текст для одного вызова TTS, маркеры пауз, вставка тишины |
| `server/utils/voiceover/segment-cut.ts` | Вырезка куска трека по границам сцены для lip-sync |
| `server/utils/replicate/json-model.ts` | Синхронный вызов модели с JSON-выходом (+ mock) |
| `tests/unit/transcription/*.spec.ts` | Тесты нормализатора, выравнивания, раннера, порядка шагов, флага |
| `tests/unit/voiceover/*.spec.ts` | Тесты слияния текста, сборки трека, вырезки сегмента |
| `tests/unit/media-provider/transcription-spec.spec.ts` | Спека модели и маршрут |
| `tests/integration/audio-first-pipeline.spec.ts` | Прогон маршрута целиком на моках |
| `prisma/migrations/20260817000000_add_transcription_step/migration.sql` | Значение enum, тип ассета, поле маршрута |

**Модифицируется:**

| Файл | Что меняется |
|---|---|
| `server/utils/media-provider/types.ts` | Способность `transcription`, вход, ограничения, спека, execution `sync_json` |
| `server/utils/media-provider/registry.ts:34-72` | Способность в списке, env-ключи |
| `server/utils/media-provider/model-specs.ts` | Спека модели транскрипции |
| `server/utils/media-provider/run-media-task.ts:238-241,728-774` | Ветка `sync_json`, usage для транскрипции, `raw` при переиспользовании |
| `server/utils/video-pipeline-db.ts:27,37-45` | `StepKey`, `STEP_ORDER` |
| `server/utils/video-pipeline-run-policy.ts:27-73` | Порядок audio-first, `executionOrderFor`, решения сборки |
| `server/utils/video-pipeline-reset.ts:18-46` | Тип ассета и `STEP_ASSET_TYPES` |
| `server/utils/video-pipeline.ts:568-880,1037` | Порядок вызовов по маршруту, вставка транскрипции, каскад |
| `server/utils/video-pipeline-steps.ts:1109-1501` | Ветка единого трека в шаге озвучки, отключение сведения |
| `server/utils/lip-sync-runner.ts:511-560,586,772,815-828,883` | Звук из общего трека вместо посценного синтеза |
| `server/utils/render.ts:1260-1294` | Слова выравнивания в субтитры, подгон длины видео под звук |
| `server/utils/balance/cost-attribution.ts:36-80` | Ветка расхода нового шага |
| `server/utils/balance/spend-breakdown.ts:50-70` | Группа расхода |
| `server/api/videos/[id]/rerun-step.post.ts` | Новый шаг в списке разрешённых к перезапуску |
| `shared/types/video.ts:27,140,149` | Второй `VideoStepKey`, `STEP_LABELS`, `STEP_ORDER` |
| `app/components/video/VideoStatusMap.ts:31,47` | Русское название шага и признак дешевизны |
| `prisma/schema.prisma:559,585,745` | `VideoStepKey.transcription`, `AssetType.transcript`, `Video.editPipeline` |
| `vitest.pure.config.ts:17-51` | Каталоги `tests/unit/transcription/**`, `tests/unit/voiceover/**` |
| `tests/unit/fixes/media-registry.spec.ts:462` | Инвариант «семь способностей» → восемь |
| `tests/unit/fixes/video-pipeline-orchestration.spec.ts:29` | Список ключей `STEP_ASSET_TYPES` |
| `tests/unit/fixes/duck-intervals-from-mix.spec.ts:70-84` | Мок `STEP_ORDER` с новым ключом |
| `.env.example` | Флаг `EDIT_PIPELINE` |

---

### Task 1: Тип транскрипта и нормализатор ответа модели

Схему конкретной модели снять нечем (токена нет, §14 спеки), поэтому нормализатор принимает три формы, встречающиеся у обёрток Whisper. Когда схема будет снята, изменится одна спека — не выравнивание и не субтитры.

**Files:**
- Create: `server/utils/transcription/types.ts`
- Create: `server/utils/transcription/normalize.ts`
- Test: `tests/unit/transcription/normalize.spec.ts`
- Modify: `vitest.pure.config.ts`

**Interfaces:**
- Consumes: ничего.
- Produces: `TranscriptWord { text: string, startSec: number, endSec: number }`, `Transcript { words: TranscriptWord[], text: string }`, `normalizeTranscriptPayload(raw: unknown): Transcript`.

- [ ] **Step 1: Добавить каталоги в DB-free сьюту**

В `vitest.pure.config.ts` в массив `include`:

```ts
      "tests/unit/transcription/**/*.spec.ts",
      "tests/unit/voiceover/**/*.spec.ts",
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
Expected: FAIL — модуль не существует.

- [ ] **Step 4: Написать тип**

Создать `server/utils/transcription/types.ts`:

```ts
/**
 * Транскрипт нашей собственной озвучки.
 *
 * Нужен не ради текста — текст известен из сценария, — а ради ГРАНИЦ: по ним
 * режутся кадры, показываются субтитры и считается фактическая длина сцены
 * (spec 2026-08-16-audio-first-editing §4).
 */

export interface TranscriptWord {
  /** Слово без окружающей пунктуации и пробелов. */
  text: string
  startSec: number
  endSec: number
}

export interface Transcript {
  words: TranscriptWord[]
  /** Полный распознанный текст: для диагностики и отчёта оператору. */
  text: string
}
```

- [ ] **Step 5: Написать нормализатор**

Создать `server/utils/transcription/normalize.ts`:

```ts
/**
 * Приведение ответа модели транскрипции к нашему транскрипту.
 *
 * Обёртки Whisper отдают слова тремя способами: `chunks` с парой timestamp,
 * `segments[].words` и плоский `words`. Разбор живёт здесь, а не в спеке модели,
 * чтобы смена модели не тянула правку выравнивания и субтитров.
 *
 * Слово без валидных границ выбрасывается, а не получает ноль: ноль встал бы в
 * начало ролика и утащил бы туда субтитр.
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
git add server/utils/transcription tests/unit/transcription/normalize.spec.ts vitest.pure.config.ts
git commit -m "feat: транскрипт озвучки — тип и нормализатор ответа модели"
```

---

### Task 2: Выравнивание транскрипта со сценарием

Модель слышит «эм эр эр», в сценарии написано «MRR»; она глотает слова и добавляет лишние. Нужны фактические границы каждого слова сценария — при том что показывать мы будем текст сценария.

**Важно про алгоритм:** сопоставление идёт по точному равенству нормализованных слов (indel-расстояние, замена запрещена). Многосложные токены — латинские аббревиатуры и числа — таким сравнением не ловятся **никогда**, поэтому они разбираются **отдельным пост-проходом** по словам, оставшимся ничьими между сопоставленными соседями. Попытка учесть их прямо в ветке сопоставления даёт мёртвый код и перехлёст интервалов с соседним словом.

**Files:**
- Create: `server/utils/transcription/align.ts`
- Test: `tests/unit/transcription/align.spec.ts`

**Interfaces:**
- Consumes: `Transcript`, `TranscriptWord` (Task 1).
- Produces:
  - `alignScriptToTranscript(input: { scenes: AlignScene[], transcript: Transcript }): AlignmentResult`
  - `AlignScene { order: number, text: string }`
  - `AlignedWord { text: string, startSec: number, endSec: number, matched: boolean }`
  - `AlignedScene { order: number, startSec: number, endSec: number, words: AlignedWord[] }`
  - `AlignmentResult { scenes: AlignedScene[], matchedRatio: number, degraded: boolean }`
  - `normalizeToken(value: string): string`

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
    expect(result.degraded).toBe(false)
  })

  it("отдаёт аббревиатуре все её слоги и не залезает на соседа", () => {
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
    expect(words[2]).toMatchObject({ startSec: 1.0, endSec: 1.6, matched: true })
    // Сосед не должен начинаться раньше, чем кончилась аббревиатура.
    expect(words[3]!.startSec).toBeGreaterThanOrEqual(words[2]!.endSec)
  })

  it("отдаёт числу произнесённые слова", () => {
    const result = alignScriptToTranscript({
      scenes: [{ order: 1, text: "выручка 1000 долларов" }],
      transcript: transcript([
        ["выручка", 0, 0.6], ["тысяча", 0.6, 1.1], ["долларов", 1.1, 1.8],
      ]),
    })

    const words = result.scenes[0]!.words
    expect(words.map(w => w.text)).toEqual(["выручка", "1000", "долларов"])
    expect(words[1]).toMatchObject({ startSec: 0.6, endSec: 1.1, matched: true })
  })

  it("переживает проглоченное моделью слово", () => {
    const result = alignScriptToTranscript({
      scenes: [{ order: 1, text: "начни с малого но начни" }],
      transcript: transcript([
        ["начни", 0, 0.4], ["малого", 0.5, 1.0], ["но", 1.0, 1.1], ["начни", 1.1, 1.5],
      ]),
    })

    const words = result.scenes[0]!.words
    expect(words.map(w => w.text)).toEqual(["начни", "с", "малого", "но", "начни"])
    expect(words[1]!.matched).toBe(false)
    expect(words[1]!.startSec).toBeGreaterThanOrEqual(words[0]!.endSec)
    expect(words[1]!.endSec).toBeLessThanOrEqual(words[2]!.startSec)
  })

  it("подряд идущие несопоставленные слова делят щель, а не сливаются в точку", () => {
    const result = alignScriptToTranscript({
      scenes: [{ order: 1, text: "один два три четыре" }],
      transcript: transcript([["один", 0, 0.4], ["четыре", 1.6, 2.0]]),
    })

    const words = result.scenes[0]!.words
    expect(words[1]!.endSec).toBeLessThanOrEqual(words[2]!.startSec)
    expect(words[1]!.endSec - words[1]!.startSec).toBeGreaterThan(0)
    expect(words[2]!.endSec - words[2]!.startSec).toBeGreaterThan(0)
  })

  it("сцена без единого совпадения не растягивается на весь ролик", () => {
    const result = alignScriptToTranscript({
      scenes: [
        { order: 1, text: "первая сцена" },
        { order: 2, text: "неузнанная середина" },
        { order: 3, text: "третья сцена" },
      ],
      transcript: transcript([
        ["первая", 0, 0.5], ["сцена", 0.5, 1.2],
        ["третья", 2.0, 2.6], ["сцена", 2.6, 3.2],
      ]),
    })

    const middle = result.scenes[1]!
    expect(middle.startSec).toBeGreaterThanOrEqual(result.scenes[0]!.endSec)
    expect(middle.endSec).toBeLessThanOrEqual(result.scenes[2]!.startSec)
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
    expect(result.scenes[0]!.endSec).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/transcription/align.spec.ts`
Expected: FAIL — модуль не существует.

- [ ] **Step 3: Написать выравнивание**

Создать `server/utils/transcription/align.ts`:

```ts
/**
 * Сопоставление текста сценария с распознанными словами.
 *
 * Показываем мы текст сценария («MRR»), а время знаем только про распознанные
 * слова («эм эр эр»). Поэтому задача не «исправить транскрипцию моделью», как
 * делают снаружи, а связать два ряда слов: эталонный текст у нас уже есть
 * (spec §4.2).
 *
 * Ядро — выравнивание двух последовательностей по indel-расстоянию (замена
 * запрещена: слово либо то же самое, либо пропуск с одной из сторон). Замена
 * дала бы «сопоставленные» пары непохожих слов и вместе с ними уверенные, но
 * выдуманные тайминги.
 *
 * Многосложные токены (аббревиатуры, числа) точным сравнением не ловятся
 * никогда: `MRR` не равно ни `эм`, ни `эр`. Их разбирает ОТДЕЛЬНЫЙ пост-проход
 * по словам, оставшимся ничьими между сопоставленными соседями. Делать это
 * внутри сопоставления нельзя — интервал такого слова перехлестнулся бы с
 * соседним.
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
  /** Сошлось меньше половины — границы ненадёжны, вызывающий обязан сказать вслух. */
  degraded: boolean
}

const DEGRADED_THRESHOLD = 0.5

interface ScriptToken {
  sceneOrder: number
  raw: string
  normalized: string
  /** Сколько распознанных слов токен может занять: у многосложных больше одного. */
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
function abbreviationSpan(raw: string): number {
  const bare = raw.replace(/[^A-Za-z]/g, "")
  const isAbbreviation = bare.length >= 2 && bare.length <= 5
    && bare === bare.toUpperCase()
    && raw === raw.toUpperCase()
  return isAbbreviation ? bare.length : 0
}

/**
 * Число произносится словами, и сколько их будет — неизвестно: «1000» это одна
 * «тысяча», а «1250» — четыре слова. Берём верхнюю оценку по числу разрядов;
 * пост-проход возьмёт столько ничейных слов, сколько реально есть.
 */
function numberSpan(raw: string): number {
  const digits = raw.replace(/[^0-9]/g, "")
  if (digits.length === 0) return 0
  return Math.min(4, Math.max(1, Math.ceil(digits.length / 2) + 1))
}

function tokenizeScene(scene: AlignScene): ScriptToken[] {
  return scene.text
    .split(/\s+/)
    .map(word => word.trim())
    .filter(Boolean)
    .map((raw) => {
      const normalized = normalizeToken(raw)
      const span = Math.max(1, abbreviationSpan(raw), numberSpan(raw))
      return { sceneOrder: scene.order, raw, normalized, span }
    })
    .filter(token => token.normalized.length > 0)
}

type Op = "match" | "script_only" | "transcript_only"

interface PathEntry { op: Op, scriptIndex: number, heardIndex: number }

function alignSequences(script: ScriptToken[], heard: TranscriptWord[]): PathEntry[] {
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

  const path: PathEntry[] = []
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

/**
 * Многосложные токены забирают ничейные распознанные слова между соседями.
 * Возвращает, сколько токенов удалось закрыть, — это доля совпадений.
 */
function assignMultiWordTokens(
  tokens: readonly ScriptToken[],
  aligned: AlignedWord[],
  heard: readonly TranscriptWord[],
  heardOfScript: ReadonlyMap<number, number>,
  usedHeard: Set<number>,
): number {
  let assigned = 0

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!
    const word = aligned[index]!
    if (word.matched || token.span < 2) continue

    let lower = -1
    for (let back = index - 1; back >= 0; back -= 1) {
      const hit = heardOfScript.get(back)
      if (hit !== undefined) { lower = hit; break }
    }
    let upper = heard.length
    for (let forward = index + 1; forward < tokens.length; forward += 1) {
      const hit = heardOfScript.get(forward)
      if (hit !== undefined) { upper = hit; break }
    }

    const free: number[] = []
    for (let h = lower + 1; h < upper; h += 1) if (!usedHeard.has(h)) free.push(h)
    if (free.length === 0) continue

    const take = free.slice(0, token.span)
    word.startSec = heard[take[0]!]!.startSec
    word.endSec = heard[take[take.length - 1]!]!.endSec
    word.matched = true
    for (const h of take) usedHeard.add(h)
    assigned += 1
  }

  return assigned
}

/**
 * Слова без пары получают время в щели между сопоставленными соседями, и щель
 * делится между ними поровну: иначе вся группа загорится в караоке одновременно.
 */
function interpolate(words: AlignedWord[], fallbackStart: number, fallbackEnd: number): void {
  let index = 0
  while (index < words.length) {
    if (words[index]!.matched) { index += 1; continue }

    let runEnd = index
    while (runEnd < words.length && !words[runEnd]!.matched) runEnd += 1

    const prevEnd = index > 0 ? words[index - 1]!.endSec : fallbackStart
    const nextStart = runEnd < words.length ? words[runEnd]!.startSec : fallbackEnd
    const span = Math.max(0, nextStart - prevEnd)
    const step = span / (runEnd - index)

    for (let k = index; k < runEnd; k += 1) {
      words[k]!.startSec = prevEnd + step * (k - index)
      words[k]!.endSec = prevEnd + step * (k - index + 1)
    }

    index = runEnd
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
  const aligned: AlignedWord[] = tokens.map(token => ({
    text: token.raw,
    startSec: 0,
    endSec: 0,
    matched: false,
  }))

  const usedHeard = new Set<number>()
  const heardOfScript = new Map<number, number>()
  let matchedCount = 0

  for (const entry of path) {
    if (entry.op !== "match") continue
    const word = aligned[entry.scriptIndex]!
    const hit = heard[entry.heardIndex]!
    // Ровно одно распознанное слово: многосложные разбирает пост-проход ниже.
    word.startSec = hit.startSec
    word.endSec = hit.endSec
    word.matched = true
    usedHeard.add(entry.heardIndex)
    heardOfScript.set(entry.scriptIndex, entry.heardIndex)
    matchedCount += 1
  }

  matchedCount += assignMultiWordTokens(tokens, aligned, heard, heardOfScript, usedHeard)

  const timelineStart = heard[0]?.startSec ?? 0
  const timelineEnd = heard[heard.length - 1]?.endSec ?? 0

  // Границы соседних сцен, а не всего ролика: сцена, которую модель не узнала,
  // иначе растянулась бы от первого до последнего слова и накрыла соседей.
  const scenes: AlignedScene[] = []
  let cursor = 0
  let previousEnd = timelineStart

  for (let sceneIndex = 0; sceneIndex < input.scenes.length; sceneIndex += 1) {
    const scene = input.scenes[sceneIndex]!
    const count = tokens.filter(token => token.sceneOrder === scene.order).length
    if (count === 0) continue

    const words = aligned.slice(cursor, cursor + count)
    cursor += count

    let nextStart = timelineEnd
    for (let ahead = cursor; ahead < aligned.length; ahead += 1) {
      if (aligned[ahead]!.matched) { nextStart = aligned[ahead]!.startSec; break }
    }
    if (nextStart < previousEnd) nextStart = previousEnd

    interpolate(words, previousEnd, nextStart)
    const startSec = words[0]!.startSec
    const endSec = words[words.length - 1]!.endSec
    previousEnd = endSec

    scenes.push({ order: scene.order, startSec, endSec, words })
  }

  const matchedRatio = matchedCount / tokens.length
  return { scenes, matchedRatio, degraded: matchedRatio < DEGRADED_THRESHOLD }
}
```

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/transcription/align.spec.ts`
Expected: PASS, 8 тестов.

- [ ] **Step 5: Коммит**

```bash
git add server/utils/transcription/align.ts tests/unit/transcription/align.spec.ts
git commit -m "feat: выравнивание сценария по распознанным словам"
```

---

### Task 3: Единый сценарный текст

В коде сегодня два независимых потока речи: `scene.spokenLine` (реплика ведущего в кадре, потребитель — lip-sync) и `voiceoverPlan.lines[].text` (закадровый нарратор, потребитель — шаг озвучки). Решение владельца от 16.08: **это один голос**, и в единый трек идут оба потока в порядке сцен.

**Files:**
- Create: `server/utils/voiceover/script-merge.ts`
- Create: `server/utils/voiceover/track-builder.ts`
- Test: `tests/unit/voiceover/script-merge.spec.ts`
- Test: `tests/unit/voiceover/track-builder.spec.ts`

**Interfaces:**
- Consumes: `AlignScene` (Task 2), `StoryDrivenVideoPlan` из `shared/types/video-runtime`.
- Produces:
  - `mergeScriptLines(input: { scenes: Array<{ order: number, spokenLine: string | null }>, voiceoverLines: Array<{ sceneOrder: number, text: string }> }): MergedScene[]`
  - `MergedScene { order: number, text: string, source: "spoken" | "narration" }`
  - `buildTrackRequest(scenes: readonly MergedScene[], options?: { maxCharacters?: number }): TrackRequest`
  - `TrackRequest { text: string, scenes: AlignScene[], pauses: TrackPause[] }` — `scenes` содержит текст **без маркеров пауз**, и именно он идёт в выравнивание.
  - `TrackPause { afterSceneOrder: number, durationSec: number }`

- [ ] **Step 1: Написать падающий тест слияния**

Создать `tests/unit/voiceover/script-merge.spec.ts`:

```ts
import { describe, expect, it } from "vitest"

import { mergeScriptLines } from "~~/server/utils/voiceover/script-merge"

describe("слияние речи в кадре и закадровой", () => {
  it("ставит реплики и нарратора в порядке сцен", () => {
    const merged = mergeScriptLines({
      scenes: [
        { order: 1, spokenLine: "Знаешь, что отличает успешных?" },
        { order: 2, spokenLine: null },
        { order: 3, spokenLine: "Начни с малого." },
      ],
      voiceoverLines: [{ sceneOrder: 2, text: "Большинство зацикливается на разовых продажах." }],
    })

    expect(merged).toEqual([
      { order: 1, text: "Знаешь, что отличает успешных?", source: "spoken" },
      { order: 2, text: "Большинство зацикливается на разовых продажах.", source: "narration" },
      { order: 3, text: "Начни с малого.", source: "spoken" },
    ])
  })

  it("реплика в кадре главнее закадровой строки той же сцены", () => {
    // Иначе у сцены оказалось бы два голоса на один и тот же отрезок времени.
    const merged = mergeScriptLines({
      scenes: [{ order: 1, spokenLine: "Речь в кадре" }],
      voiceoverLines: [{ sceneOrder: 1, text: "Закадровая строка" }],
    })

    expect(merged).toEqual([{ order: 1, text: "Речь в кадре", source: "spoken" }])
  })

  it("пропускает сцены без текста вовсе", () => {
    const merged = mergeScriptLines({
      scenes: [
        { order: 1, spokenLine: "Есть текст" },
        { order: 2, spokenLine: "   " },
        { order: 3, spokenLine: null },
      ],
      voiceoverLines: [],
    })

    expect(merged.map(scene => scene.order)).toEqual([1])
  })

  it("не теряет закадровую строку сцены, которой нет в плане сцен", () => {
    const merged = mergeScriptLines({
      scenes: [{ order: 1, spokenLine: "Первая" }],
      voiceoverLines: [{ sceneOrder: 5, text: "Хвост нарратора" }],
    })

    expect(merged.map(scene => scene.order)).toEqual([1, 5])
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/voiceover/script-merge.spec.ts`
Expected: FAIL — модуль не существует.

- [ ] **Step 3: Написать слияние**

Создать `server/utils/voiceover/script-merge.ts`:

```ts
/**
 * Один голос ролика из двух потоков речи.
 *
 * Исторически речь разделена: `scene.spokenLine` — то, что ведущий говорит в
 * кадре (его потребляет lip-sync), `voiceoverPlan.lines[]` — закадровый
 * нарратор (его потребляет шаг озвучки). Для зрителя это один и тот же человек,
 * и на audio-first маршруте текст ролика единый (решение владельца 16.08).
 *
 * Приоритет реплики в кадре над закадровой строкой той же сцены не вкусовой: в
 * противном случае на один отрезок времени пришлось бы два голоса.
 */

export interface MergeScriptInput {
  scenes: Array<{ order: number, spokenLine: string | null }>
  voiceoverLines: Array<{ sceneOrder: number, text: string }>
}

export interface MergedScene {
  order: number
  text: string
  source: "spoken" | "narration"
}

function clean(value: string | null | undefined): string {
  return (value ?? "").trim()
}

export function mergeScriptLines(input: MergeScriptInput): MergedScene[] {
  const narration = new Map<number, string>()
  for (const line of input.voiceoverLines) {
    const text = clean(line.text)
    if (text) narration.set(line.sceneOrder, text)
  }

  const merged: MergedScene[] = []
  const seen = new Set<number>()

  for (const scene of input.scenes) {
    seen.add(scene.order)
    const spoken = clean(scene.spokenLine)
    if (spoken) {
      merged.push({ order: scene.order, text: spoken, source: "spoken" })
      continue
    }
    const narrated = narration.get(scene.order)
    if (narrated) merged.push({ order: scene.order, text: narrated, source: "narration" })
  }

  // Строка нарратора, у которой нет своей сцены, всё равно звучит в ролике:
  // потерять её значило бы потерять кусок сценария.
  for (const [order, text] of narration) {
    if (!seen.has(order)) merged.push({ order, text, source: "narration" })
  }

  return merged.sort((a, b) => a.order - b.order)
}
```

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/voiceover/script-merge.spec.ts`
Expected: PASS, 4 теста.

- [ ] **Step 5: Написать падающий тест сборки трека**

Создать `tests/unit/voiceover/track-builder.spec.ts`:

```ts
import { describe, expect, it } from "vitest"

import { buildTrackRequest } from "~~/server/utils/voiceover/track-builder"

const scene = (order: number, text: string) => ({ order, text, source: "spoken" as const })

describe("сборка единого трека озвучки", () => {
  it("склеивает реплики сцен в один текст", () => {
    const request = buildTrackRequest([scene(1, "Первая реплика."), scene(2, "Вторая реплика.")])

    expect(request.text).toBe("Первая реплика. Вторая реплика.")
    expect(request.pauses).toEqual([])
  })

  it("вынимает маркер паузы из текста и запоминает её длину", () => {
    const request = buildTrackRequest([
      scene(1, "Смотри сюда. [пауза 2с]"),
      scene(2, "А теперь вывод."),
    ])

    // Маркер не должен попасть в синтез — модель прочитала бы его вслух.
    expect(request.text).toBe("Смотри сюда. А теперь вывод.")
    expect(request.pauses).toEqual([{ afterSceneOrder: 1, durationSec: 2 }])
  })

  it("отдаёт сцены с ОЧИЩЕННЫМ текстом для выравнивания", () => {
    const request = buildTrackRequest([scene(1, "Раз. [пауза 1.5с] Два.")])

    // В выравнивание должен уходить тот же текст, что ушёл в синтез: иначе
    // «пауза» и «1.5с» станут словами сценария, которых нет в транскрипте.
    expect(request.scenes).toEqual([{ order: 1, text: "Раз. Два." }])
    expect(request.pauses).toEqual([{ afterSceneOrder: 1, durationSec: 1.5 }])
  })

  it("падает, если текст не влезает в лимит модели", () => {
    expect(() => buildTrackRequest([scene(1, "а".repeat(120))], { maxCharacters: 100 }))
      .toThrow(/длиннее 100 символов/)
  })

  it("не отдаёт пустой запрос на синтез", () => {
    expect(() => buildTrackRequest([scene(1, "   ")])).toThrow(/пустой текст/)
  })
})
```

- [ ] **Step 6: Запустить тест и убедиться, что он падает**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/voiceover/track-builder.spec.ts`
Expected: FAIL — модуль не существует.

- [ ] **Step 7: Написать сборщик трека**

Создать `server/utils/voiceover/track-builder.ts`:

```ts
/**
 * Текст ролика для ОДНОГО вызова TTS.
 *
 * Посценный синтез рвал интонацию на каждой границе и требовал искусственных
 * вдохов между тейками; единый трек читается как речь живого человека (§3).
 *
 * Маркер паузы `[пауза 2с]` в синтез не попадает — модель прочитала бы его
 * вслух. Он превращается в тишину, которую вставляет шаг озвучки (§4.6).
 *
 * Наружу отдаётся ОЧИЩЕННЫЙ текст по сценам: именно он уходит в выравнивание.
 * Отдай мы исходный, «пауза» и «2с» стали бы словами сценария, которых в
 * транскрипте нет, — и просели бы и `matchedRatio`, и порог деградации.
 */

import type { AlignScene } from "../transcription/align"
import type { MergedScene } from "./script-merge"

export interface TrackPause {
  /** После какой сцены встаёт тишина. */
  afterSceneOrder: number
  durationSec: number
}

export interface TrackRequest {
  text: string
  /** Сцены с текстом без маркеров — вход выравнивания. */
  scenes: AlignScene[]
  pauses: TrackPause[]
}

/**
 * `[пауза 2с]`, `[пауза 1.5 с]` — регистр и пробел не важны.
 *
 * Регулярное выражение создаётся функцией, а не живёт константой: у глобального
 * regexp есть `lastIndex`, и общий экземпляр между вызовами `test`/`matchAll`
 * ведёт себя через раз.
 */
function pauseMarker(): RegExp {
  return /\[пауза\s*(\d+(?:[.,]\d+)?)\s*с\]/gi
}

/** Лимит MiniMax speech-02-turbo; вызывающий может передать лимит своей модели. */
const DEFAULT_MAX_CHARACTERS = 5000

export function buildTrackRequest(
  scenes: readonly MergedScene[],
  options: { maxCharacters?: number } = {},
): TrackRequest {
  const maxCharacters = options.maxCharacters ?? DEFAULT_MAX_CHARACTERS
  const parts: string[] = []
  const cleanedScenes: AlignScene[] = []
  const pauses: TrackPause[] = []

  for (const scene of scenes) {
    const original = scene.text ?? ""
    for (const match of original.matchAll(pauseMarker())) {
      const durationSec = Number.parseFloat(match[1]!.replace(",", "."))
      if (Number.isFinite(durationSec) && durationSec > 0) {
        pauses.push({ afterSceneOrder: scene.order, durationSec })
      }
    }

    const cleaned = original.replace(pauseMarker(), " ").replace(/\s+/g, " ").trim()
    if (!cleaned) continue

    parts.push(cleaned)
    cleanedScenes.push({ order: scene.order, text: cleaned })
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

  return { text, scenes: cleanedScenes, pauses }
}
```

- [ ] **Step 8: Запустить тест и убедиться, что он проходит**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/voiceover/track-builder.spec.ts`
Expected: PASS, 5 тестов.

- [ ] **Step 9: Коммит**

```bash
git add server/utils/voiceover tests/unit/voiceover
git commit -m "feat: единый сценарный текст ролика и маркеры пауз"
```

---

### Task 4: Способность `transcription` в медиареестре

Выход транскрипции — JSON, а не медиафайл, поэтому существующие ветки исполнения не подходят: `async_prediction` переносит файл из хранилища, `sync_queue` скачивает по URL. Добавляется ветка `sync_json` по образцу `sync_bytes`.

**Files:**
- Create: `server/utils/replicate/json-model.ts`
- Modify: `server/utils/media-provider/types.ts`
- Modify: `server/utils/media-provider/registry.ts:34-72`
- Modify: `server/utils/media-provider/model-specs.ts`
- Modify: `server/utils/media-provider/run-media-task.ts:238-241,627-659,728-774`
- Modify: `tests/unit/fixes/media-registry.spec.ts:462`
- Test: `tests/unit/media-provider/transcription-spec.spec.ts`

**Interfaces:**
- Consumes: ничего из предыдущих задач.
- Produces: capability `"transcription"`; `TranscriptionInput { audioUrl: string, language?: string }`; `TranscriptionConstraints { languages: readonly string[], maxDurationSec: number, audioExtensions: readonly string[] }`; `TranscriptionModelSpec`; execution `"sync_json"`; `runReplicateJsonModel(modelId: string, payload: Record<string, unknown>, config: ReplicateConfig, timeoutMs: number): Promise<unknown>`.

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

  it("отказывает на языке, которого модель не размечает", () => {
    const spec = listMediaSpecs("transcription")[0]!

    expect(() => mapMediaInput(spec, {
      audioUrl: "https://cdn.example.com/voiceover.mp3",
      language: "zh",
    })).toThrow(/не размечает язык/)
  })

  it("считает цену по секундам аудио", () => {
    const spec = listMediaSpecs("transcription")[0]!

    expect(spec.billing.unit).toBe("audio_second")
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/media-provider/transcription-spec.spec.ts`
Expected: FAIL — `listMediaSpecs("transcription")` вернёт пустой массив, первый же тест упадёт на `expect(specs.length).toBeGreaterThan(0)`.

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
 * Транскрипция СВОЕЙ озвучки. Текст известен из сценария — нужны границы слов
 * (spec §4.1).
 */
export interface TranscriptionInput {
  /** Публичный URL готового трека озвучки. */
  audioUrl: string
  /** Подсказка языка: для русского заметно повышает точность границ. */
  language?: string
}

export interface TranscriptionConstraints {
  languages: readonly string[]
  /** Потолок длины аудио у модели. Проверяется ДО оплаты. */
  maxDurationSec: number
  audioExtensions: readonly string[]
}
```

Добавить `transcription: TranscriptionInput` в `MediaInputMap`, тип спеки и член union:

```ts
export type TranscriptionModelSpec = MediaModelSpecBase<"transcription", TranscriptionInput, TranscriptionConstraints>
```

- [ ] **Step 4: Зарегистрировать способность**

В `server/utils/media-provider/registry.ts` — `"transcription"` в конец `MEDIA_CAPABILITIES`, плюс записи в оба словаря env-ключей:

```ts
  transcription: Object.freeze(["MEDIA_MODEL_TRANSCRIPTION"]),
```

```ts
  transcription: "MEDIA_PROVIDER_FALLBACK_TRANSCRIPTION",
```

- [ ] **Step 5: Добавить спеку модели**

В `server/utils/media-provider/model-specs.ts` — новая секция и запись в `MEDIA_MODEL_SPECS`:

```ts
// ─── transcription: границы слов нашей же озвучки ────────────────

/**
 * Whisper на Replicate. Цена НЕ подтверждена страницей модели (токена в
 * окружении нет — spec §14), поэтому `integrated: false`: модель видна в
 * реестре, но маршрут её не выберет и в смету она не попадёт.
 *
 * Перед включением: подтвердить тариф страницей модели и сверить имена полей
 * входа со снятой схемой — `audio`, `language`, `word_timestamps` взяты из
 * публичной документации обёртки, а не из API.
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
  // Выход способности — JSON, а не ссылка на файл: скачивать нечего, разбирает
  // его `normalizeTranscriptPayload`.
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

- [ ] **Step 6: Написать синхронный вызов модели с JSON-выходом**

Создать `server/utils/replicate/json-model.ts`:

```ts
/**
 * Синхронный вызов модели Replicate, отдающей СТРУКТУРУ, а не файл.
 *
 * Асинхронный контур (`prediction-service`) построен вокруг переноса выходного
 * ФАЙЛА в наше хранилище и вокруг вебхука. Транскрипция возвращает объект со
 * словами и отрабатывает за секунды — весь этот аппарат ей не нужен, а
 * `persistedStorageKey` для неё принципиально пуст.
 *
 * Поэтому здесь прямой вызов predictions API с поллингом. Конфигурация
 * читается вызывающим: `readReplicateConfig()` требует переменные вебхука,
 * которых синхронному вызову не нужно, — на стенде без них шаг падал бы ещё до
 * обращения к модели.
 */

import type { ReplicateConfig } from "./config"

const POLL_INTERVAL_MS = 2_000

export interface ReplicateJsonModelDeps {
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

export async function runReplicateJsonModel(
  modelId: string,
  payload: Record<string, unknown>,
  config: ReplicateConfig,
  timeoutMs: number,
  deps: ReplicateJsonModelDeps = {},
): Promise<unknown> {
  if (config.mockMode) {
    // Мок отдаёт форму `chunks`, которую понимает нормализатор: локальный стенд
    // обязан проходить маршрут целиком без единого платного вызова.
    return {
      text: "мок транскрипции",
      chunks: [
        { text: "мок", timestamp: [0, 0.4] },
        { text: "транскрипции", timestamp: [0.4, 1.2] },
      ],
    }
  }

  const token = config.apiToken
  if (!token) {
    throw new Error("Транскрипция: REPLICATE_API_TOKEN не задан, а мок-режим выключен")
  }

  const doFetch = deps.fetchImpl ?? fetch
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)))
  const deadline = Date.now() + timeoutMs

  const created = await doFetch("https://api.replicate.com/v1/models/" + modelId + "/predictions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Prefer": "wait",
    },
    body: JSON.stringify({ input: payload }),
  })
  if (!created.ok) {
    throw new Error(`Транскрипция: Replicate ответил ${created.status} при создании задачи`)
  }

  let prediction = await created.json() as { id: string, status: string, output?: unknown, error?: unknown }

  while (prediction.status === "starting" || prediction.status === "processing") {
    if (Date.now() > deadline) {
      throw new Error(`Транскрипция: модель ${modelId} не ответила за ${Math.round(timeoutMs / 1000)}с`)
    }
    await sleep(POLL_INTERVAL_MS)
    const polled = await doFetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!polled.ok) {
      throw new Error(`Транскрипция: Replicate ответил ${polled.status} при опросе задачи`)
    }
    prediction = await polled.json() as typeof prediction
  }

  if (prediction.status !== "succeeded") {
    const reason = typeof prediction.error === "string" ? prediction.error : prediction.status
    throw new Error(`Транскрипция: задача завершилась как ${reason}`)
  }

  return prediction.output
}
```

- [ ] **Step 7: Добавить ветку исполнения `sync_json`**

В `server/utils/media-provider/run-media-task.ts` — маршрутизация:

```ts
  if (spec.execution === "async_prediction") return runAsyncPredictionTask(request, spec, dependencies)
  if (spec.execution === "sync_bytes") return runSyncBytesTask(request, spec, dependencies)
  if (spec.execution === "sync_json") return runSyncJsonTask(request, spec, dependencies)
  return runSyncQueueTask(request, spec, dependencies)
```

Сама ветка — рядом с `runSyncBytesTask`:

```ts
/**
 * Ветка sync_json: провайдер отдаёт СТРУКТУРУ, а не файл и не ссылку.
 *
 * Так работает транскрипция. Скачивать нечего, поэтому JSON сериализуется и
 * пишется в `outputPath`, оттуда попадает в постоянное хранилище на общих
 * основаниях. Остальное общее с другими ветками: три уровня переиспользования,
 * ключ идемпотентности, запись `MediaPrediction`.
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

  // Гейт платных вызовов — только там, где вызов платный (как в sync_bytes).
  const costsMoney = spec.billing.unit !== "flat" || spec.billing.usd > 0
  if (costsMoney) {
    const requirePaid = dependencies.requirePaidApis
      ?? (await import("../paid-guard")).requirePaidApisEnabled
    requirePaid(spec.vendorLabel)
  }

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
  const { runReplicateJsonModel } = await import("../replicate/json-model")
  return runReplicateJsonModel(modelId, payload, readReplicateConfig(), timeoutMs)
}
```

В `RunMediaTaskDependencies`:

```ts
  /** Провайдер, отдающий структуру, а не файл (транскрипция). */
  runJsonModel?: (
    modelId: string,
    payload: Record<string, unknown>,
    timeoutMs: number,
  ) => Promise<unknown>
```

- [ ] **Step 8: Научить `deriveUsage` считать транскрипцию, а переиспользование — возвращать `raw`**

Без первого цена всегда будет 0 (`estimateMediaCost` бросит на отсутствующем `audioSeconds`, а `safeCost` ошибку проглотит). Без второго повторный заход потеряет результат: `reuseFromStorage` материализует файл, но `raw` не возвращает.

В `deriveUsage` (`run-media-task.ts:733`) добавить ветку:

```ts
    case "transcription":
      // Длительность знает только вызывающий (он мерил файл ffprobe'ом) —
      // здесь её вывести не из чего, поэтому считаем по `request.usage`.
      return {}
```

В `reuseFromStorage` после материализации файла прочитать его содержимое, если способность отдаёт JSON:

```ts
  // Для JSON-способностей результат — не файл, а структура: без неё вызывающий
  // получил бы «успех» с пустыми руками и заново пошёл бы платить.
  const raw = spec.execution === "sync_json"
    ? await readJsonFile(request.outputPath, dependencies)
    : undefined
```

и вернуть `raw` в объекте результата. Вспомогательная функция рядом с прочими `default*`:

```ts
async function readJsonFile(
  path: string,
  dependencies: RunMediaTaskDependencies,
): Promise<unknown> {
  const read = dependencies.readTextFile ?? (async (target: string) => {
    const { readFile } = await import("node:fs/promises")
    return readFile(target, "utf8")
  })
  try {
    return JSON.parse(await read(path))
  } catch (error) {
    console.warn(`[media-task] сохранённый JSON не прочитан: ${describeError(error)}`)
    return undefined
  }
}
```

и поле `readTextFile?: (path: string) => Promise<string>` в `RunMediaTaskDependencies`.

- [ ] **Step 9: Починить инвариант «семь способностей»**

`tests/unit/fixes/media-registry.spec.ts:462` сверяет набор способностей Replicate с точным списком из семи значений — новая спека делает его восьмым. Добавить `"transcription"` в ожидаемый массив (по алфавиту) и поправить формулировку заголовка теста с «семь» на «восемь».

- [ ] **Step 10: Запустить тесты**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/media-provider tests/unit/fixes/media-registry.spec.ts`
Expected: PASS.

- [ ] **Step 11: Прогнать DB-free сьюту целиком — способность попала в union**

Run: `bunx vitest run --config vitest.pure.config.ts`
Expected: PASS.

- [ ] **Step 12: Коммит**

```bash
git add server/utils/media-provider server/utils/replicate/json-model.ts tests/unit/media-provider/transcription-spec.spec.ts tests/unit/fixes/media-registry.spec.ts
git commit -m "feat: способность transcription, ветка sync_json и синхронный JSON-вызов Replicate"
```

---

### Task 5: Схема БД и распространение нового шага

Новый `StepKey` затрагивает не только пайплайн: есть исчерпывающие `Record`, вторая копия типов для UI, whitelist перезапуска и учёт расходов. Всё это правится одной задачей, иначе проект либо не скомпилируется, либо покажет оператору латинский ключ вместо названия шага.

**Files:**
- Modify: `prisma/schema.prisma:559,585,745`
- Create: `prisma/migrations/20260817000000_add_transcription_step/migration.sql`
- Modify: `server/utils/video-pipeline-db.ts:27,37-45`
- Modify: `server/utils/video-pipeline-run-policy.ts:27-45`
- Modify: `server/utils/video-pipeline-reset.ts:18-46`
- Modify: `shared/types/video.ts:27,140,149`
- Modify: `app/components/video/VideoStatusMap.ts:31,47`
- Modify: `server/api/videos/[id]/rerun-step.post.ts`
- Modify: `server/utils/balance/cost-attribution.ts:36-80`
- Modify: `server/utils/balance/spend-breakdown.ts:50-70`
- Modify: `tests/unit/fixes/video-pipeline-orchestration.spec.ts:29`
- Modify: `tests/unit/fixes/duck-intervals-from-mix.spec.ts:70-84`
- Test: `tests/unit/transcription/step-order.spec.ts`

**Interfaces:**
- Consumes: `StepKey`.
- Produces: `StepKey` пополняется значением `"transcription"`; `STEP_EXECUTION_ORDER_AUDIO_FIRST: readonly StepKey[]`; `executionOrderFor(editPipeline: boolean): readonly StepKey[]`; `stepsToRerunFrom(stepKey: StepKey, editPipeline?: boolean): StepKey[]`.

- [ ] **Step 1: Написать падающий тест**

Создать `tests/unit/transcription/step-order.spec.ts`:

```ts
import { describe, expect, it } from "vitest"

import { STEP_ORDER } from "~~/server/utils/video-pipeline-db"
import { executionOrderFor, stepsToRerunFrom } from "~~/server/utils/video-pipeline-run-policy"
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
    expect(executionOrderFor(false)).toEqual([
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

В `prisma/schema.prisma`: в `enum VideoStepKey` добавить `transcription`, в `enum AssetType` — `transcript`, в модель `Video`:

```prisma
  /// Маршрут производства, зафиксированный при старте прогона. true — audio-first
  /// (единый трек, транскрипция, монтаж по границам слов). Читается с ролика, а не
  /// из env: смена флага посреди производства не должна собирать половину ролика по
  /// одним правилам, половину по другим.
  editPipeline    Boolean   @default(false)
```

- [ ] **Step 4: Создать миграцию**

Создать `prisma/migrations/20260817000000_add_transcription_step/migration.sql` — по образцу `20260425070159_add_video_lip_sync`:

```sql
-- AlterEnum
ALTER TYPE "VideoStepKey" ADD VALUE 'transcription';

-- AlterEnum
ALTER TYPE "AssetType" ADD VALUE 'transcript';

-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "editPipeline" BOOLEAN NOT NULL DEFAULT false;
```

Без `IF NOT EXISTS`: в проекте так не пишут, и на `ADD COLUMN` это ещё и замаскировало бы дрифт схемы. Использовать новое значение enum в этой же миграции (например, в `UPDATE`) нельзя — только в следующей.

- [ ] **Step 5: Применить миграцию и перегенерировать клиент**

Run: `bun run test:db:migrate && bunx prisma generate`
Expected: миграция применена. Если команда падает на отсутствии `.env.test` — скопировать `.env.test.example` в `.env.test` и повторить.

- [ ] **Step 6: Дописать ключ в типы шагов**

`server/utils/video-pipeline-db.ts`:

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
  // Дописан в конец намеренно: stepIndex персистентный, по нему записана
  // история роликов, и вставка в середину переписала бы её.
  "transcription",
]
```

- [ ] **Step 7: Добавить порядок исполнения нового маршрута**

`server/utils/video-pipeline-run-policy.ts`:

```ts
/**
 * Порядок маршрута audio-first (spec §3).
 *
 * Озвучка первой: она эталон времени, всё остальное строится по ней.
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

/** Порядок исполнения по маршруту РОЛИКА, а не по глобальному флагу. */
export function executionOrderFor(editPipeline: boolean): readonly StepKey[] {
  return editPipeline ? STEP_EXECUTION_ORDER_AUDIO_FIRST : STEP_EXECUTION_ORDER
}
```

```ts
export function stepsToRerunFrom(stepKey: StepKey, editPipeline = false): StepKey[] {
  const order = executionOrderFor(editPipeline)
  const index = order.indexOf(stepKey)
  if (index < 0) return []
  return [...order.slice(index)]
}
```

`stepsInvalidatedByFreshClips` (там же, строки 70-73) тоже принимает `editPipeline` и передаёт его в `stepsToRerunFrom`.

- [ ] **Step 8: Завести ассет шага**

`server/utils/video-pipeline-reset.ts`: `"transcript"` в union `VideoAssetType` и запись в `STEP_ASSET_TYPES` (карта объявлена как `Record<StepKey, ...>`, без записи проект не скомпилируется):

```ts
  transcription: ["transcript"],
```

- [ ] **Step 9: Обновить вторую копию типов для UI**

`shared/types/video.ts` держит собственные `VideoStepKey` (:27), `STEP_LABELS` (:140) и `STEP_ORDER` (:149) — именно они рисуют таблицу шагов. Добавить туда `transcription` со значением `"Транскрипция"` в `STEP_LABELS` и поставить ключ в `STEP_ORDER` **сразу после `voiceover_generation`** (этот список задаёт порядок строк в UI, и он не обязан совпадать с персистентным `stepIndex`). В `VideoAsset.type` добавить `"transcript"`.

Отсутствующий там `lip_sync_generation` в этой задаче не трогаем — это отдельный давний дефект UI.

- [ ] **Step 10: Дать шагу русское название и признак дешевизны**

`app/components/video/VideoStatusMap.ts`: в `VIDEO_STEP_LABELS` — `transcription: "Транскрипция"`; в `VIDEO_STEP_IS_CHEAP` — `transcription: true` (шаг стоит центы, повтор не требует модалки с ценой).

- [ ] **Step 11: Разрешить перезапуск шага**

`server/api/videos/[id]/rerun-step.post.ts`: добавить `"transcription"` в `VALID_STEPS`, иначе кнопка повтора и `retryFromFailed` вернут 400.

- [ ] **Step 12: Завести расход шага в учёт**

`server/utils/balance/cost-attribution.ts` — ветка `case "transcription"` в `switch (stepKey)` (без неё `default: return null`, и деньги за Whisper не попадут ни в `AiAuditLog`, ни в `Video.totalCostActual`).
`server/utils/balance/spend-breakdown.ts` — добавить ключ в группу «Синтез речи и музыка», иначе расход осядет в «Прочее».

- [ ] **Step 13: Починить ломающиеся существующие тесты**

- `tests/unit/fixes/video-pipeline-orchestration.spec.ts:29` сверяет `Object.keys(STEP_ASSET_TYPES)` с точным списком из семи шагов — добавить `"transcription"`.
- `tests/unit/fixes/duck-intervals-from-mix.spec.ts:70-84` подменяет модуль `video-pipeline-db` вместе с собственным `STEP_ORDER` — добавить туда новый ключ, иначе `STEP_ORDER.indexOf("transcription")` даст `-1`.

- [ ] **Step 14: Запустить тесты**

Run: `bunx vitest run --config vitest.pure.config.ts`
Expected: PASS.

- [ ] **Step 15: Коммит**

```bash
git add prisma server/utils/video-pipeline-db.ts server/utils/video-pipeline-run-policy.ts server/utils/video-pipeline-reset.ts shared/types/video.ts app/components/video/VideoStatusMap.ts server/api/videos/\[id\]/rerun-step.post.ts server/utils/balance tests/unit
git commit -m "feat: шаг транскрипции в схеме, порядке, UI и учёте расходов"
```

---

### Task 6: Раннер шага транскрипции и его адаптер к медиаконтуру

Шаг берёт трек озвучки, вызывает способность, разбирает ответ, выравнивает по сценарию и сохраняет транскрипт ассетом. Повторный заход не платит второй раз и **не теряет тайминги**.

**Files:**
- Create: `server/utils/transcription/runner.ts`
- Create: `server/utils/transcription/media-task.ts`
- Test: `tests/unit/transcription/runner.spec.ts`

**Interfaces:**
- Consumes: `normalizeTranscriptPayload` (Task 1), `alignScriptToTranscript` (Task 2), способность `transcription` (Task 4).
- Produces:
  - `runTranscriptionStep(input: TranscriptionStepInput, deps: TranscriptionStepDeps): Promise<TranscriptionStepResult>`
  - `TranscriptionStepResult { status: "completed" | "degraded" | "skipped", scenes: AlignedScene[], costUsd: number, warning: string | null }`
  - `requestTranscription(input: { videoId: number, stepId: number, audioPath: string, audioUrl: string, language: string, outputPath: string }): Promise<{ costUsd: number, raw: unknown }>` — продовая реализация `TranscriptionStepDeps["runTask"]`.

- [ ] **Step 1: Написать падающий тест**

Создать `tests/unit/transcription/runner.spec.ts`:

```ts
import { describe, expect, it, vi } from "vitest"

import { runTranscriptionStep } from "~~/server/utils/transcription/runner"

const SCENES = [
  { order: 1, text: "тело меняется" },
  { order: 2, text: "здоровье улучшается" },
]

const INPUT = {
  videoId: 7,
  stepId: 3,
  audioPath: "/tmp/voiceover.mp3",
  audioUrl: "https://cdn/voiceover.mp3",
  scenes: SCENES,
  language: "ru",
  outputPath: "/tmp/transcript.json",
}

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
    saveTranscript: vi.fn(async () => {}),
    log: vi.fn(async () => {}),
    ...overrides,
  }
}

describe("шаг транскрипции", () => {
  it("отдаёт сценам фактические границы и стоимость", async () => {
    const result = await runTranscriptionStep(INPUT, deps() as never)

    expect(result.status).toBe("completed")
    expect(result.scenes[0]).toMatchObject({ order: 1, startSec: 0, endSec: 1.1 })
    expect(result.scenes[1]).toMatchObject({ order: 2, startSec: 1.4, endSec: 2.8 })
    expect(result.costUsd).toBeCloseTo(0.02, 6)
  })

  it("сохраняет выровненный транскрипт — повтор прогона не теряет тайминги", async () => {
    const dependencies = deps()

    await runTranscriptionStep(INPUT, dependencies as never)

    expect(dependencies.saveTranscript).toHaveBeenCalledTimes(1)
    const [payload] = (dependencies.saveTranscript as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(payload).toMatchObject({ videoId: 7 })
    expect(payload.scenes[0]).toMatchObject({ order: 1 })
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

    const result = await runTranscriptionStep(INPUT, dependencies as never)

    expect(result.status).toBe("degraded")
    expect(result.warning).toMatch(/выравнивание/i)
  })

  it("не роняет ролик, если транскрипция недоступна", async () => {
    const dependencies = deps({
      runTask: vi.fn(async () => { throw new Error("provider is down") }),
    })

    const result = await runTranscriptionStep(INPUT, dependencies as never)

    expect(result.status).toBe("skipped")
    expect(result.scenes).toEqual([])
    expect(result.warning).toMatch(/provider is down/)
    expect(dependencies.saveTranscript).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/transcription/runner.spec.ts`
Expected: FAIL — модуль не существует.

- [ ] **Step 3: Написать раннер**

Создать `server/utils/transcription/runner.ts`:

```ts
/**
 * Шаг транскрипции: границы слов нашей же озвучки.
 *
 * Зависимости инжектируются, потому что содержательная часть шага — разбор,
 * выравнивание, деградация и сохранение — обязана проверяться без БД, сети и
 * денег.
 *
 * Отказ провайдера ролик не роняет (spec §10): без точных таймингов монтаж
 * работает по плановым длительностям, и это видно в логе шага, а не молча.
 */

import { alignScriptToTranscript, type AlignedScene, type AlignScene } from "./align"
import { normalizeTranscriptPayload } from "./normalize"

export interface TranscriptionStepInput {
  videoId: number
  stepId: number
  /** Локальный файл трека: по нему считается длительность и цена. */
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
    audioPath: string
    audioUrl: string
    language: string
    outputPath: string
  }) => Promise<{ costUsd: number, raw: unknown }>
  /** Сохранение выровненного транскрипта: без него повтор прогона теряет тайминги. */
  saveTranscript: (payload: {
    videoId: number
    scenes: AlignedScene[]
    matchedRatio: number
    localPath: string
  }) => Promise<void>
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
      audioPath: input.audioPath,
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

  await deps.saveTranscript({
    videoId: input.videoId,
    scenes: alignment.scenes,
    matchedRatio: alignment.matchedRatio,
    localPath: input.outputPath,
  })

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
Expected: PASS, 4 теста.

- [ ] **Step 5: Написать адаптер к медиаконтуру**

Создать `server/utils/transcription/media-task.ts` — продовую реализацию `runTask`. Требования, каждое из которых уже стоило нам ошибки в других местах:

- маршрут берётся через `resolveMediaRoute("transcription")`, а не по имени модели;
- длительность трека измеряется `probeAudioDuration` из `server/utils/tts.ts` и уходит в `usage: { audioSeconds }` — иначе цена посчитается как ноль;
- длительность сверяется с `spec.constraints.maxDurationSec` **до** вызова, с внятным отказом;
- `videoId` передаётся всегда: без него нет ключа идемпотентности, и повтор оплатит задачу заново;
- `persist` заполняется ключом хранилища транскрипта (`StorageKeys` рядом с прочими ассетами ролика) — это включает второй уровень переиспользования;
- возвращается `{ costUsd: result.costUsd, raw: result.raw }`.

- [ ] **Step 6: Коммит**

```bash
git add server/utils/transcription tests/unit/transcription/runner.spec.ts
git commit -m "feat: раннер шага транскрипции с сохранением транскрипта и деградацией"
```

---

### Task 7: Синтез единого трека в шаге озвучки

`runVoiceoverGeneration` сегодня устроен от клипов: `probeSceneClipDurations(clipPaths)`, таймлайн из длительностей клипов, сцена без клипа пропускается. На audio-first клипов ещё нет — шаг должен идти другой веткой.

**Files:**
- Modify: `server/utils/video-pipeline-steps.ts:1109-1501`
- Test: `tests/unit/voiceover/single-track-step.spec.ts`

**Interfaces:**
- Consumes: `mergeScriptLines`, `buildTrackRequest` (Task 3), `synthesizeSpeech` из `server/utils/tts.ts`.
- Produces: `runSingleTrackVoiceover(input: SingleTrackInput, deps: SingleTrackDeps): Promise<SingleTrackResult>`, где `SingleTrackResult { trackPath: string, durationSec: number, costUsd: number, scenes: AlignScene[], pauses: TrackPause[] }`.

- [ ] **Step 1: Написать падающий тест**

Создать `tests/unit/voiceover/single-track-step.spec.ts`:

```ts
import { describe, expect, it, vi } from "vitest"

import { runSingleTrackVoiceover } from "~~/server/utils/video-pipeline-steps"

const PLAN_SCENES = [
  { order: 1, spokenLine: "Первая реплика." },
  { order: 2, spokenLine: null },
]

function deps(overrides: Record<string, unknown> = {}) {
  return {
    synthesize: vi.fn(async () => ({ audioPath: "/tmp/track.mp3", durationSec: 6.4, costUsd: 0.07 })),
    insertPauses: vi.fn(async (path: string) => path),
    log: vi.fn(async () => {}),
    ...overrides,
  }
}

describe("единый трек озвучки", () => {
  it("синтезирует ОДИН файл на весь ролик", async () => {
    const dependencies = deps()

    const result = await runSingleTrackVoiceover({
      videoId: 7,
      stepId: 4,
      scenes: PLAN_SCENES,
      voiceoverLines: [{ sceneOrder: 2, text: "Закадровая строка." }],
      voiceId: "clone-1",
      language: "ru",
      outputPath: "/tmp/track.mp3",
    }, dependencies as never)

    expect(dependencies.synthesize).toHaveBeenCalledTimes(1)
    const [call] = (dependencies.synthesize as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(call.text).toBe("Первая реплика. Закадровая строка.")
    expect(result.durationSec).toBeCloseTo(6.4, 3)
    expect(result.scenes.map(scene => scene.order)).toEqual([1, 2])
  })

  it("вставляет тишину по маркерам пауз", async () => {
    const dependencies = deps()

    await runSingleTrackVoiceover({
      videoId: 7,
      stepId: 4,
      scenes: [{ order: 1, spokenLine: "Смотри. [пауза 2с]" }, { order: 2, spokenLine: "Вывод." }],
      voiceoverLines: [],
      voiceId: "clone-1",
      language: "ru",
      outputPath: "/tmp/track.mp3",
    }, dependencies as never)

    expect(dependencies.insertPauses).toHaveBeenCalledTimes(1)
    const [, pauses] = (dependencies.insertPauses as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(pauses).toEqual([{ afterSceneOrder: 1, durationSec: 2 }])
  })

  it("падает внятно, когда голос не задан — чужой голос на лицо ведущего недопустим", async () => {
    await expect(runSingleTrackVoiceover({
      videoId: 7,
      stepId: 4,
      scenes: PLAN_SCENES,
      voiceoverLines: [],
      voiceId: null,
      language: "ru",
      outputPath: "/tmp/track.mp3",
    }, deps() as never)).rejects.toThrow(/голос/i)
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/voiceover/single-track-step.spec.ts`
Expected: FAIL — `runSingleTrackVoiceover` не экспортируется.

- [ ] **Step 3: Написать ветку единого трека**

В `server/utils/video-pipeline-steps.ts` — новая экспортируемая функция рядом с `runVoiceoverGeneration`. Она НЕ трогает существующую посценную ветку: та остаётся маршрутом по умолчанию.

Порядок работы:
1. `mergeScriptLines` — один текст из реплик и закадровых строк;
2. `buildTrackRequest` — текст для синтеза, очищенные сцены и список пауз;
3. отказ, если голос не задан (текст ошибки взять из `presenterVoiceMissingMessage`, если известен персонаж, иначе «Голос ролика не задан — синтезировать его чужим голосом нельзя»);
4. `synthesize` — один вызов TTS;
5. `insertPauses` — вставка тишины по маркерам (ffmpeg-конкатенация с `anullsrc`), если маркеры есть;
6. возврат `{ trackPath, durationSec, costUsd, scenes, pauses }`.

Зависимости (`synthesize`, `insertPauses`, `log`) инжектируются, а продовые реализации подставляются по умолчанию — как это сделано в других раннерах проекта.

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/voiceover/single-track-step.spec.ts`
Expected: PASS, 3 теста.

- [ ] **Step 5: Коммит**

```bash
git add server/utils/video-pipeline-steps.ts tests/unit/voiceover/single-track-step.spec.ts
git commit -m "feat: синтез единого трека озвучки одним вызовом TTS"
```

---

### Task 8: Lip-sync берёт звук из общего трека

Сегодня `ensureSpeech()` синтезирует речь сцены отдельным платным вызовом, а ключ переиспользования и имя файла строятся от ТЕКСТА реплики. При едином треке это даёт двойную оплату и рассинхрон: TTS недетерминирован, и вторая запись звучит иначе, чем та, что лежит под таймлайном.

**Files:**
- Create: `server/utils/voiceover/segment-cut.ts`
- Modify: `server/utils/lip-sync-runner.ts:511-560,586,883`
- Test: `tests/unit/voiceover/segment-cut.spec.ts`

**Interfaces:**
- Consumes: `AlignedScene` (Task 2).
- Produces:
  - `planSegmentCut(input: { scene: AlignedScene, trackDurationSec: number, fps: number, model: { minDurationSec: number, maxDurationSec: number } }): SegmentCut`
  - `SegmentCut { startSec: number, endSec: number, durationSec: number, clampedToModel: boolean }`
  - `segmentIdentity(input: { videoId: number, sceneOrder: number, startSec: number, endSec: number, trackFingerprint: string }): string`

- [ ] **Step 1: Написать падающий тест**

Создать `tests/unit/voiceover/segment-cut.spec.ts`:

```ts
import { describe, expect, it } from "vitest"

import { planSegmentCut, segmentIdentity } from "~~/server/utils/voiceover/segment-cut"

const MODEL = { minDurationSec: 2, maxDurationSec: 10 }

describe("вырезка куска трека под сцену", () => {
  it("режет по границам сцены, притянутым к кадру", () => {
    const cut = planSegmentCut({
      scene: { order: 1, startSec: 1.237, endSec: 4.611, words: [] },
      trackDurationSec: 60,
      fps: 30,
      model: MODEL,
    })

    // 30 fps: кадр длится 1/30 с, границы обязаны попадать в его начало.
    expect(Math.round(cut.startSec * 30) / 30).toBeCloseTo(cut.startSec, 6)
    expect(Math.round(cut.endSec * 30) / 30).toBeCloseTo(cut.endSec, 6)
    expect(cut.durationSec).toBeCloseTo(cut.endSec - cut.startSec, 6)
  })

  it("не вылезает за пределы трека", () => {
    const cut = planSegmentCut({
      scene: { order: 9, startSec: 58.5, endSec: 62.0, words: [] },
      trackDurationSec: 60,
      fps: 30,
      model: MODEL,
    })

    expect(cut.endSec).toBeLessThanOrEqual(60)
  })

  it("зажимает кусок в границы модели и говорит об этом", () => {
    const cut = planSegmentCut({
      scene: { order: 2, startSec: 0, endSec: 14, words: [] },
      trackDurationSec: 60,
      fps: 30,
      model: MODEL,
    })

    expect(cut.durationSec).toBeLessThanOrEqual(10)
    expect(cut.clampedToModel).toBe(true)
  })

  it("ключ идентичности зависит от интервала и от самого трека, а не от текста", () => {
    const base = { videoId: 7, sceneOrder: 1, startSec: 1, endSec: 4, trackFingerprint: "abc" }

    expect(segmentIdentity(base)).toBe(segmentIdentity({ ...base }))
    expect(segmentIdentity(base)).not.toBe(segmentIdentity({ ...base, startSec: 1.5 }))
    // Новый трек обесценивает все куски: иначе к свежему звуку подставятся
    // старые губы (spec §4.4).
    expect(segmentIdentity(base)).not.toBe(segmentIdentity({ ...base, trackFingerprint: "def" }))
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/voiceover/segment-cut.spec.ts`
Expected: FAIL — модуль не существует.

- [ ] **Step 3: Написать планировщик вырезки**

Создать `server/utils/voiceover/segment-cut.ts`. Требования:
- границы берутся из `AlignedScene`, притягиваются к границе кадра при переданном fps (`Math.round(sec * fps) / fps`);
- конец не превышает длительность трека;
- длительность зажимается в `[minDurationSec, maxDurationSec]` модели, и факт зажатия возвращается флагом `clampedToModel` — вызывающий обязан написать об этом в лог, а не молча отдать модели кусок не той длины;
- `segmentIdentity` — sha1 от `videoId`, порядка сцены, границ с точностью до миллисекунды и отпечатка трека.

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/voiceover/segment-cut.spec.ts`
Expected: PASS, 4 теста.

- [ ] **Step 5: Переключить lip-sync на куски трека**

В `server/utils/lip-sync-runner.ts` для роликов с `editPipeline === true`:

- вместо `ensureSpeech()` (строки 527-560) — вырезка куска общего трека по `planSegmentCut` через `ffmpeg -ss/-to`, файл кладётся туда же, где раньше лежал посценный mp3;
- ключ переиспользования: `segmentIdentity` вместо `hashSpeechIdentity` (строки 511-517), имя файла — от него же;
- `presenterTargetSec` (строка 586) считается от длительности ВЫРЕЗАННОГО куска;
- `adjustAudioTempo` (строка 772) на этом маршруте не применяется: длину диктует звук, а подгонка картинки под него — задача плана 2 (нарезка исходника ведущего). Если кусок длиннее потолка модели, шаг пишет предупреждение и отдаёт зажатый интервал — сцена получит укороченный кадр, но звук останется эталоном;
- аватарная ветка (строки 815-828) получает тот же вырезанный файл.

Старый маршрут остаётся нетронутым: вся ветка выбирается по `editPipeline`.

- [ ] **Step 6: Прогнать целевые сьюты**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/voiceover tests/unit/transcription`
Expected: PASS.

- [ ] **Step 7: Коммит**

```bash
git add server/utils/voiceover/segment-cut.ts server/utils/lip-sync-runner.ts tests/unit/voiceover/segment-cut.spec.ts
git commit -m "feat: lip-sync берёт звук из общего трека вместо посценного синтеза"
```

---

### Task 9: Переработка оркестратора

`runVideoPipeline` — линейная последовательность вызовов; `STEP_EXECUTION_ORDER` на неё не влияет. Порядок audio-first придётся собрать явно.

**Files:**
- Modify: `server/utils/video-pipeline.ts:568-880,1037`
- Test: `tests/unit/transcription/orchestrator-order.spec.ts`

**Interfaces:**
- Consumes: `executionOrderFor`, `stepsToRerunFrom` (Task 5), `runSingleTrackVoiceover` (Task 7), `runTranscriptionStep` + `requestTranscription` (Task 6).
- Produces: `planPipelineRun(editPipeline: boolean): readonly StepKey[]` — тонкая обёртка над `executionOrderFor`, по которой оркестратор решает, что вызывать следующим.

- [ ] **Step 1: Написать падающий тест**

Создать `tests/unit/transcription/orchestrator-order.spec.ts`:

```ts
import { describe, expect, it } from "vitest"

import { planPipelineRun } from "~~/server/utils/video-pipeline"

describe("план прогона оркестратора", () => {
  it("на audio-first озвучка и транскрипция идут до картинки", () => {
    const plan = planPipelineRun(true)

    expect(plan.indexOf("voiceover_generation")).toBeLessThan(plan.indexOf("image_generation"))
    expect(plan.indexOf("transcription")).toBeLessThan(plan.indexOf("image_generation"))
  })

  it("на старом маршруте план совпадает с историческим порядком", () => {
    expect(planPipelineRun(false)).toEqual([
      "prompt_generation",
      "image_generation",
      "clip_generation",
      "lip_sync_generation",
      "voiceover_generation",
      "music_generation",
      "assembly",
    ])
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/transcription/orchestrator-order.spec.ts`
Expected: FAIL — `planPipelineRun` не экспортируется.

- [ ] **Step 3: Перестроить тело прогона**

В `server/utils/video-pipeline.ts`:

1. экспортировать `planPipelineRun(editPipeline)` — обёртку над `executionOrderFor`;
2. развести исполнение на две ветки по `video.editPipeline`. Старая ветка — существующая последовательность без изменений. Новая: `runPromptGeneration` → `runSingleTrackVoiceover` → `runTranscriptionStep` → `runImageGeneration` → `runClipGeneration` → `runLipSyncStep` → `runMusicGeneration` → `runAssembly`;
3. на новой ветке **не вызывать** `invalidateClipDerivedStepCaches` (строки 765-767): он сбрасывает кэш озвучки, когда lip-sync выдал новые клипы. На audio-first это выбросило бы уже оплаченный единый трек и обесценило все аватарные кадры (§4.4);
4. `stepsToRerunFrom(stepKey)` в строке 1037 — передать вторым аргументом `video.editPipeline` (ролик там уже загружен целиком);
5. в `videoConfig`, передаваемый в шаг озвучки (литерал на строках 777-785), добавить `editPipeline: video.editPipeline`, а тип конфигурации в `video-pipeline-steps.ts:1112-1120` расширить этим полем;
6. результат транскрипции (выровненные сцены) прокинуть в шаги lip-sync и сборки — через тот же объект состояния прогона, которым уже передаются `clipSceneOrders` и `voicedIntervals`.

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/transcription/orchestrator-order.spec.ts`
Expected: PASS, 2 теста.

- [ ] **Step 5: Прогнать DB-free сьюту целиком**

Run: `bunx vitest run --config vitest.pure.config.ts`
Expected: PASS.

- [ ] **Step 6: Коммит**

```bash
git add server/utils/video-pipeline.ts server/utils/video-pipeline-steps.ts tests/unit/transcription/orchestrator-order.spec.ts
git commit -m "feat: оркестратор ведёт прогон по маршруту ролика"
```

---

### Task 10: Длина видео подгоняется под звук

Политика `voiceoverReconciliation` на новом маршруте выключается (кадры и так нарезаны по речи), но замена нужна: если lip-sync вернул клип не той длины, расхождение накапливается и звук уезжает относительно картинки.

**Files:**
- Modify: `server/utils/video-pipeline-run-policy.ts`
- Modify: `server/utils/render.ts`
- Modify: `server/utils/video-pipeline-steps.ts:1404-1501`
- Test: `tests/unit/transcription/duration-fit.spec.ts`

**Interfaces:**
- Consumes: `AlignedScene` (Task 2).
- Produces:
  - `planDurationFit(input: { expectedSec: number, actualSec: number, toleranceSec?: number }): DurationFit`
  - `DurationFit { action: "none" | "trim" | "hold_last_frame" | "fail", deltaSec: number }`
  - `shouldReconcileVoiceover(editPipeline: boolean): boolean`
  - `clipVolumeWithVoiceoverFor(editPipeline: boolean): number`

- [ ] **Step 1: Написать падающий тест**

Создать `tests/unit/transcription/duration-fit.spec.ts`:

```ts
import { describe, expect, it } from "vitest"

import {
  clipVolumeWithVoiceoverFor,
  planDurationFit,
  shouldReconcileVoiceover,
} from "~~/server/utils/video-pipeline-run-policy"

describe("подгон длины кадра под звук", () => {
  it("расхождение в пределах допуска не трогает ничего", () => {
    expect(planDurationFit({ expectedSec: 4, actualSec: 4.02 })).toMatchObject({ action: "none" })
  })

  it("клип длиннее заказанного подрезается", () => {
    const fit = planDurationFit({ expectedSec: 4, actualSec: 4.6 })

    expect(fit.action).toBe("trim")
    expect(fit.deltaSec).toBeCloseTo(0.6, 6)
  })

  it("клип короче заказанного удерживает последний кадр", () => {
    // Звук трогать нельзя: он эталон таймлайна (spec §8).
    expect(planDurationFit({ expectedSec: 4, actualSec: 3.5 })).toMatchObject({
      action: "hold_last_frame",
    })
  })

  it("расхождение больше секунды — это сбой, а не подгон", () => {
    expect(planDurationFit({ expectedSec: 4, actualSec: 1.2 })).toMatchObject({ action: "fail" })
  })
})

describe("решения сборки по маршруту", () => {
  it("на audio-first дорожки клипов глушатся полностью", () => {
    // Единый трек не совпадает по фазе с речью внутри lip-sync клипа: 0.3 дали
    // бы двойную речь с эхом (spec §6.4).
    expect(clipVolumeWithVoiceoverFor(true)).toBe(0)
  })

  it("на старом маршруте прежние 0.3 сохраняются", () => {
    expect(clipVolumeWithVoiceoverFor(false)).toBeCloseTo(0.3, 6)
  })

  it("на audio-first сведение длины отключено", () => {
    expect(shouldReconcileVoiceover(true)).toBe(false)
  })

  it("на старом маршруте сведение работает как прежде", () => {
    expect(shouldReconcileVoiceover(false)).toBe(true)
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/transcription/duration-fit.spec.ts`
Expected: FAIL — функции не экспортируются.

- [ ] **Step 3: Реализовать решения**

В `server/utils/video-pipeline-run-policy.ts`:

```ts
/** Допуск, в пределах которого расхождение длин не стоит правки. */
const DURATION_TOLERANCE_SEC = 0.05
/** Расхождение больше этого — не подгон, а сбой генерации. */
const DURATION_FAILURE_SEC = 1

export interface DurationFit {
  action: "none" | "trim" | "hold_last_frame" | "fail"
  deltaSec: number
}

/**
 * Что делать, если клип оказался не той длины, что заказана.
 *
 * Правится ВИДЕО. Звук на audio-first не трогается никогда: он эталон
 * таймлайна, и любая правка звука сдвинула бы субтитры и границы всех
 * последующих кадров (spec §8).
 */
export function planDurationFit(input: {
  expectedSec: number
  actualSec: number
  toleranceSec?: number
}): DurationFit {
  const tolerance = input.toleranceSec ?? DURATION_TOLERANCE_SEC
  const deltaSec = input.actualSec - input.expectedSec
  const magnitude = Math.abs(deltaSec)

  if (magnitude <= tolerance) return { action: "none", deltaSec }
  if (magnitude > DURATION_FAILURE_SEC) return { action: "fail", deltaSec }
  return { action: deltaSec > 0 ? "trim" : "hold_last_frame", deltaSec }
}

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

- [ ] **Step 4: Применить в сборке и в шаге озвучки**

- `server/utils/video-pipeline.ts`: громкость дорожек клипов — через `clipVolumeWithVoiceoverFor(video.editPipeline)`.
- `server/utils/video-pipeline-steps.ts:1404-1501`: весь блок сведения (ветки `extend_scene`, `trim_audio`, безымянные «сжатие» и `slowed_down`) выполняется только при `shouldReconcileVoiceover(videoConfig.editPipeline)`; иначе сцена получает `reconciliation: 'none'` без правки файлов.
- `server/utils/render.ts`: перед конкатенацией кадров сверять фактическую длину каждого клипа с заказанной через `planDurationFit` и применять решение — подрезка либо удержание последнего кадра; `action: "fail"` останавливает сборку с внятным сообщением, какой кадр и на сколько разошёлся.

- [ ] **Step 5: Запустить тест и убедиться, что он проходит**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/transcription/duration-fit.spec.ts`
Expected: PASS, 8 тестов.

- [ ] **Step 6: Коммит**

```bash
git add server/utils/video-pipeline-run-policy.ts server/utils/render.ts server/utils/video-pipeline-steps.ts server/utils/video-pipeline.ts tests/unit/transcription/duration-fit.spec.ts
git commit -m "feat: длина кадра подгоняется под звук, сведение и микс по маршруту"
```

---

### Task 11: Субтитры на реальных таймингах

`AssSegmentInput.words` в билдере ASS уже поддерживается (`dialogue.ts:83-85`), но никто его не заполняет: окна строит `buildAssSegments` в `render.ts:1260-1294` через `probeClipDurations` и `chunkSceneSpeech`.

**Files:**
- Modify: `server/utils/render.ts:1260-1294`
- Create: `server/utils/subtitles/aligned-words.ts`
- Test: `tests/unit/subtitles/aligned-words.spec.ts`

**Interfaces:**
- Consumes: `AlignedScene`, `AlignedWord` (Task 2), `chunkSceneSpeech` из `server/utils/subtitles/phrase-chunker.ts`.
- Produces: `wordsForChunk(input: { words: readonly AlignedWord[], chunkText: string, chunkStartSec: number, chunkEndSec: number }): Array<{ text: string, startSec: number, endSec: number }>`

- [ ] **Step 1: Написать падающий тест**

Создать `tests/unit/subtitles/aligned-words.spec.ts`:

```ts
import { describe, expect, it } from "vitest"

import { wordsForChunk } from "~~/server/utils/subtitles/aligned-words"

const SCENE_WORDS = [
  { text: "короткое", startSec: 0, endSec: 0.5, matched: true },
  { text: "и", startSec: 0.5, endSec: 0.6, matched: true },
  { text: "очень", startSec: 0.6, endSec: 1.0, matched: true },
  { text: "длинное", startSec: 1.0, endSec: 1.8, matched: true },
]

describe("раскладка выровненных слов по чанкам субтитра", () => {
  it("отдаёт чанку только его слова", () => {
    const words = wordsForChunk({
      words: SCENE_WORDS,
      chunkText: "очень длинное",
      chunkStartSec: 0.6,
      chunkEndSec: 1.8,
    })

    expect(words.map(w => w.text)).toEqual(["очень", "длинное"])
    expect(words[0]).toMatchObject({ startSec: 0.6, endSec: 1.0 })
  })

  it("сохраняет реальную неравномерность длительностей", () => {
    const words = wordsForChunk({
      words: SCENE_WORDS,
      chunkText: "короткое и",
      chunkStartSec: 0,
      chunkEndSec: 0.6,
    })

    // Союз звучит 0.1 с — равномерная оценка дала бы ему 0.3 и увела бы
    // караоке-подсветку.
    expect(words[1]!.endSec - words[1]!.startSec).toBeCloseTo(0.1, 3)
  })

  it("возвращает пустой список, когда слова чанка не нашлись", () => {
    const words = wordsForChunk({
      words: SCENE_WORDS,
      chunkText: "совсем другое",
      chunkStartSec: 0,
      chunkEndSec: 1,
    })

    // Пустой список — сигнал билдеру оценить тайминги по-старому, а не повод
    // подсветить случайные слова.
    expect(words).toEqual([])
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/subtitles/aligned-words.spec.ts`
Expected: FAIL — модуль не существует.

- [ ] **Step 3: Написать раскладку и подключить её**

Создать `server/utils/subtitles/aligned-words.ts` с функцией `wordsForChunk`: она ищет в словах сцены непрерывный отрезок, чьи тексты совпадают со словами чанка (сравнение по той же нормализации, что в `align.ts`), и возвращает их границы; при неудаче — пустой список.

В `server/utils/render.ts:1260-1294` пробросить в `buildAssSegments` выровненные сцены и для каждого чанка заполнять `words: wordsForChunk(...)`. Если выравнивание отсутствует или вернуло пусто — поле не заполняется, и билдер работает как сегодня (`estimateWordTimings`).

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/subtitles/aligned-words.spec.ts`
Expected: PASS, 3 теста.

- [ ] **Step 5: Коммит**

```bash
git add server/utils/subtitles/aligned-words.ts server/utils/render.ts tests/unit/subtitles/aligned-words.spec.ts
git commit -m "feat: субтитры берут тайминги слов из выравнивания"
```

---

### Task 12: Флаг маршрута

**Files:**
- Modify: `server/utils/video-pipeline-run-policy.ts`
- Modify: `server/api/videos/generate.post.ts`
- Modify: `.env.example`
- Test: `tests/unit/transcription/route-flag.spec.ts`

**Interfaces:**
- Consumes: ничего.
- Produces: `resolveEditPipelineFlag(env: Record<string, string | undefined>): boolean`

- [ ] **Step 1: Написать падающий тест**

Создать `tests/unit/transcription/route-flag.spec.ts`:

```ts
import { describe, expect, it } from "vitest"

import { resolveEditPipelineFlag } from "~~/server/utils/video-pipeline-run-policy"

describe("флаг маршрута производства", () => {
  it("выключен по умолчанию — старый маршрут основной до canary", () => {
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
Expected: FAIL — функция не экспортируется.

- [ ] **Step 3: Написать разбор флага**

В `server/utils/video-pipeline-run-policy.ts`:

```ts
/** Значения, которыми маршрут включают осознанно. Всё прочее — выключено. */
const TRUTHY = new Set(["1", "on", "true", "yes"])

/**
 * Флаг читается ОДИН раз — при создании ролика, дальше живёт на ролике
 * (`Video.editPipeline`). Перечитывать его на каждом шаге нельзя: смена
 * переменной посреди производства собрала бы половину ролика по одним
 * правилам, половину по другим (spec §3.1).
 */
export function resolveEditPipelineFlag(env: Record<string, string | undefined>): boolean {
  return TRUTHY.has((env.EDIT_PIPELINE ?? "").trim().toLowerCase())
}
```

- [ ] **Step 4: Зафиксировать маршрут при создании ролика**

В `server/api/videos/generate.post.ts` при создании `Video`:

```ts
      editPipeline: resolveEditPipelineFlag(process.env),
```

- [ ] **Step 5: Описать флаг в примере окружения**

В `.env.example` (рядом с прочими переключателями контура, например с блоком `*_MOCK_MODE`):

```
# Маршрут производства ролика. on — audio-first: единый трек озвучки,
# транскрипция, монтаж по границам слов
# (docs/superpowers/specs/2026-08-16-audio-first-editing-design.md).
# Пусто/off — прежний посценный маршрут. Значение фиксируется на ролике при создании.
EDIT_PIPELINE=
```

- [ ] **Step 6: Запустить тест и убедиться, что он проходит**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/transcription/route-flag.spec.ts`
Expected: PASS, 3 теста.

- [ ] **Step 7: Коммит**

```bash
git add server/utils/video-pipeline-run-policy.ts server/api/videos/generate.post.ts .env.example tests/unit/transcription/route-flag.spec.ts
git commit -m "feat: маршрут audio-first за флагом EDIT_PIPELINE, зафиксированным на ролике"
```

---

### Task 13: Прогон маршрута целиком на моках

Модульные тесты не доказывают, что маршрут собирает ролик. Нужна проверка сквозного прохода без единого платного вызова.

**Files:**
- Create: `tests/integration/audio-first-pipeline.spec.ts`

**Interfaces:**
- Consumes: весь маршрут.
- Produces: ничего.

- [ ] **Step 1: Написать интеграционный тест**

Создать `tests/integration/audio-first-pipeline.spec.ts`. Тест поднимает ролик с `editPipeline: true` в тестовой БД, включает мок-режимы (`REPLICATE_MOCK_MODE`, `ANTHROPIC_MOCK_MODE`, `FAL_MOCK_MODE`) и проверяет:

```ts
// 1. Шаги выполнены в порядке audio-first
expect(stepKeysInExecutionOrder).toEqual([
  "prompt_generation",
  "voiceover_generation",
  "transcription",
  "image_generation",
  "clip_generation",
  "lip_sync_generation",
  "music_generation",
  "assembly",
])

// 2. Озвучка синтезирована ОДИН раз
expect(voiceoverAssets).toHaveLength(1)

// 3. Транскрипт сохранён и переживает повтор прогона
expect(transcriptAsset).toBeTruthy()

// 4. Повторный прогон не создал новых оплаченных задач
expect(secondRunGeneratedCount).toBe(0)

// 5. Финальный файл существует и его длина совпадает с длиной трека
expect(Math.abs(finalDurationSec - trackDurationSec)).toBeLessThan(0.5)
```

- [ ] **Step 2: Запустить тест**

Run: `bunx vitest run tests/integration/audio-first-pipeline.spec.ts`
Expected: PASS. Тест требует тестовой БД — см. `docs/operations/running-db-tests.md`. Прогон ожидаемо занимает минуты, это нормально.

- [ ] **Step 3: Коммит**

```bash
git add tests/integration/audio-first-pipeline.spec.ts
git commit -m "test: сквозной прогон маршрута audio-first на моках"
```

---

### Task 14: Canary на реальных деньгах

`AGENTS.md`: платные вызовы начинаются с одного canary job, готовность интеграции не заявляется без реального подтверждения. Спека §12 требует слепого сравнения со старым маршрутом, бюджет — до $20.

**Files:**
- Create: `docs/operations/audio-first-canary-2026-08.md`

**Interfaces:** нет.

- [ ] **Step 1: Подтвердить тариф модели транскрипции**

Открыть страницу модели на Replicate, взять цену, внести в спеку `REPLICATE_WHISPER` (`billing`, `billingConfirmed: true`, `integrated: true`). Пока цена не подтверждена — маршрут работает с деградацией транскрипции и canary не имеет смысла.

- [ ] **Step 2: Снять реальную схему входа**

С токеном получить схему модели (`https://api.replicate.com/v1/models/<owner>/<name>` с заголовком авторизации) и сверить имена полей `audio`, `language`, `word_timestamps` с фактическими. Расхождения править в `mapInput` спеки — больше нигде правки не потребуются.

- [ ] **Step 3: Прогнать один ролик новым маршрутом**

`EDIT_PIPELINE=on`, один ролик, `ENABLE_PAID_APIS=true`. Записать: фактическую стоимость по шагам, длительность трека и финального файла, число оплаченных задач.

- [ ] **Step 4: Прогнать тот же сценарий старым маршрутом**

`EDIT_PIPELINE` выключен, тот же сценарий и тот же персонаж.

- [ ] **Step 5: Сравнить и записать результат**

Создать `docs/operations/audio-first-canary-2026-08.md` со сравнением по пунктам: слышны ли стыки, попадают ли субтитры в слово, есть ли двойная речь, совпала ли смета с фактом, сколько стоил каждый маршрут. Вывод — можно ли включать маршрут по умолчанию.

- [ ] **Step 6: Коммит**

```bash
git add docs/operations/audio-first-canary-2026-08.md server/utils/media-provider/model-specs.ts
git commit -m "docs: canary маршрута audio-first — сравнение со старым маршрутом"
```

---

## Что этот план сознательно НЕ делает

Границы работы. Всё перечисленное — предмет следующих планов:

- **Хранение записей ведущего и нарезка под длину речи** (§6.1–6.2 спеки) — план 2. До него длину кадра задаёт подбор готового клипа, а расхождение с речью подчищает `planDurationFit` (Task 10). `adjustAudioTempo` остаётся в коде для старого маршрута.
- **План монтажа, `EditProfile`, `BackgroundClip`, `VideoShot`, PiP, фоны и потолок стоимости** (§5, §7) — план 3.
- **Локальная замена сегмента и UI** (§4.5, §9) — план 4. До него правка одной фразы означает пересинтез всего трека, и это осознанно дорого.
- **Потерянный в `shared/types/video.ts` шаг `lip_sync_generation`** — давний дефект UI, не относящийся к этой работе. Трогать его здесь значит смешивать две правки в одном коммите.
