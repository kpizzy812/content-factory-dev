# ContentFactory - архитектурный дизайн

Статус: утверждено направление универсального продукта. Версия документа: 1.0 от 22 июля 2026 года.

## 1. Архитектурный выбор

Рассмотрены три подхода.

### Подход A - развивать полную копию VideoCamp

Плюсы: сохраняются зрелые интерфейсы, pipeline engine, БД, рендер, очереди, логи и тесты. Минусы: требуется очистить старые зависимости, небезопасный постинг и брендовые предположения.

### Подход B - извлечь только несколько модулей VideoCamp

Плюсы: меньше наследия. Минусы: придется заново собирать оркестратор, наблюдаемость, интерфейс, RBAC, хранилище и state machines. Риск потери уже решенных сложных случаев выше.

### Подход C - отдельные микросервисы вокруг неизмененного VideoCamp

Плюсы: минимальные изменения старого кода. Минусы: две модели данных, сложная атрибуция, дублирование очередей и высокая операционная стоимость.

Выбран подход A: чистая копия VideoCamp становится самостоятельным ContentFactory. Переработка выполняется по модульным границам, а не большим переписыванием.

## 2. Принципы

1. Универсальное ядро не знает названий клиентских сервисов.
2. Любая внешняя система подключается через порт и адаптер.
3. Все долгие операции представлены durable job со статусом и идемпотентным ключом.
4. Любой платный вызов имеет оценку стоимости, лимит, audit log и возможность отмены.
5. Исходные и сгенерированные файлы сохраняются в нашем объектном хранилище.
6. Публикация выполняется только через официальные API.
7. QA является частью pipeline, а не финальной ручной проверкой без данных.
8. Производительность масштабируется воркерами и очередями, а не одним длинным процессом.
9. Существующие модели и API мигрируют add-only, пока новые пути не подтверждены.
10. В коде нет секретов и клиентских токенов.

## 3. Границы модулей

### 3.1 Workspace и Brand

Отвечает за изоляцию проектов, брендов, языков, аккаунтов, шаблонов и интеграций.

Основные сущности:

- `Workspace` - владелец данных и настроек;
- `BrandProfile` - позиционирование, продукт, аудитории, tone of voice, ограничения;
- `LanguageProfile` - язык, локаль, голос, правила субтитров и CTA;
- `IntegrationConnection` - зашифрованное подключение к внешнему сервису;
- `ModelCapabilityConfig` - выбранный провайдер и модель для конкретной способности.

Существующую сущность `App` на первом этапе сохраняем как физическую таблицу, но закрываем новым доменным сервисом Workspace. Физическое переименование выполняется только после миграции всех ссылок.

### 3.2 Intelligence

Отвечает за входящие тренды и внутреннюю обратную связь.

Порты:

- `TrendSource`;
- `CompetitorSource`;
- `AnalyticsSource`.

Выходы:

- `TrendSignal`;
- `TrendEvidence`;
- `ContentHypothesis`;
- score и причины выбора.

Trendsee является первым адаптером `TrendSource`, но ручной ввод и существующие Apify-коннекторы остаются независимыми источниками.

### 3.3 Funnel

Отвечает за оффер, лид-магнит, кодовое слово, сообщения и conversion sink.

Сущности:

- `Offer`;
- `LeadMagnet` и версии;
- `Funnel` и версии;
- `KeywordRule`;
- `MessageSequence`;
- `ConversionDestination`.

Порты:

- `DirectAutomationProvider`;
- `MessagingProvider`;
- `ConversionSink`.

ChatPlace, Telegram и внешняя форма реализуются как первые адаптеры. Tracking token формируется до публикации и передается во все адаптеры.

### 3.4 Script Studio

Отвечает за хуки, сценарии, CTA, локализацию и scene plan.

Существующие Scenario, ScenarioVariant, critic и memory переиспользуются. В выходной контракт добавляются:

- связь с `ContentHypothesis` и `Funnel`;
- `languageProfileId`;
- варианты хука;
- тип сцены: presenter, b-roll, graphic, screenshot, mixed;
- spoken line;
- экранный текст;
- запрос к медиа-поиску или генерации;
- требования к жесту, эмоции и ракурсу;
- CTA и tracking metadata.

### 3.5 Presenter Library

Отвечает за исходники реального ведущего.

Сущности:

- `Presenter`;
- `PresenterRecording`;
- `PresenterClip`;
- `ClipFeature`;
- `ClipUsage`.

Pipeline ingest:

1. upload;
2. ffprobe и нормализация;
3. scene detection;
4. нарезка на пригодные короткие клипы;
5. извлечение кадров и аудио-признаков;
6. AI-теги через Replicate или LLM vision adapter;
7. perceptual hashes;
8. запись качества и допустимых способов использования.

Clip selector учитывает требования сцены, качество, недавние использования, похожесть с соседними сценами, одежду, фон, ракурс и разнообразие всей публикации.

### 3.6 Media Generation

Replicate - обязательный основной провайдер. Провайдерный контракт поддерживает capabilities:

- `lip_sync`;
- `text_to_video`;
- `image_to_video`;
- `text_to_image`;
- `image_edit`;
- `video_transform`.

Компоненты:

- `ReplicateClient` - официальный API/SDK, auth, create/get/cancel;
- `ReplicateModelRegistry` - mapping capability -> owner/model/version/input/output mapper;
- `MediaPrediction` - durable локальная запись prediction;
- `ReplicateWebhookHandler` - подпись, timestamp, idempotency и terminal-state guard;
- `PredictionRecoveryWorker` - polling зависших jobs;
- `PredictionOutputPersistor` - немедленное копирование результата в object storage;
- `MediaProviderRouter` - Replicate основной, fal.ai только явный fallback.

Все jobs создаются асинхронно. В webhook запрашиваются terminal events. Polling запускается, если webhook не пришел вовремя. Повторная доставка не создает новый asset и не списывает стоимость повторно.

## 4. Replicate lifecycle

1. Оркестратор создает локальный `MediaPrediction` с idempotency key.
2. Worker загружает входные файлы или передает подписанные URLs.
3. Replicate prediction создается с `webhook_events_filter=["completed"]` и deadline.
4. Локально сохраняются prediction ID, model version и sanitised input snapshot.
5. Подписанный webhook переводит prediction в terminal state.
6. При успехе output немедленно скачивается и сохраняется в объектное хранилище.
7. Создается или обновляется `VideoAsset`.
8. При ошибке сохраняется исходное сообщение Replicate без токенов.
9. Recovery worker опрашивает незавершенные predictions и отменяет зависшие.
10. Cost ledger записывает оценку и фактическую длительность выполнения.

Официальные ограничения, влияющие на дизайн:

- predictions по умолчанию асинхронны;
- webhooks могут повторяться и приходить не по порядку;
- подпись webhook необходимо проверять;
- API outputs могут удаляться примерно через час;
- общий create limit не заменяет лимиты конкретной модели и бюджета.

## 5. Render Pipeline

Используется гибридный рендер.

### FFmpeg

- probe и валидация;
- нарезка и нормализация;
- синхронизация аудио;
- concat/composition;
- loudness normalization;
- финальный encode;
- технические проверки файла.

### Remotion

- анимационные заголовки;
- таблицы и схемы;
- списки и callouts;
- data-driven инфографика;
- брендовые переходы;
- сложные субтитры;
- шаблоны CTA.

Scene renderer получает JSON scene plan и возвращает промежуточные клипы. FFmpeg выполняет финальное сведение. Remotion не отвечает за бизнес-логику и не обращается к БД напрямую.

## 6. QA Pipeline

QA состоит из независимых проверок:

- schema validation всех агентских выходов;
- semantic check сценария;
- fact and claim check;
- health-content policy check;
- соответствие сценария воронке и лид-магниту;
- проверка кодового слова и tracking token;
- duplicate/similarity check;
- media probe;
- audio loudness и silence check;
- subtitle coverage и safe zones;
- наличие обязательного CTA;
- проверка публичной ссылки перед постингом.

Результат QA - набор структурированных findings с severity. Blocker запрещает публикацию. Для новых медицинских утверждений и новых лид-магнитов можно включить human approval gate.

## 7. Публикация

`SocialPublisher` является общим портом. Первый новый production adapter - `MetaGraphPublisher`.

Meta adapter обязан:

- подключать Business/Creator аккаунты через OAuth;
- хранить токены зашифрованно;
- поддерживать публичные HTTPS media URLs;
- создавать Reel container;
- поддерживать Trial Reels через актуальный официальный параметр, если он доступен API и аккаунту;
- ждать готовность container без фиксированного sleep;
- вызывать media_publish;
- сохранять media ID, permalink и timestamps;
- запрашивать и учитывать content publishing limit;
- поддерживать manual или performance graduation strategy, если это разрешает актуальный API;
- быть идемпотентным и не дублировать публикацию после таймаута;
- собирать insights через официальный API.

DuoPlus/ADB provider не используется новым pipeline. Старый код остается изолированным до удаления после подтверждения Meta adapter.

## 8. Tracking и события

Tracking token создается до публикации и не меняется на всем пути.

Событийная модель:

- `hypothesis_created`;
- `script_selected`;
- `video_rendered`;
- `publication_created`;
- `platform_published`;
- `keyword_comment_detected`;
- `direct_sent`;
- `messenger_opened`;
- `lead_magnet_delivered`;
- `form_opened`;
- `form_submitted`;
- `sale_attributed`.

Каждое событие содержит workspace, brand, language, account, publication и tracking token, если они применимы. Внешние webhook события дедуплицируются по provider event ID.

## 9. Оркестрация и масштабирование

Девять бизнес-ролей представлены типизированными pipeline steps. Общий orchestrator строит dependency graph и управляет статусами.

Используются отдельные очереди:

- intelligence;
- LLM;
- Replicate media;
- local render;
- QA;
- publishing;
- analytics;
- funnel events.

Требования:

- atomic claim и lease;
- retry policy по классу ошибки;
- exponential backoff с jitter;
- dead-letter status;
- cancellation checkpoints;
- per-provider concurrency;
- per-account rate limit;
- budget limit на workspace/cycle/day;
- приоритет canary и ручных jobs;
- горизонтальный запуск нескольких workers.

Цель 300 роликов в день означает среднюю производительность 12,5 ролика в час. Capacity test моделирует 300 jobs без платных вызовов, затем запускается canary 1 ролик и партия 10-20 реальных роликов. Масштабирование разрешается только после измерения latency, error rate, стоимости и качества.

## 10. Ошибки и восстановление

- Ошибки внешнего API сохраняются полностью, но без секретов.
- Retry не создает новый платный prediction при существующем активном prediction ID.
- После рестарта worker продолжает job с последнего подтвержденного шага.
- Потерянный webhook восстанавливается polling worker.
- Исчезнувший временный output перегенерируется только после явной проверки постоянного storage.
- Ошибка одного ролика не останавливает batch.
- Ошибка одного аккаунта переводит публикации на другие подходящие аккаунты только по правилам маршрутизации, а не скрыто.
- Circuit breaker временно останавливает провайдера при массовых ошибках.

## 11. Безопасность

- Секреты хранятся только в encrypted credential storage или environment.
- API tokens не попадают в JSON snapshots, логи, URL query и клиентский bundle.
- Replicate webhook signature и timestamp проверяются до чтения события.
- Meta OAuth state и callback защищены от CSRF.
- Public media URLs имеют ограниченный срок жизни, достаточный для загрузки платформой.
- Доступ к workspace проверяется на каждом API endpoint.
- Удаление workspace запускает отдельный подтверждаемый lifecycle, а не каскадный случайный delete.

## 12. Тестирование

### Unit

- provider input/output mappers;
- webhook signature и idempotency;
- state transitions;
- clip selector;
- account limit scheduler;
- tracking propagation;
- QA rules;
- cost calculation.

### Integration

- Replicate mock create/webhook/poll/cancel;
- Meta mock container/status/publish/limit;
- Direct, Telegram и conversion webhook adapters;
- object storage persistence;
- Prisma migrations.

### End-to-end

- manual topic -> hypothesis -> script -> render -> QA -> mock publish;
- real Replicate canary;
- real Meta Trial Reel canary на тестовом профессиональном аккаунте;
- comment -> Direct -> messenger -> conversion sink с одним tracking token;
- recovery после рестарта на каждом долгом шаге.

### Load

- 300 jobs/day simulation;
- burst scheduling;
- per-account 24-hour rolling limits;
- duplicate webhook storm;
- provider slowdown and circuit breaker;
- render-worker saturation.

## 13. Порядок миграции

Порядок отражает зависимости, но не урезает итоговый продукт:

1. Создать чистый ContentFactory и убрать секреты/старый remote.
2. Ввести универсальные workspace, provider и integration boundaries.
3. Реализовать Replicate adapter, predictions, webhooks и storage persistence.
4. Реализовать Presenter Library и clip selector.
5. Подключить hybrid FFmpeg/Remotion render.
6. Реализовать Meta Graph API и Trial Reels.
7. Добавить Funnel, Lead Magnet, tracking events и внешние адаптеры.
8. Подключить Trendsee и внутренний feedback loop.
9. Завершить QA, analytics и capacity hardening.
10. Удалить недостижимые DuoPlus/ADB paths после подтвержденной замены.

## 14. Критерий завершения дизайна

Дизайн считается реализованным, когда универсальная установка проходит сквозной реальный путь без клиентского кода в ядре, использует Replicate для медиа, официальный Meta API для публикации, сохраняет tracking token до conversion sink и подтверждает нагрузочную модель 300 задач в сутки.

