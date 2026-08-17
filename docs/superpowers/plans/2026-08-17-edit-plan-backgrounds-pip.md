# План монтажа, фоны и PiP — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ролик перестаёт быть набором длинных статичных сцен: между озвучкой и картинкой появляется шаг `edit_plan`, который режет таймлайн на кадры по 1.5-2 секунды, назначает каждому передний и задний план по правилам монтажного профиля, и делает это так, что арифметику таймлайна считает код, а не модель.

**Architecture:** Три новые сущности. `EditProfile` — правила монтажа бренда (доля перебивок, шаг смены картинки, PiP, разрешение и потолок генеративного видео, зафиксированная версия LLM); ролик наследует профиль и может перебить его полем. `BackgroundClip` — библиотека загружаемых фонов, устроенная как `PresenterSourceClip`. `VideoShot` — кадр смонтированного ролика отдельной строкой, а не Json на ролике: это даёт перегенерацию одного кадра без пересборки соседей, идемпотентность шага и аудит стоимости по кадрам. Новый шаг `edit_plan` идёт сразу за транскрипцией: модель выбирает смысл, чистая функция проверяет покрытие таймлайна и чинит границы детерминированно, повторный запрос к модели идёт только если ремонт не помог. Источник фона выбирается по потолку стоимости с деградацией до картинки с движением. PiP накладывается строго после lip-sync, и это закреплено типом, а не комментарием.

**Tech Stack:** Nuxt 4 / Nitro, Bun, TypeScript, Prisma + PostgreSQL 16, Vitest (DB-free — `vitest.pure.config.ts`, с БД — `vitest.config.ts`), FFmpeg через `fluent-ffmpeg`, Replicate как основной медиапровайдер, Anthropic через `callAnthropicAgent`.

**Spec:** `docs/superpowers/specs/2026-08-16-audio-first-editing-design.md` (§5, §7, §6.3; план работ §11 пункты 5, 6, 7)

**Предшествующие планы:**
- `docs/superpowers/plans/2026-08-16-audio-first-timing.md` — выполнен: единый трек, транскрипция, выравнивание, ветка `sync_json`, `Video.editPipeline`.
- `docs/superpowers/plans/2026-08-17-audio-first-preflight.md` — семь задач до включения флага. **Этот план идёт после него.**
- `docs/superpowers/plans/2026-08-17-presenter-recordings-and-speech-cut.md` (план 2) — **независим от этого плана**, кроме Task 6 (см. «Зависимости»).

## Global Constraints

- Пакетный менеджер — **Bun**, не npm (`AGENTS.md`). Тесты: `bunx vitest run ...`.
- БД меняется **только миграциями**, `prisma db push` запрещён.
- Replicate — основной провайдер; fal только как явно настроенный fallback.
- Модель без цены, подтверждённой страницей модели, остаётся `integrated: false` и в смету не попадает.
- **Все долгие и платные операции идемпотентны и переживают рестарт процесса** (`AGENTS.md`). Повторный заход не платит второй раз и не теряет уже полученный результат.
- **Платные вызовы начинаются с одного canary job**; готовность интеграции не заявляется без реального или контрактного подтверждения (`AGENTS.md`).
- Комментарии и сообщения об ошибках — по-русски, как в окружающем коде.
- Не создавать файлы-монстры: новая логика живёт отдельными модулями в `server/utils/edit-plan/`.
- DB-free тесты должны попадать в `vitest.pure.config.ts` — там явный `include`.
- Старый маршрут не ломается и не удаляется: он остаётся основным до canary-сравнения (§2 спеки).

## Решения, которые этот план не переоткрывает

Из `docs/operations/handoff-2026-08-17-audio-first.md` §4 — все семь. Прямо относятся к этому плану:

- **№1** транскрипция на audio-first обязательна: шаг `edit_plan` без выровненных сцен не запускается вовсе и падает честно, а не рисует план по плановым длительностям;
- **№3** ключ переиспользования куска считается по границам, притянутым к кадру: границы кадров `VideoShot` притягиваются той же функцией `snapSecToFrame`;
- **№5** длительность трека измеряется ffprobe: покрытие таймлайна проверяется против неё, а не против суммы длительностей сцен;
- **№6** порог «расхождение больше секунды — сбой» к подгону под трек неприменим.

## Зависимости

- **Не зависит от плана 2.** `edit_plan` работает и на нынешнем подборе клипов ведущего: он назначает кадру передний план `presenter`, а как именно добывается фрагмент — не его дело.
- **Task 6 (PiP) даёт результат лучше вместе с планом 2.** Кроп PiP-окна из длинной записи разнообразнее, чем кроп из готового 2-10-секундного клипа. Но реализуется независимо: композиция принимает уже синхронизированный клип, откуда он взялся — неважно.
- **План 4 зависит от этого плана** в части UI: форма монтажного профиля и таблица кадров рисуют `EditProfile` и `VideoShot`.

## Что уже проверено фактически (не перепроверять)

Снято с кода при подготовке плана:

- `StepKey` — union в `server/utils/video-pipeline-db.ts:27`, `STEP_ORDER` там же; персистентный `stepIndex` пишется по нему, поэтому новые ключи дописываются **в конец**.
- Реальный порядок исполнения на audio-first задаёт `STEP_EXECUTION_ORDER_AUDIO_FIRST` (`server/utils/video-pipeline-run-policy.ts:280`), выбор — `executionOrderFor(editPipeline)` (:292). Но **вызовы шагов в `video-pipeline.ts` идут последовательностью операторов, а не обходом массива**: массив управляет каскадом сброса (`stepsToRerunFrom`), а не порядком. Новый шаг надо и дописать в массив, и вставить вызовом в нужное место `runVideoPipeline`.
- `STEP_ASSET_TYPES` — `Record<StepKey, ...>` (`server/utils/video-pipeline-reset.ts:39`): без записи для нового ключа проект не скомпилируется.
- Каскад перезапуска удаляет только `VideoAsset` (`video-pipeline.ts:1245-1264`) — строк других таблиц он не знает. `VideoShot` придётся чистить отдельной веткой там же.
- `shared/types/video.ts` держит **вторую, независимую копию** `VideoStepKey` (:27), `STEP_LABELS` (:140) и `STEP_ORDER` (:149) — именно она рисует таблицу шагов в UI.
- `app/components/video/VideoStatusMap.ts` — `VIDEO_STEP_LABELS` (:31) и `VIDEO_STEP_IS_CHEAP` (:48).
- `server/api/videos/[id]/rerun-step.post.ts:1` — `VALID_STEPS` сейчас `["prompt_generation", "image_generation", "clip_generation", "music_generation", "assembly", "transcription"]`.
- `mapStepKeyToService` (`server/utils/balance/cost-attribution.ts:36`) — `switch (stepKey)` с `default: return null`; без ветки расход шага не попадёт ни в `AiAuditLog`, ни в `Video.totalCostActual`.
- `SPEND_GROUPS` (`server/utils/balance/spend-breakdown.ts:49`) — четыре группы; ключ без группы уходит в «Прочее».
- `callAnthropicAgent` (`server/utils/agents/call-anthropic.ts:53`) принимает `systemPrompt`, `userPrompt`, `maxTokens`, `tier?: 'haiku'`, `validate`, `agentName`, `onUsage`. **Произвольный id модели он не принимает** — модель берётся из `ANTHROPIC_MODEL` / `ANTHROPIC_HAIKU_MODEL`. Для `EditProfile.llmModelId` опцию придётся добавить (Task 5, Step 4).
- `planSceneKinds` и `DEFAULT_BROLL_RATIO = 0.4` уже существуют в `server/utils/broll-plan.ts` — раскладка сцен на ведущего и перебивки написана, но она работает по сценам, а не по кадрам.
- `pickShotVariationPlan`, `planShotVariationForClip`, `buildShotVariationFilter` — `server/utils/video-tools/shot-variation.ts`: движение внутри кадра уже есть.
- `planRemotionOverlays`, `MAX_OVERLAYS_PER_VIDEO = 5` — `server/utils/remotion/overlay-plan.ts`.
- `REPLICATE_KLING_16_DURATIONS = Object.freeze([5, 10])` — `server/utils/media-provider/model-specs.ts:319`; квантование делает `pickDuration` в `mapInput` спек i2v/t2v.
- Цена кадра `replicate:flux-dev` — `{ unit: "output_image", usdPerImage: readReplicatePrice("REPLICATE_IMAGE_PRICE_USD", 0.025) }` (`model-specs.ts:152-158`).
- `snapSecToFrame(sec, fps)` и `trackEndFrame(trackDurationSec, fps)` экспортируются из `server/utils/voiceover/segment-cut.ts`.
- `TIMELINE_FPS = 30` — `shared/types/video-runtime.ts:249`.
- `dHashFromGrayscale`, `areFramesSimilar`, `DEFAULT_SIMILARITY_THRESHOLD = 6` — `server/utils/presenter/perceptual-hash.ts`.
- `AppReferenceImage` (`prisma/schema.prisma:440`) — скрины приложения с дедупом по sha1; отдельный источник фона по §7 и переделке не подлежит.
- `ScenarioGenerationProfile` (`prisma/schema.prisma:2445`) — образец профиля: `appId Int?`, `isDefault Boolean`, `settings Json`. `EditProfile` строится по нему, но полями, а не Json: по ним будет фильтрация и форма.
- `AssembleOptions.clipTrackAlignment` (`server/utils/render.ts:75-81`) уже принимает выровненные сцены и длительность трека — сборка кадров ложится рядом, а не вместо.

## File Structure

**Создаётся:**

| Файл | Ответственность |
|---|---|
| `server/utils/edit-plan/types.ts` | Кадр, план, разрешённые источники фона и переднего плана |
| `server/utils/edit-plan/profile.ts` | Слияние профиля и переопределений ролика, дефолты |
| `server/utils/edit-plan/validate.ts` | Проверка плана: покрытие, границы слов, потолки, доля перебивок |
| `server/utils/edit-plan/repair.ts` | Детерминированный ремонт границ до повторного запроса к модели |
| `server/utils/edit-plan/split-line.ts` | Дробление реплики длиннее потолка lip-sync модели |
| `server/utils/edit-plan/background-source.ts` | Выбор источника фона и деградация при исчерпании потолка |
| `server/utils/agents/edit-planner-agent.ts` | Запрос к LLM: смысл кадра, ведущий, идея картинки |
| `server/utils/edit-plan/runner.ts` | Шаг: собрать вход, спросить модель, починить, записать `VideoShot` |
| `server/utils/video-tools/pip-compose.ts` | Кроп, маска, скругление и наложение — только на синхронизированный клип |
| `server/api/edit-profiles/index.get.ts` | Список профилей |
| `server/api/edit-profiles/index.post.ts` | Создание профиля |
| `server/api/edit-profiles/[id].put.ts` | Правка профиля |
| `server/api/apps/[id]/background-clips/index.get.ts` | Список фонов |
| `server/api/apps/[id]/background-clips/index.post.ts` | Загрузка фона с дедупом |
| `server/api/apps/[id]/background-clips/[clipId].delete.ts` | Удаление фона |
| `prisma/migrations/20260819000000_add_edit_plan/migration.sql` | Три таблицы, поля ролика, значение enum шага |
| `tests/unit/edit-plan/*.spec.ts` | DB-free тесты профиля, валидации, ремонта, дробления, выбора фона, PiP |
| `tests/integration/edit-plan.spec.ts` | С БД: наследование профиля, дедуп фонов, идемпотентность шага, перегенерация кадра |

**Модифицируется:**

| Файл | Что меняется |
|---|---|
| `prisma/schema.prisma` | `EditProfile`, `BackgroundClip`, `VideoShot`, `Video.editProfileId`/`editOverrides`, `VideoStepKey.edit_plan` |
| `server/utils/video-pipeline-db.ts:27,37-45` | `StepKey`, `STEP_ORDER` |
| `server/utils/video-pipeline-run-policy.ts:280-296` | `edit_plan` в порядке audio-first |
| `server/utils/video-pipeline-reset.ts:18-48` | Запись в `STEP_ASSET_TYPES` |
| `server/utils/video-pipeline.ts:686-760,1239-1264` | Вызов шага, чистка `VideoShot` при перезапуске |
| `server/utils/agents/call-anthropic.ts:53-78` | Необязательный явный id модели |
| `server/utils/balance/cost-attribution.ts:36-88` | Ветка расхода `edit_plan` |
| `server/utils/balance/spend-breakdown.ts:49-70` | `edit_plan` в группу «Сценарии и критик» |
| `server/api/videos/[id]/rerun-step.post.ts:1` | `edit_plan` в `VALID_STEPS` |
| `shared/types/video.ts:27,140,149` | Вторая копия ключей шага |
| `app/components/video/VideoStatusMap.ts:31,48` | Название шага и признак дешевизны |
| `server/utils/storage/keys.ts` | Ключ фона библиотеки |
| `vitest.pure.config.ts:17-51` | Каталог `tests/unit/edit-plan/**` |

---

### Task 1: Схема монтажа — профиль, библиотека фонов, кадры

Три таблицы одной миграцией: `VideoShot` ссылается и на `BackgroundClip`, и на ролик, поэтому раздельные миграции оставили бы промежуточное состояние с висящим внешним ключом.

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260819000000_add_edit_plan/migration.sql`
- Modify: `server/utils/storage/keys.ts`
- Test: `tests/integration/edit-plan.spec.ts`

**Interfaces:**
- Consumes: ничего.
- Produces: prisma-модели `EditProfile`, `BackgroundClip`, `VideoShot`; поля `Video.editProfileId: number | null`, `Video.editOverrides: Json | null`; значение `VideoStepKey.edit_plan`; `StorageKeys.backgroundClip(appId, sha1, ext): string`.

- [ ] **Step 1: Написать падающий тест**

Создать `tests/integration/edit-plan.spec.ts`:

```ts
import { beforeAll, describe, expect, it } from "vitest"

import { prisma } from "~~/server/utils/prisma"

let appId: number
let videoId: number

beforeAll(async () => {
  const app = await prisma.app.create({ data: { name: "edit-plan-test" } })
  appId = app.id
  const scenario = await prisma.scenario.create({ data: { status: "draft" } })
  const video = await prisma.video.create({ data: { scenarioId: scenario.id, editPipeline: true } })
  videoId = video.id
})

describe("схема монтажа", () => {
  it("хранит профиль с правилами и версией модели", async () => {
    const profile = await prisma.editProfile.create({
      data: {
        appId,
        name: "Reforma / базовый",
        editPrompt: "Чередуй крупный и средний план ведущей каждые 5 секунд.",
        llmModelId: "claude-sonnet-4-6",
      },
    })

    // Дефолты — решения от 14.08 и §5.2 спеки, а не вкус исполнителя.
    expect(profile.brollRatio).toBeCloseTo(0.4, 6)
    expect(profile.shotChangeSec).toBeCloseTo(1.8, 6)
    expect(profile.generativeVideoEnabled).toBe(false)
    expect(profile.stepwiseApproval).toBe(false)
  })

  it("ролик наследует профиль и может перебить его полем", async () => {
    const profile = await prisma.editProfile.findFirst({ where: { appId } })

    const updated = await prisma.video.update({
      where: { id: videoId },
      data: { editProfileId: profile!.id, editOverrides: { pipEnabled: true } },
    })

    expect(updated.editProfileId).toBe(profile!.id)
    expect(updated.editOverrides).toMatchObject({ pipEnabled: true })
  })

  it("дедуплицирует фон по sha1 в пределах приложения", async () => {
    await prisma.backgroundClip.create({
      data: {
        appId,
        name: "Запись экрана: лид-магнит",
        storageKey: `apps/${appId}/backgrounds/aaaa1111.mp4`,
        sha1: "aaaa1111",
        kind: "screen_recording",
        durationSec: 8.4,
      },
    })

    await expect(prisma.backgroundClip.create({
      data: {
        appId,
        storageKey: "другой ключ",
        sha1: "aaaa1111",
        kind: "screen_recording",
      },
    })).rejects.toThrow()
  })

  it("хранит кадр ролика отдельной строкой", async () => {
    const background = await prisma.backgroundClip.findFirst({ where: { appId } })

    const shot = await prisma.videoShot.create({
      data: {
        videoId,
        order: 0,
        startSec: 0,
        endSec: 1.8,
        sceneOrder: 1,
        foreground: "presenter",
        background: "library",
        backgroundClipId: background!.id,
        idea: "Ведущая в кадре, фоном запись экрана",
      },
    })

    expect(shot.status).toBe("planned")
    expect(shot.pipEnabled).toBe(false)
    // Пара (ролик, порядок) уникальна: два кадра на одну позицию — это дыра
    // либо нахлёст в таймлайне.
    await expect(prisma.videoShot.create({
      data: { videoId, order: 0, startSec: 1.8, endSec: 3.6, foreground: "none", background: "none" },
    })).rejects.toThrow()
  })

  it("удаление фона не уносит кадры, которые его использовали", async () => {
    const background = await prisma.backgroundClip.findFirst({ where: { appId } })

    await prisma.backgroundClip.delete({ where: { id: background!.id } })

    const shot = await prisma.videoShot.findFirst({ where: { videoId, order: 0 } })
    // Кадр уже отрендерен и уехал в готовый ролик — снести его вместе с
    // исходником значит переписать историю.
    expect(shot).not.toBeNull()
    expect(shot!.backgroundClipId).toBeNull()
  })

  it("удаление ролика уносит его кадры", async () => {
    const scenario = await prisma.scenario.create({ data: { status: "draft" } })
    const temp = await prisma.video.create({ data: { scenarioId: scenario.id } })
    await prisma.videoShot.create({
      data: { videoId: temp.id, order: 0, startSec: 0, endSec: 2, foreground: "none", background: "none" },
    })

    await prisma.video.delete({ where: { id: temp.id } })

    expect(await prisma.videoShot.count({ where: { videoId: temp.id } })).toBe(0)
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `bunx vitest run tests/integration/edit-plan.spec.ts`
Expected: FAIL — `prisma.editProfile` не существует.

- [ ] **Step 3: Описать модели в схеме**

В `prisma/schema.prisma` добавить значение в `enum VideoStepKey` (:559) — **в конец**, как `transcription`:

```prisma
  edit_plan
```

Новые модели (рядом с `ScenarioGenerationProfile`, чтобы профили лежали вместе):

```prisma
/// Монтажный профиль бренда: правила, по которым режется ролик.
///
/// Правил монтажа как сущности в проекте не было вовсе — всё, что можно было
/// сделать, это переписать промпт сценариста (spec §1.4). Профиль принадлежит
/// приложению (бренду); ролик наследует его и может перебить отдельными полями
/// через Video.editOverrides.
model EditProfile {
  id                       Int      @id @default(autoincrement())
  appId                    Int?
  app                      App?     @relation(fields: [appId], references: [id], onDelete: SetNull)
  name                     String
  description              String?
  isDefault                Boolean  @default(false)
  /// Правила словами: чередование ведущих, что под кого подставлять, чем
  /// открывать ролик. Уходит в системный промпт монтажного агента.
  editPrompt               String?
  /// Целевая доля перебивок по хронометражу. 0.4 — решение от 14.08.2026.
  brollRatio               Float    @default(0.4)
  /// Целевой шаг смены картинки. 1.5-2 с — практика короткого видео (§1.3).
  shotChangeSec            Float    @default(1.8)
  pipEnabled               Boolean  @default(false)
  /// Угол наложения: top_left | top_right | bottom_left | bottom_right.
  pipPosition              String   @default("bottom_right")
  /// Доля ширины кадра под PiP-окно.
  pipSize                  Float    @default(0.28)
  /// Разворот решения от 14.08: генеративное видео на фон разрешено ОПЦИЕЙ
  /// профиля и только для кадров от 5 секунд (§7). По умолчанию выключено.
  generativeVideoEnabled   Boolean  @default(false)
  /// Потолок расхода на генеративные фоны в пределах одного ролика.
  generativeVideoBudgetUsd Float    @default(0.5)
  /// Разрешение генеративного фона — значение из constraints спеки модели.
  generativeVideoResolution String  @default("720p")
  /// Пошаговый режим: пайплайн ждёт решения оператора после каждого шага.
  /// Механизм ожидания — план 4 (§9); здесь только сам флаг профиля.
  stepwiseApproval         Boolean  @default(false)
  /// Конкретная версия модели монтажа. Полуавтоматические системы тестируются
  /// на конкретной версии: смена версии молча меняет поведение (§5.2).
  llmModelId               String?
  createdAt                DateTime @default(now())
  updatedAt                DateTime @updatedAt
  videos                   Video[]

  @@index([appId, isDefault])
}

/// Библиотека загружаемых фонов: запись экрана, лид-магнит, канал, готовая съёмка.
///
/// Устроена как PresenterSourceClip — файл в хранилище, sha1 для дедупа,
/// перцептивный хэш и история использования для cooldown (§5.2).
model BackgroundClip {
  id              String    @id @default(cuid())
  appId           Int
  app             App       @relation(fields: [appId], references: [id], onDelete: Cascade)
  name            String?
  storageKey      String
  storageProvider String    @default("gcs")
  sha1            String
  mimeType        String?
  bytes           Int?
  /// null у статичной картинки — её длительность задаёт монтаж.
  durationSec     Float?
  width           Int?
  height          Int?
  /// screen_recording | footage | image
  kind            String    @default("footage")
  tags            String[]
  isActive        Boolean   @default(true)
  usageCount      Int       @default(0)
  lastUsedAt      DateTime?
  /// dHash первого кадра: контроль похожести (PROJECT_CONTEXT §7).
  perceptualHash  String?
  uploadedById    Int?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  shots           VideoShot[]

  @@unique([appId, sha1])
  @@index([appId, isActive, lastUsedAt])
  @@index([appId, kind])
}

/// Кадр смонтированного ролика.
///
/// Отдельная таблица, а не Json на ролике: она даёт перегенерацию одного кадра
/// без пересборки соседей, идемпотентность шага и аудит стоимости по кадрам
/// (§5.2). Перцептивный хэш кадра здесь не для галочки — при шаге монтажа
/// 1.5-2 с граница кадра почти совпадает с шагом сэмплирования отпечатка
/// ролика, и отдельный проход по готовому файлу становится не нужен.
model VideoShot {
  id               String          @id @default(cuid())
  videoId          Int
  video            Video           @relation(fields: [videoId], references: [id], onDelete: Cascade)
  /// Позиция на таймлайне. Пара (videoId, order) уникальна.
  order            Int
  startSec         Float
  endSec           Float
  /// Смысловая сцена сценария, которой принадлежит кадр. null — кадр
  /// перебивки, не привязанный к реплике.
  sceneOrder       Int?
  /// presenter | none
  foreground       String          @default("none")
  /// library | image | video | app_screen | none
  background       String          @default("none")
  backgroundClipId String?
  backgroundClip   BackgroundClip? @relation(fields: [backgroundClipId], references: [id], onDelete: SetNull)
  /// Скрин приложения как фон: id AppReferenceImage. Отдельным полем, а не
  /// общей ссылкой: у скринов свой жизненный цикл и свой каскад.
  appReferenceId   String?
  /// Смысл кадра словами — из него собирается промпт генерации фона (§7).
  idea             String?
  pipEnabled       Boolean         @default(false)
  /// planned | rendering | completed | failed | degraded
  status           String          @default("planned")
  /// Готовый файл кадра (после фона, lip-sync и композиции).
  assetPath        String?
  costUsd          Float           @default(0)
  perceptualHash   String?
  /// Почему кадр деградировал: исчерпан потолок, фон не нашёлся и т.п.
  degradeReason    String?
  createdAt        DateTime        @default(now())
  updatedAt        DateTime        @updatedAt

  @@unique([videoId, order])
  @@index([videoId, startSec])
  @@index([backgroundClipId])
}
```

В `model Video` (:747) добавить:

```prisma
  /// Монтажный профиль ролика. null — правила берутся из профиля приложения по
  /// умолчанию, а если и его нет — из констант edit-plan/profile.ts.
  editProfileId            Int?
  editProfile              EditProfile? @relation(fields: [editProfileId], references: [id], onDelete: SetNull)
  /// Переопределения полей профиля на этом ролике. Частичный объект тех же
  /// полей; слияние делает resolveEditProfile.
  editOverrides            Json?
  shots                    VideoShot[]
```

и индекс `@@index([editProfileId])`.

В `model App` (:173) добавить обратные связи рядом с `generationProfiles`:

```prisma
  editProfiles         EditProfile[]
  backgroundClips      BackgroundClip[]
```

- [ ] **Step 4: Создать миграцию**

Создать `prisma/migrations/20260819000000_add_edit_plan/migration.sql`:

```sql
-- AlterEnum
ALTER TYPE "VideoStepKey" ADD VALUE 'edit_plan';

-- CreateTable
CREATE TABLE "EditProfile" (
    "id" SERIAL NOT NULL,
    "appId" INTEGER,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "editPrompt" TEXT,
    "brollRatio" DOUBLE PRECISION NOT NULL DEFAULT 0.4,
    "shotChangeSec" DOUBLE PRECISION NOT NULL DEFAULT 1.8,
    "pipEnabled" BOOLEAN NOT NULL DEFAULT false,
    "pipPosition" TEXT NOT NULL DEFAULT 'bottom_right',
    "pipSize" DOUBLE PRECISION NOT NULL DEFAULT 0.28,
    "generativeVideoEnabled" BOOLEAN NOT NULL DEFAULT false,
    "generativeVideoBudgetUsd" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "generativeVideoResolution" TEXT NOT NULL DEFAULT '720p',
    "stepwiseApproval" BOOLEAN NOT NULL DEFAULT false,
    "llmModelId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EditProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackgroundClip" (
    "id" TEXT NOT NULL,
    "appId" INTEGER NOT NULL,
    "name" TEXT,
    "storageKey" TEXT NOT NULL,
    "storageProvider" TEXT NOT NULL DEFAULT 'gcs',
    "sha1" TEXT NOT NULL,
    "mimeType" TEXT,
    "bytes" INTEGER,
    "durationSec" DOUBLE PRECISION,
    "width" INTEGER,
    "height" INTEGER,
    "kind" TEXT NOT NULL DEFAULT 'footage',
    "tags" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "perceptualHash" TEXT,
    "uploadedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackgroundClip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoShot" (
    "id" TEXT NOT NULL,
    "videoId" INTEGER NOT NULL,
    "order" INTEGER NOT NULL,
    "startSec" DOUBLE PRECISION NOT NULL,
    "endSec" DOUBLE PRECISION NOT NULL,
    "sceneOrder" INTEGER,
    "foreground" TEXT NOT NULL DEFAULT 'none',
    "background" TEXT NOT NULL DEFAULT 'none',
    "backgroundClipId" TEXT,
    "appReferenceId" TEXT,
    "idea" TEXT,
    "pipEnabled" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "assetPath" TEXT,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "perceptualHash" TEXT,
    "degradeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoShot_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "editProfileId" INTEGER,
ADD COLUMN     "editOverrides" JSONB;

-- CreateIndex
CREATE INDEX "EditProfile_appId_isDefault_idx" ON "EditProfile"("appId", "isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "BackgroundClip_appId_sha1_key" ON "BackgroundClip"("appId", "sha1");

-- CreateIndex
CREATE INDEX "BackgroundClip_appId_isActive_lastUsedAt_idx" ON "BackgroundClip"("appId", "isActive", "lastUsedAt");

-- CreateIndex
CREATE INDEX "BackgroundClip_appId_kind_idx" ON "BackgroundClip"("appId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "VideoShot_videoId_order_key" ON "VideoShot"("videoId", "order");

-- CreateIndex
CREATE INDEX "VideoShot_videoId_startSec_idx" ON "VideoShot"("videoId", "startSec");

-- CreateIndex
CREATE INDEX "VideoShot_backgroundClipId_idx" ON "VideoShot"("backgroundClipId");

-- CreateIndex
CREATE INDEX "Video_editProfileId_idx" ON "Video"("editProfileId");

-- AddForeignKey
ALTER TABLE "EditProfile" ADD CONSTRAINT "EditProfile_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackgroundClip" ADD CONSTRAINT "BackgroundClip_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoShot" ADD CONSTRAINT "VideoShot_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoShot" ADD CONSTRAINT "VideoShot_backgroundClipId_fkey" FOREIGN KEY ("backgroundClipId") REFERENCES "BackgroundClip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_editProfileId_fkey" FOREIGN KEY ("editProfileId") REFERENCES "EditProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

Новое значение enum `edit_plan` в этой же миграции **не используется** — только объявляется. Использовать его (например в `UPDATE`) можно лишь со следующей миграции: Postgres запрещает это в той же транзакции.

- [ ] **Step 5: Применить миграцию и перегенерировать клиент**

Run: `bun run test:db:migrate && bunx prisma generate`
Expected: миграция применена.

- [ ] **Step 6: Добавить ключ хранилища для фона**

В `server/utils/storage/keys.ts` рядом с `appReferenceImage`:

```ts
  /** Фон из библиотеки монтажа. Дедуп по sha1 в пределах приложения. */
  backgroundClip: (appId: number | string, sha1: string, ext = "mp4"): string =>
    `${STORAGE_PATH_PREFIX}apps/${appId}/backgrounds/${sha1}.${ext}`,
```

- [ ] **Step 7: Запустить тест**

Run: `bunx vitest run tests/integration/edit-plan.spec.ts`
Expected: PASS, 6 тестов.

- [ ] **Step 8: Коммит**

```bash
git add prisma server/utils/storage/keys.ts tests/integration/edit-plan.spec.ts
git commit -m "feat: схема монтажа — профиль, библиотека фонов, кадры ролика"
```

---

### Task 2: Разрешение профиля — наследование и переопределение

Чистая функция: профиль приложения плюс переопределения ролика плюс дефолты. Без неё каждый потребитель начнёт читать `??` по цепочке и разойдётся с соседом.

**Files:**
- Create: `server/utils/edit-plan/types.ts`
- Create: `server/utils/edit-plan/profile.ts`
- Test: `tests/unit/edit-plan/profile.spec.ts`
- Modify: `vitest.pure.config.ts:17-51`

**Interfaces:**
- Consumes: ничего.
- Produces:
  - `ResolvedEditProfile { editPrompt: string | null, brollRatio: number, shotChangeSec: number, pipEnabled: boolean, pipPosition: PipPosition, pipSize: number, generativeVideoEnabled: boolean, generativeVideoBudgetUsd: number, generativeVideoResolution: string, stepwiseApproval: boolean, llmModelId: string | null }`
  - `PipPosition = "top_left" | "top_right" | "bottom_left" | "bottom_right"`
  - `resolveEditProfile(profile: Partial<ResolvedEditProfile> | null, overrides: unknown): ResolvedEditProfile`
  - `DEFAULT_EDIT_PROFILE: ResolvedEditProfile`
  - `ShotForeground = "presenter" | "none"`, `ShotBackground = "library" | "image" | "video" | "app_screen" | "none"`
  - `PlannedShot { order: number, startSec: number, endSec: number, sceneOrder: number | null, foreground: ShotForeground, background: ShotBackground, backgroundClipId: string | null, appReferenceId: string | null, idea: string | null, pipEnabled: boolean }`
  - `ShotPlan { shots: PlannedShot[] }`

- [ ] **Step 1: Добавить каталог в DB-free сьюту**

В `vitest.pure.config.ts` в массив `include`:

```ts
      "tests/unit/edit-plan/**/*.spec.ts",
```

- [ ] **Step 2: Написать падающий тест**

Создать `tests/unit/edit-plan/profile.spec.ts`:

```ts
import { describe, expect, it } from "vitest"

import { DEFAULT_EDIT_PROFILE, resolveEditProfile } from "~~/server/utils/edit-plan/profile"

describe("разрешение монтажного профиля", () => {
  it("без профиля и переопределений отдаёт дефолты", () => {
    const resolved = resolveEditProfile(null, null)

    expect(resolved.brollRatio).toBeCloseTo(0.4, 6)
    expect(resolved.shotChangeSec).toBeCloseTo(1.8, 6)
    expect(resolved.generativeVideoEnabled).toBe(false)
    expect(resolved).toEqual(DEFAULT_EDIT_PROFILE)
  })

  it("профиль перекрывает дефолты", () => {
    const resolved = resolveEditProfile({ brollRatio: 0.6, pipEnabled: true }, null)

    expect(resolved.brollRatio).toBeCloseTo(0.6, 6)
    expect(resolved.pipEnabled).toBe(true)
    expect(resolved.shotChangeSec).toBeCloseTo(1.8, 6)
  })

  it("переопределение ролика главнее профиля", () => {
    const resolved = resolveEditProfile({ pipEnabled: true, brollRatio: 0.6 }, { pipEnabled: false })

    expect(resolved.pipEnabled).toBe(false)
    expect(resolved.brollRatio).toBeCloseTo(0.6, 6)
  })

  it("мусор в переопределениях игнорируется, а не роняет монтаж", () => {
    // editOverrides — Json из БД, туда может приехать что угодно.
    const resolved = resolveEditProfile(null, { brollRatio: "много", pipSize: null, чужое: 1 })

    expect(resolved.brollRatio).toBeCloseTo(0.4, 6)
    expect(resolved.pipSize).toBeCloseTo(DEFAULT_EDIT_PROFILE.pipSize, 6)
  })

  it("зажимает доли в осмысленный диапазон", () => {
    // Доля перебивок 2.0 и PiP на весь кадр — это не «смелая настройка», а
    // сломанный ролик.
    const resolved = resolveEditProfile({ brollRatio: 2, pipSize: 5 }, null)

    expect(resolved.brollRatio).toBeLessThanOrEqual(1)
    expect(resolved.brollRatio).toBeGreaterThanOrEqual(0)
    expect(resolved.pipSize).toBeLessThanOrEqual(0.5)
  })

  it("не даёт шагу смены картинки уехать в ноль", () => {
    // shotChangeSec = 0 дал бы бесконечное число кадров при нарезке.
    expect(resolveEditProfile({ shotChangeSec: 0 }, null).shotChangeSec).toBeGreaterThan(0)
    expect(resolveEditProfile({ shotChangeSec: -3 }, null).shotChangeSec).toBeGreaterThan(0)
  })

  it("неизвестный угол PiP заменяется дефолтным", () => {
    expect(resolveEditProfile({ pipPosition: "середина" as never }, null).pipPosition)
      .toBe(DEFAULT_EDIT_PROFILE.pipPosition)
  })
})
```

- [ ] **Step 3: Запустить тест и убедиться, что он падает**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/edit-plan/profile.spec.ts`
Expected: FAIL — модуль не существует.

- [ ] **Step 4: Написать типы**

Создать `server/utils/edit-plan/types.ts`:

```ts
/**
 * Кадр смонтированного ролика и план кадров.
 *
 * Кадр — это отрезок таймлайна с назначенными передним и задним планом. Границы
 * считает КОД, смысл выбирает МОДЕЛЬ (spec §5.1): модель, которой поручена
 * арифметика таймлайна, рано или поздно вернёт кадры с дырой или нахлёстом, и
 * это увидит зритель.
 */

export type ShotForeground = "presenter" | "none"

export type ShotBackground = "library" | "image" | "video" | "app_screen" | "none"

export type PipPosition = "top_left" | "top_right" | "bottom_left" | "bottom_right"

export interface PlannedShot {
  order: number
  startSec: number
  endSec: number
  /** Смысловая сцена сценария. null — перебивка без своей реплики. */
  sceneOrder: number | null
  foreground: ShotForeground
  background: ShotBackground
  backgroundClipId: string | null
  appReferenceId: string | null
  /** Смысл кадра словами — вход промпта генерации фона. */
  idea: string | null
  pipEnabled: boolean
}

export interface ShotPlan {
  shots: PlannedShot[]
}
```

- [ ] **Step 5: Написать разрешение профиля**

Создать `server/utils/edit-plan/profile.ts`:

```ts
/**
 * Действующие правила монтажа для конкретного ролика.
 *
 * Три уровня: константы -> профиль приложения -> переопределения ролика.
 * Слияние живёт здесь одной функцией, потому что потребителей у него несколько
 * (планировщик кадров, выбор фона, композиция PiP), и разъехавшиеся цепочки
 * `??` дали бы ролик, смонтированный наполовину по одним правилам.
 *
 * `editOverrides` приезжает из БД как Json: там может лежать что угодно,
 * включая строку вместо числа. Поэтому каждое поле не просто читается, а
 * проверяется и зажимается — на монтаже нет места «доверимся данным».
 */

import type { PipPosition } from "./types"

export interface ResolvedEditProfile {
  editPrompt: string | null
  brollRatio: number
  shotChangeSec: number
  pipEnabled: boolean
  pipPosition: PipPosition
  pipSize: number
  generativeVideoEnabled: boolean
  generativeVideoBudgetUsd: number
  generativeVideoResolution: string
  stepwiseApproval: boolean
  llmModelId: string | null
}

const PIP_POSITIONS: readonly PipPosition[] = ["top_left", "top_right", "bottom_left", "bottom_right"]

/** Минимальный кадр. Короче — смена картинки читается как мигание, а не монтаж. */
const MIN_SHOT_CHANGE_SEC = 0.8

/** Потолок PiP-окна: половина ширины кадра. Больше — это уже не наложение. */
const MAX_PIP_SIZE = 0.5

export const DEFAULT_EDIT_PROFILE: ResolvedEditProfile = Object.freeze({
  editPrompt: null,
  brollRatio: 0.4,
  shotChangeSec: 1.8,
  pipEnabled: false,
  pipPosition: "bottom_right",
  pipSize: 0.28,
  generativeVideoEnabled: false,
  generativeVideoBudgetUsd: 0.5,
  generativeVideoResolution: "720p",
  stepwiseApproval: false,
  llmModelId: null,
})

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function resolveEditProfile(
  profile: Partial<ResolvedEditProfile> | null,
  overrides: unknown,
): ResolvedEditProfile {
  const patch = (overrides && typeof overrides === "object" ? overrides : {}) as Record<string, unknown>
  const pick = <K extends keyof ResolvedEditProfile>(key: K): unknown =>
    patch[key as string] !== undefined ? patch[key as string] : profile?.[key]

  const brollRatio = num(pick("brollRatio"))
  const shotChangeSec = num(pick("shotChangeSec"))
  const pipSize = num(pick("pipSize"))
  const budget = num(pick("generativeVideoBudgetUsd"))
  const position = text(pick("pipPosition")) as PipPosition | null

  return {
    editPrompt: text(pick("editPrompt")),
    brollRatio: brollRatio === null ? DEFAULT_EDIT_PROFILE.brollRatio : clamp(brollRatio, 0, 1),
    shotChangeSec: shotChangeSec === null || shotChangeSec < MIN_SHOT_CHANGE_SEC
      ? DEFAULT_EDIT_PROFILE.shotChangeSec
      : shotChangeSec,
    pipEnabled: bool(pick("pipEnabled")) ?? DEFAULT_EDIT_PROFILE.pipEnabled,
    pipPosition: position && PIP_POSITIONS.includes(position) ? position : DEFAULT_EDIT_PROFILE.pipPosition,
    pipSize: pipSize === null ? DEFAULT_EDIT_PROFILE.pipSize : clamp(pipSize, 0.1, MAX_PIP_SIZE),
    generativeVideoEnabled: bool(pick("generativeVideoEnabled")) ?? DEFAULT_EDIT_PROFILE.generativeVideoEnabled,
    generativeVideoBudgetUsd: budget === null || budget < 0
      ? DEFAULT_EDIT_PROFILE.generativeVideoBudgetUsd
      : budget,
    generativeVideoResolution: text(pick("generativeVideoResolution"))
      ?? DEFAULT_EDIT_PROFILE.generativeVideoResolution,
    stepwiseApproval: bool(pick("stepwiseApproval")) ?? DEFAULT_EDIT_PROFILE.stepwiseApproval,
    llmModelId: text(pick("llmModelId")),
  }
}
```

- [ ] **Step 6: Запустить тест и убедиться, что он проходит**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/edit-plan/profile.spec.ts`
Expected: PASS, 7 тестов.

- [ ] **Step 7: Коммит**

```bash
git add server/utils/edit-plan vitest.pure.config.ts tests/unit/edit-plan/profile.spec.ts
git commit -m "feat: разрешение монтажного профиля — наследование и переопределение"
```

---

### Task 3: Валидация плана кадров и детерминированный ремонт

Ядро §5.3. Модель вернёт кадры с дырой, нахлёстом или границей посреди слова — это не гипотеза, а прямое наблюдение автора разобранной системы. Сначала чиним детерминированно, повторный запрос к модели — только если ремонт не помог.

**Files:**
- Create: `server/utils/edit-plan/validate.ts`
- Create: `server/utils/edit-plan/repair.ts`
- Test: `tests/unit/edit-plan/validate.spec.ts`
- Test: `tests/unit/edit-plan/repair.spec.ts`

**Interfaces:**
- Consumes: `PlannedShot`, `ShotPlan` (Task 2); `AlignedScene`, `AlignedWord` из `server/utils/transcription/align`; `snapSecToFrame` из `server/utils/voiceover/segment-cut`.
- Produces:
  - `validateShotPlan(input: ShotPlanContext): ShotPlanViolation[]`
  - `ShotPlanContext { plan: ShotPlan, trackDurationSec: number, fps: number, alignedScenes: readonly AlignedScene[], profile: ResolvedEditProfile, lipSyncMaxDurationSec: number, minGenerativeVideoSec: number, knownBackgroundIds: ReadonlySet<string> }`
  - `ShotPlanViolation { code: ViolationCode, shotOrder: number | null, message: string }`
  - `ViolationCode = "gap" | "overlap" | "word_split" | "presenter_too_long" | "unknown_background" | "broll_ratio" | "generative_video_too_short" | "out_of_track" | "empty"`
  - `repairShotPlan(input: ShotPlanContext): { plan: ShotPlan, repaired: ShotPlanViolation[] }`

- [ ] **Step 1: Написать падающий тест валидации**

Создать `tests/unit/edit-plan/validate.spec.ts`:

```ts
import { describe, expect, it } from "vitest"

import { DEFAULT_EDIT_PROFILE } from "~~/server/utils/edit-plan/profile"
import { validateShotPlan } from "~~/server/utils/edit-plan/validate"
import type { PlannedShot } from "~~/server/utils/edit-plan/types"

const WORDS = [
  { text: "первое", startSec: 0, endSec: 0.9, matched: true },
  { text: "второе", startSec: 1.0, endSec: 1.9, matched: true },
  { text: "третье", startSec: 2.1, endSec: 3.0, matched: true },
]

const SCENES = [{ order: 1, startSec: 0, endSec: 3.0, words: WORDS }]

function shot(overrides: Partial<PlannedShot> = {}): PlannedShot {
  return {
    order: 0,
    startSec: 0,
    endSec: 3.0,
    sceneOrder: 1,
    foreground: "presenter",
    background: "none",
    backgroundClipId: null,
    appReferenceId: null,
    idea: null,
    pipEnabled: false,
    ...overrides,
  }
}

function context(shots: PlannedShot[], overrides: Record<string, unknown> = {}) {
  return {
    plan: { shots },
    trackDurationSec: 3.0,
    fps: 30,
    alignedScenes: SCENES,
    profile: DEFAULT_EDIT_PROFILE,
    lipSyncMaxDurationSec: 10,
    minGenerativeVideoSec: 5,
    knownBackgroundIds: new Set<string>(),
    ...overrides,
  } as never
}

describe("валидация плана кадров", () => {
  it("принимает план, покрывающий трек без дыр", () => {
    const violations = validateShotPlan(context([
      shot({ order: 0, startSec: 0, endSec: 1.95 }),
      shot({ order: 1, startSec: 1.95, endSec: 3.0 }),
    ]))

    expect(violations).toEqual([])
  })

  it("ловит дыру между кадрами", () => {
    const violations = validateShotPlan(context([
      shot({ order: 0, startSec: 0, endSec: 1.0 }),
      shot({ order: 1, startSec: 1.5, endSec: 3.0 }),
    ]))

    expect(violations.map(v => v.code)).toContain("gap")
  })

  it("ловит нахлёст кадров", () => {
    const violations = validateShotPlan(context([
      shot({ order: 0, startSec: 0, endSec: 2.0 }),
      shot({ order: 1, startSec: 1.5, endSec: 3.0 }),
    ]))

    expect(violations.map(v => v.code)).toContain("overlap")
  })

  it("ловит границу посреди слова", () => {
    // 1.4 с — середина слова «второе» (1.0-1.9). Смена картинки там режет
    // слово пополам, и это слышно и видно.
    const violations = validateShotPlan(context([
      shot({ order: 0, startSec: 0, endSec: 1.4 }),
      shot({ order: 1, startSec: 1.4, endSec: 3.0 }),
    ]))

    expect(violations.map(v => v.code)).toContain("word_split")
  })

  it("ловит presenter-кадр длиннее потолка lip-sync модели", () => {
    const violations = validateShotPlan(context(
      [shot({ order: 0, startSec: 0, endSec: 12 })],
      { trackDurationSec: 12 },
    ))

    expect(violations.map(v => v.code)).toContain("presenter_too_long")
  })

  it("ловит ссылку на несуществующий фон", () => {
    const violations = validateShotPlan(context([
      shot({ order: 0, background: "library", backgroundClipId: "нет-такого" }),
    ]))

    expect(violations.map(v => v.code)).toContain("unknown_background")
  })

  it("отклоняет генеративное видео на кадре короче пяти секунд", () => {
    // §7: длительность квантуется в 5 или 10 секунд, поэтому двухсекундная
    // перебивка обошлась бы в цену пятисекундного клипа. Отклонять надо ДО
    // оплаты, а не после.
    const violations = validateShotPlan(context([
      shot({ order: 0, startSec: 0, endSec: 2.0, foreground: "none", background: "video" }),
      shot({ order: 1, startSec: 2.0, endSec: 3.0, foreground: "none", background: "none" }),
    ]))

    expect(violations.map(v => v.code)).toContain("generative_video_too_short")
  })

  it("ловит кадр за концом трека", () => {
    const violations = validateShotPlan(context([shot({ order: 0, startSec: 0, endSec: 4.5 })]))

    expect(violations.map(v => v.code)).toContain("out_of_track")
  })

  it("сообщает о доле перебивок вне допуска", () => {
    const violations = validateShotPlan(context([
      shot({ order: 0, startSec: 0, endSec: 3.0, foreground: "presenter" }),
    ]))

    // Ноль перебивок при целевых 40% — ролик целиком говорящая голова.
    expect(violations.map(v => v.code)).toContain("broll_ratio")
  })

  it("отклоняет пустой план — покрывать таймлайн нечем", () => {
    expect(validateShotPlan(context([])).map(v => v.code)).toContain("empty")
  })
})
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/edit-plan/validate.spec.ts`
Expected: FAIL — модуль не существует.

- [ ] **Step 3: Написать валидацию**

Создать `server/utils/edit-plan/validate.ts`:

```ts
/**
 * Проверка плана кадров перед тем, как за него заплатят.
 *
 * Разделение ответственности §5.1: модель выбирает смысл, код считает секунды.
 * Здесь — вторая половина. Причина не теоретическая: автор разобранной системы
 * прямо описывает, как модели «серьёзно тупили при реализации плана монтажа».
 * Модель, которой поручена арифметика таймлайна, рано или поздно вернёт кадры с
 * дырой или нахлёстом, и это увидит зритель.
 *
 * Функция чистая: ни БД, ни сети. Возвращает ВСЕ нарушения, а не первое —
 * ремонт (repair.ts) чинит их пачкой, а текст нарушений уходит в повторный
 * запрос к модели.
 */

import type { AlignedScene } from "../transcription/align"
import type { ResolvedEditProfile } from "./profile"
import type { ShotPlan } from "./types"

export type ViolationCode
  = | "gap"
    | "overlap"
    | "word_split"
    | "presenter_too_long"
    | "unknown_background"
    | "broll_ratio"
    | "generative_video_too_short"
    | "out_of_track"
    | "empty"

export interface ShotPlanViolation {
  code: ViolationCode
  /** Кадр, к которому относится нарушение. null — про план целиком. */
  shotOrder: number | null
  message: string
}

export interface ShotPlanContext {
  plan: ShotPlan
  /** Измеренная ffprobe длительность трека — верхняя граница таймлайна. */
  trackDurationSec: number
  fps: number
  alignedScenes: readonly AlignedScene[]
  profile: ResolvedEditProfile
  /** Потолок lip-sync модели: у kling-lip-sync это 10 с. */
  lipSyncMaxDurationSec: number
  /** Минимум генеративного видео: квантование 5/10 с (§7). */
  minGenerativeVideoSec: number
  knownBackgroundIds: ReadonlySet<string>
}

/** Половина кадра при 30 fps. Мельче — это шум округления, а не дыра. */
const EPSILON_SEC = 1 / 60

/** Насколько фактическая доля перебивок может разойтись с целевой. */
const RATIO_TOLERANCE = 0.15

/** Слово считается разорванным, если граница попала внутрь него глубже допуска. */
const WORD_EDGE_TOLERANCE_SEC = 0.02

export function validateShotPlan(input: ShotPlanContext): ShotPlanViolation[] {
  const shots = [...input.plan.shots].sort((a, b) => a.startSec - b.startSec)
  const violations: ShotPlanViolation[] = []

  if (shots.length === 0) {
    return [{ code: "empty", shotOrder: null, message: "План кадров пуст — покрывать таймлайн нечем" }]
  }

  const words = input.alignedScenes.flatMap(scene => scene.words)

  let cursor = 0
  let brollSeconds = 0
  let totalSeconds = 0

  for (const shot of shots) {
    const duration = shot.endSec - shot.startSec

    if (shot.startSec > cursor + EPSILON_SEC) {
      violations.push({
        code: "gap",
        shotOrder: shot.order,
        message: `Дыра ${cursor.toFixed(2)}-${shot.startSec.toFixed(2)}с перед кадром ${shot.order}`,
      })
    }
    if (shot.startSec < cursor - EPSILON_SEC) {
      violations.push({
        code: "overlap",
        shotOrder: shot.order,
        message: `Кадр ${shot.order} начинается в ${shot.startSec.toFixed(2)}с, когда предыдущий идёт до ${cursor.toFixed(2)}с`,
      })
    }
    if (shot.endSec > input.trackDurationSec + EPSILON_SEC) {
      violations.push({
        code: "out_of_track",
        shotOrder: shot.order,
        message: `Кадр ${shot.order} заканчивается в ${shot.endSec.toFixed(2)}с, а трек длится ${input.trackDurationSec.toFixed(2)}с`,
      })
    }
    if (shot.foreground === "presenter" && duration > input.lipSyncMaxDurationSec + EPSILON_SEC) {
      violations.push({
        code: "presenter_too_long",
        shotOrder: shot.order,
        message: `Кадр ${shot.order} с ведущим длится ${duration.toFixed(2)}с при потолке модели ${input.lipSyncMaxDurationSec}с`,
      })
    }
    if (shot.background === "library" && (!shot.backgroundClipId || !input.knownBackgroundIds.has(shot.backgroundClipId))) {
      violations.push({
        code: "unknown_background",
        shotOrder: shot.order,
        message: `Кадр ${shot.order} ссылается на фон ${shot.backgroundClipId ?? "(не указан)"}, которого нет в библиотеке`,
      })
    }
    if (shot.background === "video" && duration < input.minGenerativeVideoSec - EPSILON_SEC) {
      // §7: модели продают 5 или 10 секунд. Двухсекундная перебивка стоила бы
      // как пятисекундная, и три секунды оплаченного материала ушли бы в мусор.
      violations.push({
        code: "generative_video_too_short",
        shotOrder: shot.order,
        message: `Кадр ${shot.order} длится ${duration.toFixed(2)}с — генеративное видео не бывает короче ${input.minGenerativeVideoSec}с`,
      })
    }

    // Границу проверяем только внутреннюю: старт первого кадра и конец
    // последнего совпадают с границами трека и слово не рвут по построению.
    if (shot.startSec > EPSILON_SEC && splitsWord(words, shot.startSec)) {
      violations.push({
        code: "word_split",
        shotOrder: shot.order,
        message: `Граница кадра ${shot.order} в ${shot.startSec.toFixed(2)}с приходится на середину слова`,
      })
    }

    totalSeconds += duration
    if (shot.foreground !== "presenter") brollSeconds += duration
    cursor = Math.max(cursor, shot.endSec)
  }

  if (cursor < input.trackDurationSec - EPSILON_SEC) {
    violations.push({
      code: "gap",
      shotOrder: null,
      message: `Хвост трека ${cursor.toFixed(2)}-${input.trackDurationSec.toFixed(2)}с не покрыт ни одним кадром`,
    })
  }

  const actualRatio = totalSeconds > 0 ? brollSeconds / totalSeconds : 0
  if (Math.abs(actualRatio - input.profile.brollRatio) > RATIO_TOLERANCE) {
    violations.push({
      code: "broll_ratio",
      shotOrder: null,
      message: `Перебивки занимают ${Math.round(actualRatio * 100)}% при целевых ${Math.round(input.profile.brollRatio * 100)}%`,
    })
  }

  return violations
}

/** Попадает ли момент внутрь слова, а не в межсловный интервал. */
function splitsWord(words: readonly { startSec: number, endSec: number }[], atSec: number): boolean {
  return words.some(word =>
    atSec > word.startSec + WORD_EDGE_TOLERANCE_SEC && atSec < word.endSec - WORD_EDGE_TOLERANCE_SEC)
}
```

- [ ] **Step 4: Запустить тест валидации**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/edit-plan/validate.spec.ts`
Expected: PASS, 10 тестов.

- [ ] **Step 5: Написать падающий тест ремонта**

Создать `tests/unit/edit-plan/repair.spec.ts`:

```ts
import { describe, expect, it } from "vitest"

import { DEFAULT_EDIT_PROFILE } from "~~/server/utils/edit-plan/profile"
import { repairShotPlan } from "~~/server/utils/edit-plan/repair"
import { validateShotPlan } from "~~/server/utils/edit-plan/validate"
import type { PlannedShot } from "~~/server/utils/edit-plan/types"

const WORDS = [
  { text: "первое", startSec: 0, endSec: 0.9, matched: true },
  { text: "второе", startSec: 1.0, endSec: 1.9, matched: true },
  { text: "третье", startSec: 2.1, endSec: 3.0, matched: true },
]

function context(shots: PlannedShot[]) {
  return {
    plan: { shots },
    trackDurationSec: 3.0,
    fps: 30,
    alignedScenes: [{ order: 1, startSec: 0, endSec: 3.0, words: WORDS }],
    profile: DEFAULT_EDIT_PROFILE,
    lipSyncMaxDurationSec: 10,
    minGenerativeVideoSec: 5,
    knownBackgroundIds: new Set<string>(),
  } as never
}

const base: PlannedShot = {
  order: 0, startSec: 0, endSec: 3, sceneOrder: 1,
  foreground: "none", background: "none",
  backgroundClipId: null, appReferenceId: null, idea: null, pipEnabled: false,
}

describe("детерминированный ремонт плана кадров", () => {
  it("притягивает границу к ближайшему межсловному интервалу", () => {
    const { plan } = repairShotPlan(context([
      { ...base, order: 0, startSec: 0, endSec: 1.4 },
      { ...base, order: 1, startSec: 1.4, endSec: 3.0 },
    ]))

    // 1.4 — середина слова «второе» (1.0-1.9). Ближайшая щель — 1.9-2.1.
    expect(plan.shots[0]!.endSec).toBeGreaterThanOrEqual(1.9)
    expect(plan.shots[0]!.endSec).toBeLessThanOrEqual(2.1)
    expect(plan.shots[1]!.startSec).toBeCloseTo(plan.shots[0]!.endSec, 6)
  })

  it("закрывает дыру, а не оставляет её следующему проходу", () => {
    const { plan } = repairShotPlan(context([
      { ...base, order: 0, startSec: 0, endSec: 1.0 },
      { ...base, order: 1, startSec: 1.5, endSec: 3.0 },
    ]))

    expect(plan.shots[1]!.startSec).toBeCloseTo(plan.shots[0]!.endSec, 6)
  })

  it("срезает нахлёст по началу следующего кадра", () => {
    const { plan } = repairShotPlan(context([
      { ...base, order: 0, startSec: 0, endSec: 2.4 },
      { ...base, order: 1, startSec: 2.1, endSec: 3.0 },
    ]))

    expect(plan.shots[0]!.endSec).toBeLessThanOrEqual(plan.shots[1]!.startSec + 1e-6)
  })

  it("тянет последний кадр до конца трека", () => {
    const { plan } = repairShotPlan(context([{ ...base, order: 0, startSec: 0, endSec: 2.0 }]))

    expect(plan.shots[plan.shots.length - 1]!.endSec).toBeCloseTo(3.0, 3)
  })

  it("обрезает кадр, вылезший за конец трека", () => {
    const { plan } = repairShotPlan(context([{ ...base, order: 0, startSec: 0, endSec: 4.5 }]))

    expect(plan.shots[0]!.endSec).toBeLessThanOrEqual(3.0 + 1e-6)
  })

  it("деградирует генеративное видео на коротком кадре до картинки", () => {
    // §10: такая заявка отклоняется валидацией ДО оплаты, а кадр идёт
    // картинкой с движением.
    const { plan } = repairShotPlan(context([
      { ...base, order: 0, startSec: 0, endSec: 2.0, background: "video" },
      { ...base, order: 1, startSec: 2.0, endSec: 3.0 },
    ]))

    expect(plan.shots[0]!.background).toBe("image")
  })

  it("сбрасывает ссылку на несуществующий фон, а не оставляет битую", () => {
    const { plan } = repairShotPlan(context([
      { ...base, order: 0, background: "library", backgroundClipId: "нет-такого" },
    ]))

    expect(plan.shots[0]!.background).not.toBe("library")
    expect(plan.shots[0]!.backgroundClipId).toBeNull()
  })

  it("после ремонта план проходит проверку покрытия", () => {
    const ctx = context([
      { ...base, order: 0, startSec: 0, endSec: 1.4 },
      { ...base, order: 1, startSec: 1.6, endSec: 2.8 },
    ])
    const { plan } = repairShotPlan(ctx)

    const codes = validateShotPlan({ ...(ctx as never), plan } as never).map(v => v.code)
    expect(codes).not.toContain("gap")
    expect(codes).not.toContain("overlap")
    expect(codes).not.toContain("word_split")
  })

  it("перенумеровывает кадры подряд с нуля", () => {
    const { plan } = repairShotPlan(context([
      { ...base, order: 7, startSec: 1.9, endSec: 3.0 },
      { ...base, order: 3, startSec: 0, endSec: 1.9 },
    ]))

    expect(plan.shots.map(s => s.order)).toEqual([0, 1])
    expect(plan.shots[0]!.startSec).toBeCloseTo(0, 6)
  })

  it("возвращает список того, что чинил — молчать о ремонте нельзя", () => {
    const { repaired } = repairShotPlan(context([
      { ...base, order: 0, startSec: 0, endSec: 1.0 },
      { ...base, order: 1, startSec: 1.5, endSec: 3.0 },
    ]))

    expect(repaired.length).toBeGreaterThan(0)
    expect(repaired.map(v => v.code)).toContain("gap")
  })
})
```

- [ ] **Step 6: Запустить и убедиться, что падает**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/edit-plan/repair.spec.ts`
Expected: FAIL — модуль не существует.

- [ ] **Step 7: Написать ремонт**

Создать `server/utils/edit-plan/repair.ts`:

```ts
/**
 * Детерминированный ремонт плана кадров.
 *
 * §5.3: нарушения сначала чинятся притяжкой границ к ближайшему межсловному
 * интервалу, и только если после ремонта план всё ещё невалиден — идёт повторный
 * запрос к модели с текстом ошибки. Порядок именно такой, потому что второй
 * запрос стоит денег и времени, а девять из десяти нарушений — это границы,
 * которые код умеет поправить сам.
 *
 * Функция чистая и не мутирует вход: план приходит из ответа модели, и портить
 * его значит потерять то, что уйдёт в диагностику при повторном запросе.
 */

import { snapSecToFrame } from "../voiceover/segment-cut"
import type { PlannedShot, ShotPlan } from "./types"
import { validateShotPlan, type ShotPlanContext, type ShotPlanViolation } from "./validate"

/** Межсловные интервалы: пары (конец слова, начало следующего). */
interface WordGap {
  startSec: number
  endSec: number
}

function collectGaps(context: ShotPlanContext): WordGap[] {
  const words = context.alignedScenes
    .flatMap(scene => scene.words)
    .slice()
    .sort((a, b) => a.startSec - b.startSec)

  const gaps: WordGap[] = []
  for (let index = 0; index + 1 < words.length; index += 1) {
    const end = words[index]!.endSec
    const next = words[index + 1]!.startSec
    if (next > end) gaps.push({ startSec: end, endSec: next })
  }
  return gaps
}

/**
 * Ближайшая точка, в которой смена картинки не рвёт слово.
 *
 * Целимся в середину щели, а не в её край: край совпадает с началом или концом
 * слова, и притяжка к кадру сдвинет его внутрь соседнего.
 */
function nearestSafePoint(gaps: readonly WordGap[], atSec: number, fps: number): number {
  if (gaps.length === 0) return snapSecToFrame(atSec, fps)

  let best = gaps[0]!
  let bestDistance = Number.POSITIVE_INFINITY
  for (const gap of gaps) {
    const middle = (gap.startSec + gap.endSec) / 2
    const distance = Math.abs(middle - atSec)
    if (distance < bestDistance) {
      bestDistance = distance
      best = gap
    }
  }
  return snapSecToFrame((best.startSec + best.endSec) / 2, fps)
}

export function repairShotPlan(
  context: ShotPlanContext,
): { plan: ShotPlan, repaired: ShotPlanViolation[] } {
  const before = validateShotPlan(context)
  const gaps = collectGaps(context)
  const { fps, trackDurationSec } = context

  const shots: PlannedShot[] = context.plan.shots
    .map(shot => ({ ...shot }))
    .sort((a, b) => a.startSec - b.startSec)

  // 1. Границы: старт первого — ноль, каждая внутренняя — безопасная точка,
  //    конец последнего — конец трека. Кадры идут встык по построению, поэтому
  //    ни дыр, ни нахлёстов после этого прохода не остаётся.
  for (let index = 0; index < shots.length; index += 1) {
    const shot = shots[index]!
    shot.startSec = index === 0
      ? 0
      : shots[index - 1]!.endSec

    if (index === shots.length - 1) {
      shot.endSec = snapSecToFrame(trackDurationSec, fps)
      continue
    }

    const desiredEnd = Math.min(shot.endSec, trackDurationSec)
    const safeEnd = nearestSafePoint(gaps, desiredEnd, fps)
    // Кадр нулевой длины хуже кадра неровной длины: он ничего не показывает,
    // но занимает строку и стоит денег на генерацию фона.
    shot.endSec = Math.max(safeEnd, shot.startSec + 1 / Math.max(fps, 1))
  }

  // 2. Источники, которые нельзя оставить: несуществующий фон и генеративное
  //    видео на коротком кадре (§7, §10).
  for (const shot of shots) {
    if (shot.background === "library"
      && (!shot.backgroundClipId || !context.knownBackgroundIds.has(shot.backgroundClipId))) {
      shot.background = shot.foreground === "presenter" ? "none" : "image"
      shot.backgroundClipId = null
    }
    if (shot.background === "video"
      && shot.endSec - shot.startSec < context.minGenerativeVideoSec) {
      shot.background = "image"
    }
  }

  // 3. Нумерация подряд с нуля: order — ключ (videoId, order) в БД и позиция в
  //    склейке; дырки в нём означают потерянный кадр.
  shots.forEach((shot, index) => { shot.order = index })

  return { plan: { shots }, repaired: before }
}
```

- [ ] **Step 8: Запустить тест ремонта**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/edit-plan/repair.spec.ts`
Expected: PASS, 10 тестов.

- [ ] **Step 9: Коммит**

```bash
git add server/utils/edit-plan/validate.ts server/utils/edit-plan/repair.ts tests/unit/edit-plan
git commit -m "feat: валидация плана кадров и детерминированный ремонт границ"
```

---

### Task 4: Дробление длинной реплики и выбор источника фона

Две чистые функции, обе — про то, чего модель не должна решать сама.

**Files:**
- Create: `server/utils/edit-plan/split-line.ts`
- Create: `server/utils/edit-plan/background-source.ts`
- Test: `tests/unit/edit-plan/split-line.spec.ts`
- Test: `tests/unit/edit-plan/background-source.spec.ts`

**Interfaces:**
- Consumes: `AlignedScene` (`server/utils/transcription/align`), `ResolvedEditProfile` (Task 2), `ShotBackground` (Task 2).
- Produces:
  - `splitLongPresenterLine(input: SplitLineInput): SplitLineResult`
  - `SplitLineInput { scene: AlignedScene, maxDurationSec: number, fps: number, brollAllowed: boolean }`
  - `SplitLineResult { parts: Array<{ startSec: number, endSec: number }>, interludes: Array<{ startSec: number, endSec: number }>, warning: string | null }`
  - `pickBackgroundSource(input: BackgroundPickInput): BackgroundPick`
  - `BackgroundPickInput { durationSec: number, profile: ResolvedEditProfile, requested: ShotBackground, spentUsd: number, hasLibraryCandidate: boolean, hasAppScreen: boolean, generativeVideoUsdPerSec: number, imageUsd: number, minGenerativeVideoSec: number }`
  - `BackgroundPick { background: ShotBackground, costUsd: number, degradeReason: string | null }`

- [ ] **Step 1: Написать падающий тест дробления**

Создать `tests/unit/edit-plan/split-line.spec.ts`:

```ts
import { describe, expect, it } from "vitest"

import { splitLongPresenterLine } from "~~/server/utils/edit-plan/split-line"

function scene(words: Array<[string, number, number]>) {
  return {
    order: 1,
    startSec: words[0]![1],
    endSec: words[words.length - 1]![2],
    words: words.map(([text, startSec, endSec]) => ({ text, startSec, endSec, matched: true })),
  }
}

describe("дробление реплики длиннее потолка модели", () => {
  it("не трогает реплику, которая влезает в потолок", () => {
    const result = splitLongPresenterLine({
      scene: scene([["раз", 0, 1], ["два", 1, 2]]),
      maxDurationSec: 10,
      fps: 30,
      brollAllowed: true,
    })

    expect(result.parts).toEqual([{ startSec: 0, endSec: 2 }])
    expect(result.interludes).toEqual([])
    expect(result.warning).toBeNull()
  })

  it("режет по самой длинной паузе внутри реплики", () => {
    // §5.3 п.1: там смена плана выглядит намеренной.
    const result = splitLongPresenterLine({
      scene: scene([
        ["раз", 0, 3], ["два", 3.2, 6],
        ["три", 8, 11], ["четыре", 11.2, 13],
      ]),
      maxDurationSec: 10,
      fps: 30,
      brollAllowed: false,
    })

    expect(result.parts).toHaveLength(2)
    // Пауза 6.0-8.0 — самая длинная, рез идёт в неё.
    expect(result.parts[0]!.endSec).toBeGreaterThanOrEqual(6)
    expect(result.parts[0]!.endSec).toBeLessThanOrEqual(8)
    expect(result.warning).toBeNull()
  })

  it("ставит между частями перебивку, если пауза не годится", () => {
    // §5.3 п.2: тогда склейка двух ракурсов ведущего вообще не встречается.
    const result = splitLongPresenterLine({
      scene: scene([
        ["раз", 0, 5.9], ["два", 5.95, 11.8],
      ]),
      maxDurationSec: 10,
      fps: 30,
      brollAllowed: true,
    })

    expect(result.parts.length).toBeGreaterThanOrEqual(2)
    expect(result.interludes.length).toBeGreaterThanOrEqual(1)
  })

  it("режет по межсловному интервалу с WARN, когда перебивка запрещена", () => {
    // §5.3 п.3: и только если запрещено и это.
    const result = splitLongPresenterLine({
      scene: scene([["раз", 0, 5.9], ["два", 5.95, 11.8]]),
      maxDurationSec: 10,
      fps: 30,
      brollAllowed: false,
    })

    expect(result.parts.length).toBeGreaterThanOrEqual(2)
    expect(result.interludes).toEqual([])
    expect(result.warning).toMatch(/WARN/)
  })

  it("ни одна часть не длиннее потолка модели", () => {
    const result = splitLongPresenterLine({
      scene: scene([
        ["а", 0, 8], ["б", 8.1, 16], ["в", 16.1, 24],
      ]),
      maxDurationSec: 10,
      fps: 30,
      brollAllowed: true,
    })

    for (const part of result.parts) {
      expect(part.endSec - part.startSec).toBeLessThanOrEqual(10 + 1e-6)
    }
  })

  it("части и перебивки покрывают реплику без дыр", () => {
    const result = splitLongPresenterLine({
      scene: scene([["а", 0, 6], ["б", 8, 14]]),
      maxDurationSec: 10,
      fps: 30,
      brollAllowed: true,
    })

    const covered = [...result.parts, ...result.interludes].sort((a, b) => a.startSec - b.startSec)
    expect(covered[0]!.startSec).toBeCloseTo(0, 3)
    expect(covered[covered.length - 1]!.endSec).toBeCloseTo(14, 3)
    for (let i = 1; i < covered.length; i += 1) {
      expect(covered[i]!.startSec).toBeCloseTo(covered[i - 1]!.endSec, 3)
    }
  })

  it("реплика без слов не даёт частей — резать нечего", () => {
    const result = splitLongPresenterLine({
      scene: { order: 1, startSec: 0, endSec: 0, words: [] },
      maxDurationSec: 10,
      fps: 30,
      brollAllowed: true,
    })

    expect(result.parts).toEqual([])
  })
})
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/edit-plan/split-line.spec.ts`
Expected: FAIL — модуль не существует.

- [ ] **Step 3: Написать дробление**

Создать `server/utils/edit-plan/split-line.ts`:

```ts
/**
 * Реплика длиннее потолка lip-sync модели.
 *
 * Дробить по таймеру нельзя: склейка двух вырезок из разных мест записи посреди
 * слова читается как рывок. Порядок §5.3:
 *
 *   1. резать по самой длинной паузе внутри реплики — там смена плана выглядит
 *      намеренной;
 *   2. если подходящей паузы нет — ставить между частями перебивку, тогда
 *      склейка двух ракурсов ведущего вообще не встречается в кадре;
 *   3. и только если запрещено и это — резать по ближайшему межсловному
 *      интервалу с записью WARN в лог шага.
 *
 * Функция чистая: границы приходят из выравнивания, потолок — из спеки модели.
 */

import { snapSecToFrame } from "../voiceover/segment-cut"
import type { AlignedScene } from "../transcription/align"

export interface SplitLineInput {
  scene: AlignedScene
  /** Потолок lip-sync модели: у kling-lip-sync это 10 с. */
  maxDurationSec: number
  fps: number
  /** Разрешена ли перебивка между частями (профиль может её запретить). */
  brollAllowed: boolean
}

export interface SplitLineResult {
  /** Отрезки, которые играет ведущий. */
  parts: Array<{ startSec: number, endSec: number }>
  /** Отрезки под перебивку между частями. Пусто — перебивок нет. */
  interludes: Array<{ startSec: number, endSec: number }>
  /** Заполнено, когда пришлось резать третьим способом. */
  warning: string | null
}

interface Pause {
  startSec: number
  endSec: number
  durationSec: number
}

/** Паузы между соседними словами реплики. */
function collectPauses(scene: AlignedScene): Pause[] {
  const words = [...scene.words].sort((a, b) => a.startSec - b.startSec)
  const pauses: Pause[] = []
  for (let index = 0; index + 1 < words.length; index += 1) {
    const startSec = words[index]!.endSec
    const endSec = words[index + 1]!.startSec
    if (endSec > startSec) pauses.push({ startSec, endSec, durationSec: endSec - startSec })
  }
  return pauses
}

/** Пауза достаточной длины, чтобы смена плана в ней выглядела намеренной. */
const MEANINGFUL_PAUSE_SEC = 0.35

export function splitLongPresenterLine(input: SplitLineInput): SplitLineResult {
  const { fps, maxDurationSec, scene } = input
  if (scene.words.length === 0) return { parts: [], interludes: [], warning: null }

  const startSec = snapSecToFrame(scene.startSec, fps)
  const endSec = snapSecToFrame(scene.endSec, fps)
  if (endSec - startSec <= maxDurationSec) {
    return { parts: [{ startSec, endSec }], interludes: [], warning: null }
  }

  const pauses = collectPauses(scene)
  const parts: Array<{ startSec: number, endSec: number }> = []
  const interludes: Array<{ startSec: number, endSec: number }> = []
  let warning: string | null = null

  let cursor = startSec
  while (endSec - cursor > maxDurationSec) {
    const limit = cursor + maxDurationSec
    const inRange = pauses.filter(pause => pause.startSec > cursor && pause.endSec <= limit)

    // 1. Самая длинная пауза в пределах потолка.
    const longest = inRange
      .filter(pause => pause.durationSec >= MEANINGFUL_PAUSE_SEC)
      .sort((a, b) => b.durationSec - a.durationSec)[0]

    if (longest) {
      const cut = snapSecToFrame((longest.startSec + longest.endSec) / 2, fps)
      parts.push({ startSec: cursor, endSec: cut })
      cursor = cut
      continue
    }

    // 2. Перебивка между частями: короткая пауза всё равно есть, но она мала
    //    для смены ракурса — зато её хватает, чтобы показать другой кадр.
    const shortest = inRange.sort((a, b) => b.durationSec - a.durationSec)[0]
    if (input.brollAllowed && shortest) {
      const from = snapSecToFrame(shortest.startSec, fps)
      const to = snapSecToFrame(shortest.endSec, fps)
      parts.push({ startSec: cursor, endSec: from })
      if (to > from) interludes.push({ startSec: from, endSec: to })
      cursor = to
      continue
    }

    // 3. Последняя возможность: ближайший межсловный интервал, о котором надо
    //    сказать вслух.
    const fallback = inRange[0]
    const cut = fallback
      ? snapSecToFrame((fallback.startSec + fallback.endSec) / 2, fps)
      : snapSecToFrame(limit, fps)
    warning = `WARN реплику сцены ${scene.order} пришлось резать по межсловному интервалу `
      + `в ${cut.toFixed(2)}с: подходящей паузы нет, перебивка ${input.brollAllowed ? "не помогла" : "запрещена профилем"}`
    parts.push({ startSec: cursor, endSec: cut })
    cursor = cut
  }

  if (endSec > cursor) parts.push({ startSec: cursor, endSec })

  return { parts, interludes, warning }
}
```

- [ ] **Step 4: Запустить тест дробления**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/edit-plan/split-line.spec.ts`
Expected: PASS, 7 тестов.

- [ ] **Step 5: Написать падающий тест выбора фона**

Создать `tests/unit/edit-plan/background-source.spec.ts`:

```ts
import { describe, expect, it } from "vitest"

import { pickBackgroundSource } from "~~/server/utils/edit-plan/background-source"
import { DEFAULT_EDIT_PROFILE } from "~~/server/utils/edit-plan/profile"

function input(overrides: Record<string, unknown> = {}) {
  return {
    durationSec: 6,
    profile: { ...DEFAULT_EDIT_PROFILE, generativeVideoEnabled: true, generativeVideoBudgetUsd: 0.5 },
    requested: "video" as const,
    spentUsd: 0,
    hasLibraryCandidate: false,
    hasAppScreen: false,
    generativeVideoUsdPerSec: 0.045,
    imageUsd: 0.025,
    minGenerativeVideoSec: 5,
    ...overrides,
  }
}

describe("выбор источника фона", () => {
  it("библиотека бесплатна и выигрывает у генерации", () => {
    const pick = pickBackgroundSource(input({ requested: "library", hasLibraryCandidate: true }))

    expect(pick).toMatchObject({ background: "library", costUsd: 0, degradeReason: null })
  })

  it("скрин приложения тоже бесплатен", () => {
    const pick = pickBackgroundSource(input({ requested: "app_screen", hasAppScreen: true }))

    expect(pick).toMatchObject({ background: "app_screen", costUsd: 0 })
  })

  it("считает генеративное видео по квантованной длительности", () => {
    // 6 с квантуются в 10 (REPLICATE_KLING_16_DURATIONS = [5, 10]), значит и
    // платим за 10, а не за 6.
    const pick = pickBackgroundSource(input({ durationSec: 6, profile: {
      ...DEFAULT_EDIT_PROFILE, generativeVideoEnabled: true, generativeVideoBudgetUsd: 5,
    } }))

    expect(pick.background).toBe("video")
    expect(pick.costUsd).toBeCloseTo(0.45, 6)
  })

  it("деградирует до картинки при исчерпанном потолке", () => {
    // §7: при исчерпании потолка кадр не ломается, а деградирует, и это
    // пишется в лог шага.
    const pick = pickBackgroundSource(input({ spentUsd: 0.49 }))

    expect(pick.background).toBe("image")
    expect(pick.costUsd).toBeCloseTo(0.025, 6)
    expect(pick.degradeReason).toMatch(/потолок/i)
  })

  it("деградирует до картинки на кадре короче пяти секунд", () => {
    const pick = pickBackgroundSource(input({ durationSec: 2 }))

    expect(pick.background).toBe("image")
    expect(pick.degradeReason).toMatch(/короче/i)
  })

  it("деградирует до картинки при выключенном флаге профиля", () => {
    const pick = pickBackgroundSource(input({ profile: DEFAULT_EDIT_PROFILE }))

    expect(pick.background).toBe("image")
    expect(pick.degradeReason).toMatch(/профил/i)
  })

  it("библиотека без кандидата уходит в картинку", () => {
    const pick = pickBackgroundSource(input({ requested: "library", hasLibraryCandidate: false }))

    expect(pick.background).toBe("image")
    expect(pick.degradeReason).toMatch(/библиотек/i)
  })

  it("пустой фон бесплатен и деградации не требует", () => {
    const pick = pickBackgroundSource(input({ requested: "none" }))

    expect(pick).toMatchObject({ background: "none", costUsd: 0, degradeReason: null })
  })
})
```

- [ ] **Step 6: Запустить и убедиться, что падает**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/edit-plan/background-source.spec.ts`
Expected: FAIL — модуль не существует.

- [ ] **Step 7: Написать выбор источника**

Создать `server/utils/edit-plan/background-source.ts`:

```ts
/**
 * Чем закрыть задний план кадра и во сколько это обойдётся.
 *
 * Порядок дешевизны §7: библиотека и скрин приложения бесплатны, картинка с
 * движением стоит $0.025 за кадр, генеративное видео — от $0.225 за клип.
 *
 * Потолок стоимости обязателен: на 300 роликов в сутки разница между $0.025 и
 * $0.225 за перебивку — это разница между рабочим сервисом и несогласованным
 * счётом. При исчерпании потолка кадр не ломается, а деградирует до картинки, и
 * причина возвращается наружу, чтобы вызывающий записал её в лог шага.
 *
 * Функция чистая: тарифы приходят из спек моделей, а не читаются здесь.
 */

import type { ResolvedEditProfile } from "./profile"
import type { ShotBackground } from "./types"

export interface BackgroundPickInput {
  durationSec: number
  profile: ResolvedEditProfile
  /** Что попросила модель. */
  requested: ShotBackground
  /** Сколько уже потрачено на генеративные фоны этого ролика. */
  spentUsd: number
  hasLibraryCandidate: boolean
  hasAppScreen: boolean
  generativeVideoUsdPerSec: number
  imageUsd: number
  /** Минимум генеративного видео: квантование 5/10 с. */
  minGenerativeVideoSec: number
}

export interface BackgroundPick {
  background: ShotBackground
  costUsd: number
  /** Почему просьбу модели не выполнили. null — выполнили. */
  degradeReason: string | null
}

/**
 * Длительность, за которую реально выставят счёт.
 *
 * Модели продают 5 или 10 секунд (`REPLICATE_KLING_16_DURATIONS`), поэтому
 * шестисекундный кадр оплачивается как десятисекундный. Считать по фактической
 * длине значило бы занижать смету вдвое.
 */
function billedSeconds(durationSec: number): number {
  return durationSec <= 5 ? 5 : 10
}

export function pickBackgroundSource(input: BackgroundPickInput): BackgroundPick {
  const image = (reason: string | null): BackgroundPick =>
    ({ background: "image", costUsd: input.imageUsd, degradeReason: reason })

  if (input.requested === "none") {
    return { background: "none", costUsd: 0, degradeReason: null }
  }
  if (input.requested === "library") {
    return input.hasLibraryCandidate
      ? { background: "library", costUsd: 0, degradeReason: null }
      : image("В библиотеке нет подходящего фона — кадр идёт картинкой с движением")
  }
  if (input.requested === "app_screen") {
    return input.hasAppScreen
      ? { background: "app_screen", costUsd: 0, degradeReason: null }
      : image("Скрина приложения нет — кадр идёт картинкой с движением")
  }
  if (input.requested === "image") {
    return { background: "image", costUsd: input.imageUsd, degradeReason: null }
  }

  // Дальше только генеративное видео — самый дорогой источник.
  if (!input.profile.generativeVideoEnabled) {
    return image("Генеративное видео выключено в профиле — кадр идёт картинкой с движением")
  }
  if (input.durationSec < input.minGenerativeVideoSec) {
    return image(
      `Кадр короче ${input.minGenerativeVideoSec}с — генеративное видео такой длины не продаётся, `
      + `кадр идёт картинкой с движением`,
    )
  }

  const cost = billedSeconds(input.durationSec) * input.generativeVideoUsdPerSec
  if (input.spentUsd + cost > input.profile.generativeVideoBudgetUsd) {
    return image(
      `Потолок генеративного видео $${input.profile.generativeVideoBudgetUsd.toFixed(2)} исчерпан `
      + `(потрачено $${input.spentUsd.toFixed(3)}, кадр стоил бы $${cost.toFixed(3)}) — `
      + `кадр идёт картинкой с движением`,
    )
  }

  return { background: "video", costUsd: cost, degradeReason: null }
}
```

- [ ] **Step 8: Запустить тест выбора фона**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/edit-plan/background-source.spec.ts`
Expected: PASS, 8 тестов.

- [ ] **Step 9: Коммит**

```bash
git add server/utils/edit-plan/split-line.ts server/utils/edit-plan/background-source.ts tests/unit/edit-plan
git commit -m "feat: дробление длинной реплики по паузе и выбор источника фона с потолком"
```

---

### Task 5: Шаг `edit_plan` — ключ, агент, раннер

Шаг между транскрипцией и картинкой. Ключ шага трогает не только пайплайн: есть исчерпывающие `Record`, вторая копия типов для UI, whitelist перезапуска и учёт расходов — всё это правится одной задачей, иначе проект либо не скомпилируется, либо покажет оператору латинский ключ.

**Files:**
- Modify: `server/utils/video-pipeline-db.ts:27,37-45`
- Modify: `server/utils/video-pipeline-run-policy.ts:280-296`
- Modify: `server/utils/video-pipeline-reset.ts:39-48`
- Modify: `server/utils/video-pipeline.ts:686-760,1239-1264`
- Modify: `server/utils/agents/call-anthropic.ts:53-78`
- Modify: `server/utils/balance/cost-attribution.ts:36-88`
- Modify: `server/utils/balance/spend-breakdown.ts:49-70`
- Modify: `server/api/videos/[id]/rerun-step.post.ts:1`
- Modify: `shared/types/video.ts:27,140,149`
- Modify: `app/components/video/VideoStatusMap.ts:31,48`
- Create: `server/utils/agents/edit-planner-agent.ts`
- Create: `server/utils/edit-plan/runner.ts`
- Test: `tests/unit/edit-plan/step-order.spec.ts`
- Test: `tests/unit/edit-plan/runner.spec.ts`
- Test: `tests/integration/edit-plan.spec.ts`

**Interfaces:**
- Consumes: `resolveEditProfile` (Task 2), `validateShotPlan`, `repairShotPlan` (Task 3), `splitLongPresenterLine`, `pickBackgroundSource` (Task 4).
- Produces:
  - `StepKey` пополняется значением `"edit_plan"`
  - `planEditShots(input: EditPlannerInput): Promise<ShotPlan>` (агент)
  - `runEditPlanStep(input: EditPlanStepInput, deps: EditPlanStepDeps): Promise<EditPlanStepResult>`
  - `EditPlanStepResult { status: "completed" | "repaired" | "failed", shots: PlannedShot[], costUsd: number, warnings: string[] }`

- [ ] **Step 1: Написать падающий тест порядка шагов**

Создать `tests/unit/edit-plan/step-order.spec.ts`:

```ts
import { describe, expect, it } from "vitest"

import { STEP_ORDER } from "~~/server/utils/video-pipeline-db"
import { executionOrderFor, stepsToRerunFrom } from "~~/server/utils/video-pipeline-run-policy"
import { assetTypesForSteps, STEP_ASSET_TYPES } from "~~/server/utils/video-pipeline-reset"

describe("шаг плана монтажа в порядке шагов", () => {
  it("новый ключ дописан в конец STEP_ORDER — история роликов не переписывается", () => {
    expect(STEP_ORDER[0]).toBe("prompt_generation")
    expect(STEP_ORDER[STEP_ORDER.length - 1]).toBe("edit_plan")
  })

  it("на audio-first план монтажа идёт после транскрипции и до картинок", () => {
    const order = executionOrderFor(true)

    expect(order.indexOf("transcription")).toBeLessThan(order.indexOf("edit_plan"))
    expect(order.indexOf("edit_plan")).toBeLessThan(order.indexOf("image_generation"))
  })

  it("на старом маршруте шага нет вовсе", () => {
    expect(executionOrderFor(false)).not.toContain("edit_plan")
  })

  it("перезапуск транскрипции сбрасывает план монтажа", () => {
    expect(stepsToRerunFrom("transcription", true)).toContain("edit_plan")
  })

  it("перезапуск плана не трогает транскрипцию — она уже оплачена", () => {
    const steps = stepsToRerunFrom("edit_plan", true)

    expect(steps).not.toContain("transcription")
    expect(steps).not.toContain("voiceover_generation")
    expect(steps[0]).toBe("edit_plan")
  })

  it("у шага нет своих ассетов — кадры живут в таблице VideoShot", () => {
    expect(STEP_ASSET_TYPES.edit_plan).toEqual([])
    expect(assetTypesForSteps(["edit_plan"])).toEqual([])
  })
})
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/edit-plan/step-order.spec.ts`
Expected: FAIL — `STEP_ORDER` не содержит `edit_plan`.

- [ ] **Step 3: Разнести ключ шага по всем местам**

`server/utils/video-pipeline-db.ts`: добавить `"edit_plan"` в union `StepKey` (:27) и **в конец** `STEP_ORDER` (:37-45) — с тем же комментарием про персистентный `stepIndex`, что стоит у `transcription`.

`server/utils/video-pipeline-run-policy.ts`: в `STEP_EXECUTION_ORDER_AUDIO_FIRST` (:280) вставить `"edit_plan"` **между** `"transcription"` и `"image_generation"`. `STEP_EXECUTION_ORDER` (:264) не трогать: на старом маршруте шага не существует.

`server/utils/video-pipeline-reset.ts`: в `STEP_ASSET_TYPES` (:39) добавить

```ts
  // Кадры живут в таблице VideoShot, а не в VideoAsset: их чистит отдельная
  // ветка каскада в rerunVideoStep.
  edit_plan: [],
```

`shared/types/video.ts`: добавить `"edit_plan"` во второй `VideoStepKey` (:27), в `STEP_LABELS` (:140) со значением `"План монтажа"` и в `STEP_ORDER` (:149) **сразу после `transcription`** (этот список задаёт порядок строк в UI и не обязан совпадать с персистентным `stepIndex`).

`app/components/video/VideoStatusMap.ts`: `VIDEO_STEP_LABELS` (:31) — `edit_plan: 'План монтажа'`; `VIDEO_STEP_IS_CHEAP` (:48) — `edit_plan: true` (один вызов LLM, повтор не требует модалки с ценой).

`server/api/videos/[id]/rerun-step.post.ts:1`: добавить `"edit_plan"` в `VALID_STEPS`, иначе кнопка повтора вернёт 400.

`server/utils/balance/cost-attribution.ts`: в `switch (stepKey)` (:40) добавить

```ts
    case "edit_plan":
      // План монтажа — один вызов Anthropic, как prompt_generation. Без этой
      // ветки default вернёт null, и расход не попадёт ни в AiAuditLog, ни в
      // Video.totalCostActual.
      return "anthropic"
```

`server/utils/balance/spend-breakdown.ts`: в группу `text` (:60-64) добавить `'edit_plan'` — расход того же вида, что и генерация промптов.

- [ ] **Step 4: Разрешить агенту фиксировать версию модели**

`EditProfile.llmModelId` требует, чтобы монтажный агент шёл на конкретную версию: полуавтоматические системы тестируются на конкретной версии, иначе смена версии молча меняет поведение (§5.2). `callAnthropicAgent` сейчас принимает только `tier?: 'haiku'` и берёт модель из `ANTHROPIC_MODEL` / `ANTHROPIC_HAIKU_MODEL` (`server/utils/agents/call-anthropic.ts:75-77`).

Добавить необязательную опцию:

```ts
  /**
   * Явный id модели. Задан — побеждает и `tier`, и переменные окружения.
   *
   * Нужен монтажному профилю: полуавтоматическую систему надо тестировать на
   * конкретной версии, иначе её смена меняет поведение молча (spec §5.2).
   */
  model?: string
```

и в вычислении `modelUsed` (:77):

```ts
  const modelUsed = options.model || (options.tier === 'haiku' ? haikuModel : sonnetModel)
```

Больше в этом файле ничего не менять: остальные агенты опцию не передают и их поведение не меняется.

- [ ] **Step 5: Написать монтажного агента**

Создать `server/utils/agents/edit-planner-agent.ts` по образцу `scene-prompt-validator.ts` (тот же `callAnthropicAgent`, своя `validate`). Ключевое:

- `agentName: "edit-planner"` — иначе мок-режим не найдёт заглушку и агент пойдёт по деградированной ветке;
- `model: profile.llmModelId ?? undefined`;
- системный промпт формулирует разделение §5.1 прямым текстом: модель выбирает **смысл** (что показать, каким ведущим, из какого фона, какая идея у картинки) и **не считает секунды** — границы ей даются готовыми;
- в пользовательский промпт кладутся: `editPrompt` профиля, список сцен с фактическими границами и текстом, список доступных фонов (`id`, `kind`, `name`, `tags`), список скринов приложения, целевая доля перебивок и шаг смены картинки;
- **входные границы кадров уже нарезаны кодом**: агент получает готовую сетку кадров и заполняет для каждого `foreground`, `background`, `backgroundClipId`, `idea`, `pipEnabled`. Просить у модели `startSec`/`endSec` не надо вовсе — это и есть та арифметика, на которой модели «серьёзно тупили»;
- `validate` проверяет, что вернулся массив той же длины, что и сетка, значения `foreground`/`background` из допустимых union, а `backgroundClipId` — строка или null.

- [ ] **Step 6: Написать падающий тест раннера**

Создать `tests/unit/edit-plan/runner.spec.ts` — тест шага с внедрёнными зависимостями (образец: `tests/unit/transcription/runner.spec.ts`):

```ts
import { describe, expect, it, vi } from "vitest"

import { runEditPlanStep } from "~~/server/utils/edit-plan/runner"
import { DEFAULT_EDIT_PROFILE } from "~~/server/utils/edit-plan/profile"

const ALIGNED = [
  { order: 1, startSec: 0, endSec: 4, words: [
    { text: "первое", startSec: 0, endSec: 1.8, matched: true },
    { text: "второе", startSec: 2.0, endSec: 4.0, matched: true },
  ] },
  { order: 2, startSec: 4.2, endSec: 8, words: [
    { text: "третье", startSec: 4.2, endSec: 6.0, matched: true },
    { text: "четвёртое", startSec: 6.2, endSec: 8.0, matched: true },
  ] },
]

const INPUT = {
  videoId: 7,
  trackDurationSec: 8,
  fps: 30,
  alignedScenes: ALIGNED,
  profile: { ...DEFAULT_EDIT_PROFILE },
  lipSyncMaxDurationSec: 10,
  presenterSceneOrders: [1],
  backgrounds: [],
  appScreens: [],
}

function deps(overrides: Record<string, unknown> = {}) {
  return {
    askModel: vi.fn(async (grid: Array<{ order: number }>) => ({
      shots: grid.map(cell => ({ ...cell, foreground: "none", background: "image", idea: "идея" })),
    })),
    saveShots: vi.fn(async () => {}),
    log: vi.fn(async () => {}),
    ...overrides,
  }
}

describe("шаг плана монтажа", () => {
  it("кадры покрывают трек без дыр и нахлёстов", async () => {
    const result = await runEditPlanStep(INPUT as never, deps() as never)

    expect(result.status).not.toBe("failed")
    expect(result.shots[0]!.startSec).toBeCloseTo(0, 3)
    expect(result.shots[result.shots.length - 1]!.endSec).toBeCloseTo(8, 3)
    for (let i = 1; i < result.shots.length; i += 1) {
      expect(result.shots[i]!.startSec).toBeCloseTo(result.shots[i - 1]!.endSec, 3)
    }
  })

  it("не спрашивает у модели секунды — сетка кадров считается кодом", async () => {
    const dependencies = deps()

    await runEditPlanStep(INPUT as never, dependencies as never)

    const [grid] = (dependencies.askModel as ReturnType<typeof vi.fn>).mock.calls[0]!
    // В сетке уже есть границы: модель заполняет только смысл.
    expect(grid[0]).toHaveProperty("startSec")
    expect(grid[0]).toHaveProperty("endSec")
  })

  it("чинит ответ модели детерминированно, не спрашивая её второй раз", async () => {
    const dependencies = deps({
      askModel: vi.fn(async (grid: Array<{ order: number }>) => ({
        // Модель вернула чушь в границах — ремонт обязан её пережить.
        shots: grid.map(cell => ({ ...cell, startSec: 0, endSec: 99, foreground: "none", background: "image" })),
      })),
    })

    const result = await runEditPlanStep(INPUT as never, dependencies as never)

    expect(dependencies.askModel).toHaveBeenCalledTimes(1)
    expect(result.status).toBe("repaired")
    expect(result.shots[result.shots.length - 1]!.endSec).toBeLessThanOrEqual(8 + 1e-6)
  })

  it("спрашивает модель второй раз, когда ремонт не помог", async () => {
    const dependencies = deps({
      askModel: vi.fn(async (grid: Array<{ order: number }>) => ({
        // Ссылка на несуществующий фон ремонтом чинится, а вот пустой ответ — нет.
        shots: grid.length > 0 ? [] : [],
      })),
    })

    await runEditPlanStep(INPUT as never, dependencies as never).catch(() => {})

    expect(dependencies.askModel).toHaveBeenCalledTimes(2)
  })

  it("падает честно после второй неудачи — ролик не идёт дальше с битым планом", async () => {
    const dependencies = deps({ askModel: vi.fn(async () => ({ shots: [] })) })

    await expect(runEditPlanStep(INPUT as never, dependencies as never)).rejects.toThrow(/план монтажа/i)
  })

  it("дробит presenter-сцену длиннее потолка модели", async () => {
    const long = [{ order: 1, startSec: 0, endSec: 14, words: [
      { text: "а", startSec: 0, endSec: 6, matched: true },
      { text: "б", startSec: 7, endSec: 14, matched: true },
    ] }]
    const result = await runEditPlanStep(
      { ...INPUT, alignedScenes: long, trackDurationSec: 14, presenterSceneOrders: [1] } as never,
      deps({
        askModel: vi.fn(async (grid: Array<{ order: number }>) => ({
          shots: grid.map(cell => ({ ...cell, foreground: "presenter", background: "none" })),
        })),
      }) as never,
    )

    for (const shot of result.shots.filter(s => s.foreground === "presenter")) {
      expect(shot.endSec - shot.startSec).toBeLessThanOrEqual(10 + 1e-6)
    }
  })

  it("сохраняет кадры один раз — повтор прогона не пересоздаёт их", async () => {
    const dependencies = deps()

    await runEditPlanStep(INPUT as never, dependencies as never)

    expect(dependencies.saveShots).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 7: Запустить и убедиться, что падает**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/edit-plan/runner.spec.ts`
Expected: FAIL — модуль не существует.

- [ ] **Step 8: Написать раннер**

Создать `server/utils/edit-plan/runner.ts`. Порядок работы:

1. **Сетка кадров считается кодом.** Каждая сцена выравнивания режется на кадры длиной около `profile.shotChangeSec`, границы — ближайшие межсловные интервалы, притянутые к кадру (`snapSecToFrame`). Presenter-сцены сначала проходят `splitLongPresenterLine`, и его `interludes` становятся кадрами перебивки.
2. **Модель заполняет смысл.** `deps.askModel(grid, context)` получает готовую сетку и возвращает те же кадры с `foreground`, `background`, `backgroundClipId`, `appReferenceId`, `idea`, `pipEnabled`.
3. **Валидация и ремонт.** `validateShotPlan` → если нарушения есть, `repairShotPlan` → повторная валидация. Пусто — `status: "repaired"` (если чинили) или `"completed"`.
4. **Второй запрос к модели** только если после ремонта план всё ещё невалиден; в запрос кладётся текст нарушений (§5.3). После второй неудачи шаг падает с внятной ошибкой — ролик не должен идти дальше с планом, в котором дыра.
5. **Сохранение.** `deps.saveShots(shots)` пишет `VideoShot` пачкой. Идемпотентность: продовая реализация делает `deleteMany` по `videoId` и `createMany` в одной транзакции — иначе повтор шага оставит кадры прошлого плана рядом с новыми, а `@@unique([videoId, order])` даст непонятную ошибку вместо честной перезаписи.
6. Зависимости внедряются, потому что содержательная часть шага обязана проверяться без БД, сети и денег — тот же приём, что в `transcription/runner.ts`.

- [ ] **Step 9: Встроить шаг в оркестратор**

В `server/utils/video-pipeline.ts` после блока транскрипции (`:707-738`, где заполняется `alignedScenes`) и **до** генерации изображений (`:752`):

- шаг выполняется только при `audioFirstRoute && alignedScenes.length > 0`;
- профиль читается как `resolveEditProfile(video.editProfile ?? defaultProfileOfApp, video.editOverrides)`;
- результат кладётся в переменную, которую дальше используют шаги картинки и сборки;
- расход шага пишется `chargeStep(videoId, "edit_plan", "anthropic", profile.llmModelId, cost)` — по образцу соседнего `chargeStep(videoId, "prompt_generation", ...)` на `:651`.

В `rerunVideoStep` (`:1239-1264`) после чистки ассетов добавить:

```ts
  // Кадры лежат не в VideoAsset, а в своей таблице: каскад ассетов их не знает,
  // и без этой ветки перезапуск плана оставил бы кадры прошлого рядом с новыми.
  if (stepsToReset.includes("edit_plan")) {
    const removed = await prisma.videoShot.deleteMany({ where: { videoId } })
    if (removed.count > 0) {
      await logAgent('video-pipeline', 'info',
        `Video ${videoId}: перезапуск с шага ${stepKey} — снесено ${removed.count} кадров плана монтажа`,
        { videoId },
      ).catch(() => {})
    }
  }
```

- [ ] **Step 10: Написать тест идемпотентности с БД**

Дописать в `tests/integration/edit-plan.spec.ts` проверки: повторный прогон шага не создаёт вторых кадров и не платит второй раз; перезапуск `edit_plan` сносит старые кадры; перегенерация одного кадра (обновление одной строки `VideoShot`) не трогает соседей.

- [ ] **Step 11: Прогнать сьюты**

Run: `bunx vitest run --config vitest.pure.config.ts`
Run: `bunx vitest run tests/integration/edit-plan.spec.ts`
Expected: PASS. Существующие тесты, сверяющие список ключей `STEP_ASSET_TYPES` (`tests/unit/fixes/video-pipeline-orchestration.spec.ts:29`) и мок `STEP_ORDER` (`tests/unit/fixes/duck-intervals-from-mix.spec.ts:70-84`), придётся пополнить новым ключом — это ровно те же два места, что правились при добавлении `transcription`.

- [ ] **Step 12: Коммит**

```bash
git add server/utils/edit-plan server/utils/agents/edit-planner-agent.ts server/utils/agents/call-anthropic.ts server/utils/video-pipeline-db.ts server/utils/video-pipeline-run-policy.ts server/utils/video-pipeline-reset.ts server/utils/video-pipeline.ts server/utils/balance shared/types/video.ts app/components/video/VideoStatusMap.ts server/api/videos tests
git commit -m "feat: шаг плана монтажа — сетка кадров кодом, смысл моделью, ремонт до повтора"
```

---

### Task 6: PiP строго после lip-sync

Порядок жёсткий: вырезали фрагмент → отдали в lip-sync целым кадром → и только потом кроп, маска, скругление, наложение. Модель не находит лицо в заранее вырезанном кружке и синхронизирует плохо — на этом автор разобранной системы потерял время. У нас правило закрепляется **структурно**: функция композиции принимает уже синхронизированный клип и не может быть вызвана раньше (§6.3).

**Files:**
- Create: `server/utils/video-tools/pip-compose.ts`
- Test: `tests/unit/edit-plan/pip-compose.spec.ts`
- Modify: `server/utils/lip-sync-runner.ts` (метка синхронизированного клипа)

**Interfaces:**
- Consumes: `PipPosition`, `ResolvedEditProfile` (Task 2).
- Produces:
  - `LipSyncedClipPath` — брендированная строка, создаётся только `markLipSynced`
  - `markLipSynced(path: string): LipSyncedClipPath` (экспортируется **только** из `lip-sync-runner.ts`)
  - `buildPipOverlayFilter(input: PipOverlayInput): string[]`
  - `PipOverlayInput { foreground: LipSyncedClipPath, profile: Pick<ResolvedEditProfile, "pipPosition" | "pipSize">, canvasWidth: number, canvasHeight: number, cornerRadiusPx?: number }`

- [ ] **Step 1: Написать падающий тест**

Создать `tests/unit/edit-plan/pip-compose.spec.ts`:

```ts
import { describe, expect, it } from "vitest"

import { buildPipOverlayFilter } from "~~/server/utils/video-tools/pip-compose"
import { DEFAULT_EDIT_PROFILE } from "~~/server/utils/edit-plan/profile"

// В тесте метку ставим напрямую: в проде её ставит только lip-sync-runner.
const synced = "scene_0_lipsync.mp4" as never

function filter(overrides: Record<string, unknown> = {}) {
  return buildPipOverlayFilter({
    foreground: synced,
    profile: { pipPosition: "bottom_right", pipSize: 0.28 },
    canvasWidth: 1080,
    canvasHeight: 1920,
    ...overrides,
  } as never).join(";")
}

describe("наложение ведущего поверх фона", () => {
  it("масштабирует окно по доле ширины кадра", () => {
    // 1080 * 0.28 = 302.4 -> 302 (чётное, yuv420p нечётные не кодирует).
    expect(filter()).toContain("302")
  })

  it("ставит окно в заданный угол", () => {
    expect(filter({ profile: { pipPosition: "bottom_right", pipSize: 0.28 } })).toContain("overlay=")
    expect(filter({ profile: { pipPosition: "top_left", pipSize: 0.28 } })).toMatch(/overlay=\d+:\d+/)
  })

  it("четыре угла дают четыре разные позиции", () => {
    const positions = (["top_left", "top_right", "bottom_left", "bottom_right"] as const)
      .map(pipPosition => filter({ profile: { pipPosition, pipSize: 0.28 } }))

    expect(new Set(positions).size).toBe(4)
  })

  it("скругляет углы окна", () => {
    expect(filter()).toMatch(/geq|alphaextract|format=rgba/)
  })

  it("не выпускает окно за пределы кадра", () => {
    const graph = filter({ profile: { pipPosition: "bottom_right", pipSize: 0.5 } })
    const [, x, y] = graph.match(/overlay=(\d+):(\d+)/)!

    expect(Number(x)).toBeGreaterThanOrEqual(0)
    expect(Number(y)).toBeGreaterThanOrEqual(0)
    expect(Number(x) + 540).toBeLessThanOrEqual(1080)
  })

  it("выравнивает размер окна до чётного", () => {
    const graph = filter({ profile: { pipPosition: "top_left", pipSize: 0.333 } })
    const [, width] = graph.match(/scale=(\d+):/)!

    expect(Number(width) % 2).toBe(0)
  })
})
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/edit-plan/pip-compose.spec.ts`
Expected: FAIL — модуль не существует.

- [ ] **Step 3: Написать композицию**

Создать `server/utils/video-tools/pip-compose.ts`:

```ts
/**
 * Наложение ведущего поверх фона (PiP).
 *
 * Порядок жёсткий и он не рекомендация: вырезали фрагмент -> отдали в lip-sync
 * ЦЕЛЫМ кадром -> и только потом кроп, маска, скругление, наложение (spec §6.3).
 * Модель не находит лицо в заранее вырезанном кружке и синхронизирует плохо — на
 * этом автор разобранной системы потерял время и перестраивал алгоритм.
 *
 * Правило закреплено ТИПОМ, а не комментарием: `foreground` принимает только
 * `LipSyncedClipPath`, а такую строку создаёт единственная функция
 * `markLipSynced`, экспортированная из `lip-sync-runner.ts`. Передать сюда сырой
 * фрагмент нельзя — проект не скомпилируется.
 *
 * Чистая функция: собирает `filter_complex`, процесс не запускает (по образцу
 * `buildStillClipArgs` и `buildShotVariationFilter`).
 */

import type { PipPosition } from "../edit-plan/types"

/**
 * Путь к клипу, ПРОШЕДШЕМУ lip-sync.
 *
 * Уникальный символ в типе делает строку неподделываемой: обычная строка сюда
 * не подойдёт, а привести её можно только через `markLipSynced`.
 */
declare const lipSyncedBrand: unique symbol
export type LipSyncedClipPath = string & { readonly [lipSyncedBrand]: true }

export interface PipOverlayInput {
  /** Уже синхронизированный клип ведущего. Иначе не собирается. */
  foreground: LipSyncedClipPath
  profile: { pipPosition: PipPosition, pipSize: number }
  canvasWidth: number
  canvasHeight: number
  cornerRadiusPx?: number
}

/** Отступ окна от края кадра. */
const MARGIN_PX = 32

/** Радиус скругления по умолчанию. */
const DEFAULT_CORNER_RADIUS_PX = 48

/** Чётный размер: yuv420p нечётные стороны не кодирует. */
function even(value: number): number {
  return Math.max(2, Math.floor(value / 2) * 2)
}

function positionOf(
  position: PipPosition,
  canvasWidth: number,
  canvasHeight: number,
  windowWidth: number,
  windowHeight: number,
): { x: number, y: number } {
  const right = Math.max(0, canvasWidth - windowWidth - MARGIN_PX)
  const bottom = Math.max(0, canvasHeight - windowHeight - MARGIN_PX)
  switch (position) {
    case "top_left": return { x: MARGIN_PX, y: MARGIN_PX }
    case "top_right": return { x: right, y: MARGIN_PX }
    case "bottom_left": return { x: MARGIN_PX, y: bottom }
    case "bottom_right":
    default: return { x: right, y: bottom }
  }
}

export function buildPipOverlayFilter(input: PipOverlayInput): string[] {
  const windowWidth = even(input.canvasWidth * input.profile.pipSize)
  // Окно вертикальное, как и сам кадр: ведущий в горизонтальном окне выглядит
  // обрезанным по груди.
  const windowHeight = even(windowWidth * (16 / 9))
  const radius = input.cornerRadiusPx ?? DEFAULT_CORNER_RADIUS_PX
  const { x, y } = positionOf(
    input.profile.pipPosition, input.canvasWidth, input.canvasHeight, windowWidth, windowHeight,
  )

  return [
    // Кроп по центру уже синхронизированного кадра, затем масштаб в окно.
    `[1:v]crop='min(iw,ih*9/16)':'min(ih,iw*16/9)',scale=${windowWidth}:${windowHeight},format=rgba[pipraw]`,
    // Скругление: альфа считается по расстоянию до углов.
    `[pipraw]geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(gt(`
    + `pow(max(0,${radius}-X),2)+pow(max(0,${radius}-Y),2),pow(${radius},2))*`
    + `if(lt(X,${radius})*lt(Y,${radius}),1,0),0,255)'[pip]`,
    `[0:v][pip]overlay=${x}:${y}:format=auto[vout]`,
  ]
}
```

- [ ] **Step 4: Поставить метку в lip-sync**

В `server/utils/lip-sync-runner.ts` добавить экспорт:

```ts
/**
 * Пометить клип как прошедший lip-sync.
 *
 * Единственный способ получить `LipSyncedClipPath`. Вызывать только здесь и
 * только после того, как модель вернула синхронизированный кадр: метка — это
 * утверждение о факте, а не о намерении (spec §6.3).
 */
export function markLipSynced(path: string): LipSyncedClipPath {
  return path as LipSyncedClipPath
}
```

и вызывать её там, где шаг уже записал результат в `renderedPath` — рядом с записью `LipSyncSceneRecord`.

- [ ] **Step 5: Запустить тесты**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/edit-plan/pip-compose.spec.ts`
Expected: PASS, 6 тестов.

- [ ] **Step 6: Прогнать DB-free сьюту целиком**

Run: `bunx vitest run --config vitest.pure.config.ts`
Expected: PASS.

- [ ] **Step 7: Коммит**

```bash
git add server/utils/video-tools/pip-compose.ts server/utils/lip-sync-runner.ts tests/unit/edit-plan/pip-compose.spec.ts
git commit -m "feat: PiP-композиция принимает только синхронизированный клип"
```

---

### Task 7: API профилей и библиотеки фонов

Серверная часть §9 без единой строки интерфейса: экраны идут отдельной задачей через `$design-feature` (план 4).

**Files:**
- Create: `server/api/edit-profiles/index.get.ts`
- Create: `server/api/edit-profiles/index.post.ts`
- Create: `server/api/edit-profiles/[id].put.ts`
- Create: `server/api/apps/[id]/background-clips/index.get.ts`
- Create: `server/api/apps/[id]/background-clips/index.post.ts`
- Create: `server/api/apps/[id]/background-clips/[clipId].delete.ts`
- Test: `tests/api/edit-plan-endpoints.spec.ts`

**Interfaces:**
- Consumes: prisma-модели (Task 1), `resolveEditProfile` (Task 2), `StorageKeys.backgroundClip` (Task 1), `dHashFromGrayscale` / `areFramesSimilar` (`presenter/perceptual-hash.ts`).
- Produces: HTTP-контракты профилей и фонов.

- [ ] **Step 1: Написать падающий контрактный тест**

Создать `tests/api/edit-plan-endpoints.spec.ts` по образцу существующих тестов в `tests/api/`. Проверяемое:

- `GET /api/edit-profiles?appId=N` отдаёт список, у каждого профиля — разрешённые значения (то есть прогнанные через `resolveEditProfile`), а не сырые поля с `null`;
- `POST /api/edit-profiles` создаёт профиль, отвергает `brollRatio: 2` и `shotChangeSec: 0` с 400;
- `PUT /api/edit-profiles/:id` меняет поля и не позволяет сменить `appId` на чужое приложение;
- `POST /api/apps/:id/background-clips` заливает фон, считает `sha1` и перцептивный хэш, вторая заливка того же файла возвращает существующую строку, а не создаёт вторую;
- загрузка фона, похожего на уже принятый по перцептивному хэшу, принимается, но помечается в ответе — так же, как это устроено в ingest ведущего (`similarClips`);
- `DELETE /api/apps/:id/background-clips/:clipId` помечает фон `isActive: false`, а не удаляет строку: на него могут ссылаться кадры уже собранных роликов;
- все эндпоинты требуют `requireScopedAccess` с правами и `appId` — по образцу `server/api/characters/[id]/source-clips/index.post.ts`.

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `bunx vitest run tests/api/edit-plan-endpoints.spec.ts`
Expected: FAIL — эндпоинтов нет.

- [ ] **Step 3: Написать эндпоинты**

Реализовать по контракту выше. Загрузка фона повторяет структуру `server/api/characters/[id]/source-recordings/index.post.ts`: `readMultipartFormData`, whitelist MIME (`video/mp4`, `video/quicktime`, `image/png`, `image/jpeg`, `image/webp`), предел размера, `sha1` первых 16 hex, `StorageKeys.backgroundClip`, `uploadBuffer`, строка в БД.

Эндпоинт **не должен** содержать длинный inline-pipeline (`AGENTS.md`): разбор файла и запись в БД вынести в `server/utils/edit-plan/background-store.ts`, эндпоинт только принимает запрос и делегирует.

- [ ] **Step 4: Запустить тесты**

Run: `bunx vitest run tests/api/edit-plan-endpoints.spec.ts`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add server/api/edit-profiles server/api/apps server/utils/edit-plan/background-store.ts tests/api/edit-plan-endpoints.spec.ts
git commit -m "feat: API монтажных профилей и библиотеки фонов"
```

---

## Что этот план сознательно НЕ делает

- **Не рисует ни одного экрана.** Форма профиля, библиотека фонов и таблица кадров — план 4, и они идут через `$design-feature` по правилам `AGENTS.md`: сначала макет в `design-preview`, потом интеграция отдельной задачей. Здесь только модели и API.
- **Не реализует пошаговый режим.** `EditProfile.stepwiseApproval` заводится как поле профиля, но механизм ожидания вне прогона (статус ролика, отпущенная блокировка, продолжение новым прогоном) — план 4, §9 спеки.
- **Не переписывает сборку под кадры.** `assembleVideo` продолжает склеивать клипы сцен. Переход склейки на `VideoShot` — шаг 8 спеки (§11), он зависит и от этого плана, и от плана 2, и его цена — отдельный разбор ffmpeg-графа, который не помещается в задачу рядом с миграцией.
- **Не отключает `voiceoverReconciliation`.** Это тоже шаг 8; сейчас политика уже не исполняется на audio-first (`shouldReconcileVoiceover`), и трогать её здесь незачем.
- **Не считает отпечаток ролика по кадрам.** Поле `VideoShot.perceptualHash` заводится и заполняется, но переход этапа 7 спеки от 14.08 на «отпечаток из уже посчитанных значений» — отдельная работа в контуре уникальности.
- **Не добавляет спеку генеративного видео с подтверждённой ценой.** Тариф $0.045/с взят из §7 спеки и из уже существующих спек Kling. Если для фона выберут другую модель, её цена подтверждается страницей модели, и до тех пор она `integrated: false` — Global Constraints.
- **Не трогает `planSceneKinds`.** Раскладка сцен на ведущего и перебивки (`server/utils/broll-plan.ts`) остаётся как есть: она работает по сценам и нужна старому маршруту. `edit_plan` работает по кадрам и живёт рядом.
- **Не планирует canary.** Отдельное решение владельца (`handoff-2026-08-17-audio-first.md` §6).
