# Replicate как основной медиаконтур

Дата: 7 августа 2026 года. Закрывает P0-8, P0-9, P0-10, P1-16, P1-17, P1-18 из `docs/audit/spec-conformance-2026-08-07.md`.

Все ссылки на строки проверены по коду ветки `feat/frontend-rebuild` на дату спецификации.

---

## 1. Зачем

`docs/PROJECT_CONTEXT.md:68-84` (§5) требует:

- Replicate — основной провайдер медиа-моделей: lip-sync, генерация видео, генерация изображений, B-roll;
- модели не зашиваются в бизнес-логику, для каждой способности — настраиваемый реестр, чтобы менять модель без правки оркестратора;
- долгие predictions — асинхронно, завершение по подписанному webhook, polling как резерв, обработчик идемпотентный;
- выходные файлы сразу переносятся в постоянное хранилище, временный URL Replicate постоянным источником не считается.

Фактически на Replicate закрыт один пункт из четырёх — lip-sync.

| Что | Где вызывается | Провайдер |
|---|---|---|
| Изображения сцен | `server/utils/video-pipeline-steps.ts:518` `falStepRequest` | fal |
| Изображения-референсы (персонажи, сцены) | `server/api/characters/[id]/generate-reference.post.ts:112`, `server/api/scenes/[id]/generate-reference.post.ts:107` — прямой `falRequest` | fal |
| Клипы text-to-video | `server/utils/video-pipeline-steps.ts:826` | fal |
| Клипы image-to-video | `server/utils/video-pipeline-steps.ts:52` (endpoint константой) + `:795` `falUploadFile` + `:826` | fal |
| Речь (TTS) | `server/utils/tts.ts:235` `falRequest` | fal |
| Транскрибация (платный резерв) | `server/utils/video-content-analyzer.ts:152` `fal-ai/whisper` | fal |
| Музыка | `server/utils/mubert.ts:13` | Mubert, прямой HTTP |
| Lip-sync | `server/utils/media-provider/lip-sync.ts:81` | **Replicate**, fal — резерв |
| B-roll | не существует (grep по `b_roll|bRoll|b-roll|broll` пуст) | — |

Реестр способностей нового контура физически одноместный: `server/utils/media-provider/types.ts:1` — `MediaCapability = "lip_sync"`, `registry.ts:31-37` — одна модель в `MODELS` и один ключ в `DEFAULT_MODELS`, `registry.ts:59-61` — `mapMediaInput` бросает на любой другой capability.

Следствие, которое стоит назвать прямо: **без `FAL_KEY` Модуль 3 не запускается вовсе**. `server/utils/fal.ts:71-85` требует ключ на каждом запросе, а все четыре платных шага генерации идут через него. Рабочий Replicate этого не спасает.

Внутренняя документация проекта уже описывает целевое состояние, а код — нет: `server/utils/integrations/health.ts:83` объявляет назначением Replicate «генерация видео и lip-sync», `:96` — назначением fal.ai «кадры и клипы».

---

## 2. Текущий контур

### 2.1 Карта: реестр, исполнение, цена, атрибуция

| Способность | Реестр моделей | Исполнение | Смета | Факт | Ledger |
|---|---|---|---|---|---|
| text_to_image | `video-models.ts:55-96` (id = fal endpoint) | `falStepRequest` внутри шага, `subKey=scene.key` | `video-cost.ts:112-115`, мегапиксели | `video-cost-actual.ts:28-31` | `video-pipeline.ts:530` — service `"fal.ai"` литералом |
| text_to_video | `video-models.ts:98-208` | то же | `video-cost.ts:120-128` | `video-cost-actual.ts:51-65` | `video-pipeline.ts:563` — `"fal.ai"` литералом |
| image_to_video | **отсутствует в реестре**, `video-pipeline-steps.ts:52` | то же | по цене выбранной t2v-модели | по ней же | `"fal.ai"` |
| text_to_speech | `video-models.ts:215-304` | `falRequest` + `withTimeoutAndRetry` (`tts.ts:235`), без step-tracking | `video-cost.ts:283-291` | `tts.ts:182-192` | `cost-attribution.ts:43-51` |
| lip_sync | **два реестра сразу**: `media-provider/registry.ts:8-29` и `video-models.ts:306-353` | `MediaPrediction` + webhook + recovery + перенос в хранилище | `video-cost.ts:314-340` из `video-models.ts` | `registry.ts:72-77` из `media-provider` | `lip-sync-runner.ts:341-347`, service по фактическому провайдеру |
| music | `video-models.ts:355-377` | свой HTTP-клиент | `video-cost.ts:256-268` | — | `"mubert"` |

### 2.2 Где провайдер зашит

**Идентификаторы.** Все id в `IMAGE_MODELS`/`VIDEO_MODELS`/`TTS_MODELS` — fal-endpoint'ы; комментарий `video-models.ts:25` это фиксирует буквально («Уникальный ключ модели (fal.ai endpoint)»). Поле `provider` (`video-models.ts:32-33`) — свободная строка («Black Forest Labs», «Sync.so / fal.ai»), не enum.

**Ветвление по префиксу id.** `buildClipPayload` (`video-pipeline-steps.ts:71-124`) — три ветки по `startsWith` плюс fallback «незнакомую модель шлём в Kling-формате» с `console.warn` (`:114-123`). `buildProviderInput` и `resolveDefaultVoice` (`tts.ts:114-148`, `:77-97`) — то же по TTS. `extractAudioUrl` (`tts.ts:153-177`) — гетерогенный парсер выхода.

**Определение «чей это endpoint».** Единственное формальное — `fal-preflight-plan.ts:30-32`, `startsWith("fal-ai/")`. Остальное — угадывание подстрокой: `cost-attribution.ts:35` и `:50` (`provider.includes("fal")`), `lip-sync-runner.ts:226` (`includes("replicate")`).

**Дефолты, размноженные литералами:** `video-pipeline.ts:259-260`, `server/api/videos/generate.post.ts:136-138` и `:289-290`, `pipeline-engine.ts:563-565`, `pipeline-validator.ts:1206-1207`, `app/components/pipeline/config/VideoConfig.vue:113-114,246-249,496,553`, `generate-reference.post.ts:51` / `:47`.

**Атрибуция.** `cost-attribution.ts:26-30` — `image_generation` и `clip_generation` безусловно возвращают `"fal.ai"`, не глядя на модель. `:43-51` — voiceover с не-fal провайдером возвращает `null`, то есть расход не пишется вообще.

**Баланс.** `balance/config.ts:21-70` `KNOWN_SERVICES` — `replicate` отсутствует, хотя `CostService` его допускает (`cost-attribution.ts:11`) и строки с этим сервисом пишутся уже сегодня (`lip-sync-runner.ts:345`). Нет ни порога, ни провайдера баланса (`balance/provider-registry.ts`), ни строки в админке (`server/api/admin/balances/[service].put.ts:27`).

### 2.3 Модель исполнения: чем контуры реально отличаются

**fal-путь.** `video-pipeline-db.ts:231-302` `falStepRequest` — сабмит и поллинг внутри одного вызова. Состояние — колонки шага `falRequestId/falEndpoint/falSubKey/falQueueStatus/...` (`schema.prisma:908-923`). Один `step.id` хранит один `falRequestId`, поэтому серия сцен требует `subKey`; контракт описан на `:220-230`, цена ошибки — в комментарии `video-pipeline-steps.ts:824-825` («User потерял $3 на это»). Reattach (`:247-267`) защищает только последнюю сцену и только пока запись шага цела.

**Replicate-путь.** `MediaPrediction` (`schema.prisma:935-973`) + идемпотентный ключ + подписанный webhook + recovery + перенос output в постоянное хранилище до того, как результат считается готовым. Уровни бюджета попыток: `MAX_PREDICTION_ATTEMPTS = 5` на набор исходников и `MAX_ENTITY_ATTEMPT_CEILING = 3 × 5 = 15` на сущность (`attempt-key.ts:17,33`).

**Ключевое, что меняет объём работ.** `runLipSync` **тоже ждёт результат внутри шага**: `lip-sync.ts:178-183` вызывает `waitForPrediction`, а тот поллит собственную запись в БД (`prediction-service.ts:253-283`). Webhook пайплайн не будит — он доводит `MediaPrediction` до `persisted`, и поллинг это видит. То есть формулировка P0-9 «переход `runClipGeneration` на асинхронную модель через `MediaPrediction`+webhook» **уже сегодня означает «устойчивое состояние + синхронное ожидание»**, а не «шаг отпускает процесс». Переписывать оркестратор, `acquireLock`/`lockRegistry` (`video-pipeline-db.ts:64,78-95`) и контракт `clipPaths` между шагами для соответствия §5 не требуется.

### 2.4 Что переиспользуется как есть

`replicate/client.ts:65-108` (create/get/cancel, `webhook_events_filter=["completed"]`), `:110-148` (загрузка входов с встроенным mock-режимом), `:187-201` `extractOutputUrl` — уже разбирает `string | array | {url} | {video:{url}}`, то есть покрывает и картинки, и видео. `prediction-service.ts` целиком capability-агностичен: единственное упоминание способности — `request.model.capability` строкой на `:206`. `prediction-repository.ts` (атомарный lease на перенос, `countSpentAttemptsInScope` по префиксу ключа, `findActiveByVideoId`, `findRecoverable`), `attempt-key.ts`, `webhook.ts` + `server/api/webhooks/replicate.post.ts` + `finalize-queue.ts` (`FINALIZE_CONCURRENCY_LIMIT = 3`), `cancel.ts` (гасит все живые predictions ролика без разбора capability, подключён в `video-pipeline.ts:915`), `server/plugins/replicate-recovery.ts`, `mock.ts`.

Схема миграции не требует: `MediaPrediction.provider/capability/model` — `String` (`schema.prisma:941-943`).

### 2.5 Поправки к исходной инвентаризации и концепциям

Проверено по коду; эти пункты в присланных материалах неверны или неточны, и планировать по ним нельзя.

1. **`pipeline-engine.ts` уже переведён на провайдер-зависимый preflight** (`pipeline-engine.ts:34` импорт, `:569-575` `planFalPreflightTargets` + `evaluateFalPreflight`). Обе концепции утверждают обратное. Незакрытых точек четыре: `video-pipeline.ts:337` (`falProbeAccessBatch` по сырому списку), `pipeline-executors.ts:1146`, `pipeline-validator.ts:1210`, `server/api/videos/models.get.ts:20`. У валидатора вердикт вдобавок жёстче общего гейта: любой `status !== 'available'` попадает в ошибки (`pipeline-validator.ts:1211-1219`), то есть `probe_error` валит валидацию пайплайна.
2. **Фактическая цена lip-sync берётся не из `video-models.ts`.** Она считается `estimateMediaCost` (`registry.ts:72-77`) и приходит через `lip-sync.ts:152`. Из `video-models.ts` берутся выбор модели (`lip-sync-runner.ts:224-228`), `modelId` для ledger (`:345`) и смета (`video-cost.ts:314-340`). Значение `0.014` продублировано в `registry.ts:12` и `video-models.ts:314`; равенство держится вручную и ничем не проверяется — это дефект, а не «второй реестр вместо первого».
3. **`MAX_ENTITY_ATTEMPT_CEILING` — производная**, `3 * MAX_PREDICTION_ATTEMPTS` (`attempt-key.ts:33`), а не независимая константа 15.
4. **`VideoGenerationStep.artifacts Json?` существует** (`schema.prisma:901`) и в серверном коде не используется. Это свободное место под пер-сценные ссылки на predictions — миграция схемы для прогресса и диагностики не нужна.
5. **`MediaPrediction` не имеет ссылки на шаг** — только `videoId`/`videoAssetId` (`schema.prisma:937-940`). Связь «шаг → его predictions» строится по `videoId` + префиксу `idempotencyKey` либо через `artifacts`.
6. **`createMockReplicateProvider` всегда отдаёт `mock://replicate/output.mp4`** (`replicate/mock.ts:22`). Для интеграционных тестов картинок и аудио это даст «скачивание mp4» под видом png/mp3 — мок обязан зависеть от capability до, а не после перевода способностей.
7. **`extractOutputUrl` берёт первый строковый элемент массива** (`client.ts:190`). При `num_images > 1` остальные молча теряются. Наш инвариант — одна картинка на сцену; его нужно зафиксировать явно, а не полагаться на совпадение.
8. **Конкретные цены Replicate за изображение и за секунду видео в проекте нигде не зафиксированы.** В коде есть ровно одно число — `0.014` за секунду `kwaivgi/kling-lip-sync`. Числа, приведённые в концепции А со ссылкой на страницу тарифов, здесь не воспроизводятся: до подтверждения по счёту аккаунта или странице конкретной модели они в реестр не попадают. См. §7.

---

## 3. Решение

### 3.1 Что выбрано

**Единый типизированный реестр способностей** (конструкция концепции А) **плюс единственная точка вызова из шага с ключом единицы** (контракт концепции Б). Провайдер и модель исполнения выбирает спека модели, а не глобальный флаг и не подстрока в id.

Что отвергнуто и почему:

- **Из А — немедленный перевод шагов на «сабмит и отпустить процесс»** (её этап B). Для §5 не требуется: устойчивость даёт `MediaPrediction`, а не событийный оркестратор (см. 2.3). Цена этапа — новая модель владения роликом вместо внутрипроцессного `lockRegistry`, потеря `throwIfAborted` checkpoint'ов и смена контракта `clipPaths` между `runClipGeneration` → `lip-sync-runner` → `runVoiceoverGeneration` → `runAssembly`. Это отдельная работа, нужная под P0-19 и P1-15, и она не должна быть предусловием соответствия §5.
- **Из Б — два равноправных раннера за интерфейсом `MediaTaskRunner` с fal по умолчанию на всех способностях** и «дата депрекации + warn» как механизм миграции. Дата с предупреждением — не механизм, а надежда: пока fal-раннер существует как равная абстракция, каждая новая способность добавляется «сначала на fal, потому что быстрее». Провайдер по умолчанию задаётся спекой способности и меняется одной записью реестра; fal остаётся в реестре как модель-резерв, а не как параллельный контур.

Что взято из Б без изменений: контракт вызова с `unitKey` (прямая замена `falSubKey`), порядок миграции по способностям от дешёвого к дорогому, требование синхронизировать смету с фактическим маршрутом в том же шаге, а не «потом».

### 3.2 Реестр

```ts
export type MediaCapability =
  | "lip_sync"
  | "text_to_image"
  | "text_to_video"
  | "image_to_video"
  | "text_to_speech"
// b_roll добавляется в P0-16, отдельным решением (см. §7)

export type MediaProviderName = "replicate" | "fal"
export type MediaExecution = "async_prediction" | "sync_queue"
```

`MediaModelSpec` становится дискриминированным union по `capability` — иначе `constraints: LipSyncConstraints` (`types.ts:33`, обязательное поле) придётся размывать в `any`. Общая часть:

```ts
interface MediaModelSpecBase<C, TInput, TConstraints> {
  registryKey: string            // стабильный внутренний ключ, не зависящий от провайдера
  id: string                     // id У ПРОВАЙДЕРА: "fal-ai/flux/dev" | "<owner>/<model>"
  provider: MediaProviderName    // ЯВНОЕ поле, не подстрока и не префикс
  capability: C
  execution: MediaExecution
  billing: MediaBilling
  constraints: TConstraints
  timeoutMs: number              // у способности своя длительность, см. 3.4
  mapInput(input: TInput, ctx: MapContext): {
    payload: Record<string, unknown>
    effectiveDurationSec?: number   // квантование Kling 5|10, Wan num_frames/fps
  }
  extractOutput(raw: unknown): { urls: string[]; contentType?: string }
  voices?: { default: string; byLanguage?: Record<string, string> }  // только tts
  dataProcessor: { name: string; note: string } | null
  integrated: boolean
  tier: "budget" | "standard" | "premium"
  // UI-поля витрины
  name: string
  strengths: string[]
  tradeoffs: string[]
  avgGenerationTime?: string
}
```

Ключевое отличие от нынешнего устройства: **маппер входа и разбор выхода лежат в спеке**, а не в четырёх местах кода (`buildClipPayload`, i2v-payload на `video-pipeline-steps.ts:800-806`, `buildProviderInput`, `extractAudioUrl`). Добавление модели = одна запись в реестре. `mapInput` возвращает фактическую длительность, потому что от неё зависят и деньги, и таймлайн сборки — сегодня `clampKlingI2vDuration` (`video-pipeline-steps.ts:55-57`) молча меняет длительность, а цена считается по исходной.

Нормализованные входы, провайдеронезависимые:

```ts
TextToImageInput  { prompt, negativePrompt?, width, height, count, seed? }
TextToVideoInput  { prompt, negativePrompt?, durationSec, aspectRatio, withAudio, resolution? }
ImageToVideoInput extends TextToVideoInput { imageUrl }
TtsInput          { text, voiceId, speed, language, format }
LipSyncInput      { videoUrl, audioUrl }   // как сейчас
```

`video-models.ts` перестаёт быть источником истины и становится витриной: `ModelMeta` собирается из спеки. Инвариант жёсткий — `id`, `provider`, `capability` и цена берутся только из спеки; дубль `0.014` в двух файлах исчезает. `recommendModels`, `pickTtsModel`, `detectStrategy` остаются, но выбирают из спек.

**Биллинг** — union вместо скаляра `priceUsdPerOutputSecond` (`types.ts:33`) и вместо `ModelPricing` (`video-models.ts:14-22`):

```ts
type MediaBilling =
  | { unit: "output_image";     usdPerImage: number }
  | { unit: "output_megapixel"; usdPerMegapixel: number }                 // fal
  | { unit: "output_second";    usdPerSecond: number
                                usdPerSecondWithAudio?: number
                                byResolution?: Record<string, number> }
  | { unit: "audio_second";     usdPerSecond: number }
  | { unit: "character";        usdPerCharacter: number }
  | { unit: "hardware_second";  usdPerSecond: number; estimatedSeconds: number }
  | { unit: "flat";             usd: number }
```

`hardware_second` нужен потому, что у части моделей Replicate цена известна только после завершения prediction. Для таких моделей смета — оценка по `estimatedSeconds`, факт — по `metrics.predict_time` из вебхука (колонка `MediaPrediction.metrics` уже есть, `schema.prisma:959`). Смета и факт по такой модели расходятся по определению; в UI это должно быть видно как «≈», а не как точная сумма.

Одна функция `estimateMediaCost(spec, usage)` на все способности, `usage = { images?, outputSeconds?, characters?, audioSeconds?, withAudio?, resolution? }`. `video-cost.ts` и `video-cost-actual.ts` перестают знать про мегапиксели: `calcMegapixels` (`video-cost.ts:99-107`) и `imageMegapixels` (`video-cost-actual.ts:12-17`) остаются внутри fal-ветки биллинга и больше нигде.

### 3.3 Выбор маршрута

```
MEDIA_MODEL_TEXT_TO_IMAGE=replicate:<модель>
MEDIA_MODEL_TEXT_TO_VIDEO=replicate:<модель>
MEDIA_MODEL_IMAGE_TO_VIDEO=replicate:<модель>
MEDIA_MODEL_TEXT_TO_SPEECH=<провайдер:модель>
MEDIA_MODEL_LIP_SYNC=replicate:kwaivgi/kling-lip-sync   # алиас REPLICATE_DEFAULT_LIPSYNC_MODEL
MEDIA_PROVIDER_FALLBACK=                                # как сейчас, пусто по умолчанию
MEDIA_PROVIDER_FALLBACK_TEXT_TO_SPEECH=fal              # по-способностный override
```

`resolveMediaRoute(capability, requestedId?)` → `{ primary: MediaModelSpec; fallback: MediaModelSpec | null }`. Порядок: явный запрос (по `registryKey` или `provider:id`) → env-дефолт способности → первый `integrated` в реестре. Фолбэк — конкретная спека той же способности со своим маппером и своей ценой; нет спеки — `fallback: null`, и раннер честно падает вместо слепого сабмита. `FAL_LIP_SYNC_MODEL` и `FAL_PRICE_USD_PER_SECOND` (`lip-sync.ts:26-27`) уезжают в реестр.

### 3.4 Контракт вызова и модель исполнения

```ts
interface MediaTaskRequest {
  capability: MediaCapability
  spec: MediaModelSpec          // уже разрешённый маршрут
  input: MediaTaskInput         // типизирован по capability
  videoId: number
  videoAssetId?: number | null
  stepId: number
  unitKey: string               // scene.key — прямая замена falSubKey
  sceneOrder: number
  outputPath: string
}

interface MediaTaskResult {
  localPath: string
  provider: MediaProviderName
  modelId: string
  externalRef: string | null    // falRequestId ИЛИ MediaPrediction.id
  idempotencyKey: string | null
  costUsd: number               // по спеке того, кто РЕАЛЬНО исполнял
  source: "reused_asset" | "reused_prediction" | "generated"
  effectiveDurationSec?: number
}

runMediaTask(request): Promise<MediaTaskResult>
```

Внутри — две ветки по `spec.execution`, и обе уже существуют в коде:

- `sync_queue` (fal): `falStepRequest(stepId, spec.id, payload, unitKey)` → `spec.extractOutput` → `downloadFile`. Поведение байт-в-байт текущее, включая reattach.
- `async_prediction` (Replicate): обобщённый `runLipSync` — при необходимости загрузка входов (`createReplicateInputUploader`), `submitOrResumePrediction`, `waitForPrediction` при незаполненном `persistedStorageKey`, `getStorageDriver().downloadToFile(persistedStorageKey, outputPath)`, удаление входов в `finally`. Ретраи `withReplicateRetries` (2 попытки) и фолбэк по `MediaProviderRetriesExhaustedError` — как сейчас.

**Три уровня переиспользования** (сегодня есть только первый):

1. `VideoAsset(videoId, type, order)` + файл на диске (`video-pipeline-steps.ts:492-507`, `:759-773`) → `source="reused_asset"`, `generatedCount` не растёт;
2. файла нет, но есть `MediaPrediction` с этим `idempotencyKey` и заполненным `persistedStorageKey` → тянем из своего хранилища, `source="reused_prediction"`, провайдеру повторно не платили. **Этого уровня в fal-контуре нет вообще** — при потере локального диска (перезапуск контейнера, другая нода, переезд между воркерами) fal-путь платит заново;
3. иначе submit → `source="generated"`, `generatedCount++`.

Смысл `generatedCount` уточняется с «сколько скачали» на «сколько новых оплаченных задач создали» — ровно то, что нужно `computeImageActualCost`/`computeClipActualCost`. Контракты возврата шагов (`imagePaths`/`imageRemoteUrls`/`generatedCount`; `clipPaths`/`generatedCount`/`scenes`) и формат `outputSnapshot` не меняются — только дополняются, иначе сломается resume уже запущенных роликов (`video-pipeline-steps.ts:443-452`, `:610-627`).

**Таймауты.** `waitForPrediction` по умолчанию 15 минут (`prediction-service.ts:249`), fal-поллинг — 20 (`fal.ts:27`), Kling заявлен как 5–15 минут (`video-models.ts:121`), i2v дольше. Таймаут становится полем спеки (`timeoutMs`), а не глобальной константой: для `text_to_video` — не меньше 30 минут. Прокол таймаута на дорогой способности означает оплаченный prediction, который шаг не забрал; его подберёт recovery, но шаг уже упал.

**Прогресс и диагностика.** В Replicate-ветке колонки `fal*` не пишутся. Вместо них шаг наполняет `VideoGenerationStep.artifacts` (`schema.prisma:901`, свободна) списком `{ unitKey, sceneOrder, provider, modelId, predictionId, idempotencyKey, source, costUsd }`. `server/api/videos/[id]/progress.get.ts:56-62` читает `artifacts` наравне с `fal*`. Это даёт больше, чем `falQueueStatus`: состояние по всем сценам, а не по последней.

**Отмена.** `cancelVideoPipeline` уже двухчастная: `video-pipeline.ts:915` гасит все живые predictions ролика по `videoId`, `:935` — fal-задачу шага по `falRequestId`. После перевода первая часть начинает гасить и клипы с картинками. Смешанный режим (часть способностей на Replicate, часть на fal) отменяется корректно обеими ветками; никаких новых механизмов не нужно. Отмены **одного шага** нет ни в одном контуре — это существующий пробел, в объём не входит.

**Отсутствие ключей.** `readReplicateConfig` (`replicate/config.ts:23-33`) бросает при отсутствии `REPLICATE_API_TOKEN`, `REPLICATE_WEBHOOK_BASE_URL` или `REPLICATE_WEBHOOK_SIGNING_SECRET`. Сейчас это касается только lip-sync; после перевода изображений и клипов эти переменные станут обязательными для запуска любого ролика — и это правильно, но вызов должен быть **ленивым и по способности**: конфиг читается только когда маршрут хотя бы одной исполняемой в этом прогоне способности ведёт на Replicate. Симметрично для fal: `FAL_KEY` требуется только если fal — основной провайдер какой-то способности прогона либо включён как её фолбэк. Это и есть содержание P0-10.

### 3.5 Идентичность

`buildLipSyncIdentity` (`media-provider/lip-sync-identity.ts:45-79`) обобщается в `buildMediaIdentity`:

```
attemptCeilingScope = "{capability}:v1:video:{videoId}:scene:{sceneOrder}:model:{modelId}"
attemptScope = idempotencyKey = attemptCeilingScope + ":input:" + sha256(нормализованный вход)
```

Для lip-sync нормализованный вход — по-прежнему отпечатки видео и аудио; **раскладку ключа lip-sync не меняем**, иначе `countSpentAttemptsInScope` (`prediction-repository.ts`) перестанет видеть уже созданные записи, и миграция данных станет обязательной. Для `text_to_image`/`text_to_video` входных файлов нет — отпечаток строится по нормализованному payload (промпт, negative, размер/длительность, флаги, seed). Для `image_to_video` в отпечаток добавляется sha256 файла-скриншота.

Смысл двух уровней сохраняется дословно (см. комментарий `lip-sync-identity.ts:8-22`): правка промпта открывает свежий узкий бюджет, зацикливание на одном промпте — нет; широкий потолок не даёт получать бесконечно много свежих бюджетов сменой входа.

**Калибровка потолков — отдельное решение, не техническое.** `MAX_PREDICTION_ATTEMPTS = 5` и `MAX_ENTITY_ATTEMPT_CEILING = 15` подбирались под lip-sync, где перегенерация редка. У картинок оператор крутит промпт десятками итераций, и если каждая правка тратит широкий бюджет, сцена запрётся на 15-й. До выката нужно развести системный ретрай и осознанную перегенерацию оператором: осознанная перегенерация должна открывать новый `attemptCeilingScope` (например, добавлением в него номера ревизии сцены), либо потолок для image-способностей задаётся отдельным числом. Решение — за заказчиком (§7).

### 3.6 Стоимость и атрибуция

- `estimatedCostUsd` считается при сабмите по прайсу спеки → в `VideoGenerationStep.estimatedCost` и в смету UI.
- `actualCostUsd` считается по факту: `output_image` — по числу выданных изображений, `output_second` — по фактической длительности, `hardware_second` — `metrics.predict_time × usdPerSecond`. В ledger пишется факт.
- `chargeStep` (`video-pipeline.ts:97-116`) перестаёт принимать литерал: `video-pipeline.ts:530` и `:563` берут сервис **из результата шага**. При срабатывании фолбэка деньги уходят на счётчик fal, а не Replicate.
- `mapStepKeyToService` (`cost-attribution.ts:20-58`) перестаёт угадывать по `includes("fal")` и берёт `spec.provider`. Ветка voiceover больше не возвращает `null` для не-fal провайдера (`:50`) — это была тихая потеря денег из отчётности.
- Один шаг может дать строки по двум сервисам (часть сцен Replicate, часть — фолбэк на fal). Ledger это выдерживает: дедуп по `(videoId, stepKey, service, attempt)` (`cost-ledger.ts:67-81`), образец агрегации — `lip-sync-runner.ts:271,341-347`. `VideoGenerationStep.actualCost` остаётся одним числом; разбивка по провайдерам живёт в `artifacts` и в ledger.
- `replicate` регистрируется в `KNOWN_SERVICES` (`balance/config.ts:21-70`) и в `balance/provider-registry.ts` (P1-16). Тип провайдера баланса — открытый вопрос (§7): у Replicate есть `/v1/account`, но эндпоинта остатка средств проект не использует, поэтому по умолчанию — estimate по `AiAuditLog`, как у anthropic.
- **Смета обязана спрашивать тот же `resolveMediaRoute`, что и исполнение.** `estimateVideoCost` и `COST_PRESETS` (`video-cost.ts:404-448`, id моделей литералами) синхронизируются в том же шаге, что и раннер, а не «потом». Иначе UI показывает одну цифру, ledger — другую, с первого дня.
- i2v получает собственную спеку и собственную цену. Сегодня i2v-сцены считаются по цене выбранной t2v-модели (`video-pipeline.ts:558-568` использует `vidModel` для всех клипов), потому что endpoint `video-pipeline-steps.ts:52` в реестре отсутствует. Расхождение сметы и факта существует до всякой миграции и чинится здесь же.

### 3.7 Фолбэк на fal

Правила `docs/operations/replicate.md:81-88` сохраняются целиком: по умолчанию `MEDIA_PROVIDER_FALLBACK` пуст (видна настоящая ошибка Replicate); срабатывание только после `MediaProviderRetriesExhaustedError`; ошибки конфигурации, валидации, БД и хранилища переключением провайдера не маскируются. Добавляется по-способностный override.

Одно усиление: **fal-путь тоже заводит запись `MediaPrediction`** (`provider: "fal"`, `externalId` = fal requestId, `persistenceStatus` — по факту скачивания). Тогда «сколько раз мы уехали на резерв и сколько это стоило» становится запросом к БД, а второй уровень переиспользования работает и для fal. Сегодня fal-фолбэк lip-sync не оставляет ничего, кроме строки в логе.

---

## 4. План работ

Каждый шаг проверяем отдельно. Оценки — рабочие дни одного исполнителя, без учёта ожидания ответов заказчика по §7.

| # | Шаг | Проверяется | Оценка | Зависит от |
|---|---|---|---|---|
| 0 | Реестр: `MediaCapability`, union `MediaModelSpec`, `MediaBilling`, `estimateMediaCost`, `resolveMediaRoute`. Спеки fal переносятся в реестр данными; `mapInput`/`extractOutput` собираются из `buildClipPayload`, i2v-payload, `buildProviderInput`, `extractAudioUrl`, `result.images[0].url`, `result.video.url`. `video-models.ts` → витрина поверх спек | DB-free тесты: для каждой спеки payload сверяется с эталоном схемы модели; `estimateMediaCost` по всем единицам; `resolveMediaRoute` по всем ветвям | 3–4 | — |
| 1 | `runMediaTask` с двумя ветками исполнения. Ветка `sync_queue` = текущий `falStepRequest`. Перевод `runImageGeneration`, `runClipGeneration`, `synthesizeSpeech`, обоих `generate-reference` эндпоинтов на единый вызов. **Провайдеры по умолчанию не меняются** | Регрессия: прогон в `FAL_MOCK_MODE` даёт те же `outputSnapshot`, те же `generatedCount`, те же строки ledger, что до шага | 3–4 | 0 |
| 2 | `buildMediaIdentity` + ветка `async_prediction` из `runLipSync`. Уровень переиспользования «prediction persisted, файла нет» | DB-тест: файл удалён, повторный запуск не создаёт нового prediction и не платит | 2 | 1 |
| 3 | Деньги: цена из спеки, `chargeStep` берёт провайдера из результата, `cost-attribution` по `spec.provider`, voiceover перестаёт возвращать `null`, `replicate` в `KNOWN_SERVICES` и `provider-registry`, синхронизация `estimateVideoCost`/`COST_PRESETS` с маршрутом (P1-16) | DB-free: таблица (stepKey × провайдер) → сервис. DB: смешанный шаг даёт две строки ledger | 2 | 1 (параллельно с 2) |
| 4 | Preflight по провайдеру (P0-10): `video-pipeline.ts:337`, `pipeline-executors.ts:1146`, `pipeline-validator.ts:1210`, `models.get.ts:20` переводятся на `planFalPreflightTargets` + `evaluateFalPreflight`; валидатор перестаёт валить на `probe_error`; ленивое чтение `readReplicateConfig`/`FAL_KEY` по способностям прогона | Тест: маршрут целиком на Replicate + пустой `FAL_KEY` → прогон стартует. Обратный: маршрут на fal + пустой `FAL_KEY` → внятная ошибка | 1–1.5 | 1 (параллельно с 2, 3) |
| 5 | Мок Replicate по capability (`replicate/mock.ts:22`) + фиксация инварианта одного выхода (`client.ts:190`) | Интеграционные тесты картинок получают png, аудио — mp3 | 0.5 | 0 |
| 6 | `text_to_image` на Replicate: спека, маппер, цена за изображение, canary. Сюда же оба `generate-reference` эндпоинта | Canary по чек-листу `docs/operations/replicate.md:90-101` | 1.5–2 | 2, 3, 4, 5 |
| 7 | `image_to_video` на Replicate: собственная спека вместо константы `video-pipeline-steps.ts:52`, квантование длительности в `mapInput`, отдельная цена | Смета i2v-сцены совпадает с фактом (сегодня не совпадает) | 1.5–2 | 6 |
| 8 | `text_to_video` на Replicate: спека, таймаут ≥30 мин, canary | Canary на одном ролике из 1 сцены | 2–3 | 6 |
| 9 | `text_to_speech` (P1-18): спека, голоса в `spec.voices`, миграция сохранённых `voiceoverVoiceId` | Слепое сравнение русского голоса с текущим Kokoro | 1.5–2 + риск качества | 3 |
| 10 | Чистка: удаление `buildClipPayload`, `clampKlingI2vDuration`, `KLING_IMAGE_TO_VIDEO_ENDPOINT`, `resolveDefaultVoice`, `FAL_LIP_SYNC_MODEL`/`FAL_PRICE_USD_PER_SECOND`, литералов дефолтов в 6 местах включая `VideoConfig.vue` (P1-17) | grep по перечисленным именам пуст; фронт и бэк берут дефолт из одного места | 1.5 | 6, 7, 8, 9 |
| 11 | Обновление `docs/operations/replicate.md` под все способности (сегодня написан только про lip-sync: `:3`, `:46-55`) | — | 0.5 | 10 |

**Порядок.** Строго последовательно: 0 → 1 → {2, 3, 4, 5} → 6 → {7, 8} → 10 → 11. Шаг 9 (TTS) не зависит от 6–8 и может идти параллельно после 3. Шаги 2, 3, 4, 5 независимы между собой.

**Итого 20–24 дня.** Единый вызов и провайдер-независимый preflight — к 8–10-му дню; `FAL_KEY` перестаёт быть обязательным после шага 6 (изображения) только частично, полностью — после 8 и 9. Промежуточные поставки: после шага 1 (ничего не сломалось, контур переключаемый), после 4 (запуск не зависит от fal там, где fal не нужен), после 6 (первая способность на Replicate в проде).

**Что в объём НЕ входит:** B-roll (P0-16 — нужен продуктовый ответ, §7), музыка (Mubert остаётся как есть), `fal-ai/whisper` в `video-content-analyzer.ts:152` (это анализ исходников, а не производство медиа; отдельная задача), событийная модель оркестратора (P0-19/P1-15), Remotion (P1-19).

---

## 5. План тестов

### 5.1 Без БД (`vitest.pure.config.ts`)

- **Реестр**: `resolveMediaRoute` по всем ветвям (явный id, env-дефолт, первый integrated, неизвестная способность, отсутствующий фолбэк); неизменность раскладки ключа lip-sync.
- **Мапперы**: для каждой спеки — `mapInput` против эталонного payload схемы модели; квантование длительности (Kling 5|10, Wan `num_frames`/`fps`) и возврат `effectiveDurationSec`; отсутствие «отправим в чужом формате» — незнакомая модель обязана падать, а не уходить в submit с Kling-payload (`video-pipeline-steps.ts:114-123`).
- **`extractOutput`**: `string | array | {url} | {video:{url}} | {audio:{url}} | {images:[...]}`; массив с несколькими элементами → явная ошибка либо документированный выбор первого, но не молчание.
- **Биллинг**: `estimateMediaCost` по всем семи единицам; сумма сметы шага = сумме фактов при полном совпадении входов.
- **Идентичность**: разные промпты → разные ключи; одинаковые → один; смена модели → другой `attemptCeilingScope`; lip-sync ключ побайтово совпадает с текущим.
- **Атрибуция**: таблица (stepKey × провайдер) → сервис, включая voiceover на не-fal (не `null`).
- **Preflight**: `planFalPreflightTargets` не пропускает Replicate-модели; `evaluateFalPreflight` не блокирует на `probe_error`; маршрут целиком на Replicate → пустой список целей.

Всё это покрывает шаги 0–5 плана и не стоит ни цента.

### 5.2 С БД (интеграционные, `REPLICATE_MOCK_MODE=true`, `STORAGE_DRIVER=mock`, `FAL_MOCK_MODE=true`)

Клоны `tests/integration/replicate-lipsync-flow.spec.ts` под `text_to_image` и `text_to_video`, плюс:

- **Идемпотентность**: повтор с тем же входом не создаёт второй prediction.
- **Уровень 2 переиспользования**: `VideoAsset` есть, файла на диске нет, prediction `persisted` → второй submit не происходит, `generatedCount` не растёт.
- **Смешанный шаг**: часть сцен Replicate, часть — фолбэк на fal → две строки ledger, `actualCost` шага = сумме.
- **Отмена**: `cancelVideoPipeline` гасит и predictions, и fal-задачу; отменённая попытка не тратит узкий бюджет (`consumesAttemptBudget`).
- **Бюджеты**: 5 неудач на одном входе → внятная ошибка; смена промпта открывает свежий бюджет; 15 на сцену — потолок.
- **Recovery**: webhook «потерялся» → `recoverStalePredictions` доводит запись до `persisted`, шаг забирает результат.
- **Resume**: ролик со старым `outputSnapshot` (без `artifacts`) доигрывается без перегенерации.
- **Незакрытый fal-job**: у шага есть `falRequestId` и нетерминальный `falQueueStatus`, маршрут уже Replicate → прогон доигрывает через reattach и не платит дважды.

Оба мок-контура включаются одновременно — смешанный маршрут иначе уйдёт в сеть за деньги.

### 5.3 Только на реальных деньгах (canary)

Мок не проверяет главного: принимает ли модель наш payload, что она реально возвращает и как выглядит результат. Минимальный набор — по одному прогону на способность, `MEDIA_PROVIDER_FALLBACK` пуст, чтобы видеть настоящую ошибку Replicate:

1. **text_to_image**: одна картинка 1080×1920. Дешевле всего, ошибки маппера и биллинга ловятся здесь.
2. **image_to_video**: один клип 5 с из скриншота приложения.
3. **text_to_video**: один клип 5 с. Самый дорогой пункт.
4. **text_to_speech**: одна реплика 10–15 с на русском.
5. Повтор каждого запроса — убедиться, что новый платный prediction не появился.
6. Полный ролик из 1 сцены end-to-end, когда все четыре пройдены поштучно.

Проверяется по `docs/operations/replicate.md:96-99`: один `externalId`, `status=succeeded`, `persistenceStatus=persisted`, заполненный `persistedStorageKey`, отсутствие секретов в snapshot; результат — глазами и на слух; сумма в ledger сходится со счётом Replicate.

**Стоимость canary назвать нельзя, пока не выбраны модели и не подтверждены их тарифы** (§7). Порядок величины — единицы долларов при 2–3 итерациях на способность; точная цифра появляется вместе с ответом на первый открытый вопрос.

---

## 6. Риски и что делать с уже запущенными роликами

### 6.1 Риски

| Риск | Как гасим |
|---|---|
| Каталоги Replicate и fal — разные модели, а не «те же по другому URL». Стилистика уже отснятой части партии и новой разойдётся | Маршрут фиксируется на ролике (см. 6.2). Переключение способности — только на границе партии, не в середине |
| Цены Replicate в проекте не зафиксированы; вбить их «по вторичным источникам» = врать в смете и ledger | В реестр попадают только числа, подтверждённые страницей модели или счётом аккаунта. До подтверждения способность не переводится (блокирующая зависимость шагов 6–9) |
| Модели с тарификацией за секунду железа дают цену, неизвестную до завершения | Отдельная единица `hardware_second`: смета — диапазон и «≈» в UI, факт — из `metrics.predict_time` |
| Потолки попыток калибровались под lip-sync; у картинок оператор итерирует промпт десятками раз и упрётся в 15 | Развести системный ретрай и осознанную перегенерацию ДО выката (см. 3.5). Продуктовое решение — за заказчиком |
| `finalize-queue` рассчитан на короткие lip-sync фрагменты (`FINALIZE_CONCURRENCY_LIMIT = 3`); клипы по 10–50 МБ × 5 сцен на ролик — другая нагрузка | Перемерить лимит и память процесса на шаге 8, до пакетного запуска. Значение выносится в конфиг |
| Двойной переезд файла: `persistPredictionOutput` кладёт в `StorageKeys.mediaPredictionOutput`, шаг перезаливает под `videoSceneClip`/`videoSceneImage` — удвоенный трафик и второй набор объектов | Осознанно принимаем на шагах 6–8 (это цена устойчивости и уровня 2 переиспользования). Оптимизация «класть сразу под ключ сцены» — отдельная задача после замера объёма |
| Загрузка входов для i2v через Replicate Files API — лишнее плечо на каждую сцену со скриншотом | Альтернатива — подписанный URL из нашего хранилища; требует внешнего доступа к объектам (§7) |
| Атрибуция по фактическому провайдеру ломает исторические ряды: до миграции image/clip помечены `fal.ai` безусловно | Не чиним задним числом. В отчёте «расход по сервисам» отмечается дата перехода; `SPEND_GROUPS` (`balance/spend-breakdown.ts:50-55`) группирует по `stepKey`, а не по сервису, и переход переживает без изменений |
| `falStepRequest` и Replicate-путь сосуществуют весь период миграции — удвоенная поверхность тестов | Шаг 10 плана («чистка») — не опциональный. Критерий закрытия: `grep` по именам fal-специфичных функций пуст, fal остаётся только как спеки-резервы в реестре |
| Два непересекающихся мок-контура (`FAL_MOCK_MODE`, `REPLICATE_MOCK_MODE` + `STORAGE_DRIVER=mock`) | CI включает оба; шаг 5 плана чинит мок Replicate по capability |
| `readReplicateConfig` делает три переменные обязательными для любого ролика | Ленивое чтение по способностям прогона (шаг 4). Стенд без публичного HTTPS-origin работает на чистом поллинге — но теряет часть устойчивости (§7) |

### 6.2 Уже запущенные ролики

Принцип: ничего не переносить принудительно, оплаченное у fal — забрать у fal.

1. **Маршрут фиксируется на прогоне, а не берётся из env при каждом resume.** При старте `video-pipeline` записывает выбранный маршрут (`{ text_to_image: "...", text_to_video: "...", ... }`) в `inputSnapshot` шага; resume читает зафиксированное. Иначе выкат конфига посреди партии переведёт наполовину сгенерированный ролик на другую модель, и половина сцен окажется в чужой стилистике. Колонка `inputSnapshot Json?` уже есть — миграция не нужна.
2. **Снапшоты старого формата читаются как раньше.** `isStepCompleted` + `outputSnapshot` с `imagePaths`/`clipPaths`/`perSceneDurations` — формат не меняем, только дополняем `artifacts`. Ролики с завершённым шагом миграции не замечают.
3. **Незакрытый fal-job доигрывается через fal.** Если у шага есть `falRequestId` и `falQueueStatus` не терминальный — прогон идёт через `falStepRequest` (reattach), даже если маршрут уже `replicate`. Правило: есть незакрытая оплаченная задача — забери результат.
4. **Существующие `imageModelId`/`videoModelId`/`voiceoverModelId` в БД остаются валидными**: fal-спеки не удаляются из реестра, они переходят в статус резерва. Явно выбранная оператором fal-модель исполняется на fal.
5. **Колонки `fal*` из схемы не удаляются**, пока в БД есть незакрытые шаги с непустым `falRequestId`.
6. **Порядок выката по способностям — от дешёвого к дорогому**: `text_to_image` → `text_to_speech` → `image_to_video` → `text_to_video`. На картинках ловятся ошибки мапперов и биллинга по минимальной цене; клипы — последними, на обкатанном контуре.

---

## 7. Открытые вопросы к заказчику

Первые три блокируют шаги 6–9 плана.

1. **Какие модели Replicate под `text_to_image`, `text_to_video`, `image_to_video`, `text_to_speech` и по какой цене.** В коде зафиксирована ровно одна цена — `$0.014`/с у `kwaivgi/kling-lip-sync` (`registry.ts:12`). Нужен список моделей с тарифами со страниц самих моделей или из биллинга аккаунта. Уточнить.
2. **Бюджет на canary и кто его согласует.** Проверка каждой способности на реальных деньгах обязательна (`docs/operations/replicate.md:90-101`), суммы без ответа на п.1 назвать нельзя. Уточнить.
3. **Приоритет цена/качество.** Есть ли потолок на кадр и на секунду выходного видео, из-за которого выбор конкретной модели важнее самого факта перехода.
4. **Считается ли §5 выполненным, если fal остаётся включаемым резервом** (как сегодня у lip-sync через `MEDIA_PROVIDER_FALLBACK`), или fal должен быть удалён из кода полностью. От ответа зависит объём шага 10.
5. **Считается ли осознанная перегенерация сцены оператором тратой бюджета попыток.** Продуктовое решение; от него зависит калибровка `MAX_ENTITY_ATTEMPT_CEILING` для image-способностей (см. 3.5).
6. **Разрешена ли миграция схемы.** Предложенное решение обходится существующими колонками (`artifacts`, `inputSnapshot`, `metrics`), но разбивка `actualCost` по провайдерам и агрегаты расходов по провайдеру за период были бы дешевле колонками в `MediaPrediction` (`estimatedCostUsd`, `actualCostUsd`, `billingUnit`). Комментарии в коде (`cost-ledger.ts` — номер попытки живёт в чужом Json-поле; `prediction-repository.ts` — откат инкремента вместо второго счётчика) указывают, что схему трогать нельзя; подтвердить.
7. **Есть ли у всех окружений публичный HTTPS-origin для webhook Replicate.** `REPLICATE_WEBHOOK_BASE_URL` обязателен (`replicate/config.ts:27-29`). Где его нет, способности придётся держать на чистом поллинге — устойчивость частично теряется.
8. **Как балансировать Replicate в панели**: manual-провайдер (как mubert/indigo) или estimate по `AiAuditLog` (как anthropic). У Replicate есть `/v1/account` (уже используется в `integrations/health.ts:87`), но эндпоинта остатка средств проект не использует.
9. **Русский TTS на Replicate.** Multilingual-модели есть, качество русского из документации не видно. Нужен слепой тест на реальных репликах ведущего, прежде чем объявлять fal-Kokoro резервом. Может оказаться, что для речи правильный ответ — прямой ElevenLabs, а не Replicate (P1-18 это допускает).
10. **Что считается B-roll'ом технически**: сток, отдельная дешёвая t2v-модель, статика с кен-бёрнсом или комбинация. Без этого ответа P0-16 не отделяется от P0-9, а §5 в части «B-roll» не закрывается ничем. Реализации сегодня нет вообще — ни типа сцены, ни планировщика, ни провайдера, ни ветки сборки.
11. **Как отдавать референсный кадр для `image_to_video`**: заливать в Replicate Files API (как делает lip-sync) или отдавать подписанный URL из нашего хранилища. Второе дешевле и быстрее, но требует внешнего доступа к объектам хранилища.
12. **Что считается фактом для денег, если сработал фолбэк на fal.** У fal нет `metrics.predict_time`, и `actualCost` там считается по прайсу спеки — то есть в одной колонке смешаются факт и оценка. Допустимо ли, или нужна отметка «оценочно».
