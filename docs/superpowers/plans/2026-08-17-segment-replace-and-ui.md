# Локальная замена сегмента и интерфейс монтажа — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Правка одной фразы перестаёт стоить как новый ролик: фраза пересинтезируется отдельно и вклеивается в трек по паузам, пересобираются только сдвинувшиеся кадры. Оператор получает интерфейс, где всё это видно и управляемо — клон голоса, библиотека фонов, монтажный профиль, таблица кадров и пошаговый режим, который ждёт решения **вне** прогона.

**Architecture:** Локальная замена — чистое планирование точки вклейки (ближайшая тишина с обеих сторон, притяжка к границе кадра, кроссфейд в несколько миллисекунд) плюс ffmpeg-склейка и пересчёт выравнивания арифметикой: слова после точки вклейки сдвигаются на дельту длительности, пересинтезированный кусок получает свои границы из повторной транскрипции только его. Кадры, чьи границы сдвинулись, помечаются на пересборку; остальные и их lip-sync остаются оплаченными один раз. Клонирование голоса переезжает из скрипта в медиареестр отдельной способностью с подтверждением суммы. Пошаговый режим не держит процесс: шаг доводится до конца, ролик уходит в статус ожидания, блокировка отпускается, процесс завершается; «принять» запускает **новый** прогон, который поднимает состояние из снапшотов.

**Tech Stack:** Nuxt 4 / Nitro, Bun, TypeScript, Prisma + PostgreSQL 16, Vitest (DB-free — `vitest.pure.config.ts`, с БД — `vitest.config.ts`, HTTP — `tests/api`), Playwright для дизайн-флоу, FFmpeg через `fluent-ffmpeg`, Replicate как основной медиапровайдер.

**Spec:** `docs/superpowers/specs/2026-08-16-audio-first-editing-design.md` (§4.5, §4.6, §9; план работ §11 пункты 9a, 10)

**Предшествующие планы:**
- `docs/superpowers/plans/2026-08-16-audio-first-timing.md` — выполнен: единый трек, транскрипция, выравнивание, маркеры пауз, вырезка кусков.
- `docs/superpowers/plans/2026-08-17-audio-first-preflight.md` — семь задач до включения флага. **Этот план идёт после него**, и Task 4 здесь прямо опирается на его Task 2 (fallback длительности в `insert-pauses.ts`).
- `docs/superpowers/plans/2026-08-17-edit-plan-backgrounds-pip.md` (план 3) — **обязателен для Task 7** (форма профиля и таблица кадров рисуют `EditProfile` и `VideoShot`). Задачи 1-6 от него не зависят.

## Global Constraints

- Пакетный менеджер — **Bun**, не npm (`AGENTS.md`). Тесты: `bunx vitest run ...`.
- БД меняется **только миграциями**, `prisma db push` запрещён.
- Replicate — основной провайдер; fal только как явно настроенный fallback.
- Модель без цены, подтверждённой страницей модели, остаётся `integrated: false` и в смету не попадает.
- **Все долгие и платные операции идемпотентны и переживают рестарт процесса** (`AGENTS.md`). Повторный заход не платит второй раз и не теряет уже полученный результат.
- **Платные вызовы начинаются с одного canary job**; готовность интеграции не заявляется без реального или контрактного подтверждения (`AGENTS.md`).
- Комментарии и сообщения об ошибках — по-русски, как в окружающем коде.
- Не создавать файлы-монстры: новая логика живёт отдельными модулями в `server/utils/voiceover/`.
- DB-free тесты должны попадать в `vitest.pure.config.ts` — там явный `include`.
- Старый маршрут не ломается и не удаляется: он остаётся основным до canary-сравнения (§2 спеки).
- Новые экраны идут через `$design-feature`: сначала макет в `design-preview`, потом интеграция **отдельной задачей** (`AGENTS.md`, §9 спеки).

## Решения, которые этот план не переоткрывает

Из `docs/operations/handoff-2026-08-17-audio-first.md` §4 — все семь. Прямо относятся к этому плану:

- **№2** маршрут начатого ролика не меняется задним числом: локальная замена работает только на ролике, у которого единый трек уже есть, и не переводит его на посценный синтез;
- **№3** ключ переиспользования куска считается по границам, притянутым к кадру: после вклейки границы пересчитываются и притягиваются той же `snapSecToFrame`, иначе весь ролик переоплатит lip-sync;
- **№4** короткий кусок добивается тишиной, а не растягивается по треку;
- **№5** длительность трека измеряется ffprobe: длительность склеенного трека меряется заново, а не выводится сложением.

Отдельно: **отпечаток трека (`trackFingerprint`) после вклейки меняется обязательно** — он считается по байтам финального файла (`video-pipeline-steps.ts:2122`), и это ровно тот механизм, который обесценивает куски. Задача плана — не обойти его, а пересобрать только те кадры, чьи границы действительно сдвинулись.

## Что уже проверено фактически (не перепроверять)

Снято с кода при подготовке плана:

- **Маркеры пауз реализованы целиком.** `buildTrackRequest` (`server/utils/voiceover/track-builder.ts:45`) вынимает `[пауза 2с]` из текста и отдаёт `pauses: TrackPause[]` плюс очищенные сцены; `insertVoiceoverPauses` (`server/utils/voiceover/insert-pauses.ts:151`) режет трек `atrim`, вставляет `anullsrc` нужной длины и склеивает `concat`; `runSingleTrackVoiceover` (`video-pipeline-steps.ts:1834-1851`) вызывает вставку и пишет в лог, сколько пауз вставлено и для каких сцен точки не нашлось. То есть §4.6 закрыт, и переписывать его не надо — см. Task 4 про то, что осталось.
- Точка вставки паузы оценивается **по доле символов** текста сцен до маркера (`planPauseSplit`, `insert-pauses.ts:59-90`) — это осознанное приближение, задокументированное в шапке модуля: точных таймингов на шаге озвучки ещё нет, они появляются только после выравнивания.
- `snapSecToFrame(sec, fps)` и `trackEndFrame(trackDurationSec, fps)` экспортируются из `server/utils/voiceover/segment-cut.ts`; `segmentIdentity` там же считает ключ куска по `videoId`, `sceneOrder`, границам, `trackFingerprint` и добивке тишиной.
- `hasAudioFirstTrack(videoId)` (`video-pipeline-steps.ts:1940`) отвечает, начинали ли ролик собирать от звука — по снапшоту шага озвучки формата `{ route: "audio_first", ... }`.
- Транскрипт кэшируется в снапшоте шага по `trackFingerprint` (`video-pipeline-steps.ts:2296-2297`): при смене отпечатка транскрипция пойдёт заново.
- `synthesizeSpeech(options: TtsSynthesisOptions)` (`server/utils/tts.ts:98`) принимает `text`, `outputPath`, `modelId`, `voiceId`, `language`, `pacing`, `emotion`, `videoId` и возвращает `audioPath`, `durationSec`, `costUsd`, `characters`.
- `probeAudioDuration(path)` (`server/utils/tts.ts:66`) при ошибке ffprobe **возвращает 0, а не бросает** — это ровно тот дефект, который чинит Task 2 плана preflight; здесь на него опираться нельзя без проверки.
- `detectSilenceRanges(videoPath, { noiseDb, minSilenceSec })` и `parseSilenceRangesFromStderr(stderr)` — `server/utils/video-tools/silence-detect.ts:114,49`; дефолты `DEFAULT_SILENCE_NOISE_DB = -30`, `DEFAULT_MIN_SILENCE_SEC = 0.4`.
- `scripts/clone-voice.ts` — рабочая реализация клонирования: модель `minimax/voice-cloning`, **$3 за успешный прогон** (тариф со страницы модели, `generic_output_count`), требования MP3/M4A/WAV, 10 с — 5 мин, меньше 20 МБ, и отдельная находка: Files API отдаёт ссылку без расширения, а MiniMax определяет формат по нему, поэтому нужен URL, оканчивающийся на `.mp3`/`.m4a`/`.wav`.
- `Character.voiceId` и `Character.voiceModelId` уже есть в схеме (`prisma/schema.prisma:270-271`) с комментарием, что клон обучается **под конкретную модель**.
- Ветка исполнения `sync_json` уже написана (`server/utils/media-provider/run-media-task.ts`, `MediaExecution` в `types.ts:36`) — способность с JSON-выходом добавляется без нового транспорта.
- `MediaBilling` знает единицу `flat` (`run-media-task.ts` проверяет `spec.billing.unit !== "flat" || spec.billing.usd > 0` в гейте платных вызовов).
- `VideoStatus` (`prisma/schema.prisma:543-557`) — 13 значений, статуса ожидания оператора среди них нет.
- `RESUMABLE_VIDEO_STATUSES` (`server/utils/video-pipeline-run-policy.ts:457`) перечисляет промежуточные статусы; watchdog (`server/plugins/video-recovery.ts:83,129`) **фильтрует кандидатов прямо в SQL по этому списку**, поэтому новый статус вне списка он не увидит вовсе — отдельной защиты не требуется.
- `runVideoPipeline` (`video-pipeline.ts:268`) берёт блокировку `acquireLock(videoId)` и бросает «уже запущен», если она занята; завершённые шаги переиспользуются по снапшотам, поэтому «продолжить» — это просто новый вызов `runVideoPipeline`.
- `resumeVideoPipeline` (`video-pipeline.ts:1349`) сбрасывает шаги в `failed`/`timeout`, ставит ролик в `pending` и запускает пайплайн — образец для «принять и продолжить».
- Страницы UI: `app/pages/characters/[id].vue`, `app/pages/videos/[id].vue`; компоненты `app/components/character/CharacterPresenterSourceClips.vue`, `app/components/video/VideoStepsPanel.vue`.
- `design-preview/_system` существует (`tokens.css`, `blocks/` с готовыми блоками `EntityTable`, `Field`, `Drawer`, `EmptyState` и др.) — по `AGENTS.md` его map, glossary, components и tokens читаются **первыми**.

## File Structure

**Создаётся:**

| Файл | Ответственность |
|---|---|
| `server/utils/voiceover/segment-splice.ts` | Чистое планирование точки вклейки и аргументов ffmpeg |
| `server/utils/voiceover/alignment-shift.ts` | Пересчёт выравнивания после вклейки и список сдвинувшихся сцен |
| `server/utils/voiceover/segment-replace-runner.ts` | Раннер замены: синтез фразы, склейка, пересчёт, инвалидация кадров |
| `server/api/videos/[id]/voiceover/replace-segment.post.ts` | Замена одной фразы |
| `server/api/videos/[id]/voiceover/regenerate-track.post.ts` | Перегенерация всего трека с подтверждением |
| `server/api/characters/[id]/clone-voice.post.ts` | Клон голоса с подтверждением суммы |
| `server/api/videos/[id]/approve-step.post.ts` | «Принять» в пошаговом режиме |
| `server/api/videos/[id]/shots/[shotId]/regenerate.post.ts` | Перегенерация одного кадра |
| `server/utils/video-pipeline-stepwise.ts` | Чистое правило: ждать ли после шага и что писать в ролик |
| `prisma/migrations/20260820000000_add_stepwise_and_voice_sample/migration.sql` | Статус ожидания, поля ролика и персонажа |
| `tests/unit/voiceover/segment-splice.spec.ts` | Тесты точки вклейки |
| `tests/unit/voiceover/alignment-shift.spec.ts` | Тесты пересчёта выравнивания |
| `tests/unit/media-provider/voice-cloning-spec.spec.ts` | Спека клонирования и маршрут |
| `tests/unit/fixes/stepwise-wait.spec.ts` | Тесты правила ожидания |
| `tests/integration/segment-replace.spec.ts` | С БД: пересобираются только сдвинувшиеся кадры |
| `tests/integration/stepwise-approval.spec.ts` | С БД: ролик в ожидании не держит блокировку |
| `design-preview/catalog/09-edit-console.dc.html` | Макет монтажной консоли |

**Модифицируется:**

| Файл | Что меняется |
|---|---|
| `prisma/schema.prisma` | `VideoStatus.awaiting_operator`, `Video.stepwiseApproval`/`awaitingStepKey`, `Character.voiceSampleSha1` |
| `server/utils/media-provider/types.ts` | Способность `voice_cloning`, вход, ограничения, спека |
| `server/utils/media-provider/registry.ts` | Способность в списке и env-ключи |
| `server/utils/media-provider/model-specs.ts` | Спека `replicate:minimax-voice-cloning` |
| `server/utils/video-pipeline.ts` | Пауза после шага в пошаговом режиме |
| `server/utils/video-pipeline-run-policy.ts` | Статус ожидания рядом с `RESUMABLE_VIDEO_STATUSES` |
| `app/components/video/VideoStatusMap.ts` | Статус ожидания в карте |
| `shared/types/video.ts` | Статус ожидания во второй копии типов |
| `app/pages/characters/[id].vue`, `app/pages/videos/[id].vue` | Интеграция новых экранов |
| `vitest.pure.config.ts` | Каталог уже включён (`tests/unit/voiceover/**`) |

---

### Task 1: Точка вклейки — чистое планирование

Ядро §4.5. Оператор правит одну фразу — синтезируется только она и вклеивается по границам пауз: ближайшее тихое место с обеих сторон, притяжка к границе кадра, кроссфейд в несколько миллисекунд.

**Files:**
- Create: `server/utils/voiceover/segment-splice.ts`
- Test: `tests/unit/voiceover/segment-splice.spec.ts`

**Interfaces:**
- Consumes: `snapSecToFrame`, `trackEndFrame` (`server/utils/voiceover/segment-cut.ts`); `SilenceRange` (`server/utils/video-tools/silence-detect.ts`).
- Produces:
  - `planSegmentSplice(input: SpliceInput): SplicePlan | null`
  - `SpliceInput { sceneStartSec: number, sceneEndSec: number, trackDurationSec: number, fps: number, silences: readonly SilenceRange[], crossfadeSec?: number }`
  - `SplicePlan { cutStartSec: number, cutEndSec: number, crossfadeSec: number, anchoredToSilence: { start: boolean, end: boolean } }`
  - `buildSpliceFilters(plan: SplicePlan, replacementDurationSec: number, trackDurationSec: number): string[]`
  - `DEFAULT_SPLICE_CROSSFADE_SEC`

- [ ] **Step 1: Написать падающий тест**

Создать `tests/unit/voiceover/segment-splice.spec.ts`:

```ts
import { describe, expect, it } from "vitest"

import { buildSpliceFilters, planSegmentSplice } from "~~/server/utils/voiceover/segment-splice"

const SILENCES = [
  { startSec: 3.8, endSec: 4.2 },
  { startSec: 9.5, endSec: 10.1 },
]

function input(overrides: Record<string, unknown> = {}) {
  return {
    sceneStartSec: 4.0,
    sceneEndSec: 9.8,
    trackDurationSec: 20,
    fps: 30,
    silences: SILENCES,
    ...overrides,
  }
}

describe("планирование вклейки пересинтезированной фразы", () => {
  it("режет по серединам ближайших пауз, а не по границам сцены", () => {
    // Край паузы — это первый звук соседней фразы. Середина оставляет запас
    // тишины с обеих сторон, и склейка не слышна.
    const plan = planSegmentSplice(input())!

    expect(plan.cutStartSec).toBeGreaterThanOrEqual(3.8)
    expect(plan.cutStartSec).toBeLessThanOrEqual(4.2)
    expect(plan.cutEndSec).toBeGreaterThanOrEqual(9.5)
    expect(plan.cutEndSec).toBeLessThanOrEqual(10.1)
    expect(plan.anchoredToSilence).toEqual({ start: true, end: true })
  })

  it("притягивает точки реза к границе кадра", () => {
    const plan = planSegmentSplice(input())!

    expect(Math.abs(plan.cutStartSec * 30 - Math.round(plan.cutStartSec * 30))).toBeLessThan(1e-6)
    expect(Math.abs(plan.cutEndSec * 30 - Math.round(plan.cutEndSec * 30))).toBeLessThan(1e-6)
  })

  it("без подходящей паузы режет по границе сцены и говорит об этом", () => {
    const plan = planSegmentSplice(input({ silences: [] }))!

    expect(plan.cutStartSec).toBeCloseTo(4.0, 2)
    expect(plan.cutEndSec).toBeCloseTo(9.8, 2)
    expect(plan.anchoredToSilence).toEqual({ start: false, end: false })
  })

  it("не берёт паузу дальше допуска — это уже чужая фраза", () => {
    // Пауза в 2 секундах от границы сцены принадлежит соседней реплике:
    // вклейка по ней стёрла бы чужой текст.
    const plan = planSegmentSplice(input({ silences: [{ startSec: 1.5, endSec: 2.0 }] }))!

    expect(plan.anchoredToSilence.start).toBe(false)
  })

  it("не вылезает за начало и конец трека", () => {
    const plan = planSegmentSplice(input({
      sceneStartSec: 0, sceneEndSec: 20, trackDurationSec: 20, silences: [],
    }))!

    expect(plan.cutStartSec).toBeGreaterThanOrEqual(0)
    expect(plan.cutEndSec).toBeLessThanOrEqual(20)
  })

  it("отказывает на бессмысленном интервале", () => {
    expect(planSegmentSplice(input({ sceneStartSec: 9, sceneEndSec: 4 }))).toBeNull()
    expect(planSegmentSplice(input({ trackDurationSec: 0 }))).toBeNull()
  })

  it("кроссфейд короткий и не съедает речь", () => {
    const plan = planSegmentSplice(input())!

    expect(plan.crossfadeSec).toBeGreaterThan(0)
    expect(plan.crossfadeSec).toBeLessThanOrEqual(0.05)
  })

  it("собирает граф склейки из трёх кусков", () => {
    const plan = planSegmentSplice(input())!
    const graph = buildSpliceFilters(plan, 6.2, 20).join(";")

    // Голова трека, новая фраза, хвост трека.
    expect(graph).toContain("atrim=0")
    expect(graph).toContain("acrossfade")
    expect(graph).toMatch(/\[aout\]$/)
  })

  it("не строит голову, когда резать начинают с нуля", () => {
    const plan = planSegmentSplice(input({ sceneStartSec: 0, sceneEndSec: 5, silences: [] }))!
    const graph = buildSpliceFilters(plan, 4, 20).join(";")

    // Пустой кусок в concat даёт ffmpeg-ошибку, а не пустой звук.
    expect(graph).not.toContain("atrim=0.000:0.000")
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/voiceover/segment-splice.spec.ts`
Expected: FAIL — модуль не существует.

- [ ] **Step 3: Написать планирование**

Создать `server/utils/voiceover/segment-splice.ts`:

```ts
/**
 * Локальная замена куска трека озвучки.
 *
 * Инструмент починки, а не основной путь (spec §4.5). Оператор правит одну
 * фразу — синтезируется ТОЛЬКО она и вклеивается в трек по границам пауз.
 * Альтернатива — пересинтез всего трека, а он обесценивает все аватарные кадры
 * ролика: TTS ~$0.07, lip-sync ~$0.7, то есть правка слова стоила бы как новый
 * ролик.
 *
 * Точки реза ищутся по ТИШИНЕ, а не по границам выравнивания. Граница
 * выравнивания — это конец слова, то есть звук ещё идёт; рез там даёт щелчок.
 * Середина паузы оставляет запас тишины с обеих сторон.
 *
 * Функция чистая: тишины приходят от `detectSilenceRanges`, процесс здесь не
 * запускается (по образцу `planPauseSplit` и `planSegmentCut`).
 */

import type { SilenceRange } from "../video-tools/silence-detect"
import { snapSecToFrame, trackEndFrame } from "./segment-cut"

/** Кроссфейд на стыке. Несколько миллисекунд: длиннее — съест начало слова. */
export const DEFAULT_SPLICE_CROSSFADE_SEC = 0.02

/**
 * Насколько далеко от границы сцены разрешено искать паузу.
 *
 * Дальше — это уже пауза соседней реплики, и вклейка по ней стёрла бы чужой
 * текст. Полсекунды примерно равны длине одного слова.
 */
const SILENCE_SEARCH_RADIUS_SEC = 0.6

export interface SpliceInput {
  /** Границы заменяемой сцены из выравнивания. */
  sceneStartSec: number
  sceneEndSec: number
  /** Измеренная ffprobe длительность трека. */
  trackDurationSec: number
  fps: number
  silences: readonly SilenceRange[]
  crossfadeSec?: number
}

export interface SplicePlan {
  /** Откуда вырезаем старое. */
  cutStartSec: number
  /** До какой секунды вырезаем. */
  cutEndSec: number
  crossfadeSec: number
  /** Нашлась ли пауза с каждой стороны. false — резали по границе сцены. */
  anchoredToSilence: { start: boolean, end: boolean }
}

/** Середина ближайшей паузы в пределах радиуса поиска. null — такой паузы нет. */
function nearestSilenceMid(
  silences: readonly SilenceRange[],
  atSec: number,
  fps: number,
): number | null {
  let best: number | null = null
  let bestDistance = SILENCE_SEARCH_RADIUS_SEC

  for (const silence of silences) {
    if (!Number.isFinite(silence.startSec) || !Number.isFinite(silence.endSec)) continue
    if (silence.endSec <= silence.startSec) continue
    const mid = (silence.startSec + silence.endSec) / 2
    const distance = Math.abs(mid - atSec)
    if (distance <= bestDistance) {
      bestDistance = distance
      best = snapSecToFrame(mid, fps)
    }
  }

  return best
}

export function planSegmentSplice(input: SpliceInput): SplicePlan | null {
  const { fps, sceneEndSec, sceneStartSec, trackDurationSec } = input
  if (!Number.isFinite(trackDurationSec) || trackDurationSec <= 0) return null
  if (!Number.isFinite(sceneStartSec) || !Number.isFinite(sceneEndSec)) return null
  if (sceneEndSec <= sceneStartSec) return null

  const trackEnd = trackEndFrame(trackDurationSec, fps)

  const startAnchor = nearestSilenceMid(input.silences, sceneStartSec, fps)
  const endAnchor = nearestSilenceMid(input.silences, sceneEndSec, fps)

  const cutStartSec = Math.max(0, startAnchor ?? snapSecToFrame(sceneStartSec, fps))
  const cutEndSec = Math.min(trackEnd, endAnchor ?? snapSecToFrame(sceneEndSec, fps))
  if (cutEndSec <= cutStartSec) return null

  return {
    cutStartSec,
    cutEndSec,
    crossfadeSec: input.crossfadeSec ?? DEFAULT_SPLICE_CROSSFADE_SEC,
    anchoredToSilence: { start: startAnchor !== null, end: endAnchor !== null },
  }
}

/**
 * Граф `filter_complex` склейки: голова трека, новая фраза, хвост трека.
 *
 * Кроссфейд `acrossfade` вместо `concat` на стыках: даже при резе по тишине
 * уровни двух записей отличаются, и прямая склейка даёт слышимую ступеньку.
 * Вход 0 — исходный трек, вход 1 — пересинтезированная фраза.
 *
 * Пустые куски не создаются вовсе: `atrim=0:0` в concat это ошибка ffmpeg, а не
 * «ничего».
 */
export function buildSpliceFilters(
  plan: SplicePlan,
  replacementDurationSec: number,
  trackDurationSec: number,
): string[] {
  const filters: string[] = []
  const labels: string[] = []

  const hasHead = plan.cutStartSec > 0
  const hasTail = plan.cutEndSec < trackDurationSec

  if (hasHead) {
    filters.push(`[0:a]atrim=0:${plan.cutStartSec.toFixed(3)},asetpts=N/SR/TB[head]`)
    labels.push("[head]")
  }

  filters.push(`[1:a]atrim=0:${replacementDurationSec.toFixed(3)},asetpts=N/SR/TB[mid]`)
  labels.push("[mid]")

  if (hasTail) {
    filters.push(
      `[0:a]atrim=${plan.cutEndSec.toFixed(3)}:${trackDurationSec.toFixed(3)},asetpts=N/SR/TB[tail]`,
    )
    labels.push("[tail]")
  }

  // Склейка попарно кроссфейдом: acrossfade принимает ровно два входа.
  let current = labels[0]!
  for (let index = 1; index < labels.length; index += 1) {
    const output = index === labels.length - 1 ? "[aout]" : `[mix${index}]`
    filters.push(
      `${current}${labels[index]}acrossfade=d=${plan.crossfadeSec.toFixed(3)}:c1=tri:c2=tri${output}`,
    )
    current = output
  }
  if (labels.length === 1) filters.push(`${current}anull[aout]`)

  return filters
}
```

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/voiceover/segment-splice.spec.ts`
Expected: PASS, 9 тестов.

- [ ] **Step 5: Коммит**

```bash
git add server/utils/voiceover/segment-splice.ts tests/unit/voiceover/segment-splice.spec.ts
git commit -m "feat: планирование вклейки пересинтезированной фразы по паузам"
```

---

### Task 2: Пересчёт выравнивания и список сдвинувшихся кадров

После вклейки трек стал другой длины. Слова до точки вклейки не сдвинулись ни на миллисекунду, слова после сдвинулись ровно на дельту — это арифметика, а не повторная транскрипция всего трека. Пересобирать надо только те сцены, чьи границы действительно изменились.

**Files:**
- Create: `server/utils/voiceover/alignment-shift.ts`
- Test: `tests/unit/voiceover/alignment-shift.spec.ts`

**Interfaces:**
- Consumes: `AlignedScene`, `AlignedWord` (`server/utils/transcription/align`); `SplicePlan` (Task 1); `snapSecToFrame`.
- Produces:
  - `shiftAlignmentAfterSplice(input: ShiftInput): ShiftResult`
  - `ShiftInput { scenes: readonly AlignedScene[], plan: SplicePlan, replacementScene: AlignedScene, replacementDurationSec: number, fps: number }`
  - `ShiftResult { scenes: AlignedScene[], deltaSec: number, movedSceneOrders: number[] }`

- [ ] **Step 1: Написать падающий тест**

Создать `tests/unit/voiceover/alignment-shift.spec.ts`:

```ts
import { describe, expect, it } from "vitest"

import { shiftAlignmentAfterSplice } from "~~/server/utils/voiceover/alignment-shift"

function scene(order: number, startSec: number, endSec: number) {
  return {
    order,
    startSec,
    endSec,
    words: [{ text: `сцена${order}`, startSec, endSec, matched: true }],
  }
}

const SCENES = [scene(1, 0, 3.9), scene(2, 4.0, 9.8), scene(3, 10.0, 15.0)]

const PLAN = {
  cutStartSec: 4.0,
  cutEndSec: 9.8,
  crossfadeSec: 0.02,
  anchoredToSilence: { start: true, end: true },
}

describe("пересчёт выравнивания после вклейки", () => {
  it("сцены до вклейки не двигаются вовсе", () => {
    const result = shiftAlignmentAfterSplice({
      scenes: SCENES,
      plan: PLAN,
      replacementScene: scene(2, 0, 6.2),
      replacementDurationSec: 6.2,
      fps: 30,
    })

    expect(result.scenes[0]).toMatchObject({ order: 1, startSec: 0, endSec: 3.9 })
    expect(result.movedSceneOrders).not.toContain(1)
  })

  it("сцены после вклейки сдвигаются на дельту длительности", () => {
    // Было 5.8 с, стало 6.2 — всё, что дальше, уезжает на +0.4.
    const result = shiftAlignmentAfterSplice({
      scenes: SCENES,
      plan: PLAN,
      replacementScene: scene(2, 0, 6.2),
      replacementDurationSec: 6.2,
      fps: 30,
    })

    expect(result.deltaSec).toBeCloseTo(0.4, 3)
    expect(result.scenes[2]!.startSec).toBeCloseTo(10.4, 2)
    expect(result.movedSceneOrders).toContain(3)
  })

  it("заменённая сцена получает границы из своего транскрипта", () => {
    const result = shiftAlignmentAfterSplice({
      scenes: SCENES,
      plan: PLAN,
      replacementScene: {
        order: 2,
        startSec: 0.1,
        endSec: 6.0,
        words: [
          { text: "новая", startSec: 0.1, endSec: 2.0, matched: true },
          { text: "фраза", startSec: 2.2, endSec: 6.0, matched: true },
        ],
      },
      replacementDurationSec: 6.2,
      fps: 30,
    })

    const replaced = result.scenes.find(s => s.order === 2)!
    // Границы слов внутри новой фразы — свои, но сдвинутые на точку вклейки.
    expect(replaced.words[0]!.startSec).toBeCloseTo(4.1, 2)
    expect(replaced.words[1]!.endSec).toBeCloseTo(10.0, 2)
  })

  it("при той же длине не двигается никто", () => {
    const result = shiftAlignmentAfterSplice({
      scenes: SCENES,
      plan: PLAN,
      replacementScene: scene(2, 0, 5.8),
      replacementDurationSec: 5.8,
      fps: 30,
    })

    expect(result.deltaSec).toBeCloseTo(0, 6)
    // Сама заменённая сцена в списке остаётся: её звук другой, и кадр надо
    // пересобрать даже при неизменной длине.
    expect(result.movedSceneOrders).toEqual([2])
  })

  it("границы притянуты к кадру — иначе весь ролик переоплатит lip-sync", () => {
    const result = shiftAlignmentAfterSplice({
      scenes: SCENES,
      plan: PLAN,
      replacementScene: scene(2, 0, 6.217),
      replacementDurationSec: 6.217,
      fps: 30,
    })

    for (const s of result.scenes) {
      expect(Math.abs(s.startSec * 30 - Math.round(s.startSec * 30))).toBeLessThan(1e-6)
      expect(Math.abs(s.endSec * 30 - Math.round(s.endSec * 30))).toBeLessThan(1e-6)
    }
  })

  it("порядок сцен сохраняется и хронология не ломается", () => {
    const result = shiftAlignmentAfterSplice({
      scenes: SCENES,
      plan: PLAN,
      replacementScene: scene(2, 0, 2.0),
      replacementDurationSec: 2.0,
      fps: 30,
    })

    expect(result.scenes.map(s => s.order)).toEqual([1, 2, 3])
    for (let i = 1; i < result.scenes.length; i += 1) {
      expect(result.scenes[i]!.startSec).toBeGreaterThanOrEqual(result.scenes[i - 1]!.endSec - 1e-6)
    }
  })

  it("сцены, целиком попавшие внутрь выреза, не остаются призраками", () => {
    // Вырез 4.0-9.8 накрывает сцену 2 целиком — заменённая занимает её место,
    // и второй записи о ней быть не должно.
    const result = shiftAlignmentAfterSplice({
      scenes: [...SCENES, scene(9, 5.0, 6.0)],
      plan: PLAN,
      replacementScene: scene(2, 0, 6.2),
      replacementDurationSec: 6.2,
      fps: 30,
    })

    expect(result.scenes.filter(s => s.order === 9)).toHaveLength(0)
    expect(result.movedSceneOrders).toContain(9)
  })
})
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/voiceover/alignment-shift.spec.ts`
Expected: FAIL — модуль не существует.

- [ ] **Step 3: Написать пересчёт**

Создать `server/utils/voiceover/alignment-shift.ts`:

```ts
/**
 * Границы слов после локальной замены сегмента.
 *
 * Транскрибировать весь трек заново незачем: до точки вклейки не изменился ни
 * один сэмпл, а после неё всё уехало ровно на разницу длительностей. Границы
 * внутри новой фразы приходят из транскрипции ТОЛЬКО ЕЁ — это один короткий
 * платный вызов вместо повторной разметки всего ролика.
 *
 * Границы притягиваются к кадру той же функцией, что и вырезка кусков:
 * ruling №3 хендоффа — ключ переиспользования куска считается по притянутым
 * границам, и дрожание в миллисекундах иначе переоплатит lip-sync всего ролика.
 *
 * Функция чистая и не мутирует вход.
 */

import type { AlignedScene, AlignedWord } from "../transcription/align"
import { snapSecToFrame } from "./segment-cut"
import type { SplicePlan } from "./segment-splice"

export interface ShiftInput {
  scenes: readonly AlignedScene[]
  plan: SplicePlan
  /** Транскрипт пересинтезированной фразы: границы отсчитаны от её начала. */
  replacementScene: AlignedScene
  /** Измеренная длительность пересинтезированного файла. */
  replacementDurationSec: number
  fps: number
}

export interface ShiftResult {
  scenes: AlignedScene[]
  /** Насколько удлинился (или укоротился) трек. */
  deltaSec: number
  /** Сцены, чьи кадры обязаны быть пересобраны. */
  movedSceneOrders: number[]
}

function shiftWords(words: readonly AlignedWord[], bySec: number, fps: number): AlignedWord[] {
  return words.map(word => ({
    ...word,
    startSec: snapSecToFrame(word.startSec + bySec, fps),
    endSec: snapSecToFrame(word.endSec + bySec, fps),
  }))
}

export function shiftAlignmentAfterSplice(input: ShiftInput): ShiftResult {
  const { fps, plan, replacementDurationSec, replacementScene } = input
  const removedSec = plan.cutEndSec - plan.cutStartSec
  const deltaSec = replacementDurationSec - removedSec

  const scenes: AlignedScene[] = []
  const movedSceneOrders: number[] = []

  // Заменённая сцена всегда в списке на пересборку: её звук другой даже тогда,
  // когда длина совпала до миллисекунды, а губы под старым звуком — брак.
  movedSceneOrders.push(replacementScene.order)

  for (const scene of input.scenes) {
    // Целиком до выреза: не двигается вовсе.
    if (scene.endSec <= plan.cutStartSec + 1e-6) {
      scenes.push({
        ...scene,
        startSec: snapSecToFrame(scene.startSec, fps),
        endSec: snapSecToFrame(scene.endSec, fps),
        words: shiftWords(scene.words, 0, fps),
      })
      continue
    }

    // Целиком после выреза: уезжает на дельту.
    if (scene.startSec >= plan.cutEndSec - 1e-6) {
      const shifted = {
        ...scene,
        startSec: snapSecToFrame(scene.startSec + deltaSec, fps),
        endSec: snapSecToFrame(scene.endSec + deltaSec, fps),
        words: shiftWords(scene.words, deltaSec, fps),
      }
      scenes.push(shifted)
      if (Math.abs(deltaSec) > 1e-6) movedSceneOrders.push(scene.order)
      continue
    }

    // Пересекается с вырезом. Заменённая сцена встаёт на место выреза со
    // своими границами; всё остальное, что попало внутрь, исчезает вместе с
    // вырезанным звуком — оставить его значило бы описывать несуществующий
    // отрезок трека.
    if (scene.order === replacementScene.order) {
      scenes.push({
        ...replacementScene,
        startSec: snapSecToFrame(plan.cutStartSec + replacementScene.startSec, fps),
        endSec: snapSecToFrame(plan.cutStartSec + replacementScene.endSec, fps),
        words: shiftWords(replacementScene.words, plan.cutStartSec, fps),
      })
      continue
    }

    movedSceneOrders.push(scene.order)
  }

  // Заменённой сцены могло не быть в исходном списке (её order уникален, но
  // выравнивание могло её пропустить) — тогда вставляем на место выреза.
  if (!scenes.some(scene => scene.order === replacementScene.order)) {
    scenes.push({
      ...replacementScene,
      startSec: snapSecToFrame(plan.cutStartSec + replacementScene.startSec, fps),
      endSec: snapSecToFrame(plan.cutStartSec + replacementScene.endSec, fps),
      words: shiftWords(replacementScene.words, plan.cutStartSec, fps),
    })
  }

  scenes.sort((a, b) => a.startSec - b.startSec)
  return { scenes, deltaSec, movedSceneOrders: [...new Set(movedSceneOrders)] }
}
```

- [ ] **Step 4: Запустить тест**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/voiceover/alignment-shift.spec.ts`
Expected: PASS, 7 тестов.

- [ ] **Step 5: Коммит**

```bash
git add server/utils/voiceover/alignment-shift.ts tests/unit/voiceover/alignment-shift.spec.ts
git commit -m "feat: пересчёт выравнивания после вклейки и список сдвинувшихся сцен"
```

---

### Task 3: Раннер замены сегмента и его API

Собирает всё вместе: синтез одной фразы, разметка тишины, склейка, повторная транскрипция **только новой фразы**, пересчёт выравнивания, инвалидация сдвинувшихся кадров. Пересобираются только они — остальные и их lip-sync остаются оплаченными один раз (§4.5).

**Files:**
- Create: `server/utils/voiceover/segment-replace-runner.ts`
- Create: `server/api/videos/[id]/voiceover/replace-segment.post.ts`
- Create: `server/api/videos/[id]/voiceover/regenerate-track.post.ts`
- Test: `tests/integration/segment-replace.spec.ts`

**Interfaces:**
- Consumes: `planSegmentSplice`, `buildSpliceFilters` (Task 1); `shiftAlignmentAfterSplice` (Task 2); `synthesizeSpeech` (`server/utils/tts.ts:98`); `detectSilenceRanges` (`server/utils/video-tools/silence-detect.ts:114`); `hasAudioFirstTrack` (`video-pipeline-steps.ts:1940`).
- Produces:
  - `replaceVoiceoverSegment(input: ReplaceSegmentInput, deps: ReplaceSegmentDeps): Promise<ReplaceSegmentResult>`
  - `ReplaceSegmentInput { videoId: number, sceneOrder: number, newText: string }`
  - `ReplaceSegmentResult { trackPath: string, trackDurationSec: number, trackFingerprint: string, deltaSec: number, invalidatedSceneOrders: number[], costUsd: number }`

- [ ] **Step 1: Написать падающий тест с БД**

Создать `tests/integration/segment-replace.spec.ts`. Проверяемое:

```ts
  it("пересобирает только сдвинувшиеся кадры", async () => {
    // Ролик с тремя сценами и готовым lip-sync. Меняем текст второй.
    // Кадр первой сцены обязан остаться нетронутым: его границы не сдвинулись,
    // и второй раз платить за него нельзя.
    const before = await lipSyncRecords(videoId)

    await replaceVoiceoverSegment({ videoId, sceneOrder: 2, newText: "Новая формулировка." }, deps)

    const after = await lipSyncRecords(videoId)
    expect(after.get(1)).toEqual(before.get(1))
    expect(after.get(2)).not.toEqual(before.get(2))
  })

  it("в таймлайне после замены нет дыр", async () => {
    const scenes = await alignedScenesOf(videoId)

    for (let i = 1; i < scenes.length; i += 1) {
      expect(scenes[i]!.startSec).toBeGreaterThanOrEqual(scenes[i - 1]!.endSec - 1e-6)
    }
  })

  it("длительность трека измерена, а не выведена сложением", async () => {
    // Ruling №5 хендоффа: трек — эталон времени, врать нельзя даже на
    // миллисекунды.
    const snapshot = await voiceoverSnapshot(videoId)
    const probed = await probeAudioDuration(snapshot.trackPath)

    expect(snapshot.durationSec).toBeCloseTo(probed, 2)
  })

  it("отказывает на ролике, который не собирали от звука", async () => {
    // Ruling №2: маршрут начатого ролика не меняется задним числом.
    await expect(replaceVoiceoverSegment({ videoId: legacyVideoId, sceneOrder: 1, newText: "x" }, deps))
      .rejects.toThrow(/от звука/i)
  })

  it("повторный вызов с тем же текстом не платит второй раз", async () => {
    const first = await replaceVoiceoverSegment({ videoId, sceneOrder: 2, newText: "Одинаковый текст." }, deps)
    const second = await replaceVoiceoverSegment({ videoId, sceneOrder: 2, newText: "Одинаковый текст." }, deps)

    expect(second.costUsd).toBe(0)
    expect(second.trackFingerprint).toBe(first.trackFingerprint)
  })
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `bunx vitest run tests/integration/segment-replace.spec.ts`
Expected: FAIL — `replaceVoiceoverSegment` не существует.

- [ ] **Step 3: Написать раннер**

Создать `server/utils/voiceover/segment-replace-runner.ts`. Порядок работы:

1. **Гейт маршрута.** `hasAudioFirstTrack(videoId)` — false означает, что единого трека нет и заменять нечего: отказ с текстом «ролик не собирали от звука». Ruling №2 хендоффа.
2. **Идемпотентность.** Имя файла пересинтезированной фразы содержит хэш `(videoId, sceneOrder, newText, voiceId, modelId, language, pacing)` — тот же приём, что `hashSpeechIdentity` в посценном маршруте. Файл на месте — синтез не оплачивается второй раз.
3. **Синтез одной фразы** через `synthesizeSpeech`. Стоимость возвращается наружу и пишется в учёт до любой возможности броска — тот же урок, что Task 1 плана preflight («отказ шага не теряет расход»).
4. **Разметка тишины** в исходном треке: `detectSilenceRanges(trackPath)`.
5. **Планирование вклейки**: `planSegmentSplice`. `null` — отказ с внятным текстом, трек не трогаем.
6. **Склейка** ffmpeg по `buildSpliceFilters`. Пишем во **временный файл** и переименовываем после успешного замера — обрыв процесса не должен оставить обрезанный трек с валидным именем (тот же дефект, что чинит Task 3 плана preflight для кусков).
7. **Замер результата** ffprobe. Ноль или отрицательное — отказ: трек эталон времени (ruling №5).
8. **Транскрипция только новой фразы** — короткий вызов той же способности `transcription` по файлу фразы, и выравнивание её текста функцией `alignScriptToTranscript` с одной сценой.
9. **Пересчёт** `shiftAlignmentAfterSplice`.
10. **Новый отпечаток** трека (sha256 файла) и запись в снапшот шага озвучки — точно так же, как это делает `runAudioFirstVoiceover` (`video-pipeline-steps.ts:2122-2156`).
11. **Инвалидация.** Для каждой сцены из `movedSceneOrders` сносится запись сцены в снапшоте lip-sync и её файл; кадры `VideoShot` этих сцен переводятся в `status: "planned"` (если план 3 выполнен — иначе шаг пропускается). Сцены вне списка не трогаются вовсе.
12. Ролик переводится в статус, с которого его подхватит обычный прогон, и вызывается `runVideoPipeline`: завершённые шаги переиспользуются по снапшотам, пересобирается только то, что инвалидировано.

- [ ] **Step 4: Написать эндпоинты**

`server/api/videos/[id]/voiceover/replace-segment.post.ts` — принимает `{ sceneOrder: number, newText: string }`, права `canRunAgent` и `moduleSlug: "video-generator"` (как в `rerun-step.post.ts`), делегирует раннеру, возвращает `deltaSec`, `invalidatedSceneOrders`, `costUsd`. Длинного pipeline в эндпоинте быть не должно (`AGENTS.md`).

`server/api/videos/[id]/voiceover/regenerate-track.post.ts` — перегенерация всего трека. Требует явного `{ confirmExpensive: true }`: операция обесценивает **все** аватарные кадры ролика (§4.5), и молчаливого пути к ней быть не должно. Без флага — 400 с текстом, сколько кадров придётся пересобрать и во сколько это обойдётся.

- [ ] **Step 5: Запустить тесты**

Run: `bunx vitest run tests/integration/segment-replace.spec.ts`
Expected: PASS.

- [ ] **Step 6: Коммит**

```bash
git add server/utils/voiceover/segment-replace-runner.ts server/api/videos tests/integration/segment-replace.spec.ts
git commit -m "feat: локальная замена фразы в треке с пересборкой только сдвинувшихся кадров"
```

---

### Task 4: Маркеры пауз — что осталось

**Фактическое состояние проверено по коду: §4.6 реализован целиком.** `buildTrackRequest` вынимает маркер `[пауза 2с]` из текста (`track-builder.ts:45`), `insertVoiceoverPauses` вставляет тишину нужной длины через `atrim` + `anullsrc` + `concat` (`insert-pauses.ts:151`), `runSingleTrackVoiceover` это вызывает и пишет в лог, сколько пауз вставлено и для каких сцен точки не нашлось (`video-pipeline-steps.ts:1834-1851`). Формулировка задания «маркеры вынимаются из текста, но тишина вставляется» — верна: тишина действительно вставляется, ничего чинить не нужно.

Осталось два хвоста, и оба про то, что механизм не виден снаружи.

**Files:**
- Modify: `server/utils/voiceover/segment-replace-runner.ts`
- Modify: `server/api/videos/[id]/voiceover/replace-segment.post.ts`
- Test: `tests/unit/voiceover/track-builder.spec.ts`
- Modify: `docs/operations/` (новый короткий документ про синтаксис маркеров)

**Interfaces:**
- Consumes: `buildTrackRequest`, `TrackPause` (`server/utils/voiceover/track-builder.ts`).
- Produces: маркеры переживают локальную замену; синтаксис задокументирован.

- [ ] **Step 1: Написать падающий тест на маркер в заменяемой фразе**

Дописать в `tests/unit/voiceover/track-builder.spec.ts`:

```ts
  it("маркер в конце заменяемой фразы не уходит в синтез", () => {
    // Локальная замена синтезирует ОДНУ фразу тем же сборщиком. Если маркер
    // проедет в текст, модель прочитает «пауза два с» вслух.
    const request = buildTrackRequest([
      { order: 2, text: "Смотри сюда. [пауза 2с]", source: "spoken" },
    ])

    expect(request.text).toBe("Смотри сюда.")
    expect(request.pauses).toEqual([{ afterSceneOrder: 2, durationSec: 2 }])
  })

  it("сцена из одного маркера даёт паузу, но не текст для синтеза", () => {
    // Такая сцена не попадает в `scenes` (очищенный текст пуст), и пауза
    // остаётся без точки вставки — это уже обрабатывается planPauseSplit
    // через skippedPauses, но проверить связку надо здесь.
    expect(() => buildTrackRequest([{ order: 3, text: "[пауза 1.5с]", source: "spoken" }]))
      .toThrow(/пустой текст/)
  })
```

- [ ] **Step 2: Запустить и убедиться в результате**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/voiceover/track-builder.spec.ts`
Expected: первый тест PASS сразу (механизм уже работает), второй — проверить фактическое поведение и при расхождении привести тест к нему, а не наоборот: `buildTrackRequest` кладёт паузу в список **до** проверки на пустой текст, и это задокументировано в шапке `insert-pauses.ts`.

- [ ] **Step 3: Провести маркеры через локальную замену**

В `segment-replace-runner.ts` текст новой фразы обязан проходить через `buildTrackRequest` (а не уходить в `synthesizeSpeech` как есть), и полученные `pauses` — через `insertVoiceoverPauses` уже на файле фразы. Иначе оператор, написавший маркер в правке, услышит его вслух.

Возвращать наружу список пауз, для которых точки вставки не нашлось, — эндпоинт кладёт его в ответ.

- [ ] **Step 4: Показать пропущенные паузы оператору**

В ответе `replace-segment.post.ts` вернуть `skippedPauses`. Сегодня о них знает только лог шага (`video-pipeline-steps.ts:1843-1846`), и оператор, чья пауза не вставилась, узнаёт об этом только открыв логи.

- [ ] **Step 5: Задокументировать синтаксис**

Создать короткий `docs/operations/voiceover-pause-markers.md`: синтаксис `[пауза 2с]` и `[пауза 1.5 с]` (регистр и пробел не важны — `pauseMarker()` в `track-builder.ts:26`), куда его писать (текст сцены сценария), что он делает (тишина вставляется в трек, а не отдаётся на волю чтеца), и когда пауза пропускается (у сцены нет очищенного текста — вставлять некуда).

- [ ] **Step 6: Прогон и коммит**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/voiceover`

```bash
git add server/utils/voiceover tests/unit/voiceover docs/operations/voiceover-pause-markers.md
git commit -m "feat: маркеры пауз переживают локальную замену и видны оператору"
```

---

### Task 5: Клонирование голоса как способность медиареестра

Логика есть в `scripts/clone-voice.ts` — выносится на сервер вместе со всеми её проверками. Прогон стоит **$3**, поэтому кнопка требует явного подтверждения суммы, как `--yes` в скрипте (§9).

**Files:**
- Modify: `prisma/schema.prisma` (`Character.voiceSampleSha1`)
- Create: `prisma/migrations/20260820000000_add_stepwise_and_voice_sample/migration.sql`
- Modify: `server/utils/media-provider/types.ts`
- Modify: `server/utils/media-provider/registry.ts`
- Modify: `server/utils/media-provider/model-specs.ts`
- Create: `server/api/characters/[id]/clone-voice.post.ts`
- Test: `tests/unit/media-provider/voice-cloning-spec.spec.ts`

**Interfaces:**
- Consumes: ветка исполнения `sync_json` (существует).
- Produces:
  - capability `"voice_cloning"`
  - `VoiceCloningInput { audioUrl: string, targetModel: string, noiseReduction?: boolean, volumeNormalization?: boolean }`
  - `VoiceCloningConstraints { audioExtensions: readonly string[], minDurationSec: number, maxDurationSec: number, maxBytes: number }`
  - `VoiceCloningModelSpec`
  - поле `Character.voiceSampleSha1: string | null`

- [ ] **Step 1: Написать падающий тест**

Создать `tests/unit/media-provider/voice-cloning-spec.spec.ts`:

```ts
import { describe, expect, it } from "vitest"

import { listMediaSpecs, mapMediaInput } from "~~/server/utils/media-provider/registry"

describe("способность voice_cloning", () => {
  it("зарегистрирована и отдаёт JSON, а не файл", () => {
    const specs = listMediaSpecs("voice_cloning")

    expect(specs.length).toBeGreaterThan(0)
    expect(specs[0]!.provider).toBe("replicate")
    expect(specs[0]!.execution).toBe("sync_json")
  })

  it("цена подтверждена страницей модели — $3 за прогон", () => {
    // Отличие от транскрипции: здесь тариф снят со страницы модели ещё при
    // работе над scripts/clone-voice.ts (generic_output_count), поэтому спека
    // integrated.
    const spec = listMediaSpecs("voice_cloning")[0]!

    expect(spec.billing).toMatchObject({ unit: "flat", usd: 3 })
    expect(spec.billingConfirmed).toBe(true)
    expect(spec.integrated).toBe(true)
  })

  it("собирает payload из нормализованного входа", () => {
    const spec = listMediaSpecs("voice_cloning")[0]!

    expect(mapMediaInput(spec, {
      audioUrl: "https://cdn.example.com/sample.mp3",
      targetModel: "speech-02-turbo",
    })).toMatchObject({
      voice_file: "https://cdn.example.com/sample.mp3",
      model: "speech-02-turbo",
    })
  })

  it("отвергает ссылку без расширения ДО оплаты", () => {
    // Проверено при работе над скриптом: Files API отдаёт /v1/files/{id} без
    // расширения, а MiniMax определяет формат по нему и падает уже после
    // создания задачи — то есть за деньги.
    const spec = listMediaSpecs("voice_cloning")[0]!

    expect(() => mapMediaInput(spec, {
      audioUrl: "https://api.replicate.com/v1/files/abc123",
      targetModel: "speech-02-turbo",
    })).toThrow(/расширение/i)
  })

  it("отвергает неподдерживаемый формат", () => {
    const spec = listMediaSpecs("voice_cloning")[0]!

    expect(() => mapMediaInput(spec, {
      audioUrl: "https://cdn.example.com/sample.ogg",
      targetModel: "speech-02-turbo",
    })).toThrow(/формат/i)
  })

  it("держит ограничения модели рядом со спекой", () => {
    const spec = listMediaSpecs("voice_cloning")[0]!

    expect(spec.constraints).toMatchObject({
      minDurationSec: 10,
      maxDurationSec: 300,
      maxBytes: 20 * 1024 * 1024,
    })
  })
})
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/media-provider/voice-cloning-spec.spec.ts`
Expected: FAIL — `listMediaSpecs("voice_cloning")` вернёт пустой массив.

- [ ] **Step 3: Добавить способность в типы**

В `server/utils/media-provider/types.ts`: `"voice_cloning"` в конец `MediaCapability` (:12-20), вход и ограничения:

```ts
/**
 * Клонирование голоса ведущего. Разовая административная операция: голос
 * клонируется один раз, дальше `voice_id` уходит в обычную TTS-спеку.
 */
export interface VoiceCloningInput {
  /** Публичный URL образца. ОБЯЗАН оканчиваться расширением файла. */
  audioUrl: string
  /** Под какую TTS-модель обучается голос: тот же id в другой модели не существует. */
  targetModel: string
  noiseReduction?: boolean
  volumeNormalization?: boolean
}

export interface VoiceCloningConstraints {
  audioExtensions: readonly string[]
  minDurationSec: number
  maxDurationSec: number
  maxBytes: number
}
```

плюс `voice_cloning: VoiceCloningInput` в `MediaInputMap` (:153) и

```ts
export type VoiceCloningModelSpec = MediaModelSpecBase<"voice_cloning", VoiceCloningInput, VoiceCloningConstraints>
```

в union спек.

- [ ] **Step 4: Зарегистрировать способность**

В `server/utils/media-provider/registry.ts` — `"voice_cloning"` в конец `MEDIA_CAPABILITIES` и записи в оба словаря env-ключей:

```ts
  voice_cloning: Object.freeze(["MEDIA_MODEL_VOICE_CLONING"]),
```

```ts
  voice_cloning: "MEDIA_PROVIDER_FALLBACK_VOICE_CLONING",
```

- [ ] **Step 5: Добавить спеку модели**

В `server/utils/media-provider/model-specs.ts` — секция и запись в `MEDIA_MODEL_SPECS`. Ключевое: `registryKey: "replicate:minimax-voice-cloning"`, `id: "minimax/voice-cloning"`, `execution: "sync_json"`, `billing: { unit: "flat", usd: 3 }`, `billingConfirmed: true`, `integrated: true`, `extractOutput: () => ({ urls: [] })` (выход — структура с `voice_id`), а в `mapInput` — проверки из скрипта: расширение в URL (`.mp3`/`.m4a`/`.wav`), непустой `targetModel`. Проверки длительности и размера файла делает эндпоинт: спека URL не скачивает.

Комментарий рядом должен объяснять находку про Files API: ссылка без расширения даёт «invalid file ext for voice clone» **после** создания задачи, то есть за деньги.

- [ ] **Step 6: Завести поле образца на персонаже и миграцию**

В `model Character` (`prisma/schema.prisma:251`) рядом с `voiceId`/`voiceModelId`:

```prisma
  /// sha1 образца, на котором обучен голос. Повторная заливка того же файла с
  /// той же целевой моделью не должна стоить ещё $3.
  voiceSampleSha1 String?
```

Миграция создаётся общая с Task 6 (`20260820000000_add_stepwise_and_voice_sample`), см. там же.

- [ ] **Step 7: Написать эндпоинт**

`server/api/characters/[id]/clone-voice.post.ts`:

- принимает multipart с образцом и полями `targetModel`, `confirmUsd`;
- **без `confirmUsd === 3` возвращает 400** с текстом «прогон стоит $3, подтвердите сумму» — прямой перенос `--yes` из скрипта (§9);
- проверяет формат, длительность (10 с — 5 мин) и размер (<20 МБ) **до** любого платного вызова — модель отвергнет файл уже после создания задачи, и это будут потраченные деньги;
- считает `sha1` образца; если у персонажа уже `voiceSampleSha1` совпадает и `voiceModelId === targetModel`, возвращает существующий `voiceId` **без оплаты**;
- заливает образец в наше хранилище (ключ с расширением!) и передаёт публичный URL в способность;
- при успехе пишет `voiceId`, `voiceModelId`, `voiceSampleSha1` на персонажа;
- расход пишется в учёт до возврата ответа.

- [ ] **Step 8: Запустить тесты**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/media-provider`
Expected: PASS. Инвариант «восемь способностей» в `tests/unit/fixes/media-registry.spec.ts:462` придётся пополнить девятой — то же место, что правилось при добавлении `transcription`.

- [ ] **Step 9: Коммит**

```bash
git add server/utils/media-provider server/api/characters prisma tests/unit/media-provider tests/unit/fixes/media-registry.spec.ts
git commit -m "feat: клонирование голоса способностью медиареестра с подтверждением суммы"
```

---

### Task 6: Пошаговый режим — ожидание вне прогона

Шаг доводится до конца, ролик переходит в статус ожидания решения, блокировка ролика отпускается, процесс завершает работу. «Принять» запускает **новый** прогон, который поднимает состояние из снапшотов и идёт дальше (§9).

Ждать оператора внутри живого прогона нельзя: удержанный lock и подвешенный процесс не переживают перезапуск воркера, а требование «долгие операции идемпотентны и восстанавливаемы после рестарта» из `AGENTS.md` относится и к ожиданию.

**Files:**
- Create: `server/utils/video-pipeline-stepwise.ts`
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260820000000_add_stepwise_and_voice_sample/migration.sql`
- Modify: `server/utils/video-pipeline.ts`
- Modify: `server/utils/video-pipeline-run-policy.ts:457-466`
- Modify: `shared/types/video.ts`
- Modify: `app/components/video/VideoStatusMap.ts:4-20`
- Create: `server/api/videos/[id]/approve-step.post.ts`
- Test: `tests/unit/fixes/stepwise-wait.spec.ts`
- Test: `tests/integration/stepwise-approval.spec.ts`

**Interfaces:**
- Consumes: `StepKey`, `resolveEditProfile` (план 3 — необязателен, см. ниже).
- Produces:
  - `planStepwisePause(input: StepwiseInput): StepwiseDecision`
  - `StepwiseInput { stepwiseEnabled: boolean, justFinished: StepKey, order: readonly StepKey[] }`
  - `StepwiseDecision { pause: boolean, awaitingStepKey: StepKey | null, reason: string }`
  - `VideoStatus.awaiting_operator`; поля `Video.stepwiseApproval`, `Video.awaitingStepKey`

- [ ] **Step 1: Написать падающий тест правила**

Создать `tests/unit/fixes/stepwise-wait.spec.ts`:

```ts
import { describe, expect, it } from "vitest"

import { planStepwisePause } from "~~/server/utils/video-pipeline-stepwise"
import { RESUMABLE_VIDEO_STATUSES } from "~~/server/utils/video-pipeline-run-policy"

const ORDER = [
  "prompt_generation", "voiceover_generation", "transcription",
  "image_generation", "clip_generation", "lip_sync_generation",
  "music_generation", "assembly",
] as const

describe("пошаговый режим", () => {
  it("выключен — прогон не останавливается никогда", () => {
    const decision = planStepwisePause({
      stepwiseEnabled: false, justFinished: "transcription", order: ORDER,
    })

    expect(decision.pause).toBe(false)
    expect(decision.awaitingStepKey).toBeNull()
  })

  it("включён — останавливается после каждого шага", () => {
    for (const step of ORDER.slice(0, -1)) {
      const decision = planStepwisePause({ stepwiseEnabled: true, justFinished: step, order: ORDER })
      expect(decision.pause).toBe(true)
      expect(decision.awaitingStepKey).toBe(step)
    }
  })

  it("после последнего шага не ждёт — ждать нечего", () => {
    const decision = planStepwisePause({
      stepwiseEnabled: true, justFinished: "assembly", order: ORDER,
    })

    expect(decision.pause).toBe(false)
  })

  it("шаг не из порядка прогона паузы не вызывает", () => {
    const decision = planStepwisePause({
      stepwiseEnabled: true, justFinished: "edit_plan" as never, order: ORDER,
    })

    expect(decision.pause).toBe(false)
    expect(decision.reason).toMatch(/не в порядке/i)
  })

  it("статус ожидания НЕ входит в список подхватываемых watchdog'ом", () => {
    // §9: watchdog ролики в этом статусе зависшими не считать не должен,
    // иначе он поднимет прогон, которого оператор не просил, и заплатит за
    // следующий шаг сам.
    expect(RESUMABLE_VIDEO_STATUSES).not.toContain("awaiting_operator")
  })
})
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/fixes/stepwise-wait.spec.ts`
Expected: FAIL — модуль не существует.

- [ ] **Step 3: Написать правило**

Создать `server/utils/video-pipeline-stepwise.ts`:

```ts
/**
 * Останавливаться ли после шага в пошаговом режиме.
 *
 * Правило чистое, потому что цена ошибки высокая: лишняя пауза оставит ролик
 * стоять навсегда (автопродолжения по таймауту нет — оно обесценило бы сам
 * режим, §9), пропущенная — отдаст оператору готовый ролик вместо решения.
 *
 * Само ожидание устроено ВНЕ прогона: шаг доводится до конца, ролик переходит в
 * статус ожидания, блокировка отпускается, процесс завершает работу. Ждать
 * внутри живого прогона нельзя — удержанный lock и подвешенный процесс не
 * переживают перезапуск воркера (AGENTS.md про идемпотентность и восстановление
 * после рестарта относится и к ожиданию).
 */

import type { StepKey } from "./video-pipeline-db"

/** Статус ролика, ждущего решения оператора. Вне RESUMABLE_VIDEO_STATUSES намеренно. */
export const AWAITING_OPERATOR_STATUS = "awaiting_operator"

export interface StepwiseInput {
  stepwiseEnabled: boolean
  justFinished: StepKey
  /** Порядок исполнения маршрута ролика (executionOrderFor). */
  order: readonly StepKey[]
}

export interface StepwiseDecision {
  pause: boolean
  /** Какой шаг оператор должен принять. null — паузы нет. */
  awaitingStepKey: StepKey | null
  reason: string
}

export function planStepwisePause(input: StepwiseInput): StepwiseDecision {
  if (!input.stepwiseEnabled) {
    return { pause: false, awaitingStepKey: null, reason: "пошаговый режим выключен" }
  }

  const index = input.order.indexOf(input.justFinished)
  if (index < 0) {
    return { pause: false, awaitingStepKey: null, reason: `шаг ${input.justFinished} не в порядке прогона` }
  }
  if (index === input.order.length - 1) {
    return { pause: false, awaitingStepKey: null, reason: "последний шаг — ждать нечего" }
  }

  return {
    pause: true,
    awaitingStepKey: input.justFinished,
    reason: `ждём решения оператора после шага ${input.justFinished}`,
  }
}
```

- [ ] **Step 4: Изменить схему и создать миграцию**

В `enum VideoStatus` (`prisma/schema.prisma:543`) добавить **в конец**:

```prisma
  awaiting_operator
```

В `model Video`:

```prisma
  /// Пошаговый режим на этом ролике. Дефолт наследуется из монтажного профиля
  /// (EditProfile.stepwiseApproval), это поле — переопределение оператора.
  stepwiseApproval         Boolean               @default(false)
  /// Шаг, решения по которому ждём. Заполнено только в статусе
  /// awaiting_operator.
  awaitingStepKey          VideoStepKey?
```

Создать `prisma/migrations/20260820000000_add_stepwise_and_voice_sample/migration.sql`:

```sql
-- AlterEnum
ALTER TYPE "VideoStatus" ADD VALUE 'awaiting_operator';

-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "stepwiseApproval" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "awaitingStepKey" "VideoStepKey";

-- AlterTable
ALTER TABLE "Character" ADD COLUMN     "voiceSampleSha1" TEXT;
```

Новое значение enum в этой же миграции **не используется** — только объявляется: Postgres запрещает его использование в той же транзакции.

Run: `bun run test:db:migrate && bunx prisma generate`

- [ ] **Step 5: Разнести статус по картам**

`shared/types/video.ts` — добавить `"awaiting_operator"` в union `VideoStatus` (:13-24). Обрати внимание: эта копия уже расходится с enum схемы — в ней нет `file_missing`. Расхождение старое и к этой работе отношения не имеет; чинить его здесь не надо, чтобы не смешивать две правки в одном коммите.

`app/components/video/VideoStatusMap.ts` — в `VIDEO_STATUS_TO_ENTITY` (:4):

```ts
  // Не 'running': прогона за роликом нет вовсе, он ждёт человека.
  awaiting_operator: 'queued',
```

`server/utils/video-pipeline-run-policy.ts` — рядом с `RESUMABLE_VIDEO_STATUSES` (:457) добавить комментарий о том, что `awaiting_operator` сюда **не** входит намеренно, и почему. Список не менять.

- [ ] **Step 6: Встроить паузу в оркестратор**

В `server/utils/video-pipeline.ts` после каждого шага (там, где сейчас идёт `chargeStep` и переход к следующему вызову) вызывать `planStepwisePause`. При `pause: true`:

- записать `status: AWAITING_OPERATOR_STATUS`, `awaitingStepKey`;
- **выйти из функции штатным `return`**, а не бросать: `finally` блока `try` снимет блокировку (`lockHandle`), и процесс завершится без удержанного lock.

Блокировка обязана отпускаться именно через существующий `finally` — своя ветка освобождения разошлась бы с ним при первой правке.

- [ ] **Step 7: Написать эндпоинт «принять»**

`server/api/videos/[id]/approve-step.post.ts`:

- 409, если ролик не в статусе `awaiting_operator` — принимать нечего;
- сбрасывает `awaitingStepKey`, ставит статус, с которого прогон подхватится, и вызывает `runVideoPipeline(videoId)` — завершённые шаги переиспользуются по снапшотам, работа продолжится с места остановки (образец: `resumeVideoPipeline`, `video-pipeline.ts:1349`);
- принимает необязательное `{ action: "approve" | "regenerate" }`: `regenerate` перед запуском вызывает `rerunVideoStep(videoId, awaitingStepKey)` — это кнопка «перегенерировать» из §9.

- [ ] **Step 8: Написать тест с БД**

Создать `tests/integration/stepwise-approval.spec.ts`. Проверяемое: ролик с `stepwiseApproval: true` после первого шага стоит в `awaiting_operator`; `isLocked === false`; повторный вызов `runVideoPipeline` **не** продолжает его сам; `approve-step` продолжает прогон и не оплачивает уже выполненные шаги; watchdog (`planStalledVideoRecovery`) такой ролик не подхватывает.

- [ ] **Step 9: Прогнать сьюты**

Run: `bunx vitest run --config vitest.pure.config.ts`
Run: `bunx vitest run tests/integration/stepwise-approval.spec.ts`
Expected: PASS.

- [ ] **Step 10: Коммит**

```bash
git add server/utils/video-pipeline-stepwise.ts server/utils/video-pipeline.ts server/utils/video-pipeline-run-policy.ts prisma shared/types/video.ts app/components/video/VideoStatusMap.ts server/api/videos tests
git commit -m "feat: пошаговый режим ждёт решения вне прогона, без блокировки и процесса"
```

---

### Task 7: Экраны — дизайн-флоу, затем интеграция

По `AGENTS.md` порядок обязателен и делится на две задачи: сначала макет в `design-preview` (ImageGen-референсы, интерактивный HTML, Playwright на desktop/tablet/mobile, четыре независимых критика, итерации, `implementation-spec.md`), потом интеграция в продукт **отдельной задачей** по этой спеке. Дизайн-задача пишет только в `design-preview/` и не подключается к `app/`, API или БД.

`design-preview/_system` существует — его map, glossary, components и tokens читаются первыми, и система обновляется вместе с новым разделом.

**Files:**
- Create: `design-preview/catalog/09-edit-console.dc.html`
- Modify: `design-preview/_system/**` (новые блоки, если понадобятся)
- Create: `design-preview/implementation-spec.md` (раздел монтажной консоли)
- Modify (второй задачей): `app/pages/characters/[id].vue`, `app/pages/videos/[id].vue`, новые компоненты в `app/components/`

**Interfaces:**
- Consumes: API из Task 3, Task 5, Task 6 и из плана 3 (профили, фоны, кадры).
- Produces: макет и `implementation-spec.md`; интеграция — отдельной задачей.

- [ ] **Step 1: Запустить `$design-feature`**

Если навык недоступен — **сказать об этом явно**, а не молча пропустить дизайн-флоу (`AGENTS.md`).

Экраны из §9 спеки:

| Экран | Что на нём |
|---|---|
| Персонаж | Загрузка образца голоса, кнопка клонирования **с явным подтверждением $3**, видимый статус (`voiceId`, `voiceModelId`, дата) |
| Записи ведущего | Список записей, занимаемый объём, пометка `keep`, повторная нарезка, перезапуск упавшего ingest (план 2, Task 3) |
| Библиотека фонов | Загрузка и список по образцу исходников ведущего (план 3, Task 7) |
| Монтажный профиль | Форма правил; поле переопределения на ролике (план 3, Task 1-2) |
| План монтажа | Таблица кадров с превью, перегенерация отдельного кадра |
| Озвучка | Правка отдельной фразы с локальной заменой; перегенерация всего трека — **помечена как дорогая**, с числом кадров, которые она обесценит |
| Ролик | Пошаговый режим: статус ожидания, кнопки «принять» и «перегенерировать» |

Отдельно проговорить в макете: **перегенерация всего трека и клонирование голоса — единственные два действия с подтверждением суммы**, и они не должны выглядеть как соседние равноправные кнопки с дешёвыми операциями.

- [ ] **Step 2: Дождаться зелёного E2E и критериев ревью**

Дизайн-задача завершается после зелёного Playwright на трёх ширинах и четырёх независимых критиков. Раньше этого к `app/` не прикасаться.

- [ ] **Step 3: Коммит макета**

```bash
git add design-preview
git commit -m "design: макет монтажной консоли — профиль, кадры, озвучка, пошаговый режим"
```

- [ ] **Step 4: Интеграция отдельной задачей**

По `implementation-spec.md`, с повторной проверкой реального приложения. Отдельный коммит:

```bash
git add app
git commit -m "feat: монтажная консоль в продукте"
```

---

## Что этот план сознательно НЕ делает

- **Не переписывает маркеры пауз.** §4.6 реализован целиком (проверено по коду, см. Task 4); план только проводит маркеры через локальную замену и показывает пропущенные паузы оператору.
- **Не уточняет точку вставки паузы.** Сейчас она оценивается по доле символов (`planPauseSplit`), и это осознанное приближение: точных таймингов на шаге озвучки ещё нет. Уточнять её после выравнивания технически можно — вставить тишину в уже размеченный трек и сдвинуть тайминги арифметикой (тот же механизм, что в Task 2), — но это меняет порядок шагов и отпечаток трека после транскрипции. Отдельное решение, не хвост этого плана.
- **Не даёт правку текста сцены в UI без пересинтеза.** Правка текста меняет сценарий, и её последствия шире озвучки (субтитры, промпты сцен). Здесь только замена звучания одной фразы.
- **Не реализует автопродолжение пошагового режима по таймауту.** §9: «Автопродолжения по таймауту нет — оно обесценило бы сам режим».
- **Не делает пошаговый режим для старого маршрута.** Механизм общий по устройству, но включается только там, где есть монтажный профиль, а профиль — audio-first. Старый маршрут не задет вовсе.
- **Не переносит `scripts/clone-voice.ts` в утиль.** Скрипт остаётся: он работает без поднятого приложения и им удобно проверять модель. Дублирование проверок осознанное и отмечено комментарием в обоих местах.
- **Не планирует canary.** Отдельное решение владельца (`handoff-2026-08-17-audio-first.md` §6).
- **Не интегрирует экраны в продукт в той же задаче, что и макет** — это прямой запрет `AGENTS.md`.
