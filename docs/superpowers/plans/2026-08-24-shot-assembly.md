# Сборка по кадрам: фоны кадров, PiP и непрерывный звук — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ролик маршрута «монтаж от звука» перестаёт быть склейкой клипов сцен и становится склейкой КАДРОВ из `VideoShot`: у каждого кадра свой фон (библиотека, скрин приложения, сгенерированная картинка с движением или генеративное видео), ведущий ложится поверх фона окном PiP строго после lip-sync, звук — непрерывный трек главной дорожкой, а родные дорожки картинки идут в ноль.

**Architecture:** План кадров сегодня пишется в `VideoShot` и не читается никем. Плану нужны две недостающие половины. Первая — новый платный шаг `shot_background`, который производит МЕДИА НА КАДР: библиотечный фон материализуется из хранилища, скрин приложения берётся как есть, картинка генерируется по промпту, собранному из `VideoShot.idea` новым агентом, генеративное видео заказывается только кадрам от 5 секунд в пределах потолка профиля. Вторая — сборка: клип ведущего, синхронизированный lip-sync, приводится к длине СВОЕЙ СЦЕНЫ в треке (подрезкой или удержанием последнего кадра — правится всегда видео, звук эталон), из него вырезаются подотрезки под кадры, кадр композитится с фоном, и кадры конкатятся в ролик. Субтитры переезжают со шкалы «позиция клипа в склейке» на абсолютное время трека — там же, где живут и слова выравнивания, и границы кадров. Посценные `image_generation` и `clip_generation` на кадровом маршруте выключаются: их продукт в ролик больше не попадает, а платить за него — чистый убыток.

**Tech Stack:** Nuxt 4 / Nitro, Bun, TypeScript, Prisma + PostgreSQL 16, Vitest (DB-free — `vitest.pure.config.ts`, с БД — `vitest.config.ts`), FFmpeg через `fluent-ffmpeg` и прямой `spawn`, Replicate как основной медиапровайдер, Anthropic через `callAnthropicAgent`.

**Spec:** `docs/superpowers/specs/2026-08-16-audio-first-editing-design.md` (§7, §8, §6.3, §6.4, §5.2, §10; план работ §11 пункт 8 и исполнительная половина пункта 7)

**Предшествующие планы:**
- `docs/superpowers/plans/2026-08-16-audio-first-timing.md` — выполнен: единый трек, транскрипция, выравнивание, `Video.editPipeline`.
- `docs/superpowers/plans/2026-08-17-audio-first-preflight.md` — выполнен.
- `docs/superpowers/plans/2026-08-17-presenter-recordings-and-speech-cut.md` — выполнен (записи ведущего, нарезка под речь).
- `docs/superpowers/plans/2026-08-17-edit-plan-backgrounds-pip.md` — выполнен: `EditProfile`, `BackgroundClip`, `VideoShot`, шаг `edit_plan`, `pickBackgroundSource`, `buildPipOverlayFilter`. **Этот план идёт после него и потребляет всё, что тот произвёл.**

---

## Global Constraints

- Пакетный менеджер — **Bun**, не npm (`AGENTS.md`). Тесты: `bunx vitest run ...`.
- БД меняется **только миграциями**, `prisma db push` запрещён. Существующие миграции не редактировать: контрольные суммы лежат в `_prisma_migrations`.
- Новая миграция называется датой **позже** последней применённой. Последняя применённая — `20260822030000_add_edit_profile_image_generation_flag`.
- Replicate — основной провайдер; fal только как явно настроенный fallback. Модель без цены, подтверждённой страницей модели, остаётся `integrated: false`.
- **Платные операции идемпотентны:** повтор не платит второй раз и не теряет результат. Если провайдеру заплачено — расход записан, чем бы шаг ни кончился.
- **Ролик не доходит до «готов» в заведомо сломанном виде.**
- **СТАРЫЙ МАРШРУТ НЕ ЛОМАЕТСЯ.** Ролик без `EDIT_PIPELINE` не должен изменить ни одного вызова.
- Ни одного платного вызова в тестах.
- Комментарии и сообщения об ошибках — по-русски, как в окружающем коде.
- Не создавать файлы-монстры: новая логика живёт отдельными модулями в `server/utils/edit-plan/` и `server/utils/video-tools/`.
- DB-free тесты обязаны попадать в `vitest.pure.config.ts` — там явный `include`. Каталог `tests/unit/edit-plan/**` там уже есть; новые каталоги надо дописывать.
- Ставки берутся из спек моделей (`replicateVideoBilling()`, `findMediaSpec`), **литералов цены в продакшн-коде нет**.

---

## Решения, которые этот план НЕ переоткрывает

Из `docs/operations/handoff-2026-08-17-audio-first.md` §4, `docs/operations/handoff-2026-08-18-audio-first-merged.md` §4 и журнала плана B (`.superpowers/sdd/2026-08-17-edit-plan-backgrounds-pip/progress.md`, раздел «Рулинги»):

1. **Транскрипция на audio-first обязательна.** Кадрового маршрута без выравнивания не существует.
2. **Маршрут начатого ролика не меняется задним числом.**
3. **Звук — эталон таймлайна. Он не правится никогда.** Расходится длина — правится видео (§8).
4. **Длительность трека измеряется ffprobe.**
5. **Накопитель потолка генеративного видео — `countsAgainstBudgetUsd`, НЕ `costUsd`** (Ruling B4-1). Второе включает картинки, и потолок Kling исчерпывался бы втрое быстрее.
6. **Ставка Kling — $0.05/с** (Ruling B-16). `$0.045` в коде помечена как прежняя заниженная и совпадает с тарифом чужой модели `p-video-avatar`.
7. **`generativeVideoResolution` — пиксельный формат Kling** (`1080x1920`), не `720p` (Ruling B-15).
8. **`broll_ratio` — предупреждение, не блокирующее нарушение** (Ruling B-3).
9. **PiP строго после lip-sync, и это закреплено ТИПОМ** (Ruling B6-4): `buildPipOverlayFilter` принимает только `LipSyncedClipPath`. Правильный источник такой строки — `LipSyncSceneRecord.outputPath`. **`LipSyncStepResult.clipPaths` — голый `string[]`, он смешивает синхронизированные и несинхронизированные пути: брать оттуда нельзя, слепой `as LipSyncedClipPath` писать нельзя.**
10. **Удаление фона мягкое** (`isActive: false`) — на фон ссылаются кадры собранных роликов.
11. **Дорожки клипов идут в ноль только когда единый трек ДЕЙСТВИТЕЛЬНО состоялся** — `clipVolumeWithVoiceoverFor(audioFirstTrackCompleted)`, а не сырой флаг ролика.

### Инвариант lip-sync — блокер, если сломан

`server/utils/presenter/ffmpeg-adapter.ts` и `server/utils/video-tools/ffmpeg.ts` обязаны остаться **статически недостижимыми** из `server/utils/lip-sync-runner.ts` по всему транзитивному графу value-импортов. Причина: `video-tools/ffmpeg.ts` на уровне модуля зовёт `ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH)`, и в плане A новый статический импорт в этот файл уронил четыре теста при заданном `FFMPEG_PATH`.

Механизм защиты — **динамический `import()`**, не DI и не адаптер:

```ts
const { cutRecordingWindow } = await import("./presenter/ffmpeg-adapter")
const { guardRecordingWindowFrame } = await import("./presenter/recording-window-frame-guard")
```

Плюс `import type { LipSyncedClipPath } from "./video-tools/pip-compose"` — стирается компилятором.

**Модули, которые НЕЛЬЗЯ добавлять статическим импортом в `lip-sync-runner.ts`:** `presenter/ffmpeg-adapter.ts`, `video-tools/ffmpeg.ts`, `presenter/recording-store.ts`, `presenter/recording-window-frame-guard.ts`, `edit-plan/background-store.ts`, `video-content-analyzer.ts`. **Этот план в `lip-sync-runner.ts` не пишет вовсе** — но каждая задача обязана прогнать чистую сьюту с заданными `FFMPEG_PATH`/`FFPROBE_PATH`, потому что импорт мог приехать транзитивно.

---

## Что уже проверено фактически (не перепроверять)

Снято с кода 24.08.2026 грепом и чтением. **Номера строк не приводятся намеренно — они устаревают; ходить по именам.**

### Состояние плана кадров

- `VideoShot` наполняется единственным писателем — `runVideoEditPlan` (`server/utils/video-pipeline-steps.ts`), через `deps.saveShots` → `prisma.$transaction([videoShot.deleteMany, videoShot.createMany])` со `status: "planned"`.
- **`VideoShot.assetPath` не пишется нигде.** Потребителей у таблицы нет: в `server/utils/video-pipeline.ts` переменная `editPlan` только логируется. Единственный другой читатель — каскад сброса.
- Поля `VideoShot`: `id`, `videoId`, `order`, `startSec`, `endSec`, `sceneOrder Int?`, `foreground`, `background`, `backgroundClipId String?`, `appReferenceId String?`, `idea String?`, `pipEnabled`, `status @default("planned")`, `assetPath String?`, `costUsd Float @default(0)`, `perceptualHash String?`, `degradeReason String?`. `@@unique([videoId, order])`, `@@index([videoId, startSec])`. FK: `video → Cascade`, `backgroundClip → SetNull`, `appReference → SetNull`.
- **Колонок хранилища (`storageKey`/`storageProvider`) у `VideoShot` нет.**

### Ключи шагов

- `StepKey` — union в `server/utils/video-pipeline-db.ts`; `STEP_ORDER` там же, `transcription` и `edit_plan` дописаны в КОНЕЦ намеренно (персистентный `stepIndex`).
- `enum VideoStepKey` в `prisma/schema.prisma`: `prompt_generation, image_generation, clip_generation, voiceover_generation, music_generation, lip_sync_generation, assembly, transcription, edit_plan`.
- `enum AssetType`: `image, clip, music, voiceover, voiceover_mix, thumbnail, preview, transcript`.
- `STEP_EXECUTION_ORDER_AUDIO_FIRST` (`server/utils/video-pipeline-run-policy.ts`): `prompt_generation, voiceover_generation, transcription, edit_plan, image_generation, clip_generation, lip_sync_generation, music_generation, assembly`. `stepsToRerunFrom(stepKey, editPipeline)` и `executionOrderFor(editPipeline)` живут ТАМ ЖЕ, а не в `video-pipeline-reset.ts`.
- `STEP_ASSET_TYPES` (`server/utils/video-pipeline-reset.ts`) — `Record<StepKey, readonly VideoAssetType[]>`, исчерпывающий: без записи для нового ключа проект не скомпилируется. `edit_plan: []` с комментарием «кадры живут в VideoShot».
- `VideoShot` чистится функцией `resetEditPlanShots(videoId, stepKey, stepsToReset, isAudioFirstRoute)` в `server/utils/video-pipeline.ts`; условие удаления — `stepsToReset.includes("edit_plan") || !isAudioFirstRoute`.
- Вторая, независимая копия ключей — `shared/types/video.ts`: `VideoStepKey`, `STEP_LABELS`, `STEP_ORDER`. **`lip_sync_generation` в неё не входит** (унаследованный дрейф, этот план его не чинит).
- `app/components/video/VideoStatusMap.ts`: `VIDEO_STEP_LABELS`, `VIDEO_STEP_IS_CHEAP` — оба `Record<string, …>`, не исчерпывающие, компилятор пропуск не поймает.
- `server/api/videos/[id]/rerun-step.post.ts`: `VALID_STEPS = ["prompt_generation", "image_generation", "clip_generation", "music_generation", "assembly", "transcription", "edit_plan"]`.
- `mapStepKeyToService` (`server/utils/balance/cost-attribution.ts`) — `switch (stepKey)` с `default: return null`; `image_generation` и `clip_generation` стоят одной группой `case`.
- `SPEND_GROUPS` (`server/utils/balance/spend-breakdown.ts`) — четыре группы; `video` = `['lip_sync_generation', 'clip_generation', 'image_generation']`.
- Прецедент формы миграции «`ALTER TYPE … ADD VALUE` вместе с `ALTER TABLE` в одной миграции» — `prisma/migrations/20260817000000_add_transcription_step/migration.sql`. На PG 16 в этом проекте это работает.

### Сборка сегодня

- `assembleVideo(options: AssembleOptions)` в `server/utils/render.ts`: `normalizeClipsForConcat(clips, format)` → **если задан `clipTrackAlignment`** — `fitClipsToTrack` → concat-лист → субтитры → аудиомикс `[0:a]` клипы / `[1:a]` музыка / `[2:a]` voiceover → `normalizeFileLoudness` вторым проходом.
- `AssembleOptions.clipTrackAlignment?: { alignedScenes, positionByOrder, trackDurationSec }` — на старом маршруте не передаётся, и подгон не исполняется.
- `runAssembly(videoId, clipPaths, musicPath, subtitlesEnabled, hookText, ctaText, format, videoPlan?, extras?)` в `server/utils/video-pipeline-steps.ts` — собирает `clipTrackAlignment`, делает preflight `planAlignedClipTargets` и **роняет сборку**, если подгон невозможен.
- `clipVolumeWithVoiceoverFor(audioFirstTrackCompleted)` возвращает `0` на состоявшемся треке — §6.4 уже исполняется.
- `shouldReconcileVoiceover(audioFirstTrackCompleted)` **уже потребляется** в `runVoiceoverGeneration` (`if (shouldReconcileVoiceover(videoConfig.editPipeline ?? false))`). На audio-first сам `runVoiceoverGeneration` не вызывается вовсе — ветка берёт готовый `audioFirstTrack`.
- Готовые исполнители §8 «правится видео»: `buildClipTrimArgs(targetDurationSec, audioPresent)` → `trim=0:T,setpts=PTS-STARTPTS,fps=TIMELINE_FPS`; `buildClipHoldLastFrameArgs(extraSec, audioPresent)` → `tpad=stop_mode=clone:stop_duration=E,fps=TIMELINE_FPS`; обёртки `trimFittedClip` / `holdLastFrameFittedClip`; общие опции `concatSafeVideoOutputOptions()`; путь результата `fitClipPath()` (суффикс `_fit.mp4`).
- **Вырезки ПОДОТРЕЗКА видео `[a, b]` в проекте нет.** `buildClipTrimArgs` режет только от нуля. Единственная произвольная вырезка — `buildPresenterCutArgs` в `presenter/ffmpeg-adapter.ts`, но она принудительно масштабирует в `1080:1920` и заточена под запись ведущего.
- Субтитры: `buildAssSegments` считает окна через `buildSubtitleTimeline(clipDurations, sceneSubtitles)` и берёт слова через `alignedScenesByClipPosition(alignedScenes, positionByOrder)` — то есть по **позиции клипа в склейке**.
- `AlignedScene { order, startSec, endSec, words }` и `AlignedWord { text, startSec, endSec, matched }` (`server/utils/transcription/align.ts`) — времена **абсолютные, в секундах трека**. То же пространство координат, что у `VideoShot.startSec/endSec`.
- `TIMELINE_FPS` — `shared/types/video-runtime.ts`. `snapSecToFrame`, `trackEndFrame` — `server/utils/voiceover/segment-cut.ts`.

### lip-sync на audio-first

- `runLipSyncStep(input: LipSyncStepInput): Promise<LipSyncStepResult>`. `LipSyncStepResult`: `status`, `clipPaths: string[]` (**не брендирован, смесь**), `syncedSceneCount`, `resyncedSceneCount?`, `totalCostUsd`, `modelId`, `scenes?: LipSyncSceneRecord[]`.
- `LipSyncSceneRecord`: `sceneOrder`, `sceneIndex`, `sourcePath`, `outputPath: LipSyncedClipPath | null`, `audioPath`, `spokenLineHash`, `reuseKey`, `durationSec`, `skipped?: LipSyncSkipReason | null`.
- **Длину результата lip-sync задаёт ИСХОДНИК, а не кусок трека.** В провайдера уходит `clampDurationToModelRange(measuredDurationSec, min, max)`, где `measuredDurationSec` — длина окна записи / библиотечного клипа. Кусок трека идёт отдельным `audioPath`.
- **Кода, который меряет длину РЕЗУЛЬТАТА lip-sync, не существует.** В `LipSyncSceneRecord.durationSec` и в `VideoAsset.duration` пишется длина ИСХОДНИКА. Единственная сверка — WARN в лог шага, без правки видео.
- Бренд `LipSyncedClipPath` минтит единственная функция `markLipSynced` в `lip-sync-runner.ts`; второе место — десериализация в `readPreviousSceneRecords` (задокументировано как «не минт»).

### Фоны и медиа

- `pickBackgroundSource` (`server/utils/edit-plan/background-source.ts`) уже реализует выбор источника, потолок и деградацию; возвращает в том числе `countsAgainstBudgetUsd`.
- `BackgroundClip` имеет `storageKey` (NOT NULL), **`fileUrl`/`filePath` у него НЕТ**. `ResolvedReferenceFrame` (`server/utils/media-provider/reference-frame.ts`) требует непустой `fileUrl` — `BackgroundClip` в этот механизм не влезает.
- Хелпера «дай локальный путь к `BackgroundClip`» **не существует**. `server/utils/edit-plan/background-store.ts` умеет только `saveBackgroundClip`.
- `AppReferenceImage`: `fileUrl String` (NOT NULL, legacy `/api/files/app-references/{appId}/{sha1}.{ext}`), `storageKey String?` (**nullable**), `sha1`, `mimeType?`.
- `StorageKeys` (`server/utils/storage/keys.ts`): есть `videoSceneImage(videoId, sceneOrder, ext)`, `videoSceneClip(videoId, sceneOrder)`, `backgroundClip(appId, sha1, ext)`, `appReferenceImage(appId, sha1, ext)`. **Ключа для ассета КАДРА нет.** Класть кадр под `videoSceneImage` нельзя — коллизия со сценой.
- `getAssetsDirFor(videoId)` (`server/utils/storage-paths.ts`) = `<uploads>/assets/{videoId}`; обёртки `getAssetsDir`/`getVideosDir` — в `render.ts`.
- `renderStillClip(request: StillClipRequest)` (`server/utils/video-tools/still-clip-runner.ts`) и чистая `buildStillClipArgs` (`still-clip.ts`): картинка → клип с движением, обязательный немой `anullsrc`, `MIN_STILL_DURATION_SEC = 1`. Движение выбирает `pickShotVariationPlan(sceneIndex)` — **соседние кадры одной сцены получат одинаковую панораму, если передать `sceneOrder` вместо `shot.order`**.
- Посценные шаги: `runImageGeneration(...)` и `runClipGeneration(...)` адресуют всё `scene.order` — `VideoAsset.order`, ключ хранилища, resume-ключ («длина массива равна числу сцен»), `imagePathsByScene: Map<sceneIndex, path>`. Единица работы «кадр» в них не выражается.
- `generatedCount` в обоих шагах = число задач с `task.source === "generated"`, то есть **реально оплаченных**. Перебивка через `renderStillClip` в `generatedCount` не попадает вовсе.

### Промпты

- **Генератора «одна строка `idea` → промпт картинки» не существует.**
- `runVisualStyleAgent` (`server/utils/agents/visual-style-agent.ts`) требует `scenario: { title, hook, body, cta }` + `appName`, отдаёт стиль ролика и свои 3-5 сцен. **В видео-пайплайне не вызывается нигде** — грепом только определение. Полезное поле — `imagePromptSuffix`.
- `validateScenePrompts(scenes)` (`server/utils/agents/scene-prompt-validator.ts`, tier `haiku`) — **пост-фиксер, а не генератор**. Его `validate` **бросает** при `prompt.length < 50` и при пустом `purpose`. Безопасная обёртка — `validateScenePromptsCoherence` (`server/utils/video-prompts/post-validation.ts`): глотает исключение и возвращает оригинал.
- `generateSceneImagePrompts` требует целый `StoryPlan`; пути «дай одну строку» у неё нет.
- Мок Anthropic (`server/utils/mock/anthropic-mock.ts`) грузит `server/__fixtures__/agents/<agentName>-happy.json` и **бросает**, если файла нет. Существующие фикстуры включают `edit-planner-happy.json`, `visual-style-happy.json`.
- Сквозной прогон `tests/integration/audio-first-pipeline.spec.ts` утверждает **точный список шагов** маршрута audio-first. Каждая задача, меняющая список, обязана его обновить и прогнать зелёным.

---

## File Structure

**Создаётся:**

| Файл | Ответственность |
|---|---|
| `prisma/migrations/20260824000000_add_shot_background_step/migration.sql` | Два значения в enum: шаг `shot_background` и тип ассета `shot_background`. |
| `server/utils/edit-plan/shot-media-store.ts` | Материализация фона в локальный файл: `BackgroundClip` по `storageKey`, `AppReferenceImage` по `storageKey` или legacy-пути. Листовой модуль, без ffmpeg. |
| `server/utils/video-tools/shot-cut.ts` | Чистые аргументы ffmpeg: вырезка подотрезка `[start, start+dur]` из готового видео. Без импорта `video-tools/ffmpeg.ts`. |
| `server/utils/video-tools/shot-cut-runner.ts` | `spawn` для `shot-cut.ts` — по образцу `still-clip-runner.ts`. |
| `server/utils/agents/shot-background-prompt-agent.ts` | Агент «идея кадра → промпт картинки» + детерминированный фолбэк. |
| `server/__fixtures__/agents/shot-background-prompt-happy.json` | Фикстура мока Anthropic для этого агента. |
| `server/utils/edit-plan/shot-background-runner.ts` | Чистая часть шага: что делать с каждым кадром, накопление потолка, деградация §10. |
| `server/utils/video-tools/shot-compose.ts` | Чистое планирование композиции кадра: входы ffmpeg и filter_complex, включая ветку PiP. |
| `server/utils/video-tools/shot-compose-runner.ts` | `spawn` для композиции кадра. |
| `server/utils/edit-plan/shot-subtitles.ts` | Чистое построение ASS-сегментов по АБСОЛЮТНОМУ времени трека. |
| `tests/unit/shots/**` | DB-free тесты всего перечисленного. |

**Изменяется:**

| Файл | Что именно |
|---|---|
| `prisma/schema.prisma` | `enum VideoStepKey` + `shot_background`; `enum AssetType` + `shot_background`. |
| `server/utils/video-pipeline-db.ts` | `StepKey`, `STEP_ORDER` (в конец). |
| `server/utils/video-pipeline-run-policy.ts` | `STEP_EXECUTION_ORDER_AUDIO_FIRST` (после `edit_plan`). |
| `server/utils/video-pipeline-reset.ts` | `VideoAssetType`, `STEP_ASSET_TYPES`. |
| `server/utils/balance/cost-attribution.ts` | `mapStepKeyToService`. |
| `server/utils/balance/spend-breakdown.ts` | `SPEND_GROUPS`, группа `video`. |
| `shared/types/video.ts` | `VideoStepKey`, `STEP_LABELS`, `STEP_ORDER`. |
| `app/components/video/VideoStatusMap.ts` | `VIDEO_STEP_LABELS`, `VIDEO_STEP_IS_CHEAP`. |
| `server/api/videos/[id]/rerun-step.post.ts` | `VALID_STEPS`. |
| `server/utils/video-pipeline-steps.ts` | Новый `runShotBackgrounds`; кадровая ветка `runAssembly`. |
| `server/utils/render.ts` | `AssembleOptions.shotTimeline`; кадровая ветка `assembleVideo`. |
| `server/utils/video-pipeline.ts` | Вызов нового шага, передача кадров в сборку, скип посценных шагов. |
| `vitest.pure.config.ts` | `include` для `tests/unit/shots/**`. |
| `tests/integration/audio-first-pipeline.spec.ts` | Список шагов маршрута. |

---

## Порядок шага в маршруте

```
prompt_generation
voiceover_generation      единый трек
transcription             слова с таймингами
edit_plan                 кадры в VideoShot
shot_background      ←    НОВЫЙ: медиа фона НА КАДР (платный)
image_generation          ← на кадровом маршруте ПРОПУСКАЕТСЯ (Task 7)
clip_generation           ← на кадровом маршруте ПРОПУСКАЕТСЯ (Task 7)
lip_sync_generation       клипы ведущего по сценам
music_generation
assembly                  композиция кадров + конкат + звук + субтитры
```

`shot_background` стоит **после `edit_plan`**, потому что ему нужен план кадров и не нужен lip-sync. Композиция кадра (бесплатный ffmpeg) живёт в `assembly`, а не отдельным шагом: она требует и фонов, и клипов ведущего, а платного вызова в ней нет ни одного.

---

### Task 1: Ключ шага `shot_background` разнесён по пайплайну

Задача целиком регистрационная: ни одной строки продуктовой логики. Прецедент — коммит `32b71a5` «ключ шага edit_plan разнесён по пайплайну», сделай ровно тем же приёмом.

**Files:**
- Modify: `prisma/schema.prisma` (enum `VideoStepKey`, enum `AssetType`)
- Create: `prisma/migrations/20260824000000_add_shot_background_step/migration.sql`
- Modify: `server/utils/video-pipeline-db.ts` (`StepKey`, `STEP_ORDER`)
- Modify: `server/utils/video-pipeline-run-policy.ts` (`STEP_EXECUTION_ORDER_AUDIO_FIRST`)
- Modify: `server/utils/video-pipeline-reset.ts` (`VideoAssetType`, `STEP_ASSET_TYPES`)
- Modify: `server/utils/balance/cost-attribution.ts` (`mapStepKeyToService`)
- Modify: `server/utils/balance/spend-breakdown.ts` (`SPEND_GROUPS`)
- Modify: `shared/types/video.ts` (`VideoStepKey`, `STEP_LABELS`, `STEP_ORDER`)
- Modify: `app/components/video/VideoStatusMap.ts` (`VIDEO_STEP_LABELS`, `VIDEO_STEP_IS_CHEAP`)
- Modify: `server/api/videos/[id]/rerun-step.post.ts` (`VALID_STEPS`)
- Modify: `vitest.pure.config.ts` (`include`)
- Test: `tests/unit/shots/step-order.spec.ts`

**Interfaces:**
- Produces: `StepKey` пополняется литералом `"shot_background"`; `VideoAssetType` пополняется литералом `"shot_background"`. Всё остальное в плане на это опирается.

- [ ] **Step 1: Написать падающий тест**

Создай `tests/unit/shots/step-order.spec.ts`. Образец рядом — `tests/unit/edit-plan/step-order.spec.ts`.

```ts
import { describe, expect, it } from "vitest"

import { STEP_ORDER as SERVER_STEP_ORDER } from "~~/server/utils/video-pipeline-db"
import { STEP_ASSET_TYPES } from "~~/server/utils/video-pipeline-reset"
import {
  STEP_EXECUTION_ORDER,
  STEP_EXECUTION_ORDER_AUDIO_FIRST,
  stepsToRerunFrom,
} from "~~/server/utils/video-pipeline-run-policy"
import { STEP_LABELS, STEP_ORDER as UI_STEP_ORDER } from "~~/shared/types/video"

describe("ключ шага shot_background разнесён по пайплайну", () => {
  it("дописан в КОНЕЦ персистентного STEP_ORDER — stepIndex уже записан историей", () => {
    expect(SERVER_STEP_ORDER.at(-1)).toBe("shot_background")
    // Позиции всех прежних ключей не изменились ни на единицу.
    expect(SERVER_STEP_ORDER.indexOf("assembly")).toBe(6)
    expect(SERVER_STEP_ORDER.indexOf("transcription")).toBe(7)
    expect(SERVER_STEP_ORDER.indexOf("edit_plan")).toBe(8)
  })

  it("в порядке ИСПОЛНЕНИЯ audio-first стоит сразу после edit_plan и до image_generation", () => {
    const order = STEP_EXECUTION_ORDER_AUDIO_FIRST
    expect(order.indexOf("shot_background")).toBe(order.indexOf("edit_plan") + 1)
    expect(order.indexOf("shot_background")).toBeLessThan(order.indexOf("image_generation"))
    expect(order.indexOf("shot_background")).toBeLessThan(order.indexOf("assembly"))
  })

  it("старого маршрута новый ключ не касается вовсе", () => {
    expect(STEP_EXECUTION_ORDER).not.toContain("shot_background")
  })

  it("перезапуск edit_plan тянет за собой фоны кадров, перезапуск фонов — не тянет план", () => {
    expect(stepsToRerunFrom("edit_plan", true)).toContain("shot_background")
    expect(stepsToRerunFrom("shot_background", true)).not.toContain("edit_plan")
    // Мутация «поставить shot_background ПЕРЕД edit_plan» краснит именно здесь.
    expect(stepsToRerunFrom("shot_background", true)).toContain("assembly")
  })

  it("каскад сброса сносит ассеты фонов кадров и только их", () => {
    expect(STEP_ASSET_TYPES.shot_background).toEqual(["shot_background"])
    // Кадры (VideoShot) чистит отдельная ветка — здесь их быть не должно.
    expect(STEP_ASSET_TYPES.edit_plan).toEqual([])
  })

  it("UI знает ярлык нового шага и рисует его после плана монтажа", () => {
    expect(STEP_LABELS.shot_background).toBe("Фоны кадров")
    expect(UI_STEP_ORDER.indexOf("shot_background")).toBe(UI_STEP_ORDER.indexOf("edit_plan") + 1)
  })
})
```

- [ ] **Step 2: Прогнать тест и убедиться, что он падает**

Синхронно, с ожиданием вывода, **НЕ в фоне**:

```bash
bunx vitest run --config vitest.pure.config.ts tests/unit/shots/step-order.spec.ts
```

Ожидание: FAIL. Если файл не подхватился вовсе — впиши `"tests/unit/shots/**/*.spec.ts"` в `include` в `vitest.pure.config.ts` (там явный список) и прогони снова.

- [ ] **Step 3: Схема и миграция**

В `prisma/schema.prisma` допиши в КОНЕЦ обоих enum:

```prisma
enum VideoStepKey {
  prompt_generation
  image_generation
  clip_generation
  voiceover_generation
  music_generation
  lip_sync_generation
  assembly
  transcription
  edit_plan
  shot_background
}

enum AssetType {
  image
  clip
  music
  voiceover
  voiceover_mix
  thumbnail
  preview
  transcript
  shot_background
}
```

Создай `prisma/migrations/20260824000000_add_shot_background_step/migration.sql`:

```sql
-- Шаг производства медиа фона НА КАДР (spec §7, исполнительная половина).
-- Значение дописано в конец: enum-позиции персистентны, вставка в середину
-- переписала бы историю уже записанных VideoGenerationStep.
ALTER TYPE "VideoStepKey" ADD VALUE 'shot_background';

-- Тип ассета для готового файла фона кадра. Под videoSceneImage его класть
-- нельзя: там адресация по order СЦЕНЫ, а у кадра свой order.
ALTER TYPE "AssetType" ADD VALUE 'shot_background';
```

Форма проверена прецедентом `prisma/migrations/20260817000000_add_transcription_step/migration.sql`.

Затем:

```bash
bunx prisma generate
```

- [ ] **Step 4: Разнести ключ по коду**

`server/utils/video-pipeline-db.ts` — в union и в конец массива:

```ts
export type StepKey = "prompt_generation" | "image_generation" | "clip_generation" | "voiceover_generation" | "music_generation" | "lip_sync_generation" | "assembly" | "transcription" | "edit_plan" | "shot_background"
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
  // Дописан в конец намеренно тем же приёмом, что и transcription выше.
  "edit_plan",
  // Тем же приёмом. Порядок ИСПОЛНЕНИЯ задаёт STEP_EXECUTION_ORDER_AUDIO_FIRST.
  "shot_background",
]
```

`server/utils/video-pipeline-run-policy.ts` — в `STEP_EXECUTION_ORDER_AUDIO_FIRST` сразу после `"edit_plan"` вставь `"shot_background"`. `STEP_EXECUTION_ORDER` (старый маршрут) **не трогать**.

`server/utils/video-pipeline-reset.ts`:

```ts
export type VideoAssetType = "image" | "clip" | "music" | "voiceover" | "voiceover_mix" | "thumbnail" | "preview" | "transcript" | "shot_background"
```

```ts
  // Фон кадра — свой тип ассета: у него адресация по order КАДРА, а не сцены,
  // и перезапуск шага обязан сносить именно его, не трогая посценные картинки.
  shot_background: ["shot_background"],
```

`server/utils/balance/cost-attribution.ts` — добавь `case "shot_background":` в ту же группу `case`, где уже стоят `image_generation` и `clip_generation` (сервис резолвится по id медиа-модели).

`server/utils/balance/spend-breakdown.ts` — в группу `video`:

```ts
    stepKeys: ['lip_sync_generation', 'clip_generation', 'image_generation', 'shot_background'],
```

`shared/types/video.ts` — в union, в `STEP_LABELS` (`shot_background: "Фоны кадров"`) и в `STEP_ORDER` сразу после `"edit_plan"`.

`app/components/video/VideoStatusMap.ts` — `VIDEO_STEP_LABELS.shot_background = 'Фоны кадров'`; `VIDEO_STEP_IS_CHEAP.shot_background = false` (шаг платный).

`server/api/videos/[id]/rerun-step.post.ts` — допиши `"shot_background"` в `VALID_STEPS`.

- [ ] **Step 5: Прогнать тесты и типы**

Синхронно, **НЕ в фоне**:

```bash
bunx vitest run --config vitest.pure.config.ts tests/unit/shots/step-order.spec.ts
```
Ожидание: PASS, 6 тестов.

```bash
bunx vitest run --config vitest.pure.config.ts
```
Ожидание: зелёная сьюта целиком. Затем **та же сьюта с заданными путями ffmpeg** — этим ловится нарушение инварианта lip-sync:

```bash
FFMPEG_PATH=ffmpeg FFPROBE_PATH=ffprobe bunx vitest run --config vitest.pure.config.ts
```
(в PowerShell: `$env:FFMPEG_PATH='ffmpeg'; $env:FFPROBE_PATH='ffprobe'; bunx vitest run --config vitest.pure.config.ts`)

Типы — только дифом, репозиторий не типочистый:

```bash
bunx tsc --noEmit -p .nuxt/tsconfig.server.json
```
Сравни список ошибок с тем, что даёт чистый HEAD. Новых быть не должно.

- [ ] **Step 6: Мутационная проверка**

Сломай по одной ветке и покажи в отчёте таблицей, что краснеет хотя бы один тест:

| Мутация | Ожидаемый красный тест |
|---|---|
| `shot_background` вставлен в СЕРЕДИНУ `STEP_ORDER` (перед `assembly`) | «дописан в КОНЕЦ персистентного STEP_ORDER» |
| `shot_background` поставлен ПЕРЕД `edit_plan` в `STEP_EXECUTION_ORDER_AUDIO_FIRST` | «стоит сразу после edit_plan», «перезапуск edit_plan тянет за собой фоны» |
| `shot_background` добавлен и в `STEP_EXECUTION_ORDER` | «старого маршрута новый ключ не касается вовсе» |
| `STEP_ASSET_TYPES.shot_background = []` | «каскад сброса сносит ассеты фонов кадров» |
| `STEP_ASSET_TYPES.shot_background = ["image"]` | тот же тест |
| ярлык в `STEP_LABELS` не добавлен | «UI знает ярлык нового шага» |

- [ ] **Step 7: Коммит**

```bash
git add prisma/schema.prisma prisma/migrations/20260824000000_add_shot_background_step server/utils/video-pipeline-db.ts server/utils/video-pipeline-run-policy.ts server/utils/video-pipeline-reset.ts server/utils/balance/cost-attribution.ts server/utils/balance/spend-breakdown.ts shared/types/video.ts app/components/video/VideoStatusMap.ts "server/api/videos/[id]/rerun-step.post.ts" vitest.pure.config.ts tests/unit/shots/step-order.spec.ts
git commit -m "feat: ключ шага shot_background разнесён по пайплайну"
```

---

### Task 2: Материализация фона и вырезка подотрезка видео

Две листовые способности, которых в проекте нет: «дай локальный файл этого фона» и «вырежи секунды [a, b] из готового клипа». Обе — вход для всего остального.

> **Ruling S8-2 (принят по итогам ревью Task 2, 25.08.2026): поля `audioPresent` НЕ существует.**
> Ревьюер прогнал реальный ffmpeg: при `audioPresent: true` на фактически немом источнике
> команда не падает, а молча отдаёт файл БЕЗ аудиопотока — один stream вместо двух, и такой
> файл сдвигает таймлайн в concat. Докстрингом это не лечится.
> Звук кадров идёт в НОЛЬ по §6.4 (родная дорожка дублировала бы непрерывный трек и дала бы
> двойную речь с эхом), то есть исходный звук не нужен НИКОГДА — ни у клипа ведущего, ни у
> библиотечного фона. Поэтому граф один на все случаи: `anullsrc` добавляется ВСЕГДА,
> исходная дорожка не маппится вовсе, флага нет — нет и класса ошибок «вызывающий сказал
> неправду про источник». Блоки кода ниже написаны до этого рулинга и показывают прежнюю
> сигнатуру; фактическая — без `audioPresent`.

**Files:**
- Create: `server/utils/edit-plan/shot-media-store.ts`
- Create: `server/utils/video-tools/shot-cut.ts`
- Create: `server/utils/video-tools/shot-cut-runner.ts`
- Test: `tests/unit/shots/shot-media-store.spec.ts`
- Test: `tests/unit/shots/shot-cut.spec.ts`

**Interfaces:**
- Consumes: `getAppReferencesBase` (`server/utils/storage-paths.ts`), `TIMELINE_FPS` (`shared/types/video-runtime.ts`). **`server/utils/render.ts` НЕ импортировать**: `shot-cut.ts` обязан остаться листовым, опции кодека в нём выписаны явно (они совпадают со `still-clip.ts`, а не с `concatSafeVideoOutputOptions`).
- Produces:
  ```ts
  // shot-media-store.ts
  export interface ShotMediaDeps {
    downloadToFile: (storageKey: string, localPath: string) => Promise<void>
    fileExists: (localPath: string) => Promise<boolean>
    ensureDir: (dirPath: string) => Promise<void>
  }
  export interface BackgroundClipRef {
    id: string
    storageKey: string
    sha1: string
    mimeType: string | null
    kind: string
  }
  export interface AppReferenceRef {
    id: string
    appId: number
    sha1: string
    mimeType: string | null
    storageKey: string | null
  }
  export function backgroundClipLocalPath(assetsDir: string, clip: BackgroundClipRef): string
  export function appReferenceLocalPath(assetsDir: string, ref: AppReferenceRef): string
  export async function materializeBackgroundClip(clip: BackgroundClipRef, assetsDir: string, deps: ShotMediaDeps): Promise<string>
  export async function materializeAppReference(ref: AppReferenceRef, assetsDir: string, deps: ShotMediaDeps): Promise<string>

  // shot-cut.ts
  // ВНИМАНИЕ: `audioPresent` убран рулингом S8-2 — см. врезку выше.
  export interface ShotSubClipRequest {
    sourcePath: string
    startSec: number
    durationSec: number
    outputPath: string
  }
  export function buildShotSubClipArgs(request: ShotSubClipRequest): string[]

  // shot-cut-runner.ts
  export async function renderShotSubClip(request: ShotSubClipRequest): Promise<void>
  ```

- [ ] **Step 1: Написать падающие тесты материализации**

`tests/unit/shots/shot-media-store.spec.ts`:

```ts
import { describe, expect, it, vi } from "vitest"

import {
  appReferenceLocalPath,
  backgroundClipLocalPath,
  materializeAppReference,
  materializeBackgroundClip,
  type AppReferenceRef,
  type BackgroundClipRef,
  type ShotMediaDeps,
} from "~~/server/utils/edit-plan/shot-media-store"

const CLIP: BackgroundClipRef = {
  id: "bg1", storageKey: "zavodcamp/apps/7/backgrounds/abc123.mp4",
  sha1: "abc123", mimeType: "video/mp4", kind: "footage",
}

function deps(overrides: Partial<ShotMediaDeps> = {}): ShotMediaDeps {
  return {
    downloadToFile: vi.fn(async () => {}),
    fileExists: vi.fn(async () => false),
    ensureDir: vi.fn(async () => {}),
    ...overrides,
  }
}

describe("материализация фона кадра", () => {
  it("имя локального файла детерминировано и включает sha1 — пересборка берёт тот же файл", () => {
    const a = backgroundClipLocalPath("/assets/12", CLIP)
    const b = backgroundClipLocalPath("/assets/12", CLIP)
    expect(a).toBe(b)
    expect(a).toContain("abc123")
    expect(a.endsWith(".mp4")).toBe(true)
  })

  it("расширение берётся из mimeType, а не из storageKey", () => {
    const png = backgroundClipLocalPath("/assets/12", { ...CLIP, mimeType: "image/png", kind: "image" })
    expect(png.endsWith(".png")).toBe(true)
  })

  it("файл уже на диске — второй раз не качаем", async () => {
    const d = deps({ fileExists: vi.fn(async () => true) })
    const path = await materializeBackgroundClip(CLIP, "/assets/12", d)
    expect(path).toBe(backgroundClipLocalPath("/assets/12", CLIP))
    expect(d.downloadToFile).not.toHaveBeenCalled()
  })

  it("файла нет — качаем ровно по storageKey ровно один раз", async () => {
    const d = deps()
    await materializeBackgroundClip(CLIP, "/assets/12", d)
    expect(d.downloadToFile).toHaveBeenCalledTimes(1)
    expect(d.downloadToFile).toHaveBeenCalledWith(CLIP.storageKey, backgroundClipLocalPath("/assets/12", CLIP))
  })

  it("падение загрузки не прячется — вызывающий обязан узнать причину", async () => {
    const d = deps({ downloadToFile: vi.fn(async () => { throw new Error("сеть недоступна") }) })
    await expect(materializeBackgroundClip(CLIP, "/assets/12", d)).rejects.toThrow("сеть недоступна")
  })
})

describe("материализация скрина приложения", () => {
  const WITH_KEY: AppReferenceRef = {
    id: "r1", appId: 7, sha1: "deadbeef", mimeType: "image/png",
    storageKey: "zavodcamp/apps/7/references/deadbeef.png",
  }
  const LEGACY: AppReferenceRef = { ...WITH_KEY, storageKey: null }

  it("есть storageKey — качаем из хранилища", async () => {
    const d = deps()
    await materializeAppReference(WITH_KEY, "/assets/12", d)
    expect(d.downloadToFile).toHaveBeenCalledWith(WITH_KEY.storageKey, appReferenceLocalPath("/assets/12", WITH_KEY))
  })

  it("storageKey нет (legacy-запись) — читаем локальный путь app-references и НЕ качаем", async () => {
    const d = deps()
    const path = await materializeAppReference(LEGACY, "/assets/12", d)
    expect(d.downloadToFile).not.toHaveBeenCalled()
    expect(path).toContain("app-references")
    expect(path).toContain("deadbeef")
  })
})
```

- [ ] **Step 2: Написать падающие тесты вырезки подотрезка**

`tests/unit/shots/shot-cut.spec.ts`:

```ts
import { describe, expect, it } from "vitest"

import { buildShotSubClipArgs } from "~~/server/utils/video-tools/shot-cut"
import { TIMELINE_FPS } from "~~/shared/types/video-runtime"

const BASE = { sourcePath: "/a/scene_1_lipsync.mp4", outputPath: "/a/shot_5.mp4", audioPresent: true }

function argsFor(startSec: number, durationSec: number) {
  return buildShotSubClipArgs({ ...BASE, startSec, durationSec })
}

describe("вырезка подотрезка кадра из готового клипа", () => {
  it("-ss стоит ПЕРЕД -i: иначе ffmpeg декодирует весь клип до точки реза", () => {
    const args = argsFor(2.0, 1.8)
    expect(args.indexOf("-ss")).toBeLessThan(args.indexOf("-i"))
  })

  it("режет ровно заказанные секунды", () => {
    const args = argsFor(2.0, 1.8)
    expect(args[args.indexOf("-ss") + 1]).toBe("2.000")
    expect(args[args.indexOf("-t") + 1]).toBe("1.800")
  })

  it("частота нормализации — та же, что у всей склейки", () => {
    expect(argsFor(0, 1.8).join(" ")).toContain(`fps=${TIMELINE_FPS}`)
  })

  it("немой источник получает синтетическую дорожку — concat не терпит разнородных потоков", () => {
    const silent = buildShotSubClipArgs({ ...BASE, startSec: 0, durationSec: 1.8, audioPresent: false })
    expect(silent.join(" ")).toContain("anullsrc")
    const voiced = argsFor(0, 1.8)
    expect(voiced.join(" ")).not.toContain("anullsrc")
  })

  it("отрицательный старт и неположительная длина зажимаются, а не уезжают в ffmpeg", () => {
    const args = buildShotSubClipArgs({ ...BASE, startSec: -3, durationSec: 0, audioPresent: true })
    expect(args[args.indexOf("-ss") + 1]).toBe("0.000")
    expect(Number(args[args.indexOf("-t") + 1])).toBeGreaterThan(0)
  })

  it("NaN и Infinity не доезжают до аргументов", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const args = buildShotSubClipArgs({ ...BASE, startSec: bad, durationSec: bad, audioPresent: true })
      expect(args.every(a => !a.includes("NaN") && !a.includes("Infinity"))).toBe(true)
    }
  })

  it("выход пишется в заказанный путь последним аргументом", () => {
    expect(argsFor(1, 1).at(-1)).toBe(BASE.outputPath)
  })
})
```

- [ ] **Step 3: Прогнать оба файла и убедиться, что падают**

```bash
bunx vitest run --config vitest.pure.config.ts tests/unit/shots/shot-media-store.spec.ts tests/unit/shots/shot-cut.spec.ts
```
Ожидание: FAIL — модулей не существует.

- [ ] **Step 4: Реализация `shot-media-store.ts`**

```ts
/**
 * Локальные файлы фонов кадра.
 *
 * `BackgroundClip` хранится ТОЛЬКО по `storageKey` — колонок `fileUrl`/`filePath`
 * у него нет, и в механизм доставки референсов
 * (`media-provider/reference-frame.ts`) он не влезает: `ResolvedReferenceFrame`
 * требует непустой `fileUrl`. Поэтому здесь свой минимальный materialize.
 *
 * `AppReferenceImage` устроен наоборот: `fileUrl` обязателен, а `storageKey`
 * необязателен — записи, залитые до перехода на объектное хранилище, живут
 * только локальным файлом. Обе ветки обязаны работать.
 *
 * Модуль ЛИСТОВОЙ: ни ffmpeg, ни Prisma, ни storage-драйвера — всё приходит
 * через `ShotMediaDeps`. Так он проверяется без сети и без БД, и так его
 * безопасно импортировать откуда угодно.
 */

import { join } from "node:path"

import { getAppReferencesBase } from "../storage-paths"

export interface ShotMediaDeps {
  downloadToFile: (storageKey: string, localPath: string) => Promise<void>
  fileExists: (localPath: string) => Promise<boolean>
  ensureDir: (dirPath: string) => Promise<void>
}

export interface BackgroundClipRef {
  id: string
  storageKey: string
  sha1: string
  mimeType: string | null
  kind: string
}

export interface AppReferenceRef {
  id: string
  appId: number
  sha1: string
  mimeType: string | null
  storageKey: string | null
}

/** Расширение по mime, а не по ключу хранилища: ключ мог быть записан без него. */
const EXT_BY_MIME: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
}

function extFor(mimeType: string | null, fallback: string): string {
  if (!mimeType) return fallback
  return EXT_BY_MIME[mimeType.toLowerCase()] ?? fallback
}

/**
 * Имя детерминировано и включает `sha1`: пересборка ролика обязана взять ТОТ ЖЕ
 * файл, иначе кэш нормализации и отпечаток уникальности разъедутся между
 * прогонами.
 */
export function backgroundClipLocalPath(assetsDir: string, clip: BackgroundClipRef): string {
  const ext = extFor(clip.mimeType, clip.kind === "image" ? "png" : "mp4")
  return join(assetsDir, `bg_${clip.sha1}.${ext}`)
}

export function appReferenceLocalPath(assetsDir: string, ref: AppReferenceRef): string {
  return join(assetsDir, `screen_${ref.sha1}.${extFor(ref.mimeType, "png")}`)
}

export async function materializeBackgroundClip(
  clip: BackgroundClipRef, assetsDir: string, deps: ShotMediaDeps,
): Promise<string> {
  const localPath = backgroundClipLocalPath(assetsDir, clip)
  if (await deps.fileExists(localPath)) return localPath
  await deps.ensureDir(assetsDir)
  await deps.downloadToFile(clip.storageKey, localPath)
  return localPath
}

export async function materializeAppReference(
  ref: AppReferenceRef, assetsDir: string, deps: ShotMediaDeps,
): Promise<string> {
  // Legacy-запись без ключа хранилища: файл лежит локально там, куда его
  // положила заливка референсов. Качать нечего и неоткуда.
  if (!ref.storageKey) {
    return join(getAppReferencesBase(), String(ref.appId), `${ref.sha1}.${extFor(ref.mimeType, "png")}`)
  }
  const localPath = appReferenceLocalPath(assetsDir, ref)
  if (await deps.fileExists(localPath)) return localPath
  await deps.ensureDir(assetsDir)
  await deps.downloadToFile(ref.storageKey, localPath)
  return localPath
}
```

- [ ] **Step 5: Реализация `shot-cut.ts`**

```ts
/**
 * Вырезка подотрезка готового видео под кадр монтажа.
 *
 * Зачем отдельно: в проекте вырезки `[a, b]` для видео не было вовсе.
 * `buildClipTrimArgs` (`render.ts`) режет только ОТ НУЛЯ, а единственная
 * произвольная вырезка — `buildPresenterCutArgs` в `presenter/ffmpeg-adapter.ts`
 * — принудительно масштабирует в 1080x1920 и заточена под запись ведущего.
 *
 * Чистая функция: собирает аргументы, процесс не запускает (по образцу
 * `buildStillClipArgs` в `./still-clip.ts`). Модуль НЕ импортирует
 * `./ffmpeg.ts`: тот на уровне модуля зовёт `setFfmpegPath`, и его появление в
 * графе ломает инвариант lip-sync.
 */

import { TIMELINE_FPS } from "~~/shared/types/video-runtime"

export interface ShotSubClipRequest {
  sourcePath: string
  startSec: number
  durationSec: number
  outputPath: string
  /** Есть ли у источника звуковая дорожка. Нет — синтезируем немую. */
  audioPresent: boolean
}

/** Кадр короче этого не существует: ffmpeg отдаёт пустой файл. */
const MIN_SUB_CLIP_SEC = 1 / TIMELINE_FPS

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0
}

export function buildShotSubClipArgs(request: ShotSubClipRequest): string[] {
  const startSec = Math.max(0, finiteOrZero(request.startSec))
  const durationSec = Math.max(MIN_SUB_CLIP_SEC, finiteOrZero(request.durationSec))

  const args = [
    "-y",
    // -ss ПЕРЕД -i: быстрый поиск по контейнеру. При обратном порядке ffmpeg
    // декодирует весь клип до точки реза, и на сорока кадрах это минуты.
    "-ss", startSec.toFixed(3),
    "-i", request.sourcePath,
  ]

  if (!request.audioPresent) {
    args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100")
  }

  args.push(
    "-t", durationSec.toFixed(3),
    // Пересчёт PTS обязателен: без него у вырезки остаётся исходный штамп
    // времени, и concat кладёт кадр не туда.
    "-vf", `setpts=PTS-STARTPTS,fps=${TIMELINE_FPS},format=yuv420p`,
    "-af", "asetpts=PTS-STARTPTS",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "22",
    "-profile:v", "high",
    "-level", "4.1",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "128k",
    "-ar", "44100",
    "-ac", "2",
    "-shortest",
    "-movflags", "+faststart",
    request.outputPath,
  )

  return args
}
```

- [ ] **Step 6: Реализация `shot-cut-runner.ts`**

По образцу `server/utils/video-tools/still-clip-runner.ts` — тот же `spawn`, тот же `FFMPEG_BIN`, тот же разбор кода возврата, таймаут `SHOT_CUT_TIMEOUT_MS = 120_000`, сообщение об ошибке по-русски: `` `ffmpeg завершился с кодом ${code}: ${stderr.slice(-400)}` ``.

- [ ] **Step 7: Прогнать тесты**

```bash
bunx vitest run --config vitest.pure.config.ts tests/unit/shots/
```
Ожидание: PASS, 7 (`shot-media-store`) + 7 (`shot-cut`) = 14 тестов, плюс 6 из Task 1.

Затем целиком, включая прогон с путями ffmpeg:

```bash
bunx vitest run --config vitest.pure.config.ts
FFMPEG_PATH=ffmpeg FFPROBE_PATH=ffprobe bunx vitest run --config vitest.pure.config.ts
```

- [ ] **Step 8: Мутационная проверка**

| Мутация | Ожидаемый красный тест |
|---|---|
| `-ss` перенесён после `-i` | «-ss стоит ПЕРЕД -i» |
| `toFixed(3)` заменён на `String(...)` для `-ss` | «режет ровно заказанные секунды» (`2` вместо `2.000`) |
| `fps=${TIMELINE_FPS}` убран из `-vf` | «частота нормализации» |
| `anullsrc` добавляется всегда | «немой источник получает синтетическую дорожку» |
| `Math.max(0, ...)` у `startSec` убран | «отрицательный старт зажимается» |
| `finiteOrZero` убран | «NaN и Infinity не доезжают» |
| `fileExists` не проверяется в `materializeBackgroundClip` | «файл уже на диске — второй раз не качаем» |
| ветка `!ref.storageKey` удалена | «storageKey нет (legacy-запись)» |
| `sha1` убран из имени файла | «имя локального файла детерминировано и включает sha1» |

- [ ] **Step 9: Коммит**

```bash
git add server/utils/edit-plan/shot-media-store.ts server/utils/video-tools/shot-cut.ts server/utils/video-tools/shot-cut-runner.ts tests/unit/shots/
git commit -m "feat: материализация фона кадра и вырезка подотрезка видео"
```

---

### Task 3: Промпт фона кадра из `idea`

Спека §7: «Промпты для генерации собираются из поля `idea` кадра; для этого переиспользуются существующие агенты визуального стиля и валидатор промптов сцены». **Переиспользовать нечего:** `runVisualStyleAgent` требует полный сценарий и в пайплайне не вызывается вовсе, `generateSceneImagePrompts` требует целый `StoryPlan`, а `validateScenePrompts` — пост-фиксер, который бросает при `prompt.length < 50` и пустом `purpose`. Нужен свой генератор; валидатор навешивается сверху как есть.

**Files:**
- Create: `server/utils/agents/shot-background-prompt-agent.ts`
- Create: `server/__fixtures__/agents/shot-background-prompt-happy.json`
- Test: `tests/unit/shots/shot-background-prompt.spec.ts`

**Interfaces:**
- Consumes: `callAnthropicAgent({ systemPrompt, userPrompt, model?, maxTokens, agentName, validate, onUsage })` и тип `AnthropicCallUsage` — `server/utils/agents/call-anthropic.ts`. Образец обёртки — `planEditShots` в `server/utils/agents/edit-planner-agent.ts`.
- Produces:
  ```ts
  export interface ShotPromptRequest {
    order: number
    idea: string | null
    /** Текст реплики сцены кадра — контекст смысла. null у перебивки без сцены. */
    sceneText: string | null
    durationSec: number
  }
  export interface ShotPromptInput {
    shots: readonly ShotPromptRequest[]
    /** StoryPlan.globalVisualStyle — единый стиль ролика. */
    visualStyle: string | null
    appName: string | null
    format: "portrait" | "landscape"
    model?: string | null
    onUsage?: (usage: AnthropicCallUsage) => void
  }
  export interface ShotPrompt { order: number, prompt: string, purpose: string }
  export interface ShotPromptResult { prompts: ShotPrompt[], usage: AnthropicCallUsage | null }
  export const MIN_PROMPT_LENGTH = 50
  export function fallbackShotPrompt(request: ShotPromptRequest, visualStyle: string | null): ShotPrompt
  export function mergeShotPrompts(
    requests: readonly ShotPromptRequest[],
    answered: readonly ShotPrompt[],
    visualStyle: string | null,
  ): { prompts: ShotPrompt[], filledByFallback: number }
  export async function planShotBackgroundPrompts(input: ShotPromptInput): Promise<ShotPromptResult>
  ```

- [ ] **Step 1: Написать падающий тест**

`tests/unit/shots/shot-background-prompt.spec.ts`:

```ts
import { describe, expect, it } from "vitest"

import {
  MIN_PROMPT_LENGTH,
  fallbackShotPrompt,
  mergeShotPrompts,
  type ShotPrompt,
  type ShotPromptRequest,
} from "~~/server/utils/agents/shot-background-prompt-agent"

const REQ: ShotPromptRequest[] = [
  { order: 0, idea: "график роста выручки", sceneText: "за квартал мы выросли втрое", durationSec: 1.8 },
  { order: 1, idea: null, sceneText: null, durationSec: 2.1 },
  { order: 2, idea: "офис на рассвете", sceneText: null, durationSec: 5.0 },
]

describe("фолбэк промпта кадра", () => {
  it("всегда длиннее порога валидатора — иначе validateScenePrompts бросит", () => {
    for (const r of REQ) {
      expect(fallbackShotPrompt(r, null).prompt.length).toBeGreaterThanOrEqual(MIN_PROMPT_LENGTH)
      expect(fallbackShotPrompt(r, "неоновый киберпанк").prompt.length).toBeGreaterThanOrEqual(MIN_PROMPT_LENGTH)
    }
  })

  it("purpose непустой — второе жёсткое требование валидатора", () => {
    for (const r of REQ) expect(fallbackShotPrompt(r, null).purpose.trim().length).toBeGreaterThan(0)
  })

  it("детерминирован: пересборка ролика даёт тот же промпт, значит тот же кэш картинки", () => {
    expect(fallbackShotPrompt(REQ[0]!, "стиль").prompt).toBe(fallbackShotPrompt(REQ[0]!, "стиль").prompt)
  })

  it("идея попадает в промпт, а стиль — дописывается", () => {
    const p = fallbackShotPrompt(REQ[0]!, "неоновый киберпанк").prompt
    expect(p).toContain("график роста выручки")
    expect(p).toContain("неоновый киберпанк")
  })

  it("пустая идея не даёт промпт из одних пробелов", () => {
    const p = fallbackShotPrompt({ order: 9, idea: "   ", sceneText: null, durationSec: 2 }, null)
    expect(p.prompt.trim().length).toBeGreaterThanOrEqual(MIN_PROMPT_LENGTH)
  })

  it("сохраняет order — по нему раннер склеивает ответ с сеткой", () => {
    expect(fallbackShotPrompt(REQ[2]!, null).order).toBe(2)
  })
})

describe("склейка ответа модели с сеткой кадров", () => {
  const answered: ShotPrompt[] = [
    { order: 2, prompt: "x".repeat(60), purpose: "перебивка" },
    { order: 0, prompt: "y".repeat(60), purpose: "иллюстрация тезиса" },
  ]

  it("склейка идёт ПО order, а не по позиции в ответе", () => {
    const { prompts } = mergeShotPrompts(REQ, answered, null)
    expect(prompts.map(p => p.order)).toEqual([0, 1, 2])
    expect(prompts.find(p => p.order === 0)!.prompt).toBe("y".repeat(60))
    expect(prompts.find(p => p.order === 2)!.prompt).toBe("x".repeat(60))
  })

  it("незаполненная ячейка добивается фолбэком и СЧИТАЕТСЯ", () => {
    const { prompts, filledByFallback } = mergeShotPrompts(REQ, answered, null)
    expect(filledByFallback).toBe(1)
    expect(prompts.find(p => p.order === 1)!.prompt).toBe(fallbackShotPrompt(REQ[1]!, null).prompt)
  })

  it("чужой order из ответа модели игнорируется, а не приписывается кадру", () => {
    const { prompts } = mergeShotPrompts(REQ, [{ order: 99, prompt: "z".repeat(60), purpose: "p" }], null)
    expect(prompts).toHaveLength(3)
    expect(prompts.every(p => !p.prompt.startsWith("z"))).toBe(true)
  })

  it("короткий промпт от модели отвергается фолбэком — валидатор такой бросит", () => {
    const { prompts, filledByFallback } = mergeShotPrompts(REQ, [{ order: 0, prompt: "коротко", purpose: "p" }], null)
    expect(filledByFallback).toBe(3)
    expect(prompts.find(p => p.order === 0)!.prompt.length).toBeGreaterThanOrEqual(MIN_PROMPT_LENGTH)
  })

  it("пустой purpose от модели отвергается тем же правилом", () => {
    const { filledByFallback } = mergeShotPrompts(REQ, [{ order: 0, prompt: "q".repeat(60), purpose: "  " }], null)
    expect(filledByFallback).toBe(3)
  })

  it("дубль order в ответе не удваивает кадр — берётся первый", () => {
    const dup = [{ order: 0, prompt: "a".repeat(60), purpose: "p" }, { order: 0, prompt: "b".repeat(60), purpose: "p" }]
    const { prompts } = mergeShotPrompts(REQ, dup, null)
    expect(prompts).toHaveLength(3)
    expect(prompts.find(p => p.order === 0)!.prompt).toBe("a".repeat(60))
  })
})
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

```bash
bunx vitest run --config vitest.pure.config.ts tests/unit/shots/shot-background-prompt.spec.ts
```
Ожидание: FAIL — модуля нет.

- [ ] **Step 3: Реализация агента**

```ts
/**
 * Промпт генерации фона по «идее» кадра (spec §7).
 *
 * Почему свой агент, а не переиспользование: `runVisualStyleAgent` требует
 * полный сценарий (`title/hook/body/cta`) и отдаёт стиль ролика целиком;
 * `generateSceneImagePrompts` требует целый `StoryPlan`. Пути «дай одну строку
 * идеи» нет ни у одного. Зато `validateScenePrompts`
 * (`./scene-prompt-validator.ts`) переиспользуется как есть — но он БРОСАЕТ
 * при `prompt.length < 50` и пустом `purpose`, поэтому и модель, и фолбэк
 * обязаны отдавать промпт заведомо длиннее порога.
 *
 * Склейка ответа с сеткой — ПО `order`, а не по позиции (тот же ruling B-4, что
 * у монтажного агента): статическая фикстура мока физически не совпадёт по
 * длине с динамическим числом кадров, поэтому `validate` проверяет ФОРМУ, а
 * незаполненные ячейки добиваются детерминированным фолбэком, и их число
 * уходит в предупреждения шага.
 */

import { callAnthropicAgent, type AnthropicCallUsage } from "./call-anthropic"

export interface ShotPromptRequest {
  order: number
  idea: string | null
  sceneText: string | null
  durationSec: number
}

export interface ShotPromptInput {
  shots: readonly ShotPromptRequest[]
  visualStyle: string | null
  appName: string | null
  format: "portrait" | "landscape"
  model?: string | null
  onUsage?: (usage: AnthropicCallUsage) => void
}

export interface ShotPrompt { order: number, prompt: string, purpose: string }
export interface ShotPromptResult { prompts: ShotPrompt[], usage: AnthropicCallUsage | null }

/** Порог `validateScenePrompts`: короче — он бросит, а не починит. */
export const MIN_PROMPT_LENGTH = 50

const SYSTEM_PROMPT = `Ты подбираешь визуальный образ для КАДРА короткого вертикального видео.
На вход — короткая идея кадра и, если есть, реплика, которая под ним звучит.
Верни JSON: {"prompts":[{"order":число,"prompt":"строка","purpose":"строка"}]}.
Правила:
- prompt на английском, не короче 60 символов, описывает КАДР: объект, окружение, свет, ракурс;
- людей с узнаваемыми лицами и текст на изображении не описывать — они читаются как брак;
- purpose по-русски, одной фразой: зачем этот кадр в ролике;
- по одному объекту на каждый order из запроса, порядок любой.`

function buildUserPrompt(input: ShotPromptInput): string {
  const style = input.visualStyle?.trim()
  const app = input.appName?.trim()
  const lines = [
    `Формат кадра: ${input.format === "portrait" ? "вертикальный 9:16" : "горизонтальный 16:9"}.`,
    style ? `Единый визуальный стиль ролика: ${style}` : null,
    app ? `Продукт: ${app}` : null,
    "",
    "Кадры:",
    ...input.shots.map((s) => {
      const idea = (s.idea ?? "").trim() || "нейтральная перебивка по смыслу реплики"
      const speech = (s.sceneText ?? "").trim()
      return `- order ${s.order}, ${s.durationSec.toFixed(1)} с, идея: ${idea}`
        + (speech ? `; под кадром звучит: «${speech}»` : "")
    }),
  ]
  return lines.filter(line => line !== null).join("\n")
}

interface RawResponse { prompts: unknown }

function validate(parsed: unknown): { prompts: ShotPrompt[] } {
  const raw = parsed as RawResponse | null
  if (!raw || !Array.isArray(raw.prompts)) {
    throw new Error("Агент промптов фона: ожидался объект с массивом prompts")
  }
  // Форма, а не длина (ruling B-4): длина сверяется склейкой по order.
  const prompts: ShotPrompt[] = []
  for (const item of raw.prompts) {
    if (!item || typeof item !== "object") continue
    const cell = item as Partial<ShotPrompt>
    if (typeof cell.order !== "number" || !Number.isFinite(cell.order)) continue
    if (typeof cell.prompt !== "string" || typeof cell.purpose !== "string") continue
    prompts.push({ order: cell.order, prompt: cell.prompt, purpose: cell.purpose })
  }
  return { prompts }
}

/**
 * Детерминированный запасной промпт. Детерминизм здесь не косметика: по промпту
 * считается ключ переиспользования картинки, и «случайный» фолбэк заставлял бы
 * пересборку ролика платить за те же кадры заново.
 */
export function fallbackShotPrompt(request: ShotPromptRequest, visualStyle: string | null): ShotPrompt {
  const idea = (request.idea ?? "").trim()
  const style = (visualStyle ?? "").trim()
  const base = idea.length > 0
    ? `Cinematic b-roll shot illustrating: ${idea}.`
    : "Cinematic abstract b-roll shot, soft depth of field, no readable text, no recognizable faces."
  const tail = " Shallow depth of field, soft natural lighting, high detail, no text overlays, no recognizable faces."
  const prompt = style.length > 0 ? `${base} Visual style: ${style}.${tail}` : `${base}${tail}`
  return {
    order: request.order,
    prompt,
    purpose: idea.length > 0 ? `Перебивка по идее кадра: ${idea}` : "Нейтральная перебивка без заданной идеи",
  }
}

function isUsablePrompt(cell: ShotPrompt): boolean {
  return cell.prompt.trim().length >= MIN_PROMPT_LENGTH && cell.purpose.trim().length > 0
}

export function mergeShotPrompts(
  requests: readonly ShotPromptRequest[],
  answered: readonly ShotPrompt[],
  visualStyle: string | null,
): { prompts: ShotPrompt[], filledByFallback: number } {
  const byOrder = new Map<number, ShotPrompt>()
  for (const cell of answered) {
    // Первый выигрывает: дубль order — это неоднозначность, и молча брать
    // последний значило бы решать её монеткой.
    if (!byOrder.has(cell.order) && isUsablePrompt(cell)) byOrder.set(cell.order, cell)
  }
  let filledByFallback = 0
  const prompts = requests.map((request) => {
    const answer = byOrder.get(request.order)
    if (answer) return answer
    filledByFallback += 1
    return fallbackShotPrompt(request, visualStyle)
  })
  return { prompts, filledByFallback }
}

function estimateMaxTokens(shotCount: number): number {
  // ~120 токенов на кадр плюс запас на обёртку JSON.
  return Math.min(8192, 512 + shotCount * 120)
}

export async function planShotBackgroundPrompts(input: ShotPromptInput): Promise<ShotPromptResult> {
  if (input.shots.length === 0) return { prompts: [], usage: null }

  // usage забирается синхронно из callback — до парсинга и до validate(), иначе
  // оплаченный вызов теряется на обрезанном ответе (та же причина, что у
  // `planEditShots`).
  let usage: AnthropicCallUsage | null = null
  const parsed = await callAnthropicAgent({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildUserPrompt(input),
    model: input.model ?? undefined,
    maxTokens: estimateMaxTokens(input.shots.length),
    agentName: "shot-background-prompt",
    validate,
    onUsage: (reported) => {
      usage = reported
      input.onUsage?.(reported)
    },
  })

  const { prompts } = mergeShotPrompts(input.shots, parsed.prompts, input.visualStyle)
  return { prompts, usage }
}
```

- [ ] **Step 4: Фикстура мока**

`server/__fixtures__/agents/shot-background-prompt-happy.json` — мок Anthropic грузит её по `agentName` и **бросает**, если файла нет:

```json
{
  "prompts": [
    {
      "order": 0,
      "prompt": "Cinematic close-up of a rising revenue chart glowing on a dark glass surface, shallow depth of field, soft rim light, no readable text",
      "purpose": "Иллюстрация тезиса о росте"
    },
    {
      "order": 1,
      "prompt": "Wide cinematic shot of an empty modern office at sunrise, warm light through tall windows, soft haze, shallow depth of field, no people",
      "purpose": "Нейтральная перебивка"
    }
  ]
}
```

Фикстура намеренно короче любой реальной сетки: склейка по `order` добьёт остальное фолбэком, и это ровно то поведение, которое обязано быть покрыто.

- [ ] **Step 5: Прогнать тесты**

```bash
bunx vitest run --config vitest.pure.config.ts tests/unit/shots/shot-background-prompt.spec.ts
```
Ожидание: PASS, 12 тестов (6 на фолбэк, 6 на склейку).

```bash
bunx vitest run --config vitest.pure.config.ts
FFMPEG_PATH=ffmpeg FFPROBE_PATH=ffprobe bunx vitest run --config vitest.pure.config.ts
```

- [ ] **Step 6: Мутационная проверка**

| Мутация | Ожидаемый красный тест |
|---|---|
| `mergeShotPrompts` склеивает по позиции (`answered[i]`), а не по `order` | «склейка идёт ПО order» |
| `isUsablePrompt` не проверяет длину | «короткий промпт от модели отвергается фолбэком» |
| `isUsablePrompt` не проверяет `purpose` | «пустой purpose от модели отвергается» |
| `filledByFallback` не инкрементится | «незаполненная ячейка добивается фолбэком и СЧИТАЕТСЯ» |
| дубль `order` берёт последний (`byOrder.set` без `has`) | «дубль order в ответе не удваивает кадр» |
| `tail` убран из фолбэка (промпт короче порога на пустой идее) | «всегда длиннее порога валидатора» |
| `visualStyle` не дописывается | «идея попадает в промпт, а стиль дописывается» |
| чужой `order` из ответа приписывается по позиции | «чужой order игнорируется» |

- [ ] **Step 7: Коммит**

```bash
git add server/utils/agents/shot-background-prompt-agent.ts server/__fixtures__/agents/shot-background-prompt-happy.json tests/unit/shots/shot-background-prompt.spec.ts
git commit -m "feat: промпт фона кадра из идеи, склейка по order, детерминированный фолбэк"
```

---

### Task 4: Шаг `shot_background` — медиа фона на кадр

Платный шаг. Идемпотентность и деньги здесь — главное, а не ffmpeg.

**Files:**
- Create: `server/utils/edit-plan/shot-background-runner.ts` (чистая часть)
- Modify: `server/utils/video-pipeline-steps.ts` (шаг `runShotBackgrounds`)
- Modify: `server/utils/video-pipeline.ts` (вызов шага после `edit_plan`)
- Modify: `tests/integration/audio-first-pipeline.spec.ts` (список шагов маршрута)
- Test: `tests/unit/shots/shot-background-plan.spec.ts`
- Test: `tests/unit/shots/shot-background-plan.property.spec.ts`
- Test: `tests/integration/edit-plan.spec.ts` (дописать: идемпотентность шага)

**Interfaces:**
- Consumes: `ShotPrompt`, `planShotBackgroundPrompts` (Task 3); `materializeBackgroundClip`, `materializeAppReference` (Task 2); `pickBackgroundSource` и `BackgroundPick.countsAgainstBudgetUsd` (`server/utils/edit-plan/background-source.ts`); `renderStillClip` / `buildStillClipArgs` (`server/utils/video-tools/still-clip*.ts`); `replicateVideoBilling`, `findMediaSpec`, `estimateMediaCost`, `REPLICATE_KLING_16_DURATIONS` (`server/utils/media-provider/model-specs.ts`); канон шага — `runVideoTranscription` и `runVideoEditPlan` в `server/utils/video-pipeline-steps.ts`.
- Produces:
  ```ts
  export interface PlannedShotRow {
    order: number
    startSec: number
    endSec: number
    sceneOrder: number | null
    foreground: string
    background: string
    backgroundClipId: string | null
    appReferenceId: string | null
    idea: string | null
    pipEnabled: boolean
  }

  export type ShotBackgroundAction =
    | { kind: "none" }
    | { kind: "library"; backgroundClipId: string }
    | { kind: "app_screen"; appReferenceId: string }
    | { kind: "image" }
    | { kind: "video"; billedSec: number }

  export interface ShotBackgroundItem {
    order: number
    action: ShotBackgroundAction
    /** Полная цена кадра — идёт в смету ролика (§14) и в VideoShot.costUsd. */
    costUsd: number
    /** Только генеративное видео — накопитель потолка §7 (ruling B4-1). */
    countsAgainstBudgetUsd: number
    degradeReason: string | null
  }

  export interface ShotBackgroundPlan {
    items: ShotBackgroundItem[]
    warnings: string[]
    /** Кадры, которым нужен промпт генерации. */
    promptOrders: number[]
  }

  export function planShotBackgroundExecution(input: {
    shots: readonly PlannedShotRow[]
    imageUsd: number
    imageGenerationAllowed: boolean
    generativeVideoEnabled: boolean
    generativeVideoBudgetUsd: number
    generativeVideoUsdPerSec: number
    minGenerativeVideoSec: number
    maxGenerativeVideoSec: number
    knownBackgroundIds: ReadonlySet<string>
    knownAppScreenIds: ReadonlySet<string>
  }): ShotBackgroundPlan

  // в video-pipeline-steps.ts
  export interface VideoShotBackgroundInput {
    videoId: number
    trackFingerprint: string
    format: "portrait" | "landscape"
    renderQuality: string
    profile: ResolvedEditProfile
    /** StoryPlan.globalVisualStyle — единый стиль ролика для промптов фона. */
    visualStyle: string | null
    appName: string | null
    imageModelId: string
    videoModelId: string
    /**
     * Текст сцены по её `order` — контекст смысла для промпта фона.
     * ОБЯЗАТЕЛЕН: `PlannedShotRow` знает только `sceneOrder`, самого текста в
     * `VideoShot` нет, а промпт «под кадром звучит …» без него выродится в одну
     * идею. Источник — `videoPlan.scenes` (`spokenLine` либо `voiceoverLine`),
     * тот же, из которого строился трек.
     */
    sceneTextByOrder: ReadonlyMap<number, string>
  }
  export interface VideoShotBackgroundResult {
    status: "completed" | "degraded"
    renderedCount: number
    reusedCount: number
    costUsd: number
    warnings: string[]
  }
  export async function runShotBackgrounds(
    input: VideoShotBackgroundInput,
    deps?: Partial<ShotBackgroundStepDeps>,
  ): Promise<VideoShotBackgroundResult>
  ```

- [ ] **Step 1: Написать падающий тест на чистое планирование**

`tests/unit/shots/shot-background-plan.spec.ts`:

```ts
import { describe, expect, it } from "vitest"

import { planShotBackgroundExecution, type PlannedShotRow } from "~~/server/utils/edit-plan/shot-background-runner"

function shot(over: Partial<PlannedShotRow> = {}): PlannedShotRow {
  return {
    order: 0, startSec: 0, endSec: 1.8, sceneOrder: 1,
    foreground: "none", background: "image",
    backgroundClipId: null, appReferenceId: null, idea: "идея", pipEnabled: false,
    ...over,
  }
}

const LIMITS = {
  imageUsd: 0.025,
  imageGenerationAllowed: true,
  generativeVideoEnabled: true,
  generativeVideoBudgetUsd: 0.5,
  generativeVideoUsdPerSec: 0.05,
  minGenerativeVideoSec: 5,
  maxGenerativeVideoSec: 10,
  knownBackgroundIds: new Set<string>(["bg1"]),
  knownAppScreenIds: new Set<string>(["scr1"]),
}

describe("планирование производства фонов кадров", () => {
  it("библиотека и скрин приложения бесплатны и в потолок не идут", () => {
    const plan = planShotBackgroundExecution({
      ...LIMITS,
      shots: [
        shot({ order: 0, background: "library", backgroundClipId: "bg1" }),
        shot({ order: 1, background: "app_screen", appReferenceId: "scr1" }),
      ],
    })
    expect(plan.items.map(i => i.costUsd)).toEqual([0, 0])
    expect(plan.items.map(i => i.countsAgainstBudgetUsd)).toEqual([0, 0])
    expect(plan.promptOrders).toEqual([])
  })

  it("картинка стоит тариф модели и в потолок генеративного видео НЕ идёт (ruling B4-1)", () => {
    const plan = planShotBackgroundExecution({ ...LIMITS, shots: [shot({ background: "image" })] })
    expect(plan.items[0]!.costUsd).toBeCloseTo(0.025, 6)
    expect(plan.items[0]!.countsAgainstBudgetUsd).toBe(0)
    expect(plan.promptOrders).toEqual([0])
  })

  it("генеративное видео квантуется в 5 или 10 секунд и считается по ставке спеки", () => {
    const plan = planShotBackgroundExecution({
      ...LIMITS,
      shots: [shot({ order: 0, endSec: 6.0, background: "video" })],
    })
    expect(plan.items[0]!.action).toEqual({ kind: "video", billedSec: 10 })
    expect(plan.items[0]!.costUsd).toBeCloseTo(0.5, 6)
    expect(plan.items[0]!.countsAgainstBudgetUsd).toBeCloseTo(0.5, 6)
  })

  it("кадр короче пяти секунд генеративного видео не получает — деградирует до картинки (§7)", () => {
    const plan = planShotBackgroundExecution({
      ...LIMITS,
      shots: [shot({ endSec: 2.0, background: "video" })],
    })
    expect(plan.items[0]!.action).toEqual({ kind: "image" })
    expect(plan.items[0]!.degradeReason).toBeTruthy()
    expect(plan.items[0]!.costUsd).toBeCloseTo(0.025, 6)
  })

  it("исчерпанный потолок деградирует ПОСЛЕДУЮЩИЕ кадры, а не первый", () => {
    const plan = planShotBackgroundExecution({
      ...LIMITS,
      generativeVideoBudgetUsd: 0.5,
      shots: [
        // 5 с → billedSec 5 → $0.25, потолок ещё не исчерпан.
        shot({ order: 0, endSec: 5.0, background: "video" }),
        // 6 с → billedSec 10 → $0.50, а свободно только $0.25 → деградация.
        shot({ order: 1, startSec: 5, endSec: 11.0, background: "video" }),
      ],
    })
    expect(plan.items[0]!.action).toEqual({ kind: "video", billedSec: 5 })
    expect(plan.items[1]!.action).toEqual({ kind: "image" })
    expect(plan.items[1]!.degradeReason).toContain("потолок")
  })

  it("накопитель потолка не отравляется картинками", () => {
    const plan = planShotBackgroundExecution({
      ...LIMITS,
      generativeVideoBudgetUsd: 0.3,
      shots: [
        ...Array.from({ length: 20 }, (_, i) => shot({ order: i, background: "image" })),
        shot({ order: 20, startSec: 40, endSec: 45, background: "video" }),
      ],
    })
    // 20 картинок = $0.50 в costUsd, но в потолок Kling они не пошли,
    // поэтому пятисекундный клип за $0.25 при потолке $0.30 ещё проходит.
    expect(plan.items[20]!.action).toEqual({ kind: "video", billedSec: 5 })
  })

  it("выключенный флаг генеративного видео закрывает его совсем", () => {
    const plan = planShotBackgroundExecution({
      ...LIMITS, generativeVideoEnabled: false,
      shots: [shot({ endSec: 8, background: "video" })],
    })
    expect(plan.items[0]!.action).toEqual({ kind: "image" })
  })

  it("выключенная генерация картинок отдаёт кадр ведущему на весь экран (§10)", () => {
    const plan = planShotBackgroundExecution({
      ...LIMITS, imageGenerationAllowed: false,
      shots: [shot({ background: "image", foreground: "presenter" })],
    })
    expect(plan.items[0]!.action).toEqual({ kind: "none" })
    expect(plan.items[0]!.costUsd).toBe(0)
    expect(plan.items[0]!.degradeReason).toBeTruthy()
  })

  it("несуществующая ссылка на фон не роняет шаг, а деградирует с причиной", () => {
    const plan = planShotBackgroundExecution({
      ...LIMITS,
      shots: [shot({ background: "library", backgroundClipId: "нет-такого" })],
    })
    expect(plan.items[0]!.action).not.toEqual({ kind: "library", backgroundClipId: "нет-такого" })
    expect(plan.items[0]!.degradeReason).toBeTruthy()
  })

  it("кадр без фона промпта не просит", () => {
    const plan = planShotBackgroundExecution({
      ...LIMITS,
      shots: [shot({ background: "none", foreground: "presenter" })],
    })
    expect(plan.promptOrders).toEqual([])
    expect(plan.items[0]!.costUsd).toBe(0)
  })
})
```

- [ ] **Step 2: Написать тест-СВОЙСТВО с детерминированным перебором**

`tests/unit/shots/shot-background-plan.property.spec.ts`. Домен генератора обязан быть широким: на этой ветке узкий домен трижды прятал настоящие дефекты.

```ts
import { describe, expect, it } from "vitest"

import { planShotBackgroundExecution, type PlannedShotRow } from "~~/server/utils/edit-plan/shot-background-runner"

function lcg(seed: number) {
  let state = seed >>> 0
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 0x100000000 }
}

const BACKGROUNDS = ["library", "image", "video", "app_screen", "none"] as const

/** Реальный ролик — 40-100 кадров, а не 2-6: узкий домен уже прятал дефекты трижды. */
function generate(seed: number) {
  const rnd = lcg(seed)
  const count = 40 + Math.floor(rnd() * 61)
  const shots: PlannedShotRow[] = []
  let cursor = 0
  for (let i = 0; i < count; i += 1) {
    const duration = 0.8 + rnd() * 9.5
    const background = BACKGROUNDS[Math.floor(rnd() * BACKGROUNDS.length)]!
    shots.push({
      order: i,
      startSec: cursor,
      endSec: cursor + duration,
      sceneOrder: rnd() < 0.3 ? null : 1 + Math.floor(rnd() * 8),
      foreground: rnd() < 0.5 ? "presenter" : "none",
      background,
      // Ветка «ссылка существует» обязана порождаться, а не быть всегда пустой.
      backgroundClipId: background === "library" ? (rnd() < 0.8 ? "bg1" : "нет-такого") : null,
      appReferenceId: background === "app_screen" ? (rnd() < 0.8 ? "scr1" : "нет-такого") : null,
      idea: rnd() < 0.15 ? null : `идея ${i}`,
      pipEnabled: rnd() < 0.4,
    })
    cursor += duration
  }
  return {
    shots,
    imageUsd: 0.025,
    imageGenerationAllowed: rnd() < 0.85,
    generativeVideoEnabled: rnd() < 0.5,
    generativeVideoBudgetUsd: Math.round(rnd() * 200) / 100,
    generativeVideoUsdPerSec: 0.05,
    minGenerativeVideoSec: 5,
    maxGenerativeVideoSec: 10,
    knownBackgroundIds: new Set(["bg1"]),
    knownAppScreenIds: new Set(["scr1"]),
  }
}

const SEEDS = 20_000

describe("свойства планирования фонов кадров", () => {
  it("Свойство 1: каждому кадру ровно один пункт плана, порядок сохранён", () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const input = generate(seed)
      const plan = planShotBackgroundExecution(input)
      expect(plan.items.map(i => i.order), `seed=${seed}`).toEqual(input.shots.map(s => s.order))
    }
  })

  it("Свойство 2: сумма countsAgainstBudgetUsd никогда не превышает потолок профиля", () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const input = generate(seed)
      const spent = planShotBackgroundExecution(input).items
        .reduce((acc, i) => acc + i.countsAgainstBudgetUsd, 0)
      expect(spent, `seed=${seed}`).toBeLessThanOrEqual(input.generativeVideoBudgetUsd + 1e-9)
    }
  })

  it("Свойство 3: в потолок идёт ТОЛЬКО генеративное видео", () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      for (const item of planShotBackgroundExecution(generate(seed)).items) {
        if (item.action.kind !== "video") expect(item.countsAgainstBudgetUsd, `seed=${seed}`).toBe(0)
        else expect(item.countsAgainstBudgetUsd, `seed=${seed}`).toBeCloseTo(item.costUsd, 9)
      }
    }
  })

  it("Свойство 4: генеративного видео нет ни на одном кадре короче минимума", () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const input = generate(seed)
      planShotBackgroundExecution(input).items.forEach((item, index) => {
        if (item.action.kind !== "video") return
        const duration = input.shots[index]!.endSec - input.shots[index]!.startSec
        expect(duration, `seed=${seed}, order=${item.order}`).toBeGreaterThanOrEqual(input.minGenerativeVideoSec)
      })
    }
  })

  it("Свойство 5: всякая деградация НАЗВАНА", () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const input = generate(seed)
      planShotBackgroundExecution(input).items.forEach((item, index) => {
        const requested = input.shots[index]!.background
        if (requested !== item.action.kind) {
          expect(item.degradeReason, `seed=${seed}, order=${item.order}`).toBeTruthy()
        }
      })
    }
  })

  it("Свойство 6: план детерминирован — тот же вход даёт побайтово тот же выход", () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const input = generate(seed)
      expect(JSON.stringify(planShotBackgroundExecution(input)), `seed=${seed}`)
        .toBe(JSON.stringify(planShotBackgroundExecution(input)))
    }
  })

  it("Свойство 7: промпт просят ровно те кадры, которым назначена картинка или видео", () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const plan = planShotBackgroundExecution(generate(seed))
      const needPrompt = plan.items
        .filter(i => i.action.kind === "image" || i.action.kind === "video")
        .map(i => i.order)
      expect(plan.promptOrders, `seed=${seed}`).toEqual(needPrompt)
    }
  })
})
```

**Требование к домену генератора, проверить отдельно и написать в отчёте:** убедись, что за 20 000 сидов реально порождаются все пять значений `background`, обе ветки `backgroundClipId` (существующий и несуществующий), обе ветки обоих флагов, и потолок как ниже, так и выше цены одного клипа. Посчитай числа и приведи их. Домен, который не порождает ветку, её и не проверяет.

- [ ] **Step 3: Прогнать и убедиться, что падает**

```bash
bunx vitest run --config vitest.pure.config.ts tests/unit/shots/shot-background-plan.spec.ts tests/unit/shots/shot-background-plan.property.spec.ts
```
Ожидание: FAIL — модуля нет.

- [ ] **Step 4: Реализация чистой части**

`server/utils/edit-plan/shot-background-runner.ts`. Правила, каждое — следствие рулинга:

1. Накопитель потолка — **отдельная величина** `countsAgainstBudgetUsd`, ненулевая только у `video` (ruling B4-1). `costUsd` идёт в смету ролика и включает картинки.
2. Квантование длительности генеративного видео — по `REPLICATE_KLING_16_DURATIONS`: минимальная из значений, покрывающая длину кадра; кадр длиннее максимума деградирует до картинки с причиной.
3. Порядок деградации при отказе: `video` → `image` → `none` (кадр отдаётся ведущему на весь экран, §10). `library`/`app_screen` с несуществующей ссылкой деградируют в `image`, а при запрещённой генерации — в `none`.
4. Каждая деградация обязана иметь непустую причину по-русски: она уезжает в `VideoShot.degradeReason` и в лог шага.
5. Функция ЧИСТАЯ: ни БД, ни сети, ни файловой системы.

**Перед реализацией проверь, годится ли `pickBackgroundSource` из `server/utils/edit-plan/background-source.ts`** вместо повторения правил. Подходит — переиспользуй, оставив здесь только накопитель и склейку. Не подходит — **напиши в отчёте, чем именно**, и не дублируй правила молча: расхождение между решением плана и решением исполнения даст кадр, который в БД записан одним, а снят другим.

- [ ] **Step 5: Шаг `runShotBackgrounds` в `video-pipeline-steps.ts`**

Строй по канону `runVideoTranscription` / `runVideoEditPlan` из этого же файла — читай их и повторяй приём:

- `ensureStep(videoId, "shot_background", STEP_ORDER.indexOf("shot_background"))`;
- **ключ кэша шага**: отпечаток трека + отсортированный отпечаток кадров (`order`, `background`, `backgroundClipId`, `appReferenceId`, `idea`) + `format` + `renderQuality` + id модели картинок + id модели видео + планинг-релевантные поля профиля (`imageGenerationEnabled`, `generativeVideoEnabled`, `generativeVideoBudgetUsd`, `generativeVideoResolution`). Ключ живёт в `outputSnapshot`; совпал — шаг не платит и не рисует;
- **идемпотентность на кадр** вторым уровнем: `prisma.videoAsset.findFirst({ where: { videoId, type: "shot_background" as never, order: shot.order } })` плюс проверка, что файл существует на диске. Есть — `reusedCount += 1`, провайдер не дёргается. Тот же приём, что у `runImageGeneration`;
- **промпты** — ОДНИМ вызовом на все кадры из `plan.promptOrders` через `planShotBackgroundPrompts`. `usage` копится в переменной **ВНЕ** вызова: падение после оплаченного вызова не должно унести usage с собой (ре-ревью 3 Task 5, п. 2);
- **деньги**: `chargeStep` за реально сгенерированное. Картинки — `estimateMediaCost(imageSpec, { images: generated, megapixels })`; генеративное видео — `replicateVideoBilling().usdPerSecond` × сумма `billedSec`. Расход Anthropic за промпты — отдельной строкой через `calculateAnthropicCost`, тем же приёмом, что в `runVideoEditPlan`. **Литералов цены в коде нет**;
- **частичное падение**: посчитай ассеты типа `shot_background` ДО шага и добери деньги приёмом `chargePartialStepOnFailure` из `video-pipeline.ts`;
- **запись в БД**: по каждому кадру `prisma.videoShot.update` — `status` (`"completed"` / `"degraded"`), фактический `costUsd`, `degradeReason`. `assetPath` здесь НЕ пишется: он для готового кадра после композиции (Task 5);
- ключ хранилища: **нового билдера в `StorageKeys` в этой задаче не заводить** — фон живёт в `getAssetsDirFor(videoId)` как `shot_{order}_bg.{ext}` и попадает в `VideoAsset.filePath`. Заливку фонов кадров в объектное хранилище запиши в отчёт как незакрытое;
- деградация до `none` при любом отказе исполнения. Шаг падает целиком, только если **ни один** кадр не получил ни фона, ни ведущего: тогда под речь показывать нечего, и §10 требует честного отказа.

- [ ] **Step 6: Вызов шага в `video-pipeline.ts`**

Сразу после блока `2c` (план монтажа), под тем же условием `audioFirst !== null && alignedScenes.length > 0` и дополнительно `editPlan !== null`. Кадры читай из БД (`prisma.videoShot.findMany({ where: { videoId }, orderBy: { order: "asc" } })`), а не из `editPlan.shots`: в БД лежит то, что реально сохранено, и после перезапуска шага это единственный честный источник.

- [ ] **Step 7: Обновить сквозной прогон**

`tests/integration/audio-first-pipeline.spec.ts` утверждает **точный список шагов** маршрута. Допиши `shot_background` между `edit_plan` и `image_generation`, прогони файл зелёным. Мок Anthropic возьмёт фикстуру из Task 3.

- [ ] **Step 8: Тест идемпотентности с БД**

Дописать в `tests/integration/edit-plan.spec.ts`. **Инфраструктурная ловушка, из-за которой тесты уже переписывали дважды:** `tests/setup.ts` делает `TRUNCATE` всей public-схемы в `afterEach` после КАЖДОГО `it`. Строй фикстуры в `beforeEach`, каждый `it` самодостаточен; `beforeAll` с передачей состояния между тестами не работает.

Минимум четыре `it`:
1. повторный прогон при совпавшем ключе кэша не дёргает ни провайдера картинок, ни агента промптов (`toHaveBeenCalledTimes(0)`) и не создаёт новых `VideoAsset`;
2. смена `idea` у одного кадра промахивает кэш и перерисовывает **только** этот кадр;
3. падение на середине оставляет уже нарисованные кадры и записывает расход за них;
4. перезапуск `edit_plan` сносит и кадры, и ассеты фонов.

- [ ] **Step 9: Прогоны**

```bash
bunx vitest run --config vitest.pure.config.ts tests/unit/shots/
bunx vitest run --config vitest.pure.config.ts
FFMPEG_PATH=ffmpeg FFPROBE_PATH=ffprobe bunx vitest run --config vitest.pure.config.ts
bunx vitest run tests/integration/edit-plan.spec.ts
bunx vitest run tests/integration/audio-first-pipeline.spec.ts
```
Все — синхронно, **НЕ в фоне**. Перебор на 20 000 сидов идёт секунды; если файл свойств стал дольше 30 с, число сидов уменьшать НЕЛЬЗЯ — оптимизируй генератор.

- [ ] **Step 10: Мутационная проверка**

| Мутация | Ожидаемый красный тест |
|---|---|
| накопитель считает `costUsd` вместо `countsAgainstBudgetUsd` | «накопитель потолка не отравляется картинками», Свойство 3 |
| проверка потолка снята | Свойство 2 |
| минимум пяти секунд снят | «кадр короче пяти секунд», Свойство 4 |
| квантование даёт 6 вместо 10 | «генеративное видео квантуется» |
| деградация без причины | «несуществующая ссылка», Свойство 5 |
| `imageGenerationAllowed` игнорируется | «выключенная генерация картинок отдаёт кадр ведущему» |
| ключ кэша не включает `idea` | DB-тест «смена idea промахивает кэш» |
| ключ кэша не включает `generativeVideoBudgetUsd` | добавь DB-тест, если его нет |
| `chargeStep` вызывается при попадании в кэш | DB-тест «повторный прогон не платит» |
| промпты запрашиваются на кадр (N вызовов вместо одного) | DB-тест «повторный прогон» + счётчик вызовов |

- [ ] **Step 11: Коммит**

```bash
git add server/utils/edit-plan/shot-background-runner.ts server/utils/video-pipeline-steps.ts server/utils/video-pipeline.ts tests/unit/shots/ tests/integration/edit-plan.spec.ts tests/integration/audio-first-pipeline.spec.ts
git commit -m "feat: шаг shot_background — медиа фона на кадр, потолок и деградация"
```

---

### Task 5: Композиция кадра — ведущий, фон, PiP

Здесь исполняется §6.3 (PiP строго после lip-sync) и §8 («если lip-sync вернул клип иной длины, правится ВИДЕО»). Платных вызовов нет ни одного — только ffmpeg.

**Ключевой факт, который меняет наивное решение:** длину клипа lip-sync задаёт ИСХОДНИК (окно записи, библиотечный клип), а НЕ кусок трека. Поэтому «кадр [t1, t2] — это подотрезок клипа сцены со смещением `t1 − sceneStart`» **неверно**, пока клип не приведён к длине своей сцены в треке. Порядок обязателен:

```
клип сцены от lip-sync  →  привести к длине сцены В ТРЕКЕ (подрезка / удержание кадра)
                        →  вырезать подотрезок кадра по смещению внутри сцены
                        →  композиция с фоном (PiP либо полный экран)
```

**Files:**
- Create: `server/utils/video-tools/shot-compose.ts` (чистое планирование)
- Create: `server/utils/video-tools/shot-compose-runner.ts` (`spawn`)
- Modify: `server/utils/video-pipeline-steps.ts` (композиция внутри `runAssembly`)
- Test: `tests/unit/shots/shot-compose.spec.ts`
- Test: `tests/unit/shots/shot-timeline.spec.ts`

**Interfaces:**
- Consumes: `buildPipOverlayFilter`, `LipSyncedClipPath`, `PipOverlayInput` (`server/utils/video-tools/pip-compose.ts`); `buildShotSubClipArgs`, `renderShotSubClip` (Task 2); `buildClipTrimArgs`, `buildClipHoldLastFrameArgs`, `trimFittedClip`, `holdLastFrameFittedClip`, `probeMediaDuration`, `concatSafeVideoOutputOptions` (`server/utils/render.ts`); `buildStillClipArgs` / `renderStillClip` и `pickShotVariationPlan` (`server/utils/video-tools/still-clip*.ts`, `shot-variation.ts`); `LipSyncSceneRecord` (`server/utils/presenter/lip-sync-progress.ts`); `snapSecToFrame` (`server/utils/voiceover/segment-cut.ts`); `TIMELINE_FPS`.
- Produces:
  ```ts
  export interface ShotSources {
    /** Клип сцены, УЖЕ приведённый к длине сцены в треке. null — ведущего нет. */
    presenterPath: LipSyncedClipPath | null
    /** Смещение начала СЦЕНЫ в треке — база для вырезки подотрезка. */
    sceneStartSec: number
    /** Готовый файл фона. null — фона нет. */
    backgroundPath: string | null
    /** Фон — неподвижная картинка (нужен still-клип), а не видео. */
    backgroundIsStill: boolean
  }

  export type ShotComposition =
    | { kind: "presenter_full"; presenterPath: LipSyncedClipPath; offsetSec: number; durationSec: number }
    | { kind: "background_full"; backgroundPath: string; backgroundIsStill: boolean; durationSec: number; variationIndex: number }
    | {
        kind: "pip"
        backgroundPath: string
        backgroundIsStill: boolean
        presenterPath: LipSyncedClipPath
        presenterOffsetSec: number
        durationSec: number
        variationIndex: number
        pipFilters: string[]
      }

  export function planShotComposition(input: {
    shot: { order: number; startSec: number; endSec: number; pipEnabled: boolean; foreground: string }
    sources: ShotSources
    profile: Pick<ResolvedEditProfile, "pipPosition" | "pipSize" | "pipEnabled">
    canvasWidth: number
    canvasHeight: number
    fps: number
  }): ShotComposition | null

  /** Кадр без ведущего и без фона существовать не может — он сливается с соседом. */
  export function mergeUnrenderableShots<T extends { order: number; startSec: number; endSec: number }>(
    shots: readonly T[],
    isRenderable: (shot: T) => boolean,
  ): { shots: T[]; mergedOrders: number[] }
  ```

- [ ] **Step 1: Написать падающий тест на слияние нерисуемых кадров**

`tests/unit/shots/shot-timeline.spec.ts`:

```ts
import { describe, expect, it } from "vitest"

import { mergeUnrenderableShots } from "~~/server/utils/video-tools/shot-compose"

interface S { order: number, startSec: number, endSec: number, ok: boolean }
const s = (order: number, startSec: number, endSec: number, ok = true): S => ({ order, startSec, endSec, ok })
const renderable = (x: S) => x.ok

describe("слияние кадров, которые нечем нарисовать", () => {
  it("все кадры рисуемы — таймлайн не меняется ни на кадр", () => {
    const input = [s(0, 0, 2), s(1, 2, 4), s(2, 4, 6)]
    const { shots, mergedOrders } = mergeUnrenderableShots(input, renderable)
    expect(shots).toEqual(input)
    expect(mergedOrders).toEqual([])
  })

  it("нерисуемый кадр в середине прирастает к ПРЕДЫДУЩЕМУ — дыры не остаётся", () => {
    const { shots, mergedOrders } = mergeUnrenderableShots([s(0, 0, 2), s(1, 2, 4, false), s(2, 4, 6)], renderable)
    expect(shots.map(x => [x.startSec, x.endSec])).toEqual([[0, 4], [4, 6]])
    expect(mergedOrders).toEqual([1])
  })

  it("нерисуемый ПЕРВЫЙ кадр прирастает к следующему — начало трека покрыто", () => {
    const { shots } = mergeUnrenderableShots([s(0, 0, 2, false), s(1, 2, 4)], renderable)
    expect(shots.map(x => [x.startSec, x.endSec])).toEqual([[0, 4]])
  })

  it("нерисуемый последний кадр прирастает к предыдущему — хвост покрыт", () => {
    const { shots } = mergeUnrenderableShots([s(0, 0, 2), s(1, 2, 4, false)], renderable)
    expect(shots.map(x => [x.startSec, x.endSec])).toEqual([[0, 4]])
  })

  it("подряд идущие нерисуемые сливаются в одного соседа, а не размножаются", () => {
    const { shots, mergedOrders } = mergeUnrenderableShots(
      [s(0, 0, 2), s(1, 2, 4, false), s(2, 4, 6, false), s(3, 6, 8)], renderable,
    )
    expect(shots.map(x => [x.startSec, x.endSec])).toEqual([[0, 6], [6, 8]])
    expect(mergedOrders).toEqual([1, 2])
  })

  it("покрытие сохраняется всегда: сумма длительностей и границы не меняются", () => {
    const input = [s(0, 0, 1.5, false), s(1, 1.5, 3.3), s(2, 3.3, 5.0, false), s(3, 5.0, 7.2)]
    const { shots } = mergeUnrenderableShots(input, renderable)
    expect(shots[0]!.startSec).toBe(0)
    expect(shots.at(-1)!.endSec).toBe(7.2)
    for (let i = 1; i < shots.length; i += 1) expect(shots[i]!.startSec).toBe(shots[i - 1]!.endSec)
  })

  it("ни одного рисуемого кадра нет — возвращается пустой список, решение принимает вызывающий", () => {
    const { shots } = mergeUnrenderableShots([s(0, 0, 2, false), s(1, 2, 4, false)], renderable)
    expect(shots).toEqual([])
  })
})
```

- [ ] **Step 2: Написать падающий тест на композицию**

`tests/unit/shots/shot-compose.spec.ts`:

```ts
import { describe, expect, it } from "vitest"

import { planShotComposition, type ShotSources } from "~~/server/utils/video-tools/shot-compose"
import type { LipSyncedClipPath } from "~~/server/utils/video-tools/pip-compose"

// В тестах бренд создаётся кастом ОСОЗНАННО: продакшн-код так делать не имеет
// права (единственный минт — markLipSynced в lip-sync-runner.ts), но тест
// обязан уметь построить вход.
const PRESENTER = "/a/scene_1_lipsync_fit.mp4" as LipSyncedClipPath

const PROFILE = { pipPosition: "bottom_right" as const, pipSize: 0.28, pipEnabled: true }
const CANVAS = { canvasWidth: 1080, canvasHeight: 1920, fps: 30 }

function sources(over: Partial<ShotSources> = {}): ShotSources {
  return { presenterPath: PRESENTER, sceneStartSec: 4.0, backgroundPath: "/a/shot_3_bg.png", backgroundIsStill: true, ...over }
}

const shot = (over: Partial<{ order: number, startSec: number, endSec: number, pipEnabled: boolean, foreground: string }> = {}) => ({
  order: 3, startSec: 5.8, endSec: 7.6, pipEnabled: true, foreground: "presenter", ...over,
})

describe("композиция кадра", () => {
  it("ведущий без фона — полный экран, смещение считается ОТ НАЧАЛА СЦЕНЫ", () => {
    const plan = planShotComposition({ shot: shot({ pipEnabled: false }), sources: sources({ backgroundPath: null }), profile: PROFILE, ...CANVAS })
    expect(plan).toMatchObject({ kind: "presenter_full", presenterPath: PRESENTER })
    // 5.8 − 4.0 = 1.8, притянуто к кадру.
    expect((plan as { offsetSec: number }).offsetSec).toBeCloseTo(1.8, 6)
    expect((plan as { durationSec: number }).durationSec).toBeCloseTo(1.8, 6)
  })

  it("фон без ведущего — полный экран фона", () => {
    const plan = planShotComposition({ shot: shot({ foreground: "none" }), sources: sources({ presenterPath: null }), profile: PROFILE, ...CANVAS })
    expect(plan).toMatchObject({ kind: "background_full", backgroundPath: "/a/shot_3_bg.png", backgroundIsStill: true })
  })

  it("ведущий поверх фона при включённом PiP — ветка pip и готовые фильтры наложения", () => {
    const plan = planShotComposition({ shot: shot(), sources: sources(), profile: PROFILE, ...CANVAS })
    expect(plan!.kind).toBe("pip")
    const filters = (plan as { pipFilters: string[] }).pipFilters
    // Фон — [0:v], ведущий — [1:v]: обратный порядок прячет PiP под фоном.
    expect(filters.some(f => f.startsWith("[1:v]"))).toBe(true)
    expect(filters.at(-1)).toContain("[0:v][pip]overlay=")
    expect(filters.at(-1)).toContain("[vout]")
  })

  it("PiP выключен на КАДРЕ — ведущий занимает весь экран, фон отбрасывается", () => {
    const plan = planShotComposition({ shot: shot({ pipEnabled: false }), sources: sources(), profile: PROFILE, ...CANVAS })
    expect(plan!.kind).toBe("presenter_full")
  })

  it("PiP выключен в ПРОФИЛЕ — тот же исход, даже если кадр просит", () => {
    const plan = planShotComposition({ shot: shot({ pipEnabled: true }), sources: sources(), profile: { ...PROFILE, pipEnabled: false }, ...CANVAS })
    expect(plan!.kind).toBe("presenter_full")
  })

  it("presenter-кадр без своей сцены не берёт чужой клип — фон на весь экран", () => {
    // Модель может вернуть foreground: "presenter" при sceneOrder: null, и
    // валидация плана такого правила не имеет (ре-ревью фикс-раунда 24.08).
    // Клипа ведущего у такого кадра нет физически: он привязан к сцене.
    const plan = planShotComposition({
      shot: shot({ foreground: "presenter" }),
      sources: sources({ presenterPath: null }),
      profile: PROFILE, ...CANVAS,
    })
    expect(plan!.kind).toBe("background_full")
  })

  it("ни ведущего, ни фона — null: такой кадр не существует и обязан быть слит", () => {
    const plan = planShotComposition({
      shot: shot({ foreground: "none" }),
      sources: sources({ presenterPath: null, backgroundPath: null }),
      profile: PROFILE, ...CANVAS,
    })
    expect(plan).toBeNull()
  })

  it("альбомный холст не ломает геометрию окна PiP", () => {
    const plan = planShotComposition({
      shot: shot(), sources: sources(), profile: { ...PROFILE, pipSize: 0.5 },
      canvasWidth: 1920, canvasHeight: 1080, fps: 30,
    })
    const overlay = (plan as { pipFilters: string[] }).pipFilters.at(-1)!
    const [, x, y] = overlay.match(/overlay=(\d+):(\d+)/)!
    expect(Number(x)).toBeGreaterThanOrEqual(0)
    expect(Number(y)).toBeGreaterThanOrEqual(0)
  })

  it("движение неподвижного фона различается у соседних кадров", () => {
    const a = planShotComposition({ shot: shot({ order: 3, foreground: "none" }), sources: sources({ presenterPath: null }), profile: PROFILE, ...CANVAS })
    const b = planShotComposition({ shot: shot({ order: 4, foreground: "none" }), sources: sources({ presenterPath: null }), profile: PROFILE, ...CANVAS })
    expect((a as { variationIndex: number }).variationIndex)
      .not.toBe((b as { variationIndex: number }).variationIndex)
  })

  it("границы кадра притянуты к сетке кадров — иначе конкат уводит таймлайн", () => {
    const plan = planShotComposition({
      shot: shot({ startSec: 5.7777, endSec: 7.6111, pipEnabled: false }),
      sources: sources({ backgroundPath: null }), profile: PROFILE, ...CANVAS,
    })
    const duration = (plan as { durationSec: number }).durationSec
    expect(Math.abs(duration * 30 - Math.round(duration * 30))).toBeLessThan(1e-6)
  })

  it("отрицательное смещение невозможно: кадр начинается не раньше своей сцены", () => {
    const plan = planShotComposition({
      shot: shot({ startSec: 3.0, endSec: 4.5, pipEnabled: false }),
      sources: sources({ sceneStartSec: 4.0, backgroundPath: null }), profile: PROFILE, ...CANVAS,
    })
    expect((plan as { offsetSec: number }).offsetSec).toBeGreaterThanOrEqual(0)
  })
})
```

- [ ] **Step 3: Прогнать и убедиться, что падают**

```bash
bunx vitest run --config vitest.pure.config.ts tests/unit/shots/shot-compose.spec.ts tests/unit/shots/shot-timeline.spec.ts
```
Ожидание: FAIL — модуля нет.

- [ ] **Step 4: Реализация `shot-compose.ts`**

Правила:

1. **Ветка выбирается по НАЛИЧИЮ ИСТОЧНИКОВ, а не по полю `foreground`:** есть ведущий и фон и `shot.pipEnabled && profile.pipEnabled` → `pip`; есть ведущий (PiP выключен любой стороной) → `presenter_full`, фон отбрасывается; ведущего нет, фон есть → `background_full`; нет ни того ни другого → `null`.
   Различие принципиальное: `foreground: "presenter"` при `sceneOrder: null` **возможен** — модель вправе так вернуть, а валидация плана такого правила не имеет (подтверждено ре-ревью фикс-раунда 24.08.2026: подмена в `forcedEmpty` этого больше не создаёт, но ответ модели — создаёт). Клипа ведущего у такого кадра нет физически: он привязан к сцене. Доверять полю `foreground` значило бы искать несуществующий файл; доверять `sources.presenterPath` — корректно всегда.
2. **PiP-фильтры берутся у `buildPipOverlayFilter`**, а не собираются заново. Её вход `foreground: LipSyncedClipPath` — тип, который и есть гарантия §6.3. **Слепой `as LipSyncedClipPath` в продакшн-коде запрещён:** строка приходит из `LipSyncSceneRecord.outputPath`, она уже брендирована.
3. **Смещение** = `snapSecToFrame(Math.max(0, shot.startSec − sources.sceneStartSec), fps)`. Длительность = `snapSecToFrame(shot.endSec, fps) − snapSecToFrame(shot.startSec, fps)`.
4. **`variationIndex` = `shot.order`**, а не `sceneOrder`: `pickShotVariationPlan` выбирает панораму по индексу, и на `sceneOrder` все кадры одной сцены получили бы одинаковое движение — ровно то, ради избавления от чего затевался кадровый монтаж.
5. Функция ЧИСТАЯ: ни файловой системы, ни процессов.

`mergeUnrenderableShots` — тоже чистая: идёт по списку, нерисуемый кадр отдаёт своё время предыдущему (а первый — следующему), возвращает новый список и `mergedOrders` для лога шага. Инвариант: покрытие таймлайна не меняется, границы соседей стыкуются встык.

- [ ] **Step 5: Реализация `shot-compose-runner.ts`**

`spawn` по образцу `still-clip-runner.ts`. Три ветки:

- `presenter_full` → `renderShotSubClip` из Task 2;
- `background_full` → неподвижный фон идёт через `renderStillClip` (движение уже там), видео-фон — через `renderShotSubClip` с нулевым смещением и обрезкой/повтором до длительности кадра;
- `pip` → фон готовится как в `background_full` во временный файл, ведущий — как в `presenter_full`, затем один `ffmpeg` с двумя `-i` и `-filter_complex` из `pipFilters`, `-map "[vout]"`. Звук кадра — немой (`anullsrc`): родные дорожки идут в ноль по §6.4, и синтезировать тишину дешевле, чем глушить.

Таймаут `SHOT_COMPOSE_TIMEOUT_MS = 180_000`, ошибки по-русски с хвостом stderr.

- [ ] **Step 6: Сборка источников кадра — фон и приведённый клип ведущего**

В `runAssembly` (`server/utils/video-pipeline-steps.ts`), до композиции.

**Фон.** Пути берутся из ассетов, которые записал шаг `shot_background` (Task 4):

```ts
const backgroundAssets = await prisma.videoAsset.findMany({
  where: { videoId, type: "shot_background" as never },
  select: { order: true, filePath: true, contentType: true },
})
const backgroundByShotOrder = new Map(backgroundAssets.map(a => [a.order, a]))
```

`ShotSources.backgroundIsStill` определяется по `contentType` ассета (`image/*` — неподвижный кадр, `video/*` — уже готовый клип), а не по `VideoShot.background`: после деградации `video → image` поле плана говорит одно, а на диске лежит другое, и верить надо диску. Ассета нет или файла нет на диске — `backgroundPath: null`, кадр уходит в `mergeUnrenderableShots`.

**Ведущий.** Для каждой сцены с непустым `LipSyncSceneRecord.outputPath`:

1. измерить готовый файл `probeMediaDuration` — **сегодня этого не делает никто**, длина результата lip-sync в проекте нигде не измеряется;
2. цель — длина сцены в треке: `alignedScene.endSec − alignedScene.startSec`, притянутая к кадру;
3. расхождение больше `1/TIMELINE_FPS` → `trimFittedClip` (длиннее) либо `holdLastFrameFittedClip` (короче). **Звук не трогается никогда** — §8;
4. результат заменяет путь сцены в карте, из которой берётся `presenterPath`;
5. каждое приведение — строкой в лог шага: сцена, заказано, факт, что сделано.

Ветка исполняется **только** на кадровом маршруте. На старом `alignedScenes` нет вовсе, и она не входит.

- [ ] **Step 7: Прогоны**

```bash
bunx vitest run --config vitest.pure.config.ts tests/unit/shots/
bunx vitest run --config vitest.pure.config.ts
FFMPEG_PATH=ffmpeg FFPROBE_PATH=ffprobe bunx vitest run --config vitest.pure.config.ts
```

- [ ] **Step 8: Мутационная проверка**

| Мутация | Ожидаемый красный тест |
|---|---|
| в `pip` местами переставлены `[0:v]` и `[1:v]` | «ведущий поверх фона — ветка pip» |
| `shot.pipEnabled` игнорируется | «PiP выключен на КАДРЕ» |
| `profile.pipEnabled` игнорируется | «PiP выключен в ПРОФИЛЕ» |
| смещение считается от нуля, а не от `sceneStartSec` | «смещение считается ОТ НАЧАЛА СЦЕНЫ» |
| `Math.max(0, …)` у смещения снят | «отрицательное смещение невозможно» |
| `variationIndex` берётся из `sceneOrder` | «движение неподвижного фона различается у соседних кадров» |
| `snapSecToFrame` убран | «границы кадра притянуты к сетке кадров» |
| `null` заменён на `background_full` с пустым путём | «ни ведущего, ни фона — null» |
| слияние отдаёт время СЛЕДУЮЩЕМУ вместо предыдущего | «покрытие сохраняется всегда» |
| первый нерисуемый кадр просто выбрасывается | «нерисуемый ПЕРВЫЙ кадр прирастает к следующему» |

- [ ] **Step 9: Коммит**

```bash
git add server/utils/video-tools/shot-compose.ts server/utils/video-tools/shot-compose-runner.ts server/utils/video-pipeline-steps.ts tests/unit/shots/
git commit -m "feat: композиция кадра — PiP после lip-sync, приведение клипа к длине сцены"
```

---

### Task 6: Сборка по кадрам, субтитры по абсолютному времени, звук

**Files:**
- Create: `server/utils/edit-plan/shot-subtitles.ts`
- Modify: `server/utils/render.ts` (`AssembleOptions.shotTimeline`, ветка в `assembleVideo`, `buildAssSegments`)
- Modify: `server/utils/video-pipeline-steps.ts` (`runAssembly` — кадровая ветка)
- Modify: `server/utils/video-pipeline.ts` (передача кадров в сборку)
- Test: `tests/unit/shots/shot-subtitles.spec.ts`
- Test: `tests/unit/shots/shot-assembly.spec.ts`

**Interfaces:**
- Consumes: `AlignedScene`, `AlignedWord` (`server/utils/transcription/align.ts`); `chunkSceneSpeech`, `maxCharsForWidth` (`server/utils/subtitles/phrase-chunker.ts`); `wordsForChunk` (`server/utils/subtitles/aligned-words.ts`); `AssSegmentInput` (`server/utils/subtitles/ass-builder/dialogue.ts`); `ShotComposition` (Task 5).
- Produces:
  ```ts
  export interface TrackSubtitleInput {
    alignedScenes: readonly AlignedScene[]
    /** Текст и раскладка сцены сценария по её order. */
    scenesByOrder: ReadonlyMap<number, { text: string; placement?: SubtitlePlacement }>
    maxChars?: number
  }
  export function buildTrackSubtitleSegments(input: TrackSubtitleInput): AssSegmentInput[]

  // render.ts
  interface AssembleOptions {
    // …существующие поля без изменений…
    /**
     * Кадровый таймлайн (маршрут «монтаж от звука», шаг 8). Задан — склейка идёт
     * по кадрам, `clipTrackAlignment` не используется вовсе.
     */
    shotTimeline?: {
      shots: ReadonlyArray<{ order: number; startSec: number; endSec: number; path: string }>
      trackDurationSec: number
      subtitleSegments?: AssSegmentInput[]
    }
  }
  ```

- [ ] **Step 1: Написать падающий тест субтитров**

`tests/unit/shots/shot-subtitles.spec.ts`:

```ts
import { describe, expect, it } from "vitest"

import { buildTrackSubtitleSegments } from "~~/server/utils/edit-plan/shot-subtitles"
import type { AlignedScene } from "~~/server/utils/transcription/align"

const word = (text: string, startSec: number, endSec: number) => ({ text, startSec, endSec, matched: true })

const SCENES: AlignedScene[] = [
  { order: 1, startSec: 0.0, endSec: 2.0, words: [word("привет", 0.0, 0.7), word("это", 0.7, 1.1), word("тест", 1.1, 2.0)] },
  { order: 2, startSec: 2.0, endSec: 4.4, words: [word("вторая", 2.0, 2.9), word("сцена", 2.9, 4.4)] },
]

const BY_ORDER = new Map([
  [1, { text: "привет это тест" }],
  [2, { text: "вторая сцена" }],
])

describe("субтитры по абсолютному времени трека", () => {
  it("окна берутся из выравнивания, а не из длительностей клипов", () => {
    const segs = buildTrackSubtitleSegments({ alignedScenes: SCENES, scenesByOrder: BY_ORDER })
    expect(segs[0]!.startSec).toBeCloseTo(0.0, 6)
    expect(segs.at(-1)!.endSec).toBeCloseTo(4.4, 6)
  })

  it("сегменты идут по возрастанию времени и не перехлёстываются", () => {
    const segs = buildTrackSubtitleSegments({ alignedScenes: SCENES, scenesByOrder: BY_ORDER })
    for (let i = 1; i < segs.length; i += 1) {
      expect(segs[i]!.startSec).toBeGreaterThanOrEqual(segs[i - 1]!.endSec - 1e-9)
    }
  })

  it("слова чанка — РЕАЛЬНЫЕ тайминги выравнивания, а не равномерная оценка", () => {
    const segs = buildTrackSubtitleSegments({ alignedScenes: SCENES, scenesByOrder: BY_ORDER })
    const words = segs[0]!.words
    expect(words).toBeDefined()
    expect(words!.some(w => Math.abs(w.startSec - 0.7) < 1e-6)).toBe(true)
  })

  it("сцена без текста сценария субтитра не даёт и хвост не сдвигает", () => {
    const segs = buildTrackSubtitleSegments({
      alignedScenes: SCENES, scenesByOrder: new Map([[2, { text: "вторая сцена" }]]),
    })
    expect(segs).toHaveLength(1)
    expect(segs[0]!.startSec).toBeCloseTo(2.0, 6)
  })

  it("сцена, которой нет в выравнивании, субтитра не получает — время неизвестно", () => {
    const segs = buildTrackSubtitleSegments({
      alignedScenes: [SCENES[0]!],
      scenesByOrder: new Map([[1, { text: "привет это тест" }], [9, { text: "чужая" }]]),
    })
    expect(segs.every(s => s.text !== "чужая")).toBe(true)
  })

  it("позиционного сопоставления нет вовсе: перестановка сцен ничего не двигает", () => {
    const reversed = [SCENES[1]!, SCENES[0]!]
    const a = buildTrackSubtitleSegments({ alignedScenes: SCENES, scenesByOrder: BY_ORDER })
    const b = buildTrackSubtitleSegments({ alignedScenes: reversed, scenesByOrder: BY_ORDER })
    expect(JSON.stringify(b)).toBe(JSON.stringify(a))
  })

  it("пустое выравнивание даёт пустой список, а не бросает", () => {
    expect(buildTrackSubtitleSegments({ alignedScenes: [], scenesByOrder: BY_ORDER })).toEqual([])
  })
})
```

- [ ] **Step 2: Написать падающий тест кадровой сборки**

`tests/unit/shots/shot-assembly.spec.ts` — проверяет РЕШЕНИЯ сборки, а не запуск ffmpeg. Экспортируй из `render.ts` чистую `planShotAssembly(options)`, возвращающую `{ usesClipTrackAlignment: boolean, concatPaths: string[], clipLaneVolume: number, subtitleSource: "shots" | "clips" | "legacy" }`, и проверяй её.

```ts
import { describe, expect, it } from "vitest"

import { planShotAssembly } from "~~/server/utils/render"

const SHOTS = [
  { order: 0, startSec: 0, endSec: 1.8, path: "/a/shot_0.mp4" },
  { order: 1, startSec: 1.8, endSec: 3.6, path: "/a/shot_1.mp4" },
]

describe("решения кадровой сборки", () => {
  it("кадровый таймлайн задан — подгон длин под трек НЕ исполняется", () => {
    const plan = planShotAssembly({ shotTimeline: { shots: SHOTS, trackDurationSec: 3.6 }, clipVolumeWithVoiceover: 0, clips: [] })
    // Кадры по построению покрывают трек ровно: подгонять нечего, а лишний
    // проход тронул бы уже точные границы.
    expect(plan.usesClipTrackAlignment).toBe(false)
  })

  it("склейка идёт по кадрам в порядке order, а не по клипам сцен", () => {
    const plan = planShotAssembly({
      shotTimeline: { shots: [SHOTS[1]!, SHOTS[0]!], trackDurationSec: 3.6 },
      clipVolumeWithVoiceover: 0, clips: ["/a/scene_0.mp4"],
    })
    expect(plan.concatPaths).toEqual(["/a/shot_0.mp4", "/a/shot_1.mp4"])
  })

  it("дорожки картинки идут В НОЛЬ — иначе двойная речь с эхом (§6.4)", () => {
    const plan = planShotAssembly({ shotTimeline: { shots: SHOTS, trackDurationSec: 3.6 }, clipVolumeWithVoiceover: 0, clips: [] })
    expect(plan.clipLaneVolume).toBe(0)
  })

  it("субтитры на кадровом маршруте берутся из трека, а не из позиций клипов", () => {
    const plan = planShotAssembly({ shotTimeline: { shots: SHOTS, trackDurationSec: 3.6 }, clipVolumeWithVoiceover: 0, clips: [] })
    expect(plan.subtitleSource).toBe("shots")
  })

  it("кадрового таймлайна нет — поведение старого маршрута побайтово прежнее", () => {
    const plan = planShotAssembly({ clips: ["/a/scene_0.mp4", "/a/scene_1.mp4"], clipVolumeWithVoiceover: 0.3 })
    expect(plan.concatPaths).toEqual(["/a/scene_0.mp4", "/a/scene_1.mp4"])
    expect(plan.clipLaneVolume).toBe(0.3)
    expect(plan.subtitleSource).not.toBe("shots")
  })

  it("пустой кадровый таймлайн не превращается в пустую склейку молча", () => {
    expect(() => planShotAssembly({ shotTimeline: { shots: [], trackDurationSec: 3.6 }, clipVolumeWithVoiceover: 0, clips: [] }))
      .toThrow()
  })
})
```

- [ ] **Step 3: Прогнать и убедиться, что падают**

```bash
bunx vitest run --config vitest.pure.config.ts tests/unit/shots/shot-subtitles.spec.ts tests/unit/shots/shot-assembly.spec.ts
```
Ожидание: FAIL.

- [ ] **Step 4: Реализация `shot-subtitles.ts`**

Окна берутся прямо из `AlignedScene.startSec/endSec` — они уже в абсолютных секундах трека, ровно там же, где живут границы кадров. Текст режется тем же `chunkSceneSpeech`, что и на старом маршруте; слова чанка — `wordsForChunk({ words: scene.words, chunkText, chunkStartSec, chunkEndSec })`. Сцены сортируются по `startSec`.

**Позиционного сопоставления здесь нет вовсе** — и это главное упрощение задачи. На старом маршруте `alignedScenesByClipPosition(alignedScenes, positionByOrder)` переводит `order` сцены в позицию клипа в склейке, потому что окно субтитра считалось от длительностей клипов. На кадровом маршруте считать нечего: время уже абсолютное.

- [ ] **Step 5: Кадровая ветка в `render.ts`**

- `AssembleOptions.shotTimeline` — новое необязательное поле. **Задано и `clipTrackAlignment` тоже задан — это ошибка вызывающего**, бросай явно: две разные шкалы времени в одной сборке дают ролик, разъехавшийся со звуком.
- Задан `shotTimeline` → `clips` игнорируется, конкат-лист строится из кадров, отсортированных по `order`; `fitClipsToTrack` **не вызывается**; `buildAssSegments` получает готовые `subtitleSegments` и не считает окна сам.
- Пустой список кадров → бросить с русским сообщением: под непрерывную речь показывать нечего, ролик готовым не помечается (§10).
- Аудиомикс не меняется ни на строку: `[0:a]` кадры (громкость от вызывающего, на этом маршруте 0), `[1:a]` музыка с ducking, `[2:a]` voiceover на 1.0 с приведением громкости. Второй проход `normalizeFileLoudness` остаётся.
- Нормализация кадров перед конкатом — существующей `normalizeClipsForConcat`: кадры уже собраны в единый кодек, и повторный вызов бесплатен (нормализованный путь она узнаёт).

- [ ] **Step 6: Явное отключение `voiceoverReconciliation`**

§8 требует выключить политику **явно**, а не полагаться на то, что она и так не исполняется. Сегодня `shouldReconcileVoiceover(audioFirstTrackCompleted)` уже вызывается в `runVoiceoverGeneration`, но на audio-first сам шаг не вызывается вовсе — то есть гарантия держится на устройстве ветки, а не на правиле.

В `runAssembly`, в кадровой ветке: прочитать конфиг ролика и, если `voiceoverReconciliation` отличается от нейтрального, записать в лог шага, что политика на этом маршруте не применяется и почему (кадр нарезан по речи, мирить нечего, подмена клипов `*_ext.mp4` разошлась бы с таймлайном). Тест: кадровая сборка с `voiceoverReconciliation: 'extend_scene'` не создаёт ни одного `*_ext.mp4` и не зовёт `extendVideoClip`.

- [ ] **Step 7: Передача кадров из `video-pipeline.ts`**

После `music_generation`, перед `runAssembly`: если кадры есть и композиция удалась, передать `shotTimeline` в `extras`. `clipVolumeWithVoiceover` остаётся `clipVolumeWithVoiceoverFor(audioFirstTrackCompleted)` — не хардкодить ноль: без состоявшегося трека ноль оставил бы ведущего беззвучным.

- [ ] **Step 8: Прогоны**

```bash
bunx vitest run --config vitest.pure.config.ts tests/unit/shots/
bunx vitest run --config vitest.pure.config.ts
FFMPEG_PATH=ffmpeg FFPROBE_PATH=ffprobe bunx vitest run --config vitest.pure.config.ts
bunx vitest run tests/integration/audio-first-pipeline.spec.ts
```

- [ ] **Step 9: Мутационная проверка**

| Мутация | Ожидаемый красный тест |
|---|---|
| `fitClipsToTrack` вызывается и на кадровом маршруте | «подгон длин под трек НЕ исполняется» |
| кадры не сортируются по `order` | «склейка идёт по кадрам в порядке order» |
| `clipVolumeWithVoiceover` захардкожен в 0.3 | «дорожки картинки идут В НОЛЬ» |
| субтитры считаются старым путём | «субтитры берутся из трека» |
| ветка `shotTimeline` исполняется всегда | «кадрового таймлайна нет — поведение прежнее» |
| пустой таймлайн даёт пустую склейку | «пустой кадровый таймлайн не превращается молча» |
| окна субтитров берутся из длительностей клипов | «окна берутся из выравнивания» |
| `wordsForChunk` не вызывается | «слова чанка — РЕАЛЬНЫЕ тайминги» |
| сцена без текста получает пустой субтитр | «сцена без текста субтитра не даёт» |

- [ ] **Step 10: Коммит**

```bash
git add server/utils/edit-plan/shot-subtitles.ts server/utils/render.ts server/utils/video-pipeline-steps.ts server/utils/video-pipeline.ts tests/unit/shots/
git commit -m "feat: сборка по кадрам, субтитры по абсолютному времени, звук трека главной дорожкой"
```

---

### Task 7: Посценные картинки и клипы выключаются на кадровом маршруте

Без этой задачи ролик платит дважды: посценные картинки и **Kling-клипы** генерируются и в ролик не попадают. Это порядка $0.25 картинок плюс самая дорогая статья ролика — впустую, на каждом ролике при 300 в сутки.

**Files:**
- Modify: `server/utils/video-pipeline.ts`
- Modify: `tests/integration/audio-first-pipeline.spec.ts`
- Test: `tests/unit/shots/scene-steps-skip.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  /** Нужны ли посценные картинки и клипы этому прогону. */
  export function sceneMediaNeeded(input: {
    audioFirstTrackCompleted: boolean
    shotCount: number
  }): boolean
  ```
  (в `server/utils/video-pipeline-run-policy.ts` — рядом с `clipVolumeWithVoiceoverFor` и `shouldReconcileVoiceover`, теми же соображениями)

- [ ] **Step 1: Написать падающий тест**

`tests/unit/shots/scene-steps-skip.spec.ts`:

```ts
import { describe, expect, it } from "vitest"

import { sceneMediaNeeded } from "~~/server/utils/video-pipeline-run-policy"

describe("нужны ли посценные картинки и клипы", () => {
  it("старый маршрут — нужны всегда, что бы ни лежало в кадрах", () => {
    expect(sceneMediaNeeded({ audioFirstTrackCompleted: false, shotCount: 0 })).toBe(true)
    expect(sceneMediaNeeded({ audioFirstTrackCompleted: false, shotCount: 40 })).toBe(true)
  })

  it("трек состоялся и кадры есть — посценные шаги не нужны: их продукт в ролик не попадает", () => {
    expect(sceneMediaNeeded({ audioFirstTrackCompleted: true, shotCount: 40 })).toBe(false)
  })

  it("трек состоялся, а кадров нет — нужны: собирать будет нечего", () => {
    expect(sceneMediaNeeded({ audioFirstTrackCompleted: true, shotCount: 0 })).toBe(true)
  })

  it("решение опирается на ФАКТ трека, а не на флаг ролика", () => {
    // Ролик с включённым EDIT_PIPELINE, у которого трек не синтезировался
    // (empty_script, legacy_mode_no_single_track), обязан идти прежним путём.
    expect(sceneMediaNeeded({ audioFirstTrackCompleted: false, shotCount: 40 })).toBe(true)
  })
})
```

- [ ] **Step 2: Прогнать, убедиться, что падает**

```bash
bunx vitest run --config vitest.pure.config.ts tests/unit/shots/scene-steps-skip.spec.ts
```

- [ ] **Step 3: Реализация**

```ts
/**
 * Нужны ли ролику посценные картинки и клипы.
 *
 * На кадровом маршруте в ролик попадают только кадры (`VideoShot`), у каждого
 * свой фон от шага `shot_background`. Посценные картинки и text-to-video при
 * этом никуда не идут: их продукт не оказывается ни в одном кадре склейки.
 * Оставленные включёнными, они стоят порядка $0.25 картинок и полную цену
 * Kling-клипов на КАЖДЫЙ ролик — при 300 роликах в сутки это самая дорогая
 * бесполезная статья пайплайна.
 *
 * Смотрим на ФАКТ трека и на ФАКТ кадров, а не на флаг ролика: маршрут может
 * быть выбран, а трек не состояться (`empty_script`,
 * `legacy_mode_no_single_track`), и тогда собирать будет нечего.
 */
export function sceneMediaNeeded(input: {
  audioFirstTrackCompleted: boolean
  shotCount: number
}): boolean {
  if (!input.audioFirstTrackCompleted) return true
  return input.shotCount === 0
}
```

- [ ] **Step 4: Применить в `video-pipeline.ts`**

Перед шагом изображений: посчитать кадры, вычислить `sceneMediaNeeded`. Не нужны — вызвать существующие `skipImageGenerationStep(videoId)` и аналогичный пропуск клипов **вместо** `runImageGeneration` / `runClipGeneration`, записав причину в лог шага. Пропущенный шаг `attemptCount` не трогает, поэтому `chargeImages` / `chargeClips` получат ноль и денег не спишут — тот же приём, что уже применён для `presenterOnly`.

**Конфликт с Task 4, снят сканом — не наступи повторно.** Task 4 уже правил ожидаемый список шагов в `tests/integration/audio-first-pipeline.spec.ts`, дописав туда `shot_background`. Эта задача меняет тот же список второй раз: посценные шаги перестают ИСПОЛНЯТЬСЯ. Сначала выясни фактом, а не догадкой, остаются ли их строки в списке со статусом `skipped` (`skipPromptGenerationStep`/`skipImageGenerationStep` строку шага заводят), и правь утверждение по факту, а не по ожиданию.

**Проверить и написать в отчёте:** `runLipSyncStep` получает `clipPaths`. У сцен ведущего ячейки и сегодня пусты (они исключены из генерации клипов), а источник кадра берётся из окна записи или библиотеки. Убедись грепом, что пустой `clipPaths` не меняет поведение lip-sync на кадровом маршруте, и покажи, каким кодом это гарантировано. Если гарантии нет — **остановись и скажи**, не чини наугад.

- [ ] **Step 5: Прогоны**

```bash
bunx vitest run --config vitest.pure.config.ts
FFMPEG_PATH=ffmpeg FFPROBE_PATH=ffprobe bunx vitest run --config vitest.pure.config.ts
bunx vitest run tests/integration/audio-first-pipeline.spec.ts
```

Плюс целевые DB-тесты по затронутым модулям. Полную `tests/unit` (~50 минут) не гонять.

- [ ] **Step 6: Мутационная проверка**

| Мутация | Ожидаемый красный тест |
|---|---|
| `sceneMediaNeeded` всегда `true` | «трек состоялся и кадры есть — не нужны» |
| `sceneMediaNeeded` всегда `false` | «старый маршрут — нужны всегда» |
| проверка `shotCount` снята | «трек состоялся, а кадров нет — нужны» |
| решение по флагу ролика вместо факта трека | «решение опирается на ФАКТ трека» |

- [ ] **Step 7: Коммит**

```bash
git add server/utils/video-pipeline-run-policy.ts server/utils/video-pipeline.ts tests/unit/shots/scene-steps-skip.spec.ts tests/integration/audio-first-pipeline.spec.ts
git commit -m "feat: посценные картинки и клипы не оплачиваются на кадровом маршруте"
```

---

## Что этот план сознательно НЕ делает

1. **Заливка фонов кадров и готовых кадров в объектное хранилище.** Файлы живут в `getAssetsDirFor(videoId)` и попадают в `VideoAsset.filePath`. Нового билдера в `StorageKeys` план не заводит, колонок `storageKey`/`storageProvider` у `VideoShot` не появляется. Цена: после переезда воркера на другую машину кадры придётся пересчитать (бесплатно — платные фоны лежат в `VideoAsset`). Отдельная работа.
2. **`VideoShot.perceptualHash` не заполняется.** Переход контура уникальности на готовые значения — отдельная работа (§5.2 говорит о ней как о следствии, а не как о части шага 8).
3. **Тариф транскрипции и `edit_plan` в смете ролика.** `estimateVideoCost` (`server/utils/video-cost.ts`) о них не знает; проверено грепом — ни одного упоминания. Требование §7 и §14, но это шаг сметы, а не сборки.
4. **Перегенерация одного кадра из UI.** `VideoShot` спроектирован под неё, API и экранов план не добавляет — это план C, Task 7.
5. **Canary (§11 п. 11) и удаление старой ветки (п. 12).** Требуют токена Replicate и денег владельца.
6. **Потолок расхода на КАРТИНКИ в долларах.** Спека требует потолок только для генеративного видео; выключатель на бренд (`EditProfile.imageGenerationEnabled`) есть, потолка нет. Решение владельца, вынесено в отчёт.

---

## Самопроверка плана

**Покрытие спеки.** §8 «конкатенация кадров» — Task 6; «PiP overlay-фильтром с позицией и размером из профиля» — Task 5; «непрерывный voiceover главным lane, музыка с ducking, дорожки клипов в ноль» — Task 6 Step 5 и `clipVolumeWithVoiceoverFor`; «если lip-sync вернул клип иной длины, правится видео» — Task 5 Step 6; «субтитры: текст из сценария, тайминги из выравнивания» — Task 6 Step 4. §7 «промпты собираются из поля `idea`» — Task 3; «потолок стоимости обязателен, деградация до картинки» — Task 4; «генеративное видео только от 5 секунд» — Task 4. §6.3 «функция композиции принимает уже синхронизированный клип» — Task 5 Step 4, правило 2. §6.4 — Task 6. §10 деградации — Task 4 и Task 5 (`mergeUnrenderableShots`). §11 п. 8 «отключение `voiceoverReconciliation`» — Task 6 Step 6.

**Незакрытое спекой, но обязательное:** посценные шаги на кадровом маршруте (Task 7) — спека о них молчит, потому что писалась до того, как стало видно, что оба маршрута производства медиа сосуществуют.

**Согласованность типов.** `LipSyncedClipPath` производится только `markLipSynced` и доезжает до `buildPipOverlayFilter` через `LipSyncSceneRecord.outputPath` → `ShotSources.presenterPath` → `ShotComposition.presenterPath` — ни одного каста в продакшн-коде. `PlannedShotRow` объявлен в Task 4 и потребляется Task 5 через `ShotSources`. `ShotBackgroundAction.kind` и `VideoShot.background` — одни и те же литералы (`library`, `image`, `video`, `app_screen`, `none`).

**Порядок исполнения задач.** 1 → 2 → 3 → 4 → 5 → 6 → 7. Task 2 и Task 3 независимы друг от друга и могут идти в любом порядке после Task 1. Task 7 обязана идти ПОСЛЕ Task 6: выключить посценные шаги раньше, чем сборка научится собирать кадры, значит выпустить ролик без картинки.
