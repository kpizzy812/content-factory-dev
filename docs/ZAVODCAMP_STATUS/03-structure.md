# 03. Иерархия файлов

## Корень проекта

```
ZavodCamp/
├── app/                      # Vue / Nuxt frontend код
├── server/                   # Nitro backend
├── shared/                   # Типы, общие для front + back
├── prisma/                   # Схема БД + миграции
├── tests/                    # Vitest + Playwright тесты
├── scripts/                  # Seed-скрипты, утилиты
├── public/                   # Статика (favicon, robots.txt)
├── storage/                  # FS-fallback для STORAGE_DRIVER=local
├── docs/                     # Документация проекта (включая этот файл)
├── screens/                  # Скриншоты Playwright/visual audit
├── tmp/                      # Временные файлы
├── .claude/                  # Агенты, скиллы, память
├── .nuxt/                    # Auto-generated (gitignore)
├── .output/                  # Build output (gitignore)
├── node_modules/             # Deps (gitignore)
├── nuxt.config.ts            # Nuxt конфиг
├── prisma.config.ts          # Prisma CLI config
├── playwright.config.ts      # Playwright config
├── vitest.config.ts          # Vitest config
├── tsconfig.json             # TypeScript (наследуется от .nuxt)
├── package.json              # Зависимости и scripts
├── bun.lock                  # Bun lockfile (источник истины)
├── Dockerfile                # Multi-stage build
├── entrypoint.sh             # Container start script
├── .env / .env.example       # Environment variables
├── .env.test / .env.test.example
├── CLAUDE.md                 # Системные инструкции
├── README.md                 # Краткая инфа о проекте
├── PROJECT_AUDIT.md          # Большой аудит (203 KB)
├── PIPELINE_ANALYSIS.md      # Анализ pipeline (42 KB)
└── llms.txt                  # Снапшот для LLM (62 KB)
```

---

## `app/` — Frontend

```
app/
├── pages/                    # 42 страницы (file-based routing)
│   ├── index.vue                                   # /
│   ├── settings.vue                                # /settings
│   ├── auth/login.vue                              # /auth/login
│   ├── accounts/index.vue                          # /accounts
│   ├── analytics/{index,[uploadId]}.vue
│   ├── creatives/index.vue
│   ├── google-drive/index.vue
│   ├── ideas/{index,[id]}.vue
│   ├── indigo/{index,[id]}.vue
│   ├── pipeline/{index,[id]/index,[id]/runs/index,[id]/runs/[runId]}.vue
│   ├── posting-jobs/index.vue
│   ├── prompts-library/index.vue
│   ├── proxies/index.vue
│   ├── references/index.vue
│   ├── scenarios/{index,[id]}.vue
│   ├── trends/{index,[id]}.vue
│   ├── uploads/{index,[id]}.vue
│   ├── videos/{index,[id]}.vue
│   └── admin/                                      # 13 admin страниц
│       ├── index.vue
│       ├── accounts-health.vue
│       ├── balances.vue
│       ├── storage-health.vue
│       ├── telegram.vue
│       ├── warmup-keywords.vue
│       ├── apps/{index,[id]}.vue
│       ├── cycles/{index,[id]}.vue
│       ├── integrations/index.vue
│       ├── logs/index.vue
│       └── users/{index,[id]}.vue
│
├── components/               # 194 компонента, 19 категорий
│   ├── shared/               # EmptyState, Pagination, AsyncSelect, FieldHint, ...
│   ├── trend/                # TrendCard, TrendFilters, TrendDetailSidebar, ...
│   ├── scenario/             # ScenarioCard, ScenarioEditor, ScenarioCriticBadge, ...
│   ├── video/                # VideoCard, VideoPlayer, VideoSubtitleEditor, ...
│   ├── idea/                 # IdeaCard, IdeaActions, IdeaReferenceAnalysis, ...
│   ├── pipeline/             # PipelineCanvas, PipelineNode, ...
│   │   └── config/           # Конфигураторы узлов (Http/Code/If/Loop/Wait/...)
│   ├── upload/               # UploadCard, UploadMetaForm, ...
│   ├── analytics/            # DashboardStats, MetricsHistory, PostsTable, ...
│   ├── account/              # AccountCard, AccountCreateModal, AccountEditModal, ...
│   ├── admin/                # DashboardStatusCard, UserCard, CycleCard, ...
│   │   └── telegram/         # Chats, Templates, Deliveries, Audit, Diagnostics, ApiKeys
│   ├── indigo/               # IndigoProfileCard, IndigoStartProgressStepper, ...
│   ├── proxy/                # ProxyCard, ProxyAddModal, ProxyDiagnoseModal, ...
│   ├── warmup/               # WarmupSessionCard, WarmupKeywordPoolEditor, ...
│   ├── posting/              # PostingJobCard, PostingJobLogsModal, ...
│   ├── favorite-prompt/      # FavoritePromptCard, FavoritePromptModal, ...
│   ├── google-drive/         # DriveCredentialsSection, DriveBrowserSection, ...
│   ├── creative/             # CreativeCard, CreativeFilters
│   ├── reference/            # ReferenceCard
│   └── settings/             # IntegrationCard
│
├── composables/              # 85 composables (auto-imported)
│   └── (плоская структура: useTrends.ts, useAccounts.ts, ...)
│
├── stores/                   # 16 Pinia stores
│   └── (trendFilters.ts, scenarioFilters.ts, pipelineEditor.ts, ...)
│
├── layouts/                  # 2 layouts: default.vue, auth.vue
│
├── middleware/               # 3 middleware (1 global + 2 named)
│   ├── auth.global.ts        # Auth guard для всех маршрутов
│   ├── module-access.ts      # Проверка доступа к модулю
│   └── admin-access.ts       # Проверка canAdmin
│
├── plugins/                  # 1 плагин
│   └── auth-redirect.client.ts  # Глобальный обработчик 401
│
├── assets/css/               # Глобальные стили
│   └── main.css              # Tailwind v4 + DaisyUI 5 + темы
│
├── utils/                    # Frontend утилиты
│   └── image-fallback.ts     # Fallback для broken изображений
│
└── generated/                # Auto-generated Prisma client typings
    └── prisma/               # (gitignore-able)
```

---

## `server/` — Backend (Nitro)

```
server/
├── api/                      # 311 endpoint в 28 разделах
│   ├── auth/                 # login, logout, permissions, validate-external
│   ├── accounts/             # CRUD + credentials + style + metrics + check-login
│   ├── account-groups/       # Группы аккаунтов
│   ├── admin/                # 49 endpoint: users, apps, cycles, logs, telegram, balances, ...
│   ├── ai/suggest/           # AI-подсказки для полей форм (14 endpoint)
│   ├── analytics/            # Дашборд, posts, analyze, collect
│   ├── apps/                 # Список приложений, контекст
│   ├── creatives/            # Каталог
│   ├── favorite-prompts/     # Библиотека лучших промтов
│   ├── files/                # Скачивание файлов из storage
│   ├── google-drive/         # files, folders, download, import-to-video, sync
│   ├── health.get.ts         # Health-check
│   ├── ideas/                # CRUD + reanalyze + sync + to-scenario
│   ├── import.post.ts        # Импорт данных
│   ├── indigo/               # 36 endpoint: profiles, sessions, cookies, sync, cleanup
│   ├── pipelines/            # 47 endpoint: CRUD + runs + versions + schedule + webhook + credentials
│   ├── posting-jobs/         # Очередь постинга
│   ├── proxies/              # CRUD + check + diagnose + reveal
│   ├── references/           # Список референсов
│   ├── scenarios/            # 23 endpoint: CRUD + critic + rework + feedback + profiles
│   ├── social/               # OAuth connect/callback (TikTok/YouTube/Instagram)
│   ├── subtitles/            # keywords, presets
│   ├── taxonomy/             # Управление таксономиями
│   ├── trends/               # CRUD + analyze + stats
│   ├── trendwatcher/         # Профили парсинга + runs
│   ├── uploads/              # CRUD + retry + attempts + module-status
│   ├── videos/               # 25 endpoint: CRUD + generate + progress + steps + captions + variants
│   ├── warmup/               # keywords + sessions + accounts schedule
│   ├── webhooks/[token].ts   # Universal endpoint для pipeline webhook
│   ├── zavod/                # Health + ideas для inter-service (через ZAVOD_API_KEY)
│   └── _test/                # login, cleanup, analyze-creative-video (только NODE_ENV=test)
│
├── utils/                    # 66 модулей серверной логики
│   ├── prisma.ts             # Prisma client (singleton)
│   ├── rbac.ts               # getAuthContext, requirePermission, requireScopedAccess
│   ├── rbac-presets.ts       # Конфигурация ролей (preset → 8 флагов)
│   ├── crypto.ts             # AES-256-GCM шифрование секретов
│   ├── secret-access.ts      # decryptSecret + audit-log
│   ├── marketingcamp.ts      # Клиент к MC (validate-external, sync)
│   ├── requireZavodAuth.ts   # ZAVOD_API_KEY guard
│   ├── paid-guard.ts         # ENABLE_PAID_APIS guard
│   ├── social-guard.ts       # ENABLE_SOCIAL_POSTING guard
│   ├── anthropic.ts          # Claude API клиент + mock fixtures
│   ├── fal.ts                # fal.ai клиент (images, videos, TTS)
│   ├── mubert.ts             # Mubert music generation
│   ├── tts.ts                # TTS оркестратор
│   ├── apify-client.ts       # Apify scraper API
│   ├── render.ts             # ffmpeg обёртка
│   ├── video-metadata.ts     # ffprobe анализ
│   ├── lip-sync-runner.ts    # Lip-sync через external API
│   ├── subtitle-style.ts     # ASS-пайплайн субтитров
│   ├── video-pipeline.ts     # Главный pipeline executor для video
│   ├── video-pipeline-steps.ts
│   ├── video-pipeline-db.ts
│   ├── pipeline-engine.ts    # Universal pipeline executor (DAG)
│   ├── pipeline-graph.ts     # Топологическая сортировка узлов
│   ├── pipeline-runtime.ts   # Runtime для exec
│   ├── pipeline-validator.ts # Валидация конфига pipeline
│   ├── pipeline-executors.ts # Базовые экзекьюторы узлов
│   ├── pipeline-executors-extra.ts
│   ├── pipeline-sub-executor.ts
│   ├── pipeline-rate-limiter.ts
│   ├── pipeline-cancel-registry.ts
│   ├── pipeline-code-worker.ts  # Sandboxed Code node
│   ├── pipeline-credentials.ts  # Зашифрованные креды для нод
│   ├── pipeline-video-analyzer.ts
│   ├── pipeline-drive-scanner.ts
│   ├── pipeline-drive-uploader.ts
│   ├── trend-helpers.ts
│   ├── trendwatcher-runner.ts
│   ├── reference-pipeline.ts # yt-dlp → frames → whisper → claude
│   ├── transcript-extractor.ts
│   ├── video-content-analyzer.ts
│   ├── video-helpers.ts
│   ├── video-cost.ts
│   ├── video-models.ts
│   ├── ai-pricing.ts
│   ├── ai-audit.ts           # AiAuditLog логгер
│   ├── agent-logger.ts       # AgentLog логгер
│   ├── feedback-loop.ts      # Critic→Rework loop
│   ├── scenario-critic-orchestrator.ts
│   ├── story-video-planner.ts # Сценарий → storyboard
│   ├── idea-pipeline.ts
│   ├── idea-sync.ts          # Sync с MarketingCamp
│   ├── upload-pipeline.ts    # Загрузка на платформы
│   ├── metrics-collector.ts  # Сбор метрик публикаций
│   ├── account-metrics-mapper.ts
│   ├── account-metrics-serialize.ts
│   ├── account-style-context.ts
│   ├── analytics-ai.ts
│   ├── admin-log-aggregator.ts # Унификация 8 источников
│   ├── caption-limits.ts     # Per-platform лимиты
│   ├── cron-parser.ts
│   ├── cycle-orchestrator.ts
│   ├── expression-evaluator.ts # Safe expression evaluator
│   ├── external-call.ts      # HTTP-обёртка с retry
│   ├── storage-paths.ts      # GCS path builder + PrefixGuard
│   ├── app-context.ts
│   ├── app-enrichment-pipeline.ts
│   └── app-store-parser.ts   # Парсер метаданных приложений
│
├── automation/               # Browser automation (Indigo CDP)
│   ├── poster-runner.ts      # FSM PostingJob worker
│   ├── login-status.ts       # Проверка входа в соцсети
│   ├── video-fetcher.ts      # Скачивание видео для постинга
│   ├── screenshot-uploader.ts # Скриншоты публикаций
│   ├── poc-tiktok-post.ts    # PoC TikTok публикация
│   └── posters/              # Per-platform posters
│       ├── types.ts          # Общие типы posters
│       ├── tiktok-poster.ts
│       ├── youtube-poster.ts
│       └── instagram-poster.ts
│
└── plugins/                  # 6 server plugins (Nitro)
    ├── scheduler.ts                  # Upload + metrics + cycle ticks
    ├── trendwatcher-scheduler.ts     # Тренды Apify по расписанию
    ├── pipeline-scheduler.ts         # Pipeline cron
    ├── telegram.ts                   # Telegram bot polling
    ├── storage-init.ts               # GCS bucket warmup
    └── bigint-serializer.ts          # JSON.stringify для BigInt
```

---

## `shared/` — Общие типы

```
shared/
└── types/                    # 31 TypeScript файл с типами
    ├── trend.ts              # Trend, TrendPlatform, TrendSource
    ├── scenario.ts           # Scenario, ScenarioBlock, ScenarioStatus
    ├── video.ts              # Video, VideoStatus, VideoStep, VideoProgress
    ├── video-analysis.ts
    ├── video-runtime.ts
    ├── upload.ts             # Upload, UploadStatus, UploadProgress
    ├── idea.ts               # Idea, IdeaStatus
    ├── reference.ts          # Reference, ReferenceStatus
    ├── analytics.ts          # AnalyticsEvent, EventCategory
    ├── account-diagnostic.ts # AccountDiagnosticResult
    ├── account-metrics.ts    # AccountMetrics
    ├── account-style.ts      # AccountStyle, StyleProfile
    ├── accounts-health.ts    # AccountHealth, HealthStatus
    ├── admin-log.ts          # AdminLogEntry, AdminLogSource
    ├── agents.ts             # AgentCall, AgentResponse
    ├── app.ts                # AppConfig, AppStatus
    ├── auth.d.ts             # ambient types для nuxt-auth-utils
    ├── caption.ts            # Caption, CaptionFormat
    ├── deep-proxy-check.ts
    ├── favorite-prompt.ts
    ├── indigo.ts             # IndigoProfile, IndigoSession
    ├── kling-pattern.ts      # Kling video patterns
    ├── login-check.ts        # LoginCheckResult
    ├── pipeline-subtitle-config.ts
    ├── pipeline.ts           # Pipeline, PipelineStep, PipelineStatus
    ├── posting-job.ts        # PostingJob, PostingJobStatus
    ├── proxy.ts              # Proxy, ProxyType, ProxyStatus
    ├── story.ts              # Story, StoryElement
    ├── subtitle-preset.ts    # SubtitlePreset, SubtitleRenderer
    ├── warmup.ts             # WarmupSession, WarmupAction
    └── workflow.ts           # Workflow, WorkflowNode, WorkflowEdge
```

---

## `prisma/`

```
prisma/
├── schema.prisma             # Единая схема (75+ моделей, 40+ enum)
└── migrations/               # 89 миграций
    ├── 20260331130814_init_schema/
    ├── 20260331133711_add_video_models/
    ├── ...
    └── 20260522120000_add_login_check_and_posting_diagnostics/
```

---

## `tests/`

```
tests/
├── setup.ts                  # dotenv + TRUNCATE afterEach + DB safety
├── global-setup.ts           # prisma migrate deploy (1 раз)
├── helpers/
│   ├── auth.ts               # createTestUser + authHeaders
│   ├── api.ts                # обёртки над $fetch
│   ├── factories.ts          # Factory для ZavodUser, App, Proxy, SocialAccount
│   ├── nuxt-env.ts           # env-объект для setup({ server: true })
│   └── test-crypto.ts        # testEncrypt() — тот же AES-256-GCM
├── unit/                     # Node-env, чистая логика
├── integration/              # Nuxt env + Prisma + Nitro
├── api/                      # Contract HTTP-тесты
├── e2e/                      # Playwright (вне Vitest)
└── visual/                   # Visual audit screenshots (по дате)
    └── screenshots/{YYYY-MM-DD}/
```

---

## `scripts/`

```
scripts/
├── seed-warmup-keywords.ts          # Глобальные WarmupKeywordPool
├── seed-caption-audit.ts            # Сид для visual audit Caption Generator
├── seed-drive-pipeline-template.ts  # Draft Pipeline Drive→Analyzer→Caption→Upload
├── seed-drive-audit.ts              # Сид для Drive Auto-Caption audit
└── seed-admin-logs-demo.ts          # Demo-данные для /admin/logs visual testing
```

---

## `.claude/`

```
.claude/
├── agents/                   # 7 агентов команды
│   ├── architect.md          # Планировщик
│   ├── implementer.md        # Реализатор кода
│   ├── critic.md             # Аудитор качества
│   ├── tester.md             # Финальный тестировщик
│   ├── researcher.md         # Поиск решений и аналогов
│   ├── stylist.md            # Адаптация стилей под темы
│   └── analyzer.md           # Мета-анализ команды
│
├── skills/                   # 10 скиллов
│   ├── web-dev/SKILL.md      # Правила стека и подходы
│   ├── daisyUI/SKILL.md      # Полный llms.txt DaisyUI 5
│   ├── daisyui-v5/SKILL.md   # Альтернатива с component refs
│   ├── tailwind-4-docs/SKILL.md
│   ├── commit/SKILL.md       # Стиль коммитов
│   ├── visual-audit/SKILL.md # Playwright MCP визуальный аудит
│   ├── webapp-testing/SKILL.md # Python Playwright
│   ├── webapp-testing-extended/SKILL.md # Vitest+Playwright+supertest
│   ├── frontend-design/SKILL.md
│   └── skill-creator/SKILL.md
│
└── agent-memory/             # История работы агентов
    ├── architect/MEMORY.md   # Планы и архитектурные решения
    ├── tester/MEMORY.md      # Лента изменений (per-feature reports)
    ├── critic/MEMORY.md      # Лента критики (если есть)
    └── analyzer/ERRORS.md    # Документация системных ошибок
```

---

## `docs/`

```
docs/
├── ZAVODCAMP_STATUS/         # Этот документ
│   ├── README.md
│   ├── 01-overview.md
│   ├── ...
│   └── CHANGELOG.md
├── SPEC.md                   # Базовое ТЗ (14 KB)
├── PIPELINE_SPEC.md          # Pipeline-движок (72 KB)
├── accounts-feature.md       # Модуль аккаунтов (34 KB)
├── indigo-code-state.md      # Indigo-интеграция (32 KB)
├── proxy-history.md          # История прокси (68 KB)
├── COMPLIANCE.md             # Соответствие требованиям (8 KB)
├── SUBTITLE_PRESETS.md       # Пресеты субтитров (8 KB)
├── architecture/             # Документы по архитектуре
├── promts/                   # Промт-инженерия
└── research/                 # Исследовательские материалы
```

---

## Конвенции именования

| Тип | Конвенция | Пример |
|-----|-----------|--------|
| Vue компонент | PascalCase | `TrendCard.vue`, `PipelineCanvas.vue` |
| Composable | camelCase с префиксом `use` | `useTrends.ts`, `useAccountMetrics.ts` |
| Pinia store | camelCase + суффикс `Filters`/`Editor`/`Monitor` | `trendFilters.ts`, `pipelineEditor.ts` |
| API endpoint | `{path}.{method}.ts` | `index.get.ts`, `[id].put.ts`, `check-login.post.ts` |
| Server util | kebab-case | `pipeline-engine.ts`, `secret-access.ts` |
| Тип | kebab-case файл, PascalCase тип | `login-check.ts` → `LoginCheckResult` |
| Тест | `{feature}-{aspect}.spec.ts` | `proxies-security.spec.ts` |
| Миграция Prisma | `{YYYYMMDDHHmmss}_{snake_case_name}/` | `20260521120000_account_manual_creation/` |
| Памятка агента | `{feature}_{verb}.md` в папке агента | `posting_automation_d_plan.md` |

---

## Auto-imports (Nuxt 3+)

Благодаря структуре `app/composables/`, `app/components/`, `app/stores/`:

| Что | Где | Как используется |
|-----|-----|-----------------|
| Composables | `app/composables/*.ts` | `useTrends()` — без явного import |
| Components | `app/components/**/*.vue` | `<TrendCard />` — PascalCase в шаблоне |
| Stores | `app/stores/*.ts` | `useTrendFiltersStore()` |
| Utils | `app/utils/*.ts` | `imageFallback()` |
| Layouts | `app/layouts/*.vue` | `definePageMeta({ layout: 'auth' })` |

Server-side auto-imports работают для всего внутри `server/utils/`.

Shared types из `shared/types/` импортируются явно: `import type { Trend } from '~~/shared/types/trend'`.
