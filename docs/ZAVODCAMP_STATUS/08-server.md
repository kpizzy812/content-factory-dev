# 08. Серверная логика

Помимо API endpoints (см. [07-api.md](07-api.md)) сервер содержит **66 utils**, **9 файлов automation** и **6 plugins-планировщиков**.

---

## server/utils/ (66 модулей)

### Ядро инфраструктуры

| Модуль | Назначение |
|--------|-----------|
| `prisma.ts` | Prisma client singleton с pg-adapter |
| `rbac.ts` | `getAuthContext`, `requirePermission`, `requireScopedAccess`, `requireModuleAccess`, `requireAppAccess`, `hasAccountAccess` |
| `rbac-presets.ts` | Конфигурация ролей: preset → 8 boolean флагов |
| `marketingcamp.ts` | Клиент к MC: `validateExternal`, `syncUser`, разбор payload |
| `requireZavodAuth.ts` | Guard для `/api/zavod/*` (проверка `ZAVOD_API_KEY` Bearer) |
| `paid-guard.ts` | `ENABLE_PAID_APIS` guard перед обращением к Anthropic/fal.ai/Mubert |
| `social-guard.ts` | `ENABLE_SOCIAL_POSTING` guard перед публикацией |
| `crypto.ts` | `encrypt(text)`, `decrypt(cipher)`, `encryptSecret`, `decryptSecret`. AES-256-GCM. Формат: `iv:authTag:ciphertext` (hex). IV=16 байт, tag=16 байт, key=32 байта из `ENCRYPTION_KEY` |
| `secret-access.ts` | `decryptSecret({ userId, entityType, entityId, action, reason })` + audit-log в `SecretAccessLog` |
| `bigint-serializer.ts` (plugin) | Patch `JSON.stringify` для BigInt (счётчики, metrics) |

### AI и внешние API

| Модуль | Назначение |
|--------|-----------|
| `anthropic.ts` | Клиент Claude API. Модели `claude-sonnet-4-20250514` (основная), `claude-haiku-4-5-20251001` (лёгкая). Mock-режим читает fixtures из `server/__fixtures__/agents/` |
| `fal.ts` | fal.ai клиент: image generation (Flux, SDXL), video (Kling), TTS (Kokoro). Mock-режим генерирует MP4/PNG через ffmpeg |
| `mubert.ts` | Mubert music generation для видео |
| `tts.ts` | TTS оркестратор: выбор модели по языку (af_heart для EN, bf_emma для RU) |
| `apify-client.ts` | Apify scraper API: trending parsers, account-metrics scrapers, баланс |
| `ai-pricing.ts` | Прайсинг моделей (input/output tokens → USD) |
| `ai-audit.ts` | Логгер `AiAuditLog` с `costUsd` |
| `external-call.ts` | HTTP-обёртка с retry/timeout/proxy-agent |

### Видео и медиа

| Модуль | Назначение |
|--------|-----------|
| `render.ts` | ffmpeg-обёртка: assembly, encoding, subtitles burn-in |
| `video-metadata.ts` | ffprobe-анализ (duration, resolution, fps, codec, audio) |
| `lip-sync-runner.ts` | Lip-sync через external API (sync.so / hedra) |
| `subtitle-style.ts` | ASS-пайплайн субтитров: 10 пресетов (Opus.pro style), word-by-word karaoke |
| `transcript-extractor.ts` | Whisper (fal.ai) + AI-keyword detection |
| `video-content-analyzer.ts` | Adaptive frame count, scene-detection, parallel ffmpeg, marketing prompt mode |
| `caption-limits.ts` | Per-platform лимиты заголовков и описаний (TikTok 2200, YouTube 5000 и т.д.) |
| `video-models.ts` | Реестр доступных fal.ai моделей |
| `video-cost.ts` | Калькулятор стоимости генерации |
| `video-helpers.ts` | Утилиты для работы с Video record |

### Pipeline-движок

| Модуль | Назначение |
|--------|-----------|
| `pipeline-engine.ts` | Universal DAG executor: топологическая сортировка, выполнение узлов, передача контекста |
| `pipeline-graph.ts` | Парсинг graphData → узлы + рёбра, валидация структуры |
| `pipeline-runtime.ts` | Runtime для exec: переменные, expressions, error handling |
| `pipeline-validator.ts` | Pre-flight валидация перед запуском (нет циклов, все узлы соединены, конфиги полны) |
| `pipeline-executors.ts` | Базовые исполнители: HttpRequest, Code, If, Loop, Wait, Set, Filter, SubPipeline |
| `pipeline-executors-extra.ts` | Доменные: Trendwatcher, ScenarioGenerator, VideoGenerator, Upload, Analytics |
| `pipeline-sub-executor.ts` | Запуск SubPipeline (рекурсия + предотвращение бесконечности) |
| `pipeline-rate-limiter.ts` | Per-user, per-pipeline rate-limits |
| `pipeline-cancel-registry.ts` | Глобальный реестр AbortController'ов для cancel |
| `pipeline-code-worker.ts` | Sandboxed JS execution для Code-узлов (изолированный context) |
| `pipeline-credentials.ts` | Зашифрованные креды для узлов (PipelineCredential) |
| `expression-evaluator.ts` | Safe evaluator выражений в конфигах (`{{ trend.title }}`) |
| `cron-parser.ts` | Парсер cron-выражений для расписаний |

### Доменные пайплайны

| Модуль | Назначение |
|--------|-----------|
| `video-pipeline.ts` | Главный 6-шаговый pipeline: prompt → image → video → voiceover → music → assembly |
| `video-pipeline-steps.ts` | Реализация каждого шага |
| `video-pipeline-db.ts` | DB-операции (VideoGenerationStep tracking) |
| `pipeline-video-analyzer.ts` | Video Analyzer executor (Stage 2): фреймы → Claude vision → анализ |
| `pipeline-drive-scanner.ts` | Drive Scanner executor (Stage 1): сканирование GDrive → импорт в Video |
| `pipeline-drive-uploader.ts` | Drive Uploader (sink): загрузка готовых видео в GDrive |
| `trendwatcher-runner.ts` | Trendwatcher worker: Apify API → парсинг → импорт в Trend |
| `trend-helpers.ts` | Утилиты для Trend (group by platform, dedupe) |
| `reference-pipeline.ts` | yt-dlp → frames → whisper → Claude vision (12 фреймов, prompt caching) → 2-stage synthesis → ReferenceBreakdown |
| `idea-pipeline.ts` | Pipeline создания Idea (auto-analysis) |
| `idea-sync.ts` | Двусторонняя синхронизация Idea с MarketingCamp |
| `story-video-planner.ts` | Сценарий → storyboard для видео |
| `upload-pipeline.ts` | Реальная публикация на платформы (OAuth API или browser_automation) |
| `metrics-collector.ts` | Сбор PostMetrics из API соцсетей |
| `feedback-loop.ts` | Critic → Rework → Regenerate loop |
| `scenario-critic-orchestrator.ts` | AI-критика сценариев (6 dimensions сравнения вариантов) |

### Аккаунты и метрики

| Модуль | Назначение |
|--------|-----------|
| `account-style-context.ts` | Контекст для AI-генерации стиль-профилей |
| `account-metrics-mapper.ts` | Преобразование Apify response → AccountMetricsSnapshot |
| `account-metrics-serialize.ts` | Сериализация для API ответа |
| `analytics-ai.ts` | AI-анализ метрик постов (рекомендации) |

### Storage

| Модуль | Назначение |
|--------|-----------|
| `storage-paths.ts` | GCS path builder + PrefixGuard (запрет писать вне `zavodcamp/`) |

### Прочее

| Модуль | Назначение |
|--------|-----------|
| `app-context.ts` | Контекст приложения для AI-промтов |
| `app-store-parser.ts` | Парсер метаданных приложений (App Store / Google Play) |
| `app-enrichment-pipeline.ts` | AI-обогащение App данными из stores |
| `admin-log-aggregator.ts` | Унификация 8 log-источников в единую ленту |
| `cycle-orchestrator.ts` | Запуск ProductionCycle: trendwatch → scenarios → videos → uploads |
| `agent-logger.ts` | Логгер AgentLog (для ProductionCycle) |

---

## server/automation/ — Browser automation

### Главные модули

**`poster-runner.ts`** — FSM PostingJob worker:
- Polling раз в 30 сек (`POSTING_WORKER_ENABLED=true`)
- Состояния: `pending` → `queued` → `posting` → `done` / `failed`
- Per-platform retry logic
- Завершение через `screenshot-uploader.ts` для подтверждения

**`login-status.ts`** — проверка статуса входа:
- Подключение к Indigo через puppeteer-core (CDP)
- Поиск платформ-специфичных селекторов (timeline, profile menu)
- Возврат `LoginStatus`: `logged_in` / `logged_out` / `suspicious` / `error`

**`video-fetcher.ts`** — скачивание видео для постинга:
- Источник: GCS / DriveFile / external URL
- Конвертация формата если нужно
- Cleanup временных файлов

**`screenshot-uploader.ts`** — скриншоты публикаций:
- Postupload screenshot (после публикации)
- Сохранение в storage с привязкой к Upload

**`poc-tiktok-post.ts`** — PoC ручной публикации TikTok (для отладки).

### posters/ — Per-platform публикация

**`types.ts`** — общие типы:
```ts
interface PosterContext {
  account: SocialAccount
  proxy: Proxy
  indigoProfile: IndigoProfile
  video: Video
  caption: Caption
  cdp: CDPSession
}
interface PosterResult {
  postUrl: string
  postId: string
  screenshotUrl: string
}
```

**`tiktok-poster.ts`** — TikTok Studio:
- Open Studio → upload video → fill caption → publish
- Hashtag extraction из Caption
- Wait selectors с timeout
- Error categorization (proxy_blocked, captcha, suspended)

**`youtube-poster.ts`** — YouTube Studio:
- Upload modal → details (title, description, tags)
- Visibility → Public/Unlisted
- Categorize → Shorts если `<60s`
- Schedule support

**`instagram-poster.ts`** — Instagram Reels:
- Create → Reel → upload
- Caption + cover frame
- Tag accounts
- Audio licensing check

---

## server/plugins/ — Schedulers (6)

Все scheduler-плагины имеют общий гейт первой строкой:
```ts
if (process.env.SCHEDULERS_ENABLED === "false") return
```

### `scheduler.ts` — Upload + metrics + cycle

3 `setInterval`:
1. **Upload tick** (`SCHEDULER_UPLOAD_INTERVAL_MS=300000` = 5 мин): обработка очереди Upload
2. **Metrics tick** (`SCHEDULER_METRICS_INTERVAL_MS=3600000` = 1 час): сбор метрик постов
3. **Cycle check** (`SCHEDULER_CYCLE_CHECK_INTERVAL_MS=21600000` = 6 часов): мониторинг застрявших ProductionCycle
4. **Reference watchdog** (`SCHEDULER_REFERENCE_WATCHDOG_INTERVAL_MS=300000`): таймаут stuck Reference записей

### `trendwatcher-scheduler.ts`

Запуск TrendwatcherProfile по cron-расписанию (`TrendwatcherProfile.scheduleCron`).

### `pipeline-scheduler.ts`

Запуск Pipeline по `PipelineSchedule.cron`.

### `telegram.ts`

Telegram bot polling: команды от админов, статусы доставки, шаблоны.

### `storage-init.ts`

При старте: проверка GCS bucket, прогрев credential cache.

### `bigint-serializer.ts`

Patch для глобального `JSON.stringify` чтобы корректно сериализовать BigInt.

---

## Mock-серверы (для разработки/тестов)

| Сервер | Порт | Команда | Что мокает |
|--------|------|---------|-----------|
| Proxy mock | 18888 | `bun run mock:proxy` | Health-check прокси: возвращает синтетические `ProxyHealthCheck` |
| Indigo mock | 35001 | `bun run mock:indigo` | Indigo Browser API: auth, profiles list/create/start/stop |
| Drive mock | 18889 | `bun run mock:drive` | Google Drive REST v3: list files/folders, download |

Включаются флагами `*_MOCK_MODE=true` (см. [02-stack.md](02-stack.md#environment-variables)).

---

## Test infrastructure

### Test bypass авторизации

Зашит в `server/utils/rbac.ts` → `getAuthContext`:

```ts
if (process.env.NODE_ENV !== "production"
    && process.env.TEST_AUTH_BYPASS === "1"
    && request.headers["x-test-auth-token"] === process.env.TEST_AUTH_TOKEN
    && request.headers["x-test-user-id"]) {
  return loadUser(request.headers["x-test-user-id"])
}
```

Работает только для endpoint'ов, идущих через `getAuthContext` / `requirePermission` / `requireScopedAccess`. Около 9 endpoint'ов зовут `requireUserSession` напрямую — для них покрытие через Playwright e2e.

### Safety guards

- `tests/setup.ts` блокирует если `DATABASE_URL` не на порту **5436** или имя БД не содержит **"tests"**
- TRUNCATE всех таблиц `public` afterEach (кроме `_prisma_migrations`)
- `singleThread: true` для предотвращения race
- `prisma db push` запрещён (см. CLAUDE.md)

---

## Логирование

### 8 таблиц логов (унифицированы в `admin-log-aggregator.ts`)

1. **`AgentLog`** — события AI-агентов в ProductionCycle
2. **`AppEnrichmentLog`** — обогащение метаданных App
3. **`SecretAccessLog`** — расшифровки секретов (append-only)
4. **`TelegramCommandAudit`** — команды Telegram-бота
5. **`TelegramDelivery`** — статусы доставки сообщений
6. **`TrendwatcherRunLog`** — события TrendwatcherRun
7. **`WebhookLog`** — входящие webhook'и pipeline
8. **`AiAuditLog`** — все AI-предложения с costUsd

Лента `/admin/logs` отображает все 8 в едином формате с фильтрами по source, level, resolved.

---

## Безопасность

### Шифрование

| Что шифруется | Где |
|---------------|-----|
| `SocialAccount.accessToken`, `refreshToken`, `loginPassword`, `recoveryEmail`, `recoveryPhone`, `twoFASecret` | По всему flow |
| `Proxy.host`, `username`, `password` | При создании |
| `IndigoProfile.cookiesSnapshot` | При импорте cookies |
| `PipelineCredential.encryptedData` | При создании |
| `DriveFile` (некоторые поля) | При синке |

### Audit-log

Каждая расшифровка через `decryptSecret()` создаёт запись в `SecretAccessLog`:
- `userId` — кто
- `entityType`, `entityId` — что
- `action` — view / use_in_session / export
- `clientIp`, `userAgent` — откуда
- `reason` — для чего (обязательно для UI reveal)

### Webhook HMAC

Каждый `Pipeline.webhookSecret` используется для HMAC-проверки входящих webhook'ов.

### CORS

Закрыт по умолчанию. Открытые публичные endpoint'ы — только `/api/health`, `/api/webhooks/[token]`, `/api/zavod/*` (с Bearer-токеном).
