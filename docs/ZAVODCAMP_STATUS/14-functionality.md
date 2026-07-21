# 14. Реализованный функционал

Полная карта работающих фич на дату создания документа. Источник данных — `.claude/agent-memory/tester/MEMORY.md` + текущее состояние кода.

---

## Высокоуровневый pipeline контента

```
1. ПОИСК ТРЕНДОВ
   ↓ (Apify scraper или manual import)
2. AI-АНАЛИЗ ТРЕНДА
   ↓ (Claude vision + 12 frames + 2-stage synthesis)
3. ИДЕЯ КОНТЕНТА
   ↓ (manual / from chat / from pipeline / from MarketingCamp)
4. СЦЕНАРИЙ (несколько вариантов)
   ↓ (AI-критика, выбор лучшего, ручная правка)
5. ВИДЕО-ПРОИЗВОДСТВО (6 шагов)
   ↓ (prompt → image → video → voiceover → music → assembly)
6. УНИКАЛИЗАЦИЯ ПОД ПЛАТФОРМЫ
   ↓ (per-platform ffmpeg варианты)
7. СУБТИТРЫ + CAPTION
   ↓ (10 пресетов ASS + AI keyword detection)
8. ПУБЛИКАЦИЯ
   ↓ (OAuth API или Indigo browser automation)
9. СБОР МЕТРИК
   ↓ (Apify scrapers / OAuth API)
10. АНАЛИТИКА И РЕКОМЕНДАЦИИ
```

Каждый этап имеет страницу в UI, API endpoints, БД-модели, тесты.

---

## Модуль: Trendwatcher

### Возможности
- **Apify-парсеры** для TikTok, YouTube, Instagram, Telegram
- **Inline-режим** для on-demand парсинга
- **Расписание** через cron (Trendwatcher Scheduler)
- **Валидация** профиля парсинга перед запуском
- **History** с метриками: foundCount, importedCount, analyzedCount, skipCount, errorCount
- **Retry** для упавших запусков
- **AI-анализ** каждого тренда (Claude vision)
- **Творческий бриф** (предмет, целевая аудитория, тон, рекомендации)
- **Insights** (что зашло, почему)
- **Назначение app** (тренд → приложение)
- **Статусы** (new, processing, ready, published, rejected)

### Страницы
- `/trends` — 3 таба (Тренды, Профили, Запуски)
- `/trends/[id]` — детали + AI-анализ
- `/admin/cycles` — циклы Trendwatcher запусков

### API
- `/api/trends/*` (8), `/api/trendwatcher/*` (15)

### Реализация
- `server/utils/trendwatcher-runner.ts` — worker
- `server/utils/apify-client.ts` — клиент Apify
- `server/plugins/trendwatcher-scheduler.ts` — cron
- `server/utils/reference-pipeline.ts` — yt-dlp → frames → whisper → Claude

---

## Модуль: Идеи

### Возможности
- **Источники:** chat / pipeline / manual
- **Sync с MarketingCamp** (externalId, syncStatus, syncDirection, remoteSnapshot)
- **AI-анализ** идеи (рекомендации)
- **Reference analysis** — сравнение с справочными образцами через AI-инсайты
- **Реализация в сценарий** (Idea → Scenario)
- **Лог действий оператора** (approve/reject/edit)

### Страницы
- `/ideas` — список + создание + sync toolbar
- `/ideas/[id]` — детали + анализ + reference progress

### API
- `/api/ideas/*` (11)

### Реализация
- `server/utils/idea-pipeline.ts` — workflow
- `server/utils/idea-sync.ts` — sync с MC
- `useIdeaSync` composable + `IdeaSyncToolbar`/`IdeaSyncInfo` компоненты

---

## Модуль: Сценарии

### Возможности
- **Multi-variant генерация** (по умолчанию 3 варианта)
- **AI-критика** сравнивает варианты по 6 dimensions:
  - hook strength
  - narrative coherence
  - visual appeal
  - CTA clarity
  - audience fit
  - originality
- **Rework loop** — критик может потребовать переделать
- **Auto-select** лучшего варианта
- **Ручная правка** через ScenarioEditor
- **Регенерация блоков** (hook / body / CTA отдельно)
- **Visual style improvement** (AI улучшение стиля)
- **History** ревью-действий (accept/reject/rework + комментарий)
- **Feedback** продюсера → AI learning
- **Generation profiles** (шаблоны для App)
- **Story planning** — сценарий → storyboard

### Страницы
- `/scenarios` — список с фильтрами
- `/scenarios/[id]` — варианты в табах + AI-критика (модалка) + feedback + видео

### API
- `/api/scenarios/*` (23)

### Реализация
- `server/utils/scenario-critic-orchestrator.ts` — AI-критика
- `server/utils/feedback-loop.ts` — rework loop
- `server/utils/story-video-planner.ts` — storyboard

### Метрики
- 28 API-тестов на 3 спека после внедрения Critic'а
- 30/30 тестов на Apify Account Metrics

---

## Модуль: Видео-продакшн

### 6-шаговый pipeline
1. **prompt** — формирование промта на основе сценария + стиль-профиля
2. **image** — генерация изображений (fal.ai Flux / SDXL)
3. **video** — image → video clip (Kling)
4. **voiceover** — TTS (fal-ai/kokoro)
5. **music** — Mubert generation
6. **assembly** — ffmpeg сборка

### Возможности
- **Adaptive frame count** в Video Analyzer Stage 2
- **Scene detection** через ffmpeg
- **Parallel ffmpeg** для скорости
- **Marketing prompt mode** для специфичных задач
- **VideoFrame** покадровый анализ
- **TTL idempotency** (анализ не повторяется)
- **Per-step status tracking** (VideoGenerationStep): pending/in_progress/completed/partial/failed/no_data/timeout
- **Cancel / Resume / Skip step / Rerun step / Rerender assembly**
- **Lip-sync** через external API (sync.so / hedra)
- **10 пресетов субтитров** (Opus.pro style):
  - Word-by-word karaoke
  - AI keyword detector
  - ASS-формат
  - CSS-имитация в UI picker
- **Pipeline-level subtitle config**
- **Уникализация per-platform** (ffmpeg варианты, paramsHash cache, race-safe upsert)
- **Caption Generator** (Stage 3 от Drive pipeline):
  - Per-platform метаданные (title, description, hashtags)
  - Approval workflow
  - AI regeneration

### Страницы
- `/videos` — список
- `/videos/[id]` — плеер + конфиг + ассеты + субтитры + уникальные варианты + подписи

### API
- `/api/videos/*` (25)

### Реализация
- `server/utils/video-pipeline.ts` — главный
- `server/utils/video-pipeline-steps.ts` — каждый шаг
- `server/utils/subtitle-style.ts` — ASS pipeline
- `server/utils/transcript-extractor.ts` — Whisper
- `server/utils/render.ts` — ffmpeg wrapper

---

## Модуль: Социальные аккаунты

### Возможности
- **Manual creation** (multi-step wizard) — покупные аккаунты без OAuth
- **Browser automation** posting method (через Indigo)
- **API method** posting (legacy через OAuth — DEPRECATED 410)
- **2FA** через TOTP (otpauth library)
- **Шифрование** учётных данных (AES-256-GCM)
- **Reveal с reason** (audit-log в SecretAccessLog)
- **Привязка прокси** (1:1)
- **Привязка Indigo-профиля** (M:N с primary флагом)
- **Style-профиль** для AI (цвета, фильтры, эстетика)
- **Apify Account Metrics** (часть C):
  - Снимок followers, posts, engagement_rate
  - Sparkline динамики
  - Топ постов
  - 24h idempotency
  - Force update
- **Warmup-планировщик**:
  - Детерминистическая XorShift32 RNG
  - 9 распределений (platform × age bucket)
  - Daily human-like sessions
- **Login check** — проверка статуса через Indigo CDP
- **Profile completeness** (0-100%)
- **Account Groups** для bulk-операций
- **Profile diagnostic panel** — последняя ошибка, статус API

### Страницы
- `/accounts` — список + multi-step create wizard
- `/admin/accounts-health` — дашборд здоровья по платформам
- `/admin/warmup-keywords` — пулы ключевых слов

### API
- `/api/accounts/*` (15), `/api/account-groups/*` (4), `/api/warmup/*` (11)

### Особенности
- **1:1:1 enforcement** (account = profile = proxy)
- **Hard-block** на постинг при нарушении связки
- **Deep proxy check** — проверка работы прокси через аккаунт

---

## Модуль: Indigo (anti-detect браузеры)

### Возможности
- **Sync workspace** с Indigo Browser
- **Profile management** (CRUD)
- **Fingerprint configuration** (Canvas, UA, WebGL)
- **Cookies import/export**
- **Multi-account linking** (M:N с SocialAccount)
- **Primary account** на профиль
- **Session lifecycle**: start-prepare → start → session-record → session-end → stop
- **Stop recovery** — message-based detection (already stopped, not running, profile inactive)
- **Persistent running banner** — зелёная плашка пока профиль работает
- **Stepper запуска** с success alert и портом
- **Orphan cleanup** — find/remove "осиротевшие" профили
- **Remote duplicate cleanup**
- **Sanity diagnostic panel**
- **Launcher fallback modal** — если не удалось запустить
- **CDP подключение** через puppeteer-core (валидировано на deep-check)

### Страницы
- `/indigo` — список + sync + cleanup
- `/indigo/[id]` — детали + stepper

### API
- `/api/indigo/*` (36)

### Реализация
- `puppeteer-core@24.43.1` для CDP
- Connect к Indigo launcher на 127.0.0.1:45011
- Helpers в `server/automation/posters/`

---

## Модуль: Прокси

### Возможности
- **CRUD** прокси (http/https/socks5)
- **Резидентные** NodeMaven
- **Шифрование** host/username/password
- **Health checks** автоматические (cron 4h) и manual
- **Latency tracking**
- **Ban detection**
- **History** проверок
- **Diagnose** — прямой пинг, тест через API, анализ
- **Reveal credentials** (с reason)
- **Auto-rotation** (если support от провайдера)
- **IPv4-only** (миграция 2026-05-15)

### Страницы
- `/proxies`

### API
- `/api/proxies/*` (10)

### Реализация
- `server/automation/login-status.ts` — проверка через аккаунт
- Mock-сервер :18888 для разработки
- `PROXY_HEALTH_CHECK_ENABLED` + `SCHEDULER_PROXY_HEALTH_INTERVAL_MS=14400000`

---

## Модуль: PostingJob (browser automation)

### Возможности
- **FSM** queue: pending → queued → posting → done / failed / cancelled
- **Per-platform posters** (TikTok / YouTube / Instagram)
- **Worker polling** 30 сек
- **Retry** с экспоненциальным backoff
- **Logs** каждой попытки
- **Screenshot** после публикации
- **Cancel modal** с подтверждением
- **Force-stop** через admin
- **Diagnostics** (last error, account state)

### Страницы
- `/posting-jobs`
- Карточки на `/uploads/[id]`

### API
- `/api/posting-jobs/*` (8)

### Реализация
- `server/automation/poster-runner.ts` — worker FSM
- `server/automation/posters/{tiktok,youtube,instagram}-poster.ts`
- `server/automation/screenshot-uploader.ts`
- `POSTING_WORKER_ENABLED=true`

---

## Модуль: Аналитика

### Возможности
- **Дашборд:** views, engagement, CTR
- **PostsTable** sortable (views/likes/comments/CTR)
- **Top CTR list**
- **Per-platform** фильтры
- **History метрик** с линейным графиком
- **Per-upload analytics** с рекомендациями
- **AI-анализ** метрик постов
- **Metrics collector** scheduler (1 час)

### Страницы
- `/analytics` — 2 таба (Summary, По аккаунту)
- `/analytics/[uploadId]` — детали загрузки

### API
- `/api/analytics/*` (5)

### Реализация
- `server/utils/metrics-collector.ts`
- `server/utils/analytics-ai.ts`

---

## Модуль: Pipeline (No-Code конструктор)

### Возможности
- **Визуальный DAG-редактор** (@vue-flow/core)
- **Drag-n-drop** узлов
- **Конфигураторы** для типов узлов:
  - HttpRequest (внешний API)
  - Code (sandboxed JS)
  - If / Loop / Wait
  - Set (переменные) / Filter (коллекция)
  - SubPipeline (рекурсия)
  - Доменные: Trendwatcher, Scenario, Video, Upload, DriveScanner, VideoAnalyzer, CaptionGenerator, Idea, Analytics
- **Версионирование** + rollback
- **Расписание** cron
- **Webhook** с HMAC-проверкой
- **Logs** webhook'ов
- **Credentials** (шифрованные API keys / OAuth)
- **Test** узлов изолированно
- **Upstream context** для узла (что ему прилетит)
- **Validation** перед запуском (нет циклов, все узлы соединены)
- **Run history** + retry + replay + cancel
- **Runtime stats** (success rate, avg time)
- **Tags** (M:N)
- **Presets** (templates)
- **Import/Export** JSON
- **Sharing** (sharedWith[])
- **Rate limiting** per-user/per-pipeline
- **AI audit log** + AI autofill

### Страницы
- `/pipeline` — каталог + монитор
- `/pipeline/[id]` — редактор
- `/pipeline/[id]/runs/[runId]` — детали запуска

### API
- `/api/pipelines/*` (47)

### Реализация
- `server/utils/pipeline-engine.ts` — DAG executor
- `server/utils/pipeline-graph.ts` — топосорт
- `server/utils/pipeline-validator.ts`
- `server/utils/pipeline-code-worker.ts` — sandboxed Code node
- `server/utils/expression-evaluator.ts` — safe `{{ ... }}`
- `server/plugins/pipeline-scheduler.ts` — cron

---

## Модуль: Google Drive

### Stage 1 — Credentials & Sync
- Service Account setup wizard
- Multi-credential management
- Test connection
- Browser папок/файлов
- Folder picker для синхронизации
- 30-минутный scheduler для metadata refresh

### Stage 2 — Drive Auto-Caption Pipeline
- **Drive Scanner** — сканирует подключённую папку
- **Video Analyzer** — анализирует кадры через Claude vision (Stage 2 модернизирован)
- **Caption Generator** — per-platform метаданные
- **Upload** — публикация

### Stage 3 — Google Drive Uploader (sink-нода)
- Заливка готовых видео обратно в Drive через SA multipart upload
- driveFileId / driveCredentialId в Video

### Страницы
- `/google-drive`

### API
- `/api/google-drive/*` (5)

### Реализация
- `server/utils/pipeline-drive-scanner.ts` — Stage 1
- `server/utils/pipeline-video-analyzer.ts` — Stage 2
- `server/utils/pipeline-drive-uploader.ts` — Stage 3
- Mock-сервер :18889 для разработки

---

## Модуль: Storage (GCS migration)

### Возможности
- **STORAGE_DRIVER:** gcs / local / mock
- **GCS bucket** `marketingcamp-creatives` под префиксом `zavodcamp/`
- **PrefixGuard** — запрет писать вне префикса
- **getStorageDriver()** обязателен везде
- **Signed URLs** для playback
- **Storage health** dashboard
- **Cleanup** старых файлов

### Страницы
- `/admin/storage-health`

### API
- `/api/admin/storage-health`, `/api/videos/[id]/storage-status`, `/api/videos/[id]/playback-url`

### Реализация
- `server/utils/storage-paths.ts`
- `@google-cloud/storage@7.19.0`

---

## Модуль: Telegram-бот

### Возможности
- **Chats management** (chatId, routingTags)
- **Templates** с переменными `{{...}}` + AI-generation
- **API keys** с rotation
- **Deliveries log** + resend
- **Command audit**
- **Diagnostics** (статус бота, last delivery)
- **Test send**
- **Restart**

### Страницы
- `/admin/telegram` (с табами: Overview, Chats, Templates, Deliveries, Audit, ApiKeys, Diagnostics)

### API
- 19 endpoint в `/api/admin/telegram/*`

### Реализация
- `server/plugins/telegram.ts` — bot polling
- `TELEGRAM_MOCK_MODE` для разработки

---

## Модуль: RBAC

### Возможности
- **MC как источник истины** (POST /api/auth/login → validate-external)
- **Fail-fast** если MC не вернул permissions (502)
- **8 boolean флагов** + 5 ролевых пресетов
- **Modules access** (массив slug'ов)
- **App assignments** с accessLevel/accounts/geos/permissions
- **Admin bypass** только для модулей и приложений (не для флагов)
- **isActive** локальная блокировка
- **Read-only UserRoleEditor** (правки в MC)
- **6 регрессионных тестов** в `tests/api/rbac-philosophy.spec.ts`

### Реализация
- `server/utils/rbac.ts`
- `server/utils/rbac-presets.ts`
- `server/utils/marketingcamp.ts`

---

## Модуль: Креативы и Промты

### Креативы
- Каталог из трендов/идей
- Фильтры (тип/источник/статус)

### Лучшие промты
- **AI Pattern Analysis** (Kling pattern: camera, lighting, actionStructure, mood, motionIntensity)
- Public/Private flag
- Usage count
- Notes + tags
- Re-analyze trigger

### Страницы
- `/creatives`, `/prompts-library`

### API
- `/api/creatives`, `/api/favorite-prompts/*` (5)

---

## Модуль: Цикл генерации (ProductionCycle)

### Возможности
- **Запуск цикла** через AdminDashboard
- **Per-app + per-group**
- **Статус FSM** (pending → running → completed/failed/stopped)
- **Метрики:** trendsFound, scenariosGen, videosGen, uploadsCount
- **Cycle check scheduler** (6 часов): обнаружение застрявших циклов
- **Logs** (AgentLog)
- **Manual stop**

### Страницы
- `/admin/cycles` — список
- `/admin/cycles/[id]` — детали

### API
- `/api/admin/cycles/*`

### Реализация
- `server/utils/cycle-orchestrator.ts`

---

## Модуль: Logs (унифицированная лента)

### Возможности
8 источников логов в одном виде:
1. AgentLog
2. AppEnrichmentLog
3. SecretAccessLog
4. TelegramCommandAudit
5. TrendwatcherRunLog
6. WebhookLog
7. AiAuditLog
8. (TelegramDelivery — отдельная страница)

### Возможности UI
- Фильтры (level, module, resolved)
- Mark as resolved
- Источники цветовой код
- Per-record drill-down

### Страницы
- `/admin/logs`

### API
- `/api/admin/logs`, `/api/admin/logs/[id]/resolve`

### Реализация
- `server/utils/admin-log-aggregator.ts`

---

## Модуль: Balances (остатки сервисов)

### Возможности
- **Ручной ввод** остатков (fal.ai, anthropic, indigo, nodemaven, mubert)
- **Currency** (USD по умолчанию)
- **Metadata** (traffic_left_gb, days_remaining)
- **Notes**
- **History** (enteredAt → updatedAt)
- **Apify auto-fetch** (для NodeMaven и Apify самого через API)

### Страницы
- `/admin/balances`

### API
- `/api/admin/balances`, `/api/admin/balances/[service]`

---

## Тестовая инфраструктура (Vitest + Playwright)

### Реализовано (DoD 14/14 PASS)
- Vitest 2 + happy-dom + singleThread
- @nuxt/test-utils 3 для integration
- supertest 7 для contract HTTP
- Playwright 1.48 на 4 viewport'ах
- **Safety guards:**
  - Wrong-DB block (порт 5436, имя содержит "tests")
  - Production NODE_ENV block
  - TRUNCATE afterEach
- **SCHEDULERS_ENABLED=false** в 4 плагинах
- **TEST_AUTH_BYPASS** двойной гейт
- **TRUNCATE между тестами** + singleThread
- **107/107** API тестов PASS на последний коммит
- **9 spec'ов** на manual account creation
- **30/30** на Apify Account Metrics
- **6/6** Vitest setup tests, **1/1** Playwright smoke

### Visual Audit
- Через MCP Playwright
- 4 viewport screenshots на каждую страницу
- Report в `tests/visual/{YYYY-MM-DD}-{feature}.md`
- Severity: BLOCKER / MAJOR / MINOR / CLEAN

---

## DevOps

### Docker
- Multi-stage: build (Bun) → runtime (Bun + ffmpeg + yt-dlp + Indigo + Xvfb)
- Все Chrome deps для Debian bookworm
- Persistent volumes для storage

### entrypoint.sh
- Pre-flight: ffmpeg, ffprobe, yt-dlp обязательны
- ENV check: ENCRYPTION_KEY=64 hex, NUXT_SESSION_PASSWORD, и т.д.
- prisma migrate deploy
- Optional seed
- Indigo + Xvfb запуск (до 60s ожидание)
- exec bun .output/server/index.mjs

### Build size
- ~38-39 MB stable

---

## Mock-режимы (для dev без расходов)

| Мок | Что | Как включить |
|-----|-----|--------------|
| Anthropic | Fixtures из `server/__fixtures__/agents/` | `ANTHROPIC_MOCK_MODE=true` |
| fal.ai | ffmpeg-generated MP4/PNG/MP3 в `_mock_cache` | `FAL_MOCK_MODE=true` |
| Mubert | stub music | `(в fal.ts)` |
| Telegram | stdout-логирование | `TELEGRAM_MOCK_MODE=true` |
| Indigo | mock сервер :35001 | `INDIGO_MOCK_MODE=true` |
| Proxy | mock сервер :18888 | `PROXY_MOCK_MODE=true` |
| Google Drive | mock сервер :18889 | `GOOGLE_DRIVE_MOCK_MODE=true` |

---

## Scenario Quality Critic (2026-05-06)

### Возможности
- AI-агент сравнивает N вариантов по 6 dimensions
- Rework-loop
- Auto-select лучшего
- Score + детальные scoreDetails
- 3 API endpoints (critic.post / critic-reviews.get / critic/best.put)
- CriticReview модель + ScenarioVariant.qualityScore/qualityScoreDetails/qualityCheckedAt
- 2 миграции
- UI: ScenarioCriticBadge, ScenarioCriticReportModal, alert на /scenarios/[id]
- 28/28 API тестов PASS (3 спека)

### Реализация
- `server/utils/scenario-critic-orchestrator.ts`

---

## Content Uniqueness Pipeline (Трек F)

### Возможности
- **ffmpeg-сервис** per-platform уникализации видео
- **Cache** по paramsHash
- **Race-safe upsert**
- **2 API endpoints**
- **VideoUniqueVariantsSection.vue**

---

## Account Warming Planner (Трек E)

### Возможности
- **Детерминистическая** генерация ежедневных human-like сессий
- **XorShift32 RNG** для воспроизводимости
- **9 распределений** (platform × age bucket)
- **DaisyUI timeline UI**
- **11 API endpoints** с RBAC
- **Таб "Прогрев"** в AccountEditModal
- **/admin/warmup-keywords** страница
- **Миграция** `warmup_models` (только ADD)
- **31/31** smoke tests

---

## Account Observability Dashboard (Трек G)

### Возможности
- Dashboard `/admin/accounts-health`
- 1 API endpoint с Promise.all 13 запросов
- Completeness 8×12.5% (8 признаков по 12.5% каждый)
- Сортировка ASC
- 4 компонента (Summary, ByPlatform, Table, CompletenessBar)
- Composable + страница + middleware admin-access
- Карточка в `/admin/index`

---

## Сводка проекта

| Метрика | Значение |
|---------|----------|
| Страниц | 42 |
| Компонентов | 194 |
| Composables | 85 |
| Stores | 16 |
| API endpoints | 311 |
| Server utils | 66 |
| Postgres моделей | 75+ |
| Миграций | 89 |
| Shared types | 31 |
| Тем | 5 активных + 2 кастомных |
| Агентов Claude | 7 |
| Скиллов | 10 |
| Mock-серверов | 3 |
| Schedulers | 4 |
| Внешних интеграций | Anthropic, fal.ai, Mubert, Apify, NodeMaven, Indigo, Google Drive, Telegram, MarketingCamp |
| Платформ публикации | TikTok, YouTube, Instagram, Telegram |
| Build size | 38.8 MB |

---

## Будущее развитие

См. `.claude/agent-memory/architect/MEMORY.md` для планов и `.claude/agent-memory/tester/MEMORY.md` для ленты текущих работ.

Свежий план: `posting_automation_d_plan.md` (трек D автоматизации постинга).
