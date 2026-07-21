# ZavodCamp — Полное обследование проекта

> Дата аудита: 2026-05-05
> Платформа: Nuxt 4 + Vue 3 + Prisma 7 + PostgreSQL + Tailwind 4 + DaisyUI 5
> Назначение: No-Code платформа для автоматизации видеоконтента, трендов и **публикации в соцсети с антидетект-инфраструктурой** (proxy/Indigo/warming/uniqification)

---

## Оглавление

- [1. Дерево файлов проекта](#1-дерево-файлов-проекта)
- [2. Корневые конфиг-файлы](#2-корневые-конфиг-файлы)
- [3. База данных (Prisma)](#3-база-данных-prisma)
- [4. Серверная часть (server/)](#4-серверная-часть-server)
  - [4.1. Утилиты и сервисы](#41-утилиты-и-сервисы)
  - [4.2. AI-агенты](#42-ai-агенты)
  - [4.3. Внешние API-клиенты](#43-внешние-api-клиенты)
  - [4.4. Pipeline Engine](#44-pipeline-engine)
  - [4.5. Видео-генерация](#45-видео-генерация)
  - [4.6. Загрузка в соцсети](#46-загрузка-в-соцсети)
  - [4.7. Trendwatcher](#47-trendwatcher)
  - [4.8. Telegram](#48-telegram)
  - [4.9. Серверные плагины](#49-серверные-плагины)
  - [4.10. API Endpoints](#410-api-endpoints)
- [5. Фронтенд (app/)](#5-фронтенд-app)
  - [5.1. Layouts](#51-layouts)
  - [5.2. Middleware](#52-middleware)
  - [5.3. Plugins](#53-plugins)
  - [5.4. Pages](#54-pages)
  - [5.5. Components](#55-components)
  - [5.6. Composables](#56-composables)
  - [5.7. Stores (Pinia)](#57-stores-pinia)
  - [5.8. Utils](#58-utils)
  - [5.9. Assets](#59-assets)
- [6. Shared (shared/)](#6-shared-shared)
  - [6.1. Types](#61-types)
  - [6.2. Utils](#62-utils)
- [7. Агентная команда (.claude/)](#7-агентная-команда-claude)
- [8. Документация (docs/)](#8-документация-docs)
- [9. Прочее](#9-прочее)
- [10. Интеграция fal.ai](#10-интеграция-falai)
- [11. Хроника изменений 2026-04-16 → 2026-04-25](#11-хроника-изменений-2026-04-16--2026-04-25)
- [12. Хроника изменений 2026-04-25 → 2026-05-05](#12-хроника-изменений-2026-04-25--2026-05-05) ⭐ NEW
- [13. Social Automation Stack](#13-social-automation-stack) ⭐ NEW
- [14. Тестовая инфраструктура и Mock-режим](#14-тестовая-инфраструктура-и-mock-режим) ⭐ NEW
- [15. Сводная статистика](#15-сводная-статистика)

---

## 1. Дерево файлов проекта

```
ZavodCamp/
├── bun.lock
├── CLAUDE.md
├── PROJECT_AUDIT.md
├── PIPELINE_ANALYSIS.md
├── README.md
├── llms.txt
├── nuxt.config.ts
├── package.json
├── prisma.config.ts
├── tsconfig.json
├── skills-lock.json
├── playwright.config.ts             # ⭐ 4 viewport projects (1920/1280/768/375), порт 3100
├── vitest.config.ts                 # ⭐ singleThread, alias под Nuxt
├── .env / .env.example / .env.test  # ⭐ .env.test для test-инфраструктуры
├── .gitignore                       # ⭐ !.env.test.example, screens/, tests/visual/screenshots
│
├── app/
│   ├── assets/css/main.css
│   ├── components/                  # 208 .vue компонентов (+12)
│   │   ├── account/                 # 13 (+7): AccountCard, AccountConnectButton, AccountGroupCard,
│   │   │                            #     AccountGroupEditModal, AccountStyleProfileEditor,
│   │   │                            #     AccountStyleStatusBadge,
│   │   │                            #     ⭐ AccountCredentialRevealModal, AccountCredentialsForm,
│   │   │                            #     ⭐ AccountEditModal, AccountIndigoTab, AccountPicker,
│   │   │                            #     ⭐ AccountProxyPicker, AccountWarmupTab
│   │   ├── admin/                   # 18 (+4) + telegram/7:
│   │   │                            #     AppCard, AppDeleteConfirmModal, AppForm,
│   │   │                            #     ⭐ AppAccountsManager, AppReferenceImagesManager,
│   │   │                            #     AppReferenceImagesModal,
│   │   │                            #     CycleCard, CycleStartModal, DashboardAlerts/Status/Recent/Video,
│   │   │                            #     LogEntry, LogFilters, UserCard, UserRoleEditor,
│   │   │                            #     ⭐ AccountCompletenessBar, AccountsHealthByPlatform,
│   │   │                            #     ⭐ AccountsHealthSummary, AccountsHealthTable
│   │   │   └── telegram/            # 7
│   │   ├── analytics/               # 7
│   │   ├── creative/                # 2
│   │   ├── favorite-prompt/         # 4
│   │   ├── idea/                    # 10
│   │   ├── ⭐ indigo/                # 6: IndigoCredentialsModal, IndigoProfileCard,
│   │   │                            #     IndigoProfileEditModal, IndigoProfileLinkModal,
│   │   │                            #     IndigoSessionStatusBadge, IndigoSyncStatusBadge
│   │   ├── pipeline/                # 30 + config/ + monitor/
│   │   │   ├── config/              # 18
│   │   │   │   └── trendwatcher/    # 5
│   │   │   └── monitor/             # 11
│   │   ├── ⭐ posting/               # 5: PostingJobCancelModal, PostingJobCard,
│   │   │                            #     PostingJobLogsModal, PostingJobRetryConfirm,
│   │   │                            #     PostingJobStatusBadge
│   │   ├── ⭐ proxy/                 # 5: ProxyAddModal, ProxyCard,
│   │   │                            #     ProxyCheckHistoryModal, ProxyHealthBadge,
│   │   │                            #     ProxyRevealCredentialsModal
│   │   ├── reference/               # 1
│   │   ├── scenario/                # 12
│   │   ├── settings/                # 1
│   │   ├── shared/                  # 10
│   │   ├── trend/                   # 17
│   │   ├── upload/                  # 6
│   │   ├── video/                   # 14 (+3): + ⭐ VideoSubtitlePresetCard,
│   │   │                            #     ⭐ VideoSubtitlePresetPicker, ⭐ VideoUniqueVariantsSection
│   │   └── ⭐ warmup/                # 6: WarmupActionList, WarmupKeywordPoolCard,
│   │                                #     WarmupKeywordPoolEditor, WarmupPlanPreviewModal,
│   │                                #     WarmupSessionCard, WarmupSessionStatusBadge
│   ├── composables/                 # 69 файлов (+14, см. раздел 5.6)
│   ├── layouts/                     # 2: auth.vue, default.vue
│   ├── middleware/                  # 3
│   ├── pages/                       # 38 маршрутов (+7, см. раздел 5.4)
│   ├── plugins/                     # 1: auth-redirect.client.ts
│   ├── stores/                      # 15 файлов (+4, см. раздел 5.7)
│   └── utils/                       # 4
│
├── server/
│   ├── api/                         # 261 endpoint (+50, см. раздел 4.10)
│   │   ├── _test/                   # ⭐ login, cleanup (тройной гейт NODE_ENV+TEST_AUTH_BYPASS+x-test-auth-token)
│   │   ├── proxies/                 # ⭐ CRUD + check + check-all + reveal + checks
│   │   ├── indigo/                  # ⭐ profiles CRUD + start/stop + link/unlink + sync + credentials
│   │   ├── posting-jobs/            # ⭐ CRUD + retry + cancel + logs + stats
│   │   └── warmup/                  # ⭐ accounts/preview/schedule/sessions, keywords CRUD
│   ├── plugins/                     # 4 (все с SCHEDULERS_ENABLED gate)
│   ├── ⭐ __mocks__/                 # standalone mock-серверы (proxy:18888, indigo:35001)
│   ├── ⭐ __fixtures__/agents/       # 7 happy-фикстур для Anthropic mock
│   ├── ⭐ automation/                # watchdog для idea-анализа
│   └── utils/                       # ~80 файлов (+~20, см. раздел 4.1)
│       ├── agents/                  # 25 AI-агентов (+7)
│       ├── ⭐ proxy/                 # alert-dedup, dto, probe, proxy-checker
│       ├── ⭐ indigo/                # client, credentials, dto, rate-limiter, sync, token-manager, types
│       ├── ⭐ posting/               # error-classifier, job-service, runner-mock, state-machine, worker
│       ├── ⭐ warmup/                # 9 модулей: rng, distributions, comment-pool, age-classifier,
│       │                            #     planner, keyword-pool, session-service, dto, validation
│       ├── ⭐ mock/                  # mode, fixture-loader, anthropic-mock, fal-mock
│       ├── ⭐ video-uniqifier/       # ffmpeg, index, params, service
│       ├── ⭐ video-prompts/         # 8 модулей декомпозиции generateSceneImagePrompts
│       ├── ⭐ subtitles/             # ass-builder/, font-resolver, preset-registry, render-ass, word-timings
│       ├── ⭐ video-tools/           # ffmpeg, subtitle-parsers, yt-dlp
│       ├── social/                  # factory, instagram, oauth-config, tiktok, types, youtube
│       └── telegram/                # alerts, analyzer, bot, cmd-cycle, commands, messaging, variable-registry
│
├── shared/
│   ├── types/                       # 24 файла (+8, см. раздел 6.1)
│   └── utils/                       # 8 файлов (+2)
│
├── prisma/
│   ├── schema.prisma                # 1866 строк (+453), 59 моделей (+23), 40 enum (+10)
│   └── migrations/                  # 71 миграция (+13, см. раздел 3)
│
├── ⭐ tests/                         # vitest + @nuxt/test-utils + Playwright
│   ├── api/                         # API contract тесты (proxies-crud, proxies-security, accounts-credentials-security)
│   ├── e2e/                         # Playwright spec'и (auth, proxy-lifecycle, account-setup, mobile-navigation, settings, smoke)
│   ├── unit/                        # smoke
│   ├── integration/                 # auth-bypass, db
│   ├── helpers/                     # auth, api, factories, playwright, e2e-setup, nuxt-env, test-crypto
│   ├── visual/                      # отчёты visual-audit (screenshots в .gitignore)
│   ├── setup.ts                     # safety guard на :5436 + db name 'tests'
│   └── global-setup.ts              # одноразовая prisma migrate deploy
│
├── ⭐ scripts/                       # 11 ts-скриптов
│   ├── backfill-favorite-prompt-patterns.ts
│   ├── generate-subtitle-samples.ts
│   ├── normalize-video-subtitles-style.ts
│   ├── seed-warmup-keywords.ts
│   ├── test-alert-dedup.ts
│   ├── test-indigo-mock.ts
│   ├── test-mock-mode.ts
│   ├── test-posting-state-machine.ts
│   ├── test-proxy-checker.ts
│   ├── test-uniqifier.ts
│   └── test-warmup-planner.ts
│
├── docs/
│   ├── PIPELINE_SPEC.md
│   ├── SPEC.md
│   ├── COMPLIANCE.md                # ⭐ Управление ENCRYPTION_KEY, инцидент-уровень high
│   └── architecture/
│       └── social_automation.md     # ⭐ Setup, Mock Development, Track F uniqification, итерация 2 Indigo
│
├── public/
│   ├── favicon.ico
│   └── robots.txt
│
├── storage/
│   ├── fonts/                       # ⭐ Anton/Montserrat-Bold/Black/Inter-Bold (OFL) для ASS-субтитров
│   └── uploads/
│       ├── app-references/          # картинки-референсы приложений (SHA1 dedup)
│       ├── assets/                  # промежуточные ассеты per-видео
│       │   └── _mock_cache/         # ⭐ placeholder MP4/MP3/PNG для FAL_MOCK_MODE
│       ├── videos/                  # готовые финальные видео
│       └── unique/                  # ⭐ per-platform уникализированные варианты
│
├── generated/prisma/                # сгенерированный клиент (gitignored)
│
└── .claude/
    ├── agents/                      # 7 агентов
    ├── skills/                      # 10 скиллов: + ⭐ visual-audit, ⭐ webapp-testing-extended
    └── agent-memory/                # память агентов (см. раздел 7)
```

---

## 2. Корневые конфиг-файлы

### `nuxt.config.ts`

- `compatibilityDate: "2025-07-15"`
- `devtools: { enabled: true }`
- `css: ["./app/assets/css/main.css"]`
- `vite.plugins: [tailwindcss()]`
- `colorMode: { storage: "cookie", preference: "bumblebee" }`
- Modules: `nuxt-auth-utils`, `@pinia/nuxt`, `@nuxt/icon`, `@vueuse/motion`, `@nuxtjs/color-mode`
- `runtimeConfig`:
  - **AI**: `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL=claude-sonnet-4-20250514`, `ANTHROPIC_HAIKU_MODEL=claude-haiku-4-5-20251001`
  - **Медиа**: `FAL_KEY`, `MUBERT_KEY`, `ELEVENLABS_API_KEY`, `DEFAULT_TTS_MODEL_ID=fal-ai/kokoro/american-english`, `DEFAULT_TTS_VOICE_EN=af_heart`, `DEFAULT_TTS_VOICE_RU=bf_emma`
  - **Гейты**: `ENABLE_PAID_APIS`, `ENABLE_SOCIAL_POSTING`
  - **Безопасность**: `ENCRYPTION_KEY` (64-hex для шифрования OAuth-токенов и pipeline credentials)
  - **OAuth соцсетей**: `YOUTUBE_CLIENT_ID/SECRET`, `TIKTOK_CLIENT_KEY/SECRET`, `INSTAGRAM_APP_ID/SECRET`
  - **Боты**: `TELEGRAM_BOT_TOKEN`
  - **Парсеры**: `APIFY_TOKEN`
  - **MarketingCamp ↔ ZavodCamp**: `MARKETING_CAMP_URL`, `INTER_SERVICE_API_KEY`, `ZAVOD_API_KEY`
  - **Пороги**: `REFERENCE_THRESHOLD_VIEWS`, `REFERENCE_THRESHOLD_WATCH_THROUGH`
  - **Планировщики (мс)**: `SCHEDULER_UPLOAD_INTERVAL_MS`, `SCHEDULER_METRICS_INTERVAL_MS`, `SCHEDULER_CYCLE_CHECK_INTERVAL_MS`

### `package.json`

**Scripts:**
- Базовые: `dev`, `build`, `generate`, `preview`, `postinstall`
- ⭐ Mock-серверы: `mock:proxy` (порт 18888), `mock:indigo` (порт 35001), `mock:all`
- ⭐ Seed/тесты доменов: `seed:warmup`, `test:warmup`, `test:uniqifier`
- ⭐ Vitest: `test`, `test:watch`, `test:ui`, `test:unit`, `test:integration`, `test:api`
- ⭐ Playwright: `test:e2e`, `test:e2e:ui`, `test:e2e:install`
- ⭐ Тестовая БД: `test:db:migrate`, `test:db:reset` (через `.env.test`, защита от прода)

**Главные dependencies:**
- `nuxt ^4.4.2`, `vue ^3.5.30`, `vue-router ^5.0.4`
- `@pinia/nuxt 0.11.3`, `nuxt-auth-utils 0.5.29`
- `@prisma/client ^7.4.2`, `@prisma/adapter-pg ^7.4.2`, `pg ^8.19.0`
- `tailwindcss ^4.2.1`, `@tailwindcss/vite ^4.2.1`, `daisyui ^5.5.19` (devDependency)
- `@nuxt/icon 2.2.1`, `@iconify-json/mingcute ^1.2.7`
- `@vue-flow/core ^1.48.2`, `@vue-flow/minimap ^1.5.4` — граф-визуализация конвейеров
- `@formkit/auto-animate ^0.9.0`, `@vueuse/motion ^3.0.3`, `vue-draggable-plus ^0.6.1`
- `fluent-ffmpeg ^2.1.3` — обработка видео и сборка
- `isomorphic-dompurify ^3.8.0`, `marked ^17.0.4` — безопасный markdown
- `@nuxtjs/color-mode` — темы
- ⭐ `https-proxy-agent ^9`, `http-proxy-agent ^9`, `socks-proxy-agent ^10` — proxy-чекер
- ⭐ `youtube-dl-exec ^3.1.5` — yt-dlp для analyze-reference Idea pipeline

**DevDependencies:** `prisma ^7.4.2`, `tsx ^4.21.0`, `dotenv ^17.3.1`, `@types/fluent-ffmpeg`, `@types/pg`, ⭐ `vitest ^2`, `@nuxt/test-utils ^3`, `@playwright/test ^1`, `supertest ^7`, `happy-dom`

### `tsconfig.json`

Использует Nuxt-сгенерированные конфиги: `.nuxt/tsconfig.app.json`, `.nuxt/tsconfig.server.json`, `.nuxt/tsconfig.shared.json`, `.nuxt/tsconfig.node.json`.

### `prisma.config.ts`

Минимальный конфиг — точки расширения Prisma 7.

### `.env.example`

Содержит шаблоны для всех переменных окружения, включая `DATABASE_URL=postgresql://user:password@localhost:5432/zavodcamp`, `NUXT_SESSION_PASSWORD`, `MARKETING_CAMP_URL`, `INTER_SERVICE_API_KEY`, `ZAVOD_API_KEY`, `FAL_KEY`, `MUBERT_KEY`, `ENABLE_PAID_APIS`, `ENABLE_SOCIAL_POSTING`, `ENCRYPTION_KEY`, OAuth-ключи, `TELEGRAM_BOT_TOKEN`, `APIFY_TOKEN`, пороги и интервалы планировщика.

### `CLAUDE.md`

Центральный системный документ проекта на русском. Источник для голосовых команд (триггер `commit`-скилла), правил декомпозиции (никаких файлов 1000+ строк) и явный запрет на `prisma db push`. Указывает источники актуального контекста: `docs/SPEC.md`, `.claude/agent-memory/tester/MEMORY.md`, `.claude/skills/web-dev/SKILL.md`.

### `README.md`, `PIPELINE_ANALYSIS.md`, `llms.txt`

Сводное описание проекта, разбор внутреннего pipeline-движка и текстовый дамп для LLM-инструментов соответственно.

### `skills-lock.json`

Залоченные версии установленных Claude-скиллов.

---

## 3. База данных (Prisma)

### Схема (`prisma/schema.prisma`) — 1866 строк, 59 моделей, 40 enum

#### Enum-типы (40)

| Enum | Значения |
|------|----------|
| `RolePreset` | admin, producer, operator, analyst, observer |
| `TrendStatus` | new, reviewed, in_work, completed, dismissed |
| `Platform` | tiktok, instagram, youtube |
| `AccountStatus` | active, expired, revoked |
| ⭐ `ProxyType` | datacenter, residential, mobile |
| ⭐ `ProxyProtocol` | http, https, socks5 |
| ⭐ `ProxyStatus` | active, dead, leak, auth_failed, expired, unverified |
| ⭐ `WarmupStatus` | not_started, in_progress, completed, paused |
| ⭐ `WarmupSessionStatus` | planned, running, completed, failed, cancelled |
| ⭐ `RegistrationSource` | manual, automated, indigo, third_party |
| `CycleStatus` | pending, running, completed, failed, stopped |
| `AgentLogLevel` | info, warn, error |
| `UploadStatus` | pending, uploading, published, failed, scheduled, canceled, blocked_by_env |
| `PostStatus` | active, deleted, blocked |
| `AnalysisStatus` | none, pending, running, completed, failed |
| `VideoStatus` | pending, configuring, generating_prompts, generating_images, generating_clips, generating_voiceover, generating_music, assembling, completed, failed, timeout, canceled |
| `VideoStepKey` | prompt_generation, image_generation, clip_generation, voiceover_generation, music_generation, **lip_sync_generation** ⭐, assembly |
| `VideoStepStatus` | pending, queued, running, completed, failed, timeout, canceled, skipped |
| `VideoFormat` | portrait, landscape |
| `AssetType` | image, clip, music, voiceover, voiceover_mix |
| `ScenarioStatus` | draft, generating, generated, selected, rejected, needs_rework, archived |
| `VariantStatus` | draft, accepted, rejected, needs_rework, superseded |
| `ReviewActionType` | accept, reject, rework, regenerate, delete_scenario, delete_variant, copy, regenerate_block |
| ⭐ `IndigoSyncStatus` | synced, local_only, remote_only, conflict, deleted_remote, error |
| `PipelineStatus` | active, inactive |
| `RunStatus` | pending, running, success, failed, cancelled, no_data |
| `StepStatus` | pending, running, success, partial, no_data, failed, skipped, cancelled, blocked, waiting |
| `TriggerType` | manual, schedule, webhook |
| `TrendwatcherRunStatus` | pending, starting, running, importing, analyzing, completed, failed, canceled, partially_completed |
| `TrendwatcherTriggerType` | manual, scheduled, pipeline |
| `CredentialType` | api_key, bearer_token, basic_auth, oauth2, custom |
| `TaxonomyType` | strategy, hook_style, prompt_pattern, pipeline_category, ⭐ `kling_pattern` |
| `IdeaSource` | manual, telegram, pipeline, marketingcamp |
| `SyncStatus` | none, synced, pending_export, pending_import, conflict, error |
| `SyncDirection` | local, imported, exported, bidirectional |
| `IdeaStatus` | pending, processing, ready, in_work, completed, failed |
| `IdeaActionType` | create, edit, delete, restore, reanalyze, send_to_scenario |
| `TelegramDeliveryStatus` | pending, sent, failed |
| ⭐ `PostingJobStatus` | pending, preparing, in_progress, awaiting_proxy, retry_queued, succeeded, failed, cancelled |
| ⭐ `PostingErrorCategory` | proxy_dead, proxy_leak, captcha, account_banned, network_error, rate_limit, validation, unknown |

#### Модели по доменам

##### Пользователи и права

- **`ZavodUser`** (id, externalId, email, name, surname, rolePreset, canRead/Write/Create/Delete/Approve/RunAgent/ApplyChanges/Admin, moduleAccess[], appAccess[], telegramChatId, isActive, lastLoginAt). Связи: favoritePrompts[]

##### Приложения и обогащение

- **`App`** — главная сущность приложения с расширенным контекстом для AI:
  - Базовые: name, description, keywords[], geo, language
  - Store: appStoreUrl, playStoreUrl, storePlatforms[]
  - Метаданные магазина: productName, subtitle, longDescription, developer, categories[], targetAudience, pricingNotes, iconUrl, screenshotUrls[], heroImageUrl
  - **`referenceImageUrls[]`** ⭐ — пользовательские картинки-референсы (загрузка через multipart, SHA1 dedup в storage)
  - AI-контекст: featureBullets[], asoKeywords[], onboardingSummary, aiSummary, brandTone, visualCues, forbiddenClaims[], riskyClaims[], creativeAngles, transformationPromise, corePain, coreOutcome, scenarioContext
  - Статус: enrichmentStatus, lastEnrichedAt, enrichmentError
- **`AppEnrichmentLog`** — история парсинга (sourceUrl, platform, status, rawPayload, parsedData, aiContext, errorMessage)
- **`AppReferenceImage`** ⭐ (appId, fileUrl, sha1, mimeType, byteSize, **`aiTags`** (controlled vocab из 23 тегов), **`aiCaption`**, **`aiHasUI`**, **`aiPrimaryAction`**, **`aiAnalyzedAt`**, **`aiAnalysisError`**) — backfill из `App.referenceImageUrls` через миграцию `app_reference_images_metadata`. screen-tagger-agent (Claude Vision Sonnet) гонит каждую загрузку fire-and-forget. Используется как image-to-video input для Kling через `fal-ai/kling-video/v2.1/standard/image-to-video`

##### Тренды и анализ

- **`Trend`** (externalId, appId?, platform, sourceUrl, title, description, authorName, thumbnailUrl, videoUrl, viewCount, likeCount, commentCount, shareCount, hashtags[], language, geo, keyword, publishedAt, status, analysisStatus, isDeleted, deletedAt, **`runId`** ⭐, **`pipelineId`** ⭐). Индексы: isDeleted+status, platform+isDeleted, language, geo, runId, pipelineId
- **`TrendInsight`** (trendId unique, whyViral, patterns[], hooks[], audience, confidence)
- **`CreativeBrief`** (trendId unique, hookAnalysis, sceneStructure, visualStyle, viralityReasons, frameAnalysisSettings, summary, modelVersion, promptVersion, confidence)

##### Сценарии и варианты

- **`Scenario`** (trendId, briefId?, appId?, profileId?, status, selectedVariantId?, generationStatus, operatorNotes, reworkRequest, sourceBriefVersion, sourcePromptVersion, isDeleted, **`runId`** ⭐, **`pipelineId`** ⭐). Связи: variants[], reviewActions[], videos[], feedbacks[]
- **`ScenarioVariant`** (scenarioId, variantIndex, status, title, hook, body, cta, fullScript, visualStyleText, visualStyleStructured, **`storyPlan`** ⭐ (JSON), toneProfile, rationale, promptVersion, agentVersion). Связи: blockRevisions[], visualStyleRevisions[], reviewActions[]
- **`ScenarioBlockRevision`** — построчная история правок блоков сценария
- **`VisualStyleRevision`** — история улучшений визуального стиля
- **`ScenarioReviewAction`** — журнал действий оператора (accept/reject/rework)
- **`ScenarioGenerationProfile`** ⭐ — сохраняемый профиль настроек генерации (правила стиля, протагонист, anti-loop)
- **`ScenarioFeedback`** ⭐ — отзывы операторов (scenarioId/videoId/uploadId, feedbackText, sentiment, derived requirements/recommendations, source)
- **`ScenarioMemory`** ⭐ — нейросетевая память с requirements/recommendations (scope=global/app/trend, version)

##### Видео и ассеты

- **`Video`** (scenarioId, variantId?, applicationId?, status, currentStep, format, filePath, fileUrl, duration, errorMessage, subtitlesEnabled, subtitlesStyle, subtitlePreset, **`voiceoverPlan`** ⭐, musicEnabled, musicMood, musicDuration, musicVolume, musicVolumeWithVoiceover, clipDuration, imageCount, renderQuality, targetPlatform, **`voiceoverEnabled`**, **`voiceoverProvider`**, **`voiceoverModelId`**, **`voiceoverVoiceId`**, **`voiceoverLanguage`**, **`voiceoverPacing`**, **`voiceoverReconciliation`**, imageModelId, videoModelId, modelStrategy, generateAudio, **`lipSyncEnabled`** ⭐, **`lipSyncModelId`** ⭐, isLocked, lockedAt, lockedReason, totalCostEstimate, totalCostActual, **`runId`** ⭐, **`pipelineId`** ⭐)
- **`VideoAsset`** (videoId, type, prompt, filePath, fileUrl, order, duration). Связь: favoritePromptsFromAsset[]
- **`VideoGenerationStep`** (videoId, stepKey, stepIndex, status, startedAt, finishedAt, inputSnapshot, outputSnapshot, artifacts, attemptCount, maxAttempts, estimatedCost, actualCost, logs, errorMessage, **`falRequestId`**, **`falEndpoint`**, **`falQueueStatus`**, **`falLogsSnapshot`**, **`falSubmittedAt`**, **`falCompletedAt`**, **`falCanceledAt`**, **`falWebhookReceivedAt`**, **`falResultUrl`**, **`falErrorCode`**, **`falAttemptGroupId`**, **`falSubKey`** ⭐). Индексы: videoId+stepKey, falRequestId, status

##### Загрузки и соцсети

- **`Upload`** (videoId, socialAccountId, ⭐ **`accountGroupId`** (FK SetNull), ⭐ **`dispatchMode`** (account/group), applicationId?, status, postStatus, publishMode, scheduledAt, platformPostId, platformPostUrl, title, description, hashtags[], idempotencyKey unique, errorMessage, blockedByEnv, attemptCount, lastAttemptAt, runId, pipelineId)
- **`SocialAccount`** ⭐ расширен: login (encrypted), password (encrypted), recoveryEmail (encrypted), twoFactorSecret (encrypted), notes, birthDate, registrationSource, **`proxyId`** (FK), **`indigoProfileId`** (FK), **`warmupStatus`**, totalPostsPublished, ⭐ **`lastPostedAt`** (для round-robin ротации)
- **`AccountGroup`** (appId, name, styleMode, stylePolicy Json, ⭐ **`dispatchMode`** (round_robin/all/first_active))
- **`AccountStyleProfile`** (socialAccountId unique, version, data Json, status). Связь: revisions[]
- **`AccountStyleRevision`** (profileId, version, changeType, changeSummary, changedSections[], previousData, newData, accepted, appliedById)
- **`AccountGroupMember`** (groupId, socialAccountId; unique pair)
- **`SocialUploadAttempt`** — попытки публикации в соцсети
- **`PostMetrics`** — метрики опубликованных постов
- **`Reference`** (uploadId unique, reason, aiAnalysis, addedAt) — референсные посты-образцы

##### Антидетект-инфраструктура (Social Automation) ⭐

- **`Proxy`** ⭐ (appId, type, **`protocol`** (http/https/socks5), host, portRaw (encrypted), username (encrypted), password (encrypted), expiresAt, status, consecutiveFailures, lastCheckedAt, lastIpDetected, leakDetectedAt, **`alertHistory`** Json (per-category дедуп: 24ч leak, 12ч auth, 7д expired)). Индексы: appId+status, status+lastCheckedAt
- **`ProxyHealthCheck`** ⭐ (proxyId, checkedAt, status, ipDetected, latencyMs, errorCategory, errorMessage)
- **`IndigoProfile`** ⭐ (workspaceId, indigoId unique, name, platformType, os, userAgent, language, timezone, **`config`** opaque Json snapshot, **`syncStatus`** (synced/local_only/remote_only/conflict/deleted_remote/error), proxyId? (FK), socialAccountId? (1:1 unique). Индексируемые denormalized поля name/platformType/os/userAgent/language/timezone
- **`SecretAccessLog`** ⭐ (userId, secretType, accountId?, proxyId?, fieldName, reason, ip, userAgent, accessedAt) — журнал каждого reveal/decrypt
- **`PostingJob`** ⭐ (uploadId? FK, accountId FK, platform, payload Json, status (см. PostingJobStatus), attemptCount, maxAttempts (default 3), retryAt, errorCategory, errorMessage, createdById, cancelledById (FK SetNull на ZavodUser), createdAt, startedAt, finishedAt). Композитный индекс status+retryAt для быстрого выбора retry_queued
- **`PostingJobLog`** ⭐ (jobId, level, message, payload, recordedAt) — структурированный лог попыток постинга
- **`WarmupSession`** ⭐ (accountId FK, dayKey unique-per-account, status, plannedActions Json, executedActions Json, startedAt, finishedAt, errorMessage). Дедуп по dayKey, 409 при повторе без replace=true
- **`WarmupKeywordPool`** ⭐ (vertical (tech/lifestyle/fitness/education/music), language, keywords[], comments[], appId? (опц. брендирование), isSystem). 7 default-pool через scripts/seed-warmup-keywords.ts
- **`VideoUniqueVariant`** ⭐ (videoId FK, platform (tiktok/youtube), paramsHash, fileHash, filePath, fileUrl, paramsJson Json, fileSizeBytes, durationSec). Unique constraint videoId+platform+paramsHash, детерминистический seed XorShift32 по seed `${videoId}:${platform}:v1`

##### Производственные циклы

- **`ProductionCycle`** (appId, groupId?, status, startedById, startedAt, completedAt, errorMessage, trendsFound, scenariosGen, videosGen, uploadsCount). Связь: logs[]
- **`AgentLog`** (cycleId?, module, level, message, details, resolved)

##### Идеи (с двусторонней синхронизацией)

- **`Idea`** (appId?, source, sourceUrl, platform, transcription, language, title, hook, body, cta, visualStyle, whyViral, status, analysisStatus, operatorNotes, tags[], isDeleted, deletedAt, sentToScenarioAt, errorMessage, mediaType, thumbnailUrl, **`referenceStatus`** ⭐, **`externalId` unique** ⭐, **`syncStatus`** ⭐, **`syncDirection`** ⭐, **`lastSyncedAt`** ⭐, **`lastSyncError`** ⭐, **`remoteSnapshot`** ⭐ Json, **`localDirty`** ⭐, **`runId`** ⭐, **`pipelineId`** ⭐)
- **`IdeaAnalysis`** (ideaId unique, hookAnalysis, sceneStructure, visualStyle, viralityReasons, summary, modelVersion, promptVersion, confidence, **`referenceBreakdown`** ⭐, **`referenceVersion`** ⭐)
- **`IdeaOperatorAction`** — журнал действий оператора над идеей

##### Конвейеры (Pipeline)

- **`Pipeline`** (userId, name, description, markdownDescription, icon, color, tags[], status, graphData Json, sharedWith[], webhookToken unique, webhookSecret, webhookEnabled, activeVersionId?, **`subtitleStyle`** ⭐, lastEditedAt). Связи: runs[], versions[], schedule?, webhookLogs[], scenarios[], trends[], videos[], uploads[], ideas[]
- **`PipelineTag`** (name unique)
- **`PipelineVersion`** (pipelineId, version, graphData, name, description, createdById, isDeployed)
- **`PipelineSchedule`** (pipelineId unique, cronExpr, timezone, enabled, lastRunAt, nextRunAt, lastRunStatus, missedRunCount)
- **`PipelineCredential`** (userId, name, type, encryptedData, metadata, description, expiresAt, lastUsedAt, lastTestedAt, lastTestStatus, revokedAt; unique userId+name)
- **`WebhookLog`** (pipelineId, runId?, sourceIp, userAgent, payload, statusCode, errorMsg)
- **`WorkflowRun`** (pipelineId, status, triggerType, triggeredBy?, graphSnapshot, graphVersionId, retryOfRunId?, replayOfRunId?, **`parentRunId`** ⭐ (защита от рекурсии), cancelRequestedAt, cancelRequestedBy, errorMessage, errorCategory). Связи: steps[], scenarios[], trends[], videos[], uploads[], ideas[]
- **`WorkflowStep`** (runId, nodeId, nodeName, nodeType, status, input, output, error, errorCategory, logs, attemptCount, retryPolicy, artifacts, startedAt, finishedAt, duration)

##### Trendwatcher

- **`TrendwatcherProfile`** (appId, name, actorId, keywords[], platforms[], language, geo, viewCountMin, viewCountMax, maxItems, enabled, scheduleEnabled, scheduleCron, scheduleTimezone, scheduleNextRunAt, scheduleLastRunAt, lastRunId?, lastSuccessfulRunAt, validationStatus, validationSummary, validatedAt, **`isInline`** ⭐, **`sourceNodeId`** ⭐, **`sourcePipelineId`** ⭐). Индексы: isInline, appId+isInline
- **`TrendwatcherRun`** (profileId, status, triggerType, externalRunId, sourceType, startedAt, completedAt, canceledAt, failureReason, errorCategory, errorStep, errorSummary, apifyStatus, apifyStatusMessage, canRetry, needsProfileFix, datasetId, foundCount, importedCount, analyzedCount, skippedCount, **`dedupSkipCount`** ⭐, **`viewCountSkipCount`** ⭐, **`warningCount`** ⭐, initiatedBy)
- **`TrendwatcherRunLog`** (runId, level, message, step, payload)

##### Telegram

- **`TelegramChat`** (chatId unique, userId, chatType, title, username, alertsEnabled, isAuthorized, routingTags[])
- **`TelegramMessageTemplate`** (key unique, title, category, messageBody, variablesSchema, isActive)
- **`TelegramDelivery`** (templateId?, eventType, relatedEntityType, relatedEntityId, targetChatId, status, telegramMessageId, errorMessage, messageText, sentAt)
- **`TelegramCommandAudit`** — журнал команд бота
- **`TelegramApiKey`** (key unique, label, isActive, expiresAt)

##### Таксономия и аудит

- **`TaxonomyItem`** (type, slug, name, shortDescription, fullExplanation, category, tags[], examples[], useCases[], isSystem, isArchived, createdById; unique type+slug)
- **`AiAuditLog`** (userId, action, nodeType, pipelineId, nodeCanvasId, model, prompt, suggestions, blockedFields, rejectedFields, appliedFields, status)

##### Избранные промты ⭐

- **`FavoritePrompt`** (userId, appId?, promptText (snapshot), sourceVideoAssetId? (onDelete:SetNull), tags[] **GIN-индекс**, notes, isPublic, usageCount, lastUsedAt, ⭐ **`aiPatternAnalysis`** Json (camera/lighting/mood/intensity/keywords structured), ⭐ **`aiAnalyzedAt`**, ⭐ **`aiAnalysisError`**, ⭐ **`aiAnalysisAttempts`** (hard-cap 3))

### Миграции — 71 штука (от `20260331130814_init_schema` до `20260505083527_posting_jobs_fk_and_index`)

| № | Дата | Имя | Назначение |
|---|------|-----|-----------|
| 1 | 2026-03-31 | `init_schema` | Базовая схема |
| 2 | 2026-03-31 | `add_video_models` | Видео-модели |
| 3 | 2026-03-31 | `add_social_upload_models` | Загрузка в соцсети |
| 4 | 2026-03-31 | `add_analytics_models` | Аналитика |
| 5 | 2026-03-31 | `add_zavod_user` | Пользователи ZavodUser |
| 6 | 2026-03-31 | `add_admin_models` | Админ-модели |
| 7 | 2026-03-31 | `add_telegram_chat` | Telegram интеграция |
| 8 | 2026-03-31 | `add_ideas` | Идеи контента |
| 9 | 2026-04-01 | `add_pipeline` | Базовые конвейеры |
| 10 | 2026-04-01 | `add_trendwatcher_profile` | TrendWatcher профили |
| 11 | 2026-04-01 | `add_execution_models` | WorkflowRun, WorkflowStep |
| 12 | 2026-04-01 | `add_pipeline_schedule` | Планирование конвейеров |
| 13 | 2026-04-01 | `add_webhook_token` | Вебхук-токены |
| 14 | 2026-04-01 | `add_workflow_indexes` | Индексы workflow |
| 15 | 2026-04-02 | `unify_platform_enum` | Унификация Platform enum |
| 16 | 2026-04-06 | `add_trendwatcher_features` | Расширение Trendwatcher |
| 17 | 2026-04-06 | `add_scenario_variants_and_review` | Варианты сценариев и review |
| 18 | 2026-04-06 | `ideas_module_v2` | Ideas v2 (анализ и операции) |
| 19 | 2026-04-06 | `telegram_enhanced_models` | Расширенный Telegram |
| 20 | 2026-04-07 | `add_video_steps_upload_attempts` | Video steps + upload attempts |
| 21 | 2026-04-07 | `add_clip_duration` | Длительность клипов |
| 22 | 2026-04-08 | `add_image_count` | Кол-во изображений |
| 23 | 2026-04-08 | `add_trendwatcher_runs` | Запуски Trendwatcher |
| 24 | 2026-04-08 | `add_error_diagnostics_fields` | Диагностика ошибок |
| 25 | 2026-04-08 | `add_profile_validation_fields` | Валидация профилей |
| 26 | 2026-04-09 | `pipeline_production_grade` | Production-grade pipeline |
| 27 | 2026-04-09 | `add_pipeline_credentials` | Credentials для конвейеров |
| 28 | 2026-04-09 | `pipeline_hardening_webhook_secret_credential_revocation` | Усиление безопасности |
| 29 | 2026-04-09 | `add_taxonomy_item` | Таксономия |
| 30 | 2026-04-09 | `add_pipeline_metadata_fields` | Метаданные конвейеров |
| 31 | 2026-04-09 | `add_pipeline_category_taxonomy_and_last_edited_at` | Категории и lastEditedAt |
| 32 | 2026-04-10 | `ai_audit_log` | Логирование AI операций |
| 33 | 2026-04-10 | `add_pipeline_context_to_ai_audit` | Pipeline-контекст в AI audit |
| 34 | 2026-04-10 | `add_pipeline_to_idea_source` | Pipeline как источник идей |
| 35 | 2026-04-10 | `pipeline_category_to_tags` | category→tags |
| 36 | 2026-04-10 | `pipeline_tags_m2m` | M2M связь для tags |
| 37 | 2026-04-13 | `add_telegram_api_key` | Telegram API keys |
| 38 | 2026-04-13 | `add_partial_step_status` | StepStatus.partial |
| 39 | 2026-04-14 | `add_video_timeout_status` | VideoStatus.timeout |
| 40 | 2026-04-14 | `add_video_model_fields` | imageModelId, videoModelId |
| 41 | 2026-04-14 | `add_no_data_run_status` | RunStatus.no_data |
| 42 | 2026-04-15 | `app_enrichment_extension` | Расширение App, AppEnrichmentLog |
| 43 | 2026-04-15 | `story_driven_scenario_pipeline` ⭐ | StoryPlan, ScenarioGenerationProfile, ScenarioFeedback, ScenarioMemory |
| 44 | 2026-04-16 | `add_reference_analysis_fields` ⭐ | Idea.referenceAnalysis, referenceBreakdown |
| 45 | 2026-04-16 | `add_account_style_profile` ⭐ | AccountStyleProfile, AccountStyleRevision, AccountGroup.styleMode/stylePolicy |
| 46 | 2026-04-16 | `add_idea_marketingcamp_sync` ⭐ | Idea.externalId/syncStatus/syncDirection/remoteSnapshot |
| 47 | 2026-04-16 | `add_voiceover_runtime` ⭐ | Video.voiceoverProvider/ModelId/Pacing/Reconciliation, AssetType voiceover/voiceover_mix, VideoStepKey.voiceover_generation |
| 48 | 2026-04-16 | `add_step_no_data_status` ⭐ | StepStatus.no_data |
| 49 | 2026-04-16 | `trendwatcher_inline_profile` ⭐ | TrendwatcherProfile.isInline/sourceNodeId/sourcePipelineId, TrendwatcherTriggerType.pipeline |
| 50 | 2026-04-16 | `update_default_actor_id` ⭐ | Дефолтный actor ID |
| 51 | 2026-04-16 | `backfill_broken_actor_ids` ⭐ | Backfill deprecated actorId → working |
| 52 | 2026-04-17 | `add_fal_subkey` ⭐ | VideoGenerationStep.falSubKey (per-scene изоляция fal-job) |
| 53 | 2026-04-17 | `add_video_subtitle_preset` ⭐ | Video.subtitlePreset, anti-occlusion поля |
| 54 | 2026-04-17 | `add_pipeline_subtitle_style` ⭐ | Pipeline.subtitleStyle |
| 55 | 2026-04-22 | `add_app_reference_image_urls` ⭐ | App.referenceImageUrls |
| 56 | 2026-04-23 | `add_favorite_prompts` ⭐ | FavoritePrompt модель + GIN-индекс tags |
| 57 | 2026-04-23 | `add_pipeline_run_tracking` ⭐ | Scenario/Trend/Video/Upload/Idea.runId+pipelineId FK с onDelete:SetNull |
| 58 | 2026-04-23 | `add_trendwatcher_skip_breakdown` ⭐ | TrendwatcherRun.dedupSkipCount/viewCountSkipCount/warningCount |
| 59 | 2026-04-25 | `add_video_lip_sync` ⭐ | Video.lipSyncEnabled/lipSyncModelId, VideoStepKey.lip_sync_generation |
| 60 | 2026-04-25 | `accounts_pipeline_integration` ⭐⭐ | SocialAccount.lastPostedAt, AccountGroup.dispatchMode, Upload.accountGroupId/dispatchMode |
| 61 | 2026-04-25 | `add_favorite_prompt_pattern_analysis` ⭐⭐ | FavoritePrompt.aiPatternAnalysis/aiAnalyzedAt/aiAnalysisError/aiAnalysisAttempts, TaxonomyType.kling_pattern |
| 62 | 2026-04-25 | `add_idea_analysis_progress` ⭐⭐ | Прогресс anaylze-reference (yt-dlp + ffmpeg + whisper + Claude vision) |
| 63 | 2026-04-25 | `app_reference_images_metadata` ⭐⭐ | AppReferenceImage модель + backfill из App.referenceImageUrls через UNNEST |
| 64 | 2026-04-29 | `social_automation_foundation` ⭐⭐ | SocialAccount расширение, Proxy, ProxyHealthCheck, SecretAccessLog, enum ProxyType/ProxyStatus/WarmupStatus/RegistrationSource |
| 65 | 2026-04-29 | `add_proxy_protocol` ⭐⭐ | Proxy.protocol enum (http/https/socks5) с дефолтом http |
| 66 | 2026-04-29 | `proxy_alert_dedup` ⭐⭐ | Proxy.alertHistory Json (per-category дедуп Telegram-алертов) |
| 67 | 2026-04-30 | `indigo_profile` ⭐⭐ | IndigoProfile, IndigoSyncStatus enum, FK 1:1 с SocialAccount и n:1 с Proxy |
| 68 | 2026-04-30 | `posting_jobs` ⭐⭐ | PostingJob, PostingJobLog, PostingJobStatus, PostingErrorCategory |
| 69 | 2026-05-04 | `warmup_models` ⭐⭐ | WarmupSession, WarmupKeywordPool, WarmupSessionStatus enum |
| 70 | 2026-05-04 | `add_video_unique_variants` ⭐⭐ | VideoUniqueVariant, unique constraint videoId+platform+paramsHash |
| 71 | 2026-05-05 | `posting_jobs_fk_and_index` ⭐⭐ | FK createdById/cancelledById на ZavodUser SetNull, композитный индекс status+retryAt |

⭐ — миграция периода 2026-04-15 … 2026-04-25 (раздел 11). ⭐⭐ — миграция периода 2026-04-25 … 2026-05-05 (раздел 12).

---

## 4. Серверная часть (`server/`)

### 4.1. Утилиты и сервисы (`server/utils/`)

**Базовая инфраструктура:**
- `prisma.ts` — singleton Prisma-клиента с pg-adapter
- `anthropic.ts` — обёртка над Claude (Sonnet/Haiku) с retry и cost-логированием
- `fal.ts` — низкоуровневый клиент fal.ai Queue API (см. раздел 10), ⭐⭐ замокирован через `FAL_MOCK_MODE`
- `tts.ts` — синтез речи через fal.ai (Kokoro EN/RU, PlayAI, ElevenLabs)
- `mubert.ts` — фоновая музыка
- `rbac.ts` + `rbac-presets.ts` — контроль доступа (роли + per-app access). ⭐⭐ `getAuthContext` поддерживает `TEST_AUTH_BYPASS` (тройной гейт NODE_ENV+ENV+x-test-auth-token)
- `paid-guard.ts` — `requirePaidApisEnabled(serviceName)`, гейт для платных API. ⭐⭐ \*_MOCK_MODE флаги обходят гейт
- `social-guard.ts` — гейт публикации в соцсети
- `crypto.ts` — шифрование OAuth-токенов и pipeline-credentials через `ENCRYPTION_KEY`. ⭐⭐ `encryptSecret`/`decryptSecret` для кред аккаунтов и прокси, error-сообщения включают `openssl rand -hex 32` команду
- `secret-access.ts` ⭐⭐ — `readSecret` поверх `SecretAccessLog`, `sanitizeForLog`, `maskHost`, `buildSecretAccessContext`
- `requireZavodAuth.ts` — Bearer-auth проверки для внешнего API (MarketingCamp ↔ Zavod)
- `subtitle-style.ts` ⭐ — `normalizeSubtitleStyle`/`mergeSubtitleStyle` с clamp wordsPerLine 3..6 и compat snake_case

**AI и контекст:**
- `ai-audit.ts` — журналирование AI-операций (suggest field/block)
- `agent-logger.ts` — структурированное логирование AI-агентов
- `app-context.ts` — сборка контекстного блока приложения для промптов
- `account-style-context.ts` ⭐ — резолвер AccountStyleProfile для сценарного pipeline
- `analytics-ai.ts` ⭐ — извлечение style-relevant рекомендаций для AccountStyleProfile

**Pipeline:**
- `pipeline-engine.ts`, `pipeline-runtime.ts`, `pipeline-graph.ts`
- `pipeline-executors.ts`, `pipeline-executors-extra.ts` — исполнители доменных и системных нод
- `pipeline-validator.ts` — валидация графа (цикличность, sub-pipeline depth, cross-section consistency)
- `pipeline-rate-limiter.ts` — rate-limit по пользователю и pipeline
- `pipeline-cancel-registry.ts` ⭐ — `AbortController` registry для hard cancel активных шагов
- `pipeline-credentials.ts` — операции с PipelineCredential
- `pipeline-code-worker.ts` — sandbox для нод типа Code
- `pipeline-sub-executor.ts` ⭐ — sub-pipeline с защитой от рекурсии (`parentRunId`-цепочка, depth limit)

**Видео и сценарий:**
- `video-pipeline.ts` — оркестрация генерации
- `video-pipeline-db.ts` ⭐ — БД-слой со step-tracking + `falStepRequest` (idempotent reattach)
- `video-pipeline-steps.ts` — отдельные шаги (prompts, images, clips, voiceover, music, assembly)
- `video-models.ts` — реестр моделей (IMAGE/VIDEO/TTS/LIP_SYNC/MUSIC) с pricing/integrated/tier
- `video-cost.ts` — `estimateVideoCost`, `COST_PRESETS` (budget/balanced/quality), `getCostOptimizationTips`
- `video-helpers.ts` — `downloadFile`, prompt-helpers, scene-utils
- `video-metadata.ts` — ffprobe и обмен данными о клипах
- `story-video-planner.ts` ⭐ — конвертирует StoryPlan → ExecutableVideoPlan (per-scene durations, modes legacy_simple / story_driven)
- `lip-sync-runner.ts` ⭐ — премиум-runner sync-lipsync с TTS+upload+FAL job
- `render.ts` — FFmpeg-сборка (drawtext, concat demuxer, audio lanes, ducking)

**Trendwatcher и парсинг:**
- `trendwatcher-runner.ts` — оркестратор запуска парсинга (Apify + import + analyze)
- `apify-client.ts` — клиент Apify
- `trend-helpers.ts` — нормализация трендов

**Идеи и MarketingCamp:**
- `idea-pipeline.ts` — обработка одной идеи (transcript + analysis)
- `idea-sync.ts` ⭐ — двусторонняя синхронизация Idea ↔ MarketingCamp (push/pull/conflict)
- `marketingcamp.ts` — HTTP-клиент MarketingCamp API
- `reference-pipeline.ts` ⭐ — оркестрация анализа медиа-референсов
- `transcript-extractor.ts` ⭐ — YouTube captions с таймкодами через ffprobe + yt-dlp
- `feedback-loop.ts` ⭐ — извлечение requirements/recommendations из ScenarioFeedback в ScenarioMemory

**App enrichment:**
- `app-enrichment-pipeline.ts` — обогащение приложения через Anthropic
- `app-store-parser.ts` — multi-source extraction (JSON-LD → meta → DOM → regex → AI fallback) с FieldProvenance и StoreExtractionReport

**Cycle и upload:**
- `cycle-orchestrator.ts` — оркестрация ProductionCycle (trends → scenarios → videos → uploads)
- `metrics-collector.ts` — сбор постовых метрик из соцсетей
- `upload-pipeline.ts` — оркестрация публикации видео
- `expression-evaluator.ts` — резолв `{{expression}}` в input/notification узлах
- `cron-parser.ts` — расписания

**⭐⭐ Антидетект и постинг (Social Automation, см. раздел 13):**
- `proxy/proxy-checker.ts` — TCP connect + HTTP probe с leak-detection через ipify
- `proxy/probe.ts` — `probeHttps` (CONNECT) + `probeHttp` (forward) + socks5 fallback chain
- `proxy/alert-dedup.ts` — quiet period 24ч/12ч/7д для leak/auth/expired
- `proxy/dto.ts` — маппер без секретов
- `indigo/client.ts` — Indigo Browser API (auth/list/create/start/stop), MD5 password
- `indigo/sync.ts` — двусторонняя синхронизация по indigoId
- `indigo/credentials.ts` — `PipelineCredential[indigo:workspace]` шифрованный JSON
- `indigo/token-manager.ts` — `PipelineCredential[indigo:auth_token]` с refresh за 5 мин и `withIndigoToken` 401-retry
- `indigo/rate-limiter.ts` — token bucket 80 RPM
- `posting/state-machine.ts` — pending→preparing→awaiting_proxy→in_progress→succeeded/failed/retry_queued/cancelled
- `posting/job-service.ts` — CRUD postings, retry, cancel
- `posting/worker.ts` — 6-й scheduler 30с под флагом `POSTING_WORKER_ENABLED`
- `posting/runner-mock.ts` — 10% сбой, exhaust-check default по Platform
- `posting/error-classifier.ts` — proxy_dead/network/captcha/banned/validation
- `warmup/planner.ts` — детерминистический seedable XorShift32 по `accountId:YYYY-MM-DD`
- `warmup/distributions.ts` — 9 ключей (tiktok/youtube/instagram × new/warming/mature)
- `warmup/age-classifier.ts` — new<7д, warming<30д, mature
- `warmup/keyword-pool.ts`, `comment-pool.ts`, `session-service.ts`, `rng.ts`, `dto.ts`, `validation.ts`
- `video-uniqifier/service.ts` ⭐⭐ — per-platform уникализация ffmpeg (file hash + base metadata, не perceptual)
- `video-uniqifier/ffmpeg.ts`, `params.ts`, `index.ts`

**⭐⭐ Mock-инфраструктура (см. раздел 14):**
- `mock/mode.ts` — `isProxyMockMode/isIndigoMockMode/...` флаги (5 отдельных env)
- `mock/fixture-loader.ts` — загрузка JSON-фикстур из `server/__fixtures__/`
- `mock/anthropic-mock.ts` — `agentName` → fixture (`story-architect-happy.json` и т.п.)
- `mock/fal-mock.ts` — submit/poll/getResult/uploadFile/probeAccess с `mock://` URL схемой

**⭐ Декомпозиция видео-промптов (`video-prompts/`):**
- `index.ts` — публичный `generateSceneImagePrompts` (re-export)
- `types.ts`, `extras.ts`, `scene-description.ts`, `system-prompt.ts`
- `context-blocks.ts` — 9 блоков (Story Arc, Emotional Journey, Visual Code, Platform, Reference Patterns, App Context, Account Style, Continuity Bible, App Screen Reference)
- `anthropic-call.ts` — обёртка с `cache_control: ephemeral`
- `post-validation.ts` — coherence check через scene-prompt-validator (Haiku)

**⭐ Субтитры в стиле Opus.pro (`subtitles/`):**
- `preset-registry.ts` — 10 пресетов
- `ass-builder/header.ts`, `dialogue.ts`, `animation-tags.ts`, `keyword-emphasis.ts`
- `font-resolver.ts`, `word-timings.ts`, `render-ass.ts` (с try/catch fallback на drawtext)

**⭐ Видео-инструменты (`video-tools/`):**
- `yt-dlp.ts` — async getRunner с автопоиском `/usr/bin/yt-dlp`, env override `YT_DLP_BIN_PATH`
- `ffmpeg.ts` — `describeSubprocessError` дампит constructor name, code, exitCode, signal, command, stderr/stdout, stack
- `subtitle-parsers.ts` — VTT/SRT парсинг

**⭐ Lip-sync, story:**
- `lip-sync-runner.ts` — TTS + falUploadFile + sync-lipsync
- `story-video-planner.ts` — StoryPlan → ExecutableVideoPlan

### 4.2. AI-агенты (`server/utils/agents/`)

| Файл | Роль |
|------|------|
| `call-anthropic.ts` | Низкоуровневая обёртка `callAnthropicAgent` с auto-retry и audit |
| `call-anthropic-cached.ts` ⭐ | Обёртка с `cache_control: ephemeral` на статичный system-prompt, graceful degradation на 400 |
| `trend-analyzer-agent.ts` | Анализ тренда → TrendInsight + CreativeBrief |
| `story-architect-agent.ts` | Дуга повествования (premise/conflict/turningPoint/resolution), инжекция accountStyle, referenceContext, favorite prompts. ⭐ EN-only negativeConstraints с санитайзером кириллицы |
| `scene-planner-agent.ts` | Декомпозиция на 3-6 сцен, `spokenLine`, visual mood, props/locations, haiku repair-pass. ⭐ devicesInScene + блок ДОСТУПНЫЕ СКРИНШОТЫ (`appScreenRef`) |
| `continuity-director-agent.ts` | Согласованность сцен, мёрж по `order`, заполнение protagonist bible. ⭐ восстанавливает devicesInScene и appScreenRef из исходных сцен |
| `subtitle-director-agent.ts` | Оптимизация субтитров (4 слова/строка, anti-occlusion). ⭐ требует wordsPerLine в JSON-output |
| `optimization-memory-agent.ts` | Извлечение requirements/recommendations из feedback в ScenarioMemory |
| `reference-analyzer-agent.ts` | Двухстадийный анализ медиа-референса с anti-copy трансформацией |
| `favorite-prompts-loader.ts` | Подбор top-3 промтов из FavoritePrompt как style compass |
| `prompt-pattern-extractor.ts` ⭐⭐ | Haiku fire-and-forget анализ промта в 4 паттерна (camera/lighting/mood/intensity), hard-cap aiAnalysisAttempts >= 3, кеширует в FavoritePrompt |
| `scene-prompt-validator.ts` ⭐⭐ | Post-pass coherence check, возвращает original при count mismatch |
| `screen-tagger-agent.ts` ⭐⭐ | Vision Sonnet на каждую загрузку AppReferenceImage, controlled-vocab из 23 тегов |
| `scenario-marketing-validator.ts` ⭐ | Haiku auto-repair, блокирует storyPlan без бренда (app.name в spokenLine/voiceover/CTA) |
| `subtitle-keyword-agent.ts` ⭐ | AI keyword detection через Haiku с heuristic-fallback (для karaoke-emphasis в ASS) |
| `video-frame-analyzer-agent.ts` ⭐⭐ | Claude vision batch на 12 кадров с prompt caching (для analyze-reference Idea) |
| `video-scene-synthesizer-agent.ts` ⭐⭐ | Синтез сцен из frames + transcript |
| `copywriting-agent.ts` | Hook/body/CTA |
| `visual-style-agent.ts` | Визуальный стиль (palette/lighting/composition) |
| `hook-generator-agent.ts` | Хуки для соцсетей |
| `keyword-agent.ts` | Ключевые слова |
| `posting-time-agent.ts` | Рекомендация времени публикации |
| `platform-adaptation-agent.ts` | Адаптация контента под TikTok/Instagram/YouTube |
| `idea-analyzer-agent.ts` | Анализ идеи (hookAnalysis, sceneStructure, viralityReasons) |
| `app-enrichment-agent.ts` | Обогащение приложения по данным магазина и URL |
| `scenario-pipeline.ts` | Сценарный конвейер v3 — оркестрация Story Architect → Scene Planner → Continuity → Subtitle. ⭐ STYLE COMPASS блок со structured patterns |

### 4.3. Внешние API-клиенты

- `fal.ts` — единый клиент для всех fal.ai моделей (см. раздел 10), ⭐⭐ замокирован через `FAL_MOCK_MODE`
- `tts.ts` — TTS через fal.ai
- `mubert.ts` — Mubert API
- `apify-client.ts` — Apify Actor API (Trendwatcher)
- `marketingcamp.ts` — MarketingCamp REST API
- `indigo/client.ts` ⭐⭐ — Indigo Browser API (launcher.indigobrowser.com:45001 prod / localhost:35001 mock), MD5 password, token bucket 80 RPM
- `social/youtube.ts` — YouTube Data API v3
- `social/tiktok.ts` — TikTok Content Posting API
- `social/instagram.ts` — Instagram Graph API
- `social/factory.ts` — фабрика по platform
- `social/oauth-config.ts` — OAuth scopes/redirects
- `social/types.ts` — типы Upload payload

### 4.4. Pipeline Engine

DAG-движок поверх PostgreSQL и `WorkflowRun`/`WorkflowStep`. Особенности:
- **Параллелизм по уровням** — ноды одного уровня (по топологическому порядку) выполняются параллельно
- **Idempotency** ⭐ — executors проверяют существующие сущности по `runStartedAt` scope
- **Hard cancel** ⭐ — `pipeline-cancel-registry.ts` хранит `AbortController` per run, `cancel.post.ts` сразу прерывает FAL и subprocess'ы
- **Sub-pipeline защита** ⭐ — `parentRunId`-цепочка, max depth=5, защита от циклической рекурсии
- **No-data контракт** ⭐ — domain-ноды возвращают `_noData/_noDataReason/_domainStatus`, propagated downstream, notification-нода различает `success/no_data/warning`
- **Resume from crashed step** ⭐ — engine на старте подгружает prior steps в success/partial/no_data/skipped и пропускает через `completedNodeIds`
- **Recover orphaned runs** — финализирует зомби-шаги в running/pending как failed перед reque
- **Retry-step API + UI кнопка** на failed/cancelled шагах

### 4.5. Видео-генерация

См. подробно в разделе 10. Ключевые отличия от первого аудита:
- **Story-driven runtime** ⭐ — `story-video-planner.ts` исполняет `StoryPlan` per-scene вместо uniform `clipDuration`
- **Voiceover lane** ⭐ — TTS per-scene + ffprobe duration + reconciliation (`accept/atempo/trim`) + ducking
- **Lip-sync premium** ⭐ — отдельный шаг `lip_sync_generation` между clip и voiceover
- **Subtitle preset** ⭐ — `subtitlePlacement`, anti-occlusion, 4-word default
- **Cost-предпросмотр** — `estimateVideoCost` принимает `scenarioId+variantIdx`, считает по реальным `sceneDurations`

### 4.6. Загрузка в соцсети

- `upload-pipeline.ts` — pipeline upload (валидация → загрузка → запись `Upload.platformPostId`)
- `social/youtube.ts/tiktok.ts/instagram.ts` — реализации
- `metrics-collector.ts` — сбор PostMetrics
- ⭐⭐ **`posting/`** — асинхронная state-machine публикации (см. раздел 13). PostingJob с retry, dead-letter, worker-tick 30с
- ⭐⭐ **executeUploadNode переписан** через `resolveUploadTarget`: режимы account/group, round_robin сортирует по lastPostedAt, all создаёт Upload на каждого active-члена, first_active по id. lastPostedAt тикается сразу при create для честной ротации
- ⭐⭐ **Pipeline-validator** потерял REQUIRED accountId, получил структурную+DB-проверку (error на missing/inactive, warning на platform mismatch с upstream video)

### 4.7. Trendwatcher

- `trendwatcher-runner.ts` — обработчик профиля (Apify run → import + dedup + analyze)
- ⭐ Поддержка inline-профилей в pipeline-нодах через `isInline/sourceNodeId/sourcePipelineId`
- ⭐ Counters: `dedupSkipCount`, `viewCountSkipCount`, `warningCount` отдельно
- ⭐ Pipeline-trigger: при `triggerType=pipeline` `runId/pipelineId` цепляются через relation connect

### 4.8. Telegram

- `telegram/bot.ts` — Bot API клиент
- `telegram/commands.ts`, `cmd-cycle.ts` — обработка команд
- `telegram/messaging.ts` — отправка по шаблонам
- `telegram/alerts.ts` — алерты ошибок и циклов
- `telegram/variable-registry.ts` — реестр переменных для шаблонов
- `telegram/analyzer.ts` — анализ входящих сообщений (для idea-flow)

### 4.9. Серверные плагины (`server/plugins/`)

- `scheduler.ts` — глобальный планировщик (uploads, metrics, cycle checks). ⭐ 5-й setInterval раз в 4 часа — proxy health check с Telegram алертами на leak/dead. ⭐⭐ 6-й setInterval 30 сек — PostingJob worker под `POSTING_WORKER_ENABLED`
- `pipeline-scheduler.ts` — выполнение PipelineSchedule по cron. ⭐⭐ Universal `SCHEDULERS_ENABLED=false` гейт первой строкой
- `trendwatcher-scheduler.ts` — выполнение TrendwatcherProfile.scheduleCron. ⭐⭐ Universal `SCHEDULERS_ENABLED` гейт
- `telegram.ts` — инициализация Telegram-бота при старте. ⭐⭐ Universal `SCHEDULERS_ENABLED` гейт

### 4.10. API Endpoints

> 261 файл в `server/api/` (+50 за период). Сгруппировано по разделам.

#### Auth (`/api/auth/`)
- `login.post.ts`, `logout.post.ts`, `permissions.get.ts`

#### Apps
- `apps.get.ts`, `apps.post.ts`
- `apps/[id]/...` — `enrich.post.ts`, `reference-images.post.ts`, `reference-images.delete.ts`
- `admin/apps.get.ts`, `admin/apps.post.ts`, `admin/apps/enrich-preview.post.ts`, `admin/apps/[id].get/put/delete.ts`

#### Trends (`/api/trends/`)
- `index.get.ts`, `stats.get.ts`
- `[id].get/delete.ts`
- `[id]/analyze.post.ts`, `[id]/app.put.ts`, `[id]/status.put.ts`

#### Scenarios (`/api/scenarios/`)
- `index.get.ts`, `generate.post.ts`
- `[id].get/put/delete.ts`
- `[id]/improve-visual-style.post.ts`, `[id]/regenerate-block.post.ts`, `[id]/reject.put.ts`, `[id]/rework.put.ts`, `[id]/rework-regenerate.post.ts`, `[id]/select.put.ts`
- ⭐ `feedback.get/post.ts`, `memory.get.ts`, `profiles/index.get.ts`, `profiles/index.post.ts`, `profiles/[id].delete.ts`

#### Videos (`/api/videos/`)
- `index.get.ts`, `generate.post.ts`, `estimate-cost.post.ts`, `models.get.ts`
- `[id].get/delete.ts`
- `[id]/cancel.post.ts`, `[id]/edit-subtitles.post.ts`, `[id]/progress.get.ts`, `[id]/rerun-step.post.ts`, `[id]/resume.post.ts`
- ⭐ `[id]/skip-step.post.ts` (whitelist voiceover/music)
- ⭐ `[id]/rerender-assembly.post.ts`
- ⭐⭐ `[id]/uniqify.post.ts` (canRunAgent, platform tiktok/youtube)
- ⭐⭐ `[id]/variants.get.ts` (canRead)

#### Uploads (`/api/uploads/`)
- `index.get.ts`, `create.post.ts`, `module-status.get.ts`
- `[id].get.ts`, `[id]/attempts.get.ts`, `[id]/retry.post.ts`

#### Analytics (`/api/analytics/`)
- `dashboard.get.ts`, `posts.get.ts`, `collect.post.ts`, `analyze/[uploadId].post.ts`

#### Accounts и Social
- `accounts/index.get/post.ts`, `accounts/[id].delete.ts`
- ⭐⭐ `accounts/[id]/credentials.get/put.ts`, `accounts/[id]/credentials/reveal.post.ts`, `accounts/[id]/credentials-meta.get.ts` (только non-secret + hasLoginX boolean), `accounts/[id]/proxy.put.ts`, `accounts/[id]/style/...`
- `account-groups/index.get/post.ts`, `account-groups/[id].put/delete.ts` (⭐⭐ принимают `dispatchMode`)
- `social/connect/[platform].get.ts`, `social/callback/[platform].get.ts`

#### ⭐⭐ Antidetect Stack

**Proxies** (`/api/proxies/`)
- CRUD: `index.get/post.ts`, `[id].get/put/delete.ts`
- Health: `[id]/check.post.ts`, `[id]/checks.get.ts`, `check-all.post.ts` (concurrency=5 через Promise.allSettled)
- Reveal: `[id]/reveal.post.ts` с журналом в SecretAccessLog

**Indigo Browser** (`/api/indigo/`)
- Profiles CRUD: `profiles/index.get/post.ts`, `profiles/[id].get/put/delete.ts`
- Lifecycle: `profiles/[id]/start.post.ts` (вызывает `assertProxyHealthyBeforeSession` ДО hit к Indigo), `[id]/stop.post.ts`
- Linking: `profiles/[id]/link-account.post.ts`, `unlink-account.post.ts`
- Sync: `sync.post.ts` (двусторонняя по indigoId)
- Workspace credentials: `credentials/index.put/delete.ts`, `credentials/status.get.ts`, `credentials/test.post.ts`

**Posting Jobs** (`/api/posting-jobs/`)
- CRUD: `index.get/post.ts`, `[id].get.ts`, `stats.get.ts`
- Lifecycle: `[id]/retry.post.ts`, `[id]/cancel.post.ts`
- Audit: `[id]/logs.get.ts`

**Warmup** (`/api/warmup/`)
- Per-account: `accounts/[accountId]/preview.post.ts` (детерминистический preview), `schedule.post.ts` (с `replace=true` flag), `sessions.get.ts`
- Sessions: `sessions.get.ts`, `sessions/[id].get/delete.ts`, `sessions/[id]/cancel.post.ts`
- Keyword Pools: `keywords/index.get/post.ts`, `keywords/[id].put/delete.ts`

**Test bypass** (`/api/_test/`) — гейты `NODE_ENV !== production` + `TEST_AUTH_BYPASS=1` + `x-test-auth-token`
- ⭐⭐ `login.post.ts` — `setUserSession` для Playwright
- ⭐⭐ `cleanup.post.ts` — TRUNCATE CASCADE для afterEach

#### Ideas (`/api/ideas/`)
- `index.get.ts`, `ideas.get.ts`, `ideas.post.ts`
- `[id].get/put/delete.ts`
- `[id]/analyze-reference.post.ts` ⭐, `[id]/reanalyze.post.ts`, `[id]/sync.post.ts` ⭐, `[id]/to-scenario.post.ts`
- `sync/import.post.ts` ⭐, `sync/export.post.ts` ⭐, `sync/status.get.ts` ⭐

#### Pipelines (`/api/pipelines/`)
- `index/list/post`: `pipelines.get.ts`, `pipelines.post.ts`, `[id].get/put/delete.ts`
- Run/exec: `[id]/run.post.ts`, `[id]/runs.get.ts`, `[id]/runs/[runId].get.ts`, `[id]/runs/[runId]/cancel.post.ts`, `replay.post.ts`, `retry-step.post.ts` ⭐
- Versions: `[id]/versions.get/post.ts`, `[id]/versions/[versionId]/restore.post.ts`
- Schedule: `[id]/schedule.get/put/delete.ts`
- Webhooks: `[id]/webhook.post/delete.ts`, `[id]/webhook-logs.get.ts`, `[id]/validate.get.ts`, `[id]/export.get.ts`
- Nodes: `nodes/test.post.ts`, `[id]/nodes/[nodeId]/upstream-context.get.ts` ⭐
- Tags: `tags.get/post/put/delete.ts`
- Other: `presets.get.ts`, `runtime-stats.get.ts`, `monitor.get.ts` ⭐ (без N+1), `import.post.ts`

#### Pipeline Credentials (`/api/pipelines/credentials/`)
- `index.get/post.ts`
- `[id].put/delete.ts`
- `[id]/revoke.post.ts`, `[id]/unrevoke.post.ts`, `[id]/test.post.ts`, `[id]/usage.get.ts`

#### Webhooks
- `webhooks/[token].post.ts`

#### AI Suggestions (`/api/ai/`)
- `audit.get/put.ts`
- `suggest/`: `block.post.ts`, `description.post.ts`, `field.post.ts`, `hooks.post.ts`, `keywords.post.ts`, `platform-adaptation.post.ts`, `posting-time.post.ts`, `scenario.post.ts`, `scenario-config.post.ts` ⭐, `taxonomy.post.ts`, `trendwatcher-config.post.ts` ⭐, `visual-style.post.ts`

#### Trendwatcher (`/api/trendwatcher/`)
- `profiles.get/post.ts`
- `profiles/[id].get/put/delete.ts`
- `profiles/[id]/duplicate.post.ts`, `schedule.put.ts`, `validate.post.ts`
- `run.post.ts`
- `runs/index.get.ts`, `runs/active.get.ts`, `runs/[id].get/delete.ts`, `runs/[id]/retry.post.ts`

#### Admin (`/api/admin/`)
- `dashboard.get.ts`, `users.get.ts`, `users/[id].get/put.ts`, `apps.get/post.ts`, `apps/...`, `cycles.get.ts`, `cycles/start.post.ts`, `cycles/[id].get.ts`, `cycles/[id]/stop.post.ts`, `logs.get.ts`, `logs/[id]/resolve.put.ts`
- ⭐⭐ `accounts-health.get.ts` — дашборд состояния аккаунтов на 13 параллельных Prisma-запросах, completeness scoring 8 критериев по 12.5% (login/2FA/proxy/proxy healthy/indigo/warmup ready/warmup до 7д/active), без утечки секретов (только hasLoginCredentials и has2FA boolean)
- ⭐⭐ AppReferenceImage AI: `apps/[id]/reference-images/[refId]/analyze.post.ts`
- Telegram: `telegram/audit.get.ts`, `chats.get.ts`, `chats/[id].put/delete.ts`, `deliveries.get.ts`, `deliveries/[id]/...`, `keys/index.get/post.ts`, `keys/[id].put/delete.ts`, `restart.post.ts`, `status.get.ts`, `templates.get/post.ts`, `templates/generate.post.ts`, `templates/[id].put/delete.ts`, `test.post.ts`, `variables.get.ts`

#### Favorite Prompts ⭐ (`/api/favorite-prompts/`)
- `index.get/post.ts`
- `[id].get/put/delete.ts`
- ⭐⭐ `[id]/reanalyze.post.ts` — повторный pattern-анализ (Haiku)

#### References, Taxonomy, Creatives, Files, Integration
- `references/index.get.ts`
- `taxonomy.get/post.ts`, `taxonomy/[id].put/delete.ts`, `taxonomy/seed.post.ts`
- `creatives.get.ts`
- `files/[...path].get.ts` — раздача `storage/uploads/*` с auth и cache headers
- `integration/status.get.ts` — статус интеграций (FAL, Anthropic, OAuth, Mubert)

#### Внешний API ZavodCamp (для MarketingCamp)
- `zavod/health.get.ts` ⭐, `zavod/ideas.get.ts` ⭐, `zavod/ideas/[id].get.ts` ⭐ (Bearer auth через `requireZavodAuth`)

#### Прочее
- `health.get.ts`, `import.post.ts`

---

## 5. Фронтенд (`app/`)

### 5.1. Layouts
- `auth.vue` — для `/auth/login`
- `default.vue` — основной (header + sidebar + slot)

### 5.2. Middleware
- `auth.global.ts` — глобальная проверка сессии и редирект на `/auth/login`
- `admin-access.ts` — проверка `canAdmin`
- `module-access.ts` — проверка `moduleAccess[]` (per-route)

### 5.3. Plugins
- `auth-redirect.client.ts` — клиентский редирект после login

### 5.4. Pages

| Роут | Файл | Назначение |
|------|------|-----------|
| `/` | `index.vue` | Dashboard / главная |
| `/auth/login` | `auth/login.vue` | OAuth-вход |
| `/admin` | `admin/index.vue` | Admin dashboard |
| `/admin/users` | `admin/users/index.vue` | Список пользователей |
| `/admin/users/[id]` | `admin/users/[id].vue` | Редактирование пользователя |
| `/admin/apps` | `admin/apps/index.vue` | Список приложений |
| `/admin/apps/[id]` | `admin/apps/[id].vue` | Редактирование+обогащение приложения |
| `/admin/cycles` | `admin/cycles/index.vue` | Production Cycles |
| `/admin/cycles/[id]` | `admin/cycles/[id].vue` | Детали цикла |
| `/admin/logs` | `admin/logs/index.vue` | Логи операций |
| `/admin/telegram` | `admin/telegram.vue` | Telegram-бот |
| ⭐⭐ `/admin/accounts-health` | `admin/accounts-health.vue` | Account Observability Dashboard (Track G) — 6 stat-cards, horizontal bar по платформам, таблица сортированная по completeness ASC |
| ⭐⭐ `/admin/integrations` | `admin/integrations/index.vue` | Indigo workspace + Test connection |
| ⭐⭐ `/admin/warmup-keywords` | `admin/warmup-keywords.vue` | CRUD WarmupKeywordPool |
| `/trends` | `trends/index.vue` | Тренды |
| `/trends/[id]` | `trends/[id].vue` | Детали тренда |
| `/scenarios` | `scenarios/index.vue` | Сценарии |
| `/scenarios/[id]` | `scenarios/[id].vue` | Редактор сценария |
| `/videos` | `videos/index.vue` | Видео |
| `/videos/[id]` | `videos/[id].vue` | Детали видео |
| `/uploads` | `uploads/index.vue` | Загрузки |
| `/uploads/[id]` | `uploads/[id].vue` | Детали загрузки |
| `/analytics` | `analytics/index.vue` | Аналитика |
| `/analytics/[uploadId]` | `analytics/[uploadId].vue` | Детали поста |
| `/accounts` | `accounts/index.vue` | Соцсети-аккаунты |
| `/ideas` | `ideas/index.vue` | Идеи |
| `/ideas/[id]` | `ideas/[id].vue` | Детали идеи |
| `/creatives` | `creatives/index.vue` | Креативы |
| `/references` | `references/index.vue` | Референсы |
| `/settings` | `settings.vue` | Настройки и интеграции |
| ⭐ `/prompts-library` | `prompts-library/index.vue` | Библиотека избранных промтов |
| `/pipeline` | `pipeline/index.vue` | Каталог + центр мониторинга |
| `/pipeline/[id]` | `pipeline/[id]/index.vue` | Редактор графа |
| ⭐ `/pipeline/[id]/runs` | `pipeline/[id]/runs/index.vue` | История запусков |
| ⭐ `/pipeline/[id]/runs/[runId]` | `pipeline/[id]/runs/[runId].vue` | Детали запуска |
| ⭐⭐ `/proxies` | `proxies/index.vue` | Список прокси, ProxyAddModal, mass check, ProxyCheckHistoryModal |
| ⭐⭐ `/indigo` | `indigo/index.vue` | Indigo profiles, фильтры по syncStatus и поиск, Sync/Создать/Credentials |
| ⭐⭐ `/posting-jobs` | `posting-jobs/index.vue` | PostingJob с фильтрами, retry, cancel, logs |

### 5.5. Components

> 208 .vue-файлов (+12 за период 2026-04-25 → 2026-05-05). Полный список — в разделе 1 (дерево). Ключевые добавления:

#### account/ (13)
- ⭐ `AccountStyleProfileEditor.vue` — модальный редактор AccountStyleProfile c 7 табами и AI suggest
- ⭐ `AccountStyleStatusBadge.vue` — статус профиля стиля (pending/active/conflicting)
- ⭐⭐ `AccountEditModal.vue` — табы Доступы / Прокси / Indigo / Прогрев
- ⭐⭐ `AccountCredentialsForm.vue` — per-field reveal через указание причины, pre-load через `/credentials-meta` (только non-secret + hasLoginX boolean), placeholder'ы шифрованных полей «не изменено» vs «не задано», валидация birthDate не в будущем
- ⭐⭐ `AccountCredentialRevealModal.vue` — модал ввода причины reveal (`SecretAccessLog`)
- ⭐⭐ `AccountIndigoTab.vue` — таб Indigo (replace заглушки)
- ⭐⭐ `AccountWarmupTab.vue` — 4-й таб Прогрев с превью-модалом, историей сессий и DELETE
- ⭐⭐ `AccountProxyPicker.vue` — выбор прокси
- ⭐⭐ `AccountPicker.vue` — табы Аккаунт/Группа, поиск, фильтр платформы, inline-предупреждения; используется в UploadConfig.vue вместо мёртвого SharedAsyncSelect

#### admin/ (18 + telegram/7)
- ⭐ `AppReferenceImagesManager.vue` — inline-менеджер reference-картинок приложения, ⭐⭐ переписан под карточный грид с AI-блоком, polling 4с пока есть pending, кнопкой rerun и spinner
- ⭐ `AppReferenceImagesModal.vue` — модалка загрузки с drag&drop, paste-catcher, SHA1 dedup
- `AppForm.vue` — расширен бейджами FieldProvenance и confidence-scores
- ⭐⭐ `AppAccountsManager.vue` — карточка Аккаунты соцсетей и группы на /admin/apps/[id]: список SocialAccount, список AccountGroup, создание группы с выбором dispatchMode, удаление через DaisyUI dialog
- ⭐⭐ `AccountCompletenessBar.vue` — h-1/h-2 с aria-valuenow для accounts-health
- ⭐⭐ `AccountsHealthSummary.vue`, `AccountsHealthByPlatform.vue` (horizontal bar), `AccountsHealthTable.vue` (lock+shield в Кредах)

#### favorite-prompt/ (4) ⭐
- `FavoritePromptCard.vue`, `FavoritePromptModal.vue`, `FavoritePromptFilters.vue`, `FavoritePromptButton.vue` — звёздочка-кнопка на детали видео

#### idea/ (10)
- ⭐ `IdeaReferenceAnalysis.vue` — пять закрытых секций (patterns, scenes, narrative, visual, transcript) с expandable preview
- ⭐ `IdeaSyncInfo.vue`, `IdeaSyncToolbar.vue` — двусторонняя синхронизация с MarketingCamp, бейджи статуса, кнопки sync/export

#### pipeline/ — основное ядро
- `PipelineNode.vue`, `PipelineCanvas.vue`, `PipelineToolbar.vue`, `PipelineRightPanel.vue`, `PipelineSidebar.vue`
- ⭐ `PipelineRunCard.vue`, `PipelineRunStats.vue` — переиспользуемые карточка и статистика рана
- `PipelineAiAuditLog.vue`, `PipelineAiAutofill.vue` — AI suggest для нод
- `PipelineNodeTestPanel.vue`, `PipelineNodeLastRun.vue` — тестирование и история per-node
- `PipelineCreateModal.vue`, `PipelineDeleteConfirmModal.vue`, `PipelineImportModal.vue`, `PipelinePresetsModal.vue`, `PipelinePreviewModal.vue`, `PipelineRunsModal.vue`, `PipelineScheduleModal.vue`, `PipelineUnsavedModal.vue`, `PipelineVersionsModal.vue`, `PipelineWebhookModal.vue`
- `PipelineTagPicker.vue` — ⭐ исправлен dropdown z-index (Teleport в `<dialog>` ancestor вместо body)

#### pipeline/config/ (16)
- ⭐ `ScenarioConfigEditor.vue` — модальный редактор сценарной ноды с 4 табами (Сценарий / Субтитры / Приложение / Озвучка), status-badges
- ⭐ `ScenarioAppSelector.vue` — выбор приложения с enrichment badge
- ⭐ `FavoritePromptsPicker.vue` — пикер избранных промтов в Scenario-конфиге (manual/AI auto)
- `VideoConfig.vue` — расширен на 22 поля, ⭐ AI Lip-sync чекбокс, premium-бейдж, блокировка на `fast_draft`
- `TrendwatcherConfig.vue` — ⭐ автономный (linked/inline режимы), AI autofill в верх

#### pipeline/config/trendwatcher/ ⭐ (5)
- `AiAutofill.vue`, `InlineForm.vue`, `ProfileEditorModal.vue`, `ProfilePicker.vue`, `ProfileSummary.vue`

#### pipeline/monitor/ ⭐ (11)
- `Block.vue`, `Card.vue`, `DirectoryBlock.vue`, `Empty.vue`, `Row.vue`, `Run.vue`, `RunSteps.vue`, `RunsList.vue`, `StepDataNode.vue`, `StepDataViewer.vue`, `Toolbar.vue`

#### scenario/ (12)
- ⭐ `ScenarioStoryPlan.vue` — визуализация StoryPlan timeline (premise/conflict/turningPoint/resolution + scene-cards с длительностью и эмоцией)
- ⭐ `ScenarioFeedbackForm.vue` — отзыв с рейтингом, AI-extracted requirements

#### shared/ (10)
- ⭐ `RunPipelineFilterBadge.vue` — бейдж активных pipeline/run фильтров для domain-страниц

#### video/ (14)
- ⭐ `VideoSubtitleEditor.vue` — inline-редактор субтитров после генерации (4 слова дефолт). ⭐ читает video.subtitlesStyle первым, badge «Из сценария / Изменено вручную» с кнопкой сброса
- ⭐ `VideoSubtitlePresetCard.vue`, `VideoSubtitlePresetPicker.vue` — выбор из 10 ASS-пресетов в стиле Opus.pro (CSS-имитация фоном + видео overlay opacity-0 до canplay)
- ⭐⭐ `VideoUniqueVariantsSection.vue` — DaisyUI tabs-lift, alert-info disclaimer о perceptual hashing, table table-xs с params, badge-soft. Интегрирован в /videos/[id] для completed-видео

#### ⭐⭐ proxy/ (5)
- `ProxyAddModal.vue` — radio-выбор протокола http/https/socks5 с подсказкой mobile=SOCKS5
- `ProxyCard.vue` — badge с протоколом, inline-блок с историей категорий и tooltip формата 'утечка IP: 3х (последний 30.04 14:25), след. через 18ч'
- `ProxyCheckHistoryModal.vue` — разворачиваемое details сообщение об ошибке с показом errorCategory
- `ProxyHealthBadge.vue`, `ProxyRevealCredentialsModal.vue`

#### ⭐⭐ indigo/ (6)
- `IndigoProfileCard.vue`, `IndigoProfileEditModal.vue`, `IndigoProfileLinkModal.vue`, `IndigoSyncStatusBadge.vue`, `IndigoSessionStatusBadge.vue`, `IndigoCredentialsModal.vue`

#### ⭐⭐ posting/ (5)
- `PostingJobCard.vue`, `PostingJobStatusBadge.vue`, `PostingJobLogsModal.vue`, `PostingJobRetryConfirm.vue`, `PostingJobCancelModal.vue`

#### ⭐⭐ warmup/ (6)
- `WarmupActionList.vue`, `WarmupPlanPreviewModal.vue`, `WarmupSessionCard.vue`, `WarmupSessionStatusBadge.vue`, `WarmupKeywordPoolCard.vue`, `WarmupKeywordPoolEditor.vue`

#### favorite-prompt/ (4) — обновления
- ⭐⭐ `FavoritePromptCard.vue` — 4 pattern-badges (camera/lighting/mood/intensity), три статуса анализа, кнопка Повторить, polling 5с в библиотеке пока есть pending

### 5.6. Composables (69)

#### Аккаунты и группы
- `useAccounts.ts`, `useAccountActions.ts`, `useAccountGroups.ts`
- ⭐⭐ `useAccountCredentials.ts` — pre-load non-secret через credentials-meta + reveal с указанием причины
- ⭐⭐ `useAccountsHealth.ts` — completeness данные для admin/accounts-health

#### Административные
- `useAdminDashboard.ts`, `useAdminUsers.ts`, `useAdminApps.ts`, `useAdminCycles.ts`, `useAdminLogs.ts`, `useAdminTelegram.ts`

#### AI
- `useAiSuggest.ts`

#### Аналитика
- `useAnalyticsDashboard.ts`, `useAnalyticsPosts.ts`, `useAnalyticsDetail.ts`, `useAnalyticsActions.ts`

#### Контент
- `useTrends.ts`, `useTrendDetail.ts`, `useTrendStats.ts`
- `useScenarios.ts`, `useScenarioDetail.ts`, `useScenarioActions.ts`, `useGenerateScenarios.ts`
- `useVideos.ts`, `useVideoDetail.ts`, `useVideoActions.ts`, `useVideoProgress.ts`
- `useUploads.ts`, `useUploadDetail.ts`, `useUploadActions.ts`, `useUploadModuleStatus.ts`
- `useIdeas.ts`, `useIdeaDetail.ts`, `useIdeaActions.ts`, ⭐ `useIdeaSync.ts`
- `useCreatives.ts`, `useReferences.ts`

#### Pipeline и мониторинг
- `usePipelines.ts`, `usePipelineDetail.ts`, `usePipelineActions.ts`
- `usePipelineRuns.ts`, `usePipelineRunDetail.ts`
- ⭐ `usePipelineMonitor.ts` — polling с debounce 300мс
- ⭐ `usePipelineMonitorUrlSync.ts` — sync filters (search/runs/sort/page/view) с URL
- ⭐ `useRunPipelineFilter.ts` — фильтрация domain-страниц по run/pipeline

#### Утилиты
- `usePermissions.ts`, `useRbacConfig.ts`, `useMarkdownSafe.ts`, `useIntegrationStatus.ts`

#### Trendwatcher
- `useTrendwatcherProfiles.ts`, `useTrendwatcherRuns.ts`

#### Прочее
- `useTaxonomy.ts`
- ⭐ `useAppEnrich.ts`, ⭐ `useAppReferenceImages.ts`
- ⭐ `useFavoritePrompts.ts`, ⭐ `useFavoritePromptDetail.ts`, ⭐ `useFavoritePromptActions.ts`
- ⭐⭐ `useSubtitlePresets.ts` — список из preset-registry, sampleVideoUrl null-safe

#### ⭐⭐ Антидетект (Social Automation)
- `useProxies.ts`, `useProxyActions.ts` (с `checkAllProxies` агрегатом)
- `useIndigoProfiles.ts`, `useIndigoActions.ts`
- `usePostingJobs.ts`, `usePostingJobActions.ts`
- `useWarmupSessions.ts`, `useWarmupActions.ts`, `useWarmupKeywords.ts`
- `useVideoVariants.ts` (MaybeRefOrGetter с toValue), `useVideoVariantActions.ts`

### 5.7. Stores (Pinia, 15)

- `adminFilters.ts` — фильтры на админ-страницах
- `trendFilters.ts`, `scenarioFilters.ts`, `videoFilters.ts`, `uploadFilters.ts`, `ideaFilters.ts`, `analyticsFilters.ts`, `creativeFilters.ts`, ⭐ `favoritePromptFilters.ts`
- `pipelineEditor.ts` — состояние редактора графа (selectedNode, viewport, dragging)
- ⭐ `pipelineMonitor.ts` — мониторинг конвейеров; **инвертированная логика** (хранит свёрнутые id), localStorage читается только в `onMounted` через `hydrateFromStorage` для исправления hydration mismatch
- ⭐⭐ `proxyFilters.ts` — фильтры списка прокси
- ⭐⭐ `indigoFilters.ts` — фильтры по syncStatus и поиск
- ⭐⭐ `postingJobFilters.ts` — фильтры PostingJob
- ⭐⭐ `warmupFilters.ts` — фильтры WarmupSession и пулов

### 5.8. Utils

- `format.ts` — форматирование дат, длительностей, размеров
- `guides.ts` — подсказки и onboarding-тексты
- `pipeline-node-meta.ts` — метаинформация типов нод (icon, label, category, ⭐ `nodeTypesWithCustomAiAutofill`)
- `pipeline-node-schema.ts` — JSON-схемы валидации (⭐ video schema расширена с 3 до 22 полей)

### 5.9. Assets

- `assets/css/main.css` — Tailwind 4 + DaisyUI 5 темы. ⭐ Добавлен `border-info/40` через `@source inline` для подсветки активных шагов мониторинга.

---

## 6. Shared (`shared/`)

### 6.1. Types (24 файла)

- `account-style.ts` — `AccountStyleProfile`, `AccountStyleRevision`, `StyleMode`, `StylePolicy`
- `agents.ts` — типы AI-агентов
- `analytics.ts` — `AnalyticsPostRow`, `AnalyticsFilters`, `DashboardStats`
- `app.ts` — `App`, `AppEnrichmentLog`, `FieldProvenance`, `StoreExtractionReport`
- `auth.d.ts` — Session, User-types
- `favorite-prompt.ts` — `FavoritePrompt`, `FavoritePromptFilters`. ⭐⭐ расширен `aiPatternAnalysis`/`aiAnalyzedAt`/`aiAnalysisError`/`aiAnalysisAttempts`
- `idea.ts` — `Idea`, `IdeaStatus`, `IdeaAnalysis`, `IdeaSource`, `SyncStatus`, `SyncDirection`, `IdeaSyncInfo`
- ⭐⭐ `kling-pattern.ts` — structured pattern (camera/lighting/mood/intensity/keywords) для prompt-pattern-extractor
- ⭐⭐ `pipeline-subtitle-config.ts` — конфиг subtitle для pipeline (preset ↔ wordsPerLine ↔ placement)
- `pipeline.ts` — `Pipeline`, `WorkflowRun`, `WorkflowStep`, `TriggerType`, `RunStatus`, `StepStatus`
- `reference.ts` — `ReferenceAnalysis`, `SceneBreakdown`, `NarrativePattern`, `VisualPattern`, `MechanicsInsight`
- `scenario.ts` — `Scenario`, `ScenarioVariant`, `ScenarioStatus`, `ReviewAction`, `ScenarioGenerationProfileData`, `ScenarioFeedbackDerived`, `OptimizationMemoryData`
- `story.ts` — `StoryPlan`, `SceneCard`, `ProtagonistBible`, `ContinuityBible`, `SubtitleStyleProfile`, `VoiceoverPlan`, `EmotionalJourney`. ⭐ `SUBTITLE_WORDS_PER_LINE_MIN/MAX/DEFAULT (3/6/4)`, required `wordsPerLine`. ⭐ `SceneCard.devicesInScene`, `appScreenRef`
- ⭐ `subtitle-preset.ts` — 10 ASS-пресетов (Opus.pro style): id, label, sampleVideoUrl, animation, font
- `trend.ts` — `Trend`, `TrendStatus`, `TrendInsight`, `CreativeBrief`
- `upload.ts` — `Upload`, `UploadStatus`, `SocialUploadAttempt`, `PostMetrics`
- `video-runtime.ts` — `StoryDrivenVideoPlan`, `VoiceoverPlan`, `MusicConfig`, `SubtitleStyle`, `LipSyncMode`
- `video.ts` — `Video`, `VideoStatus`, `VideoAsset`, `VideoFormat`, `ModelStrategy`
- `workflow.ts` — типы Workflow

#### ⭐⭐ Антидетект и постинг

- `proxy.ts` — `Proxy`, `ProxyType`, `ProxyProtocol`, `ProxyStatus`, `ProxyHealthCheck`, `PROXY_PROTOCOLS`
- `indigo.ts` — `IndigoProfile`, `IndigoSyncStatus`, `IndigoConfigSnapshot`
- `posting-job.ts` — `PostingJob`, `PostingJobStatus`, `PostingErrorCategory`, `PostingJobLog`
- `warmup.ts` — `WarmupSession`, `WarmupSessionStatus`, `WarmupKeywordPool`, distributions config
- `accounts-health.ts` — `AccountCompleteness`, `AccountsHealthSummary`, `AccountsHealthByPlatform` (8 критериев по 12.5%)

### 6.2. Utils (8 файлов)

- ⭐ `pipeline-format.ts` — форматтеры дат и длительностей
- `pipeline-humanize.ts` — humanize fallback (snake_case → русские названия)
- `pipeline-meta.ts` — метаинформация о типах нод
- `pipeline-node-routes.ts` — мапинг node-type → URL фильтра
- `pipeline-presets.ts` — стартовые шаблоны конвейеров
- ⭐ `pipeline-status.ts` — статусы и триггеры (run/step)
- ⭐ `scene-budget.ts` — расчёт бюджета сценария (sceneCountStrategy → ценовой диапазон)
- ⭐ `video-prompt-helpers.ts` — `DEVICE_NEGATIVES`, `buildDeviceOrientationBlock`, `DEVICE_RULES_NOTE_FOR_AGENTS`, `APP_SCREEN_ANCHOR_NEGATIVE` — единый источник правды для агентов и runtime (защита от бага «экран на задней крышке устройства»)

---

## 7. Агентная команда (`.claude/`)

### 7.1. Субагенты (`.claude/agents/`)

7 агентов: `analyzer.md`, `architect.md`, `critic.md`, `implementer.md`, `researcher.md`, `stylist.md`, `tester.md`. ⭐ В `tester.md` обновлено: «больше не коммитит самостоятельно, только рапортует о готовности».

### 7.2. Skills (`.claude/skills/`)

10 скиллов: `commit/`, `daisyUI/`, `daisyui-v5/`, `frontend-design/`, `skill-creator/`, `tailwind-4-docs/`, `webapp-testing/`, `web-dev/`, ⭐⭐ `visual-audit/` (workflow на 4 viewport, severity BLOCKER/MAJOR/MINOR, verdict NEEDS REWORK/PASS WITH NOTES/CLEAN, шаблоны overflow/tap-target/modal-overflow/contrast), ⭐⭐ `webapp-testing-extended/` (Vitest + @nuxt/test-utils + Playwright + supertest helpers, обзор тестовой инфраструктуры).

### 7.3. Agent Memory (`.claude/agent-memory/`)

#### `analyzer/`
- `MEMORY.md`, `ERRORS.md`

#### `architect/` (43 файла)
- `MEMORY.md` — общая архитектура
- `project_favorite_prompts.md`, `project_pipeline_monitor_dashboard.md`, `project_run_pipeline_filters.md`, `project_pipeline_guides_trendfilter.md`, `project_kling_prompt_enrichment.md`, `project_pipeline_execution_engine.md`, `project_video_runtime_parity.md`, `project_video_module.md`, `project_scenario_module.md`, `project_social_upload_module.md`, `project_trendwatcher_module.md`, `project_analytics_module.md`, `project_auth_integration.md`, `project_infrastructure_plan.md`
- ⭐⭐ `project_accounts_integration.md`, `project_app_screen_image_to_video.md`, `project_subtitle_presets_opus_style.md`, `project_subtitles_sync.md`
- ⭐⭐ `social_automation_iteration_1_preflight.md` / `_complete.md` — Foundation (Proxy/SocialAccount creds/SecretAccessLog)
- ⭐⭐ `track_a_preflight.md` / `_complete.md` — Foundation для Social Automation
- ⭐⭐ `track_b_preflight.md` / `_complete.md` — Indigo Browser API client (итерация 2)
- ⭐⭐ `track_c_complete.md` — Mock-инфраструктура для всех внешних API
- ⭐⭐ `track_d_preflight.md` / `_complete.md` — PostingJob state machine
- ⭐⭐ `track_e_preflight.md` / `_plan.md` — Account Warming Planner
- ⭐⭐ `track_f_preflight.md` / `_plan.md` — Content Uniqueness Pipeline
- ⭐⭐ `track_g_preflight.md` / `_plan.md` — Account Observability Dashboard
- ⭐⭐ `test_infra_preflight.md` — Vitest + Playwright инфраструктура
- ⭐⭐ `api_tests_complete.md` / `e2e_tests_complete.md`
- ⭐⭐ `visual_audit_skill_complete.md` — обоснование 4 viewport
- ⭐⭐ `favorite_prompts_finalization.md`, `idea_video_full_analysis.md`, `kling_prompts_extension.md`
- `video_65_diagnostic.md`, `video_65_rerun_instructions.md`

#### `critic/` (22 файла)
- `MEMORY.md`
- `review_favorite_prompts_code.md`, `review_kling_prompt_enrichment.md`, `review_pipeline_monitor_arch.md`
- `review_module1..5_arch.md` и `review_module1..5_code.md`, `review_module1_trendwatcher.md`
- `favorite_prompts_finalization_review.md`, `idea_video_full_analysis_review.md`, `kling_prompts_extension_review.md`
- ⭐⭐ `review_track_d_backend.md`, `review_track_e.md`, `review_track_f.md`, `review_track_g.md`
- ⭐⭐ `review_test_infra.md`, `review_subtitle_presets_code.md`

#### `implementer/`
- `MEMORY.md`, `project_patterns.md`
- ⭐ `feedback_hydration_localstorage.md`, `feedback_usefetch_reactive_query.md`

#### `researcher/`
- `MEMORY.md`, `kling_prompting_best_practices.md`, `project_ai_agents_collections.md`, `project_marketingcamp_auth.md`, `project_marketingcamp_full_research.md`, `project_module3_video_stack.md`, `project_module4_social_upload.md`, `project_pipeline_engine_research.md`, `project_pipeline_ux_patterns.md`

#### `stylist/`
- `MEMORY.md`, `reviewed_initial.md`, `reviewed_module1..5.md`, ⭐ `reviewed_favorite_prompts.md`

#### `tester/`
- `MEMORY.md` — единственный source-of-truth для текущего состояния
- ⭐⭐ `test_infra_dod.md` — DoD 14/14 PASS для test-infra
- ⭐⭐ `track_e_test.md` — отчёт по Account Warming Planner (31/31 PASS)
- `idea_video_full_analysis_test_report.md`, `kling_prompts_extension_test_report.md`

---

## 8. Документация (`docs/`)

- `SPEC.md` — полное ТЗ проекта
- `PIPELINE_SPEC.md` — спецификация pipeline-движка
- ⭐⭐ `COMPLIANCE.md` — Управление ENCRYPTION_KEY (инцидент-уровень high), backup-инструкция, rotation-procedure
- ⭐⭐ `architecture/social_automation.md` — общий гайд по антидетект-стеку:
  - Setup: ENCRYPTION_KEY (`openssl rand -hex 32`) с предупреждением о необратимой потере данных
  - Mock Development — 5 env-флагов и точки входа
  - Итерация 1 (Foundation) — Proxy/SocialAccount creds/SecretAccessLog
  - Итерация 2 (Indigo) — workspace credentials, sync, rate-limiter
  - Track F (Content Uniqueness) — disclaimer что ffmpeg меняет file hash и base metadata, но не обходит perceptual hashing TikTok/Meta

---

## 9. Прочее

### `public/`
- `favicon.ico`, `robots.txt`

### `storage/`

**`storage/fonts/`** ⭐ — шрифты с поддержкой кириллицы для ASS-субтитров (Anton, Montserrat-Bold/Black, Inter-Bold) с лицензиями OFL.

**`storage/uploads/`:**
- `app-references/{appId}/` — картинки-референсы (multipart, SHA1 dedup, выдача через `/api/files/[...path]`)
- `assets/{videoId}/` — промежуточные ассеты per-видео:
  - `scene_{n}_clip.mp4`, `scene_{n}_image.jpg`
  - ⭐ `scene_{n}_clip_norm.mp4` — нормализованный клип (H.264 high@4.1 yuv420p, 30fps, AAC 44.1k stereo) с кэшем по mtime
  - ⭐ `scene_{n}_spoken.mp3` (TTS для lip-sync)
  - ⭐ `scene_{n}_lipsync.mp4` (lip-synced версия клипа)
  - `voiceover_*.mp3`, `voiceover_mix.mp3`, `music.mp3`
- `videos/{videoId}.mp4` — финальные видео
- ⭐⭐ `unique/{videoId}/{platform}/{paramsHash}.mp4` — per-platform уникализированные варианты
- ⭐⭐ `_mock_cache/` — placeholder MP4/MP3/PNG для FAL_MOCK_MODE (генерируются ffmpeg с кешем по kind)

### `generated/prisma/`
Сгенерированный Prisma 7 клиент (gitignored).

---

## 10. Интеграция fal.ai

> ⭐ Новый раздел. Полный аудит интеграции fal.ai — всех точек обращения, моделей, паттернов и стандартов.

### 10.1. Архитектурный обзор

Интеграция реализована как четырёхуровневая обёртка:

1. **Базовый клиент** — `server/utils/fal.ts` (501 строка). Всё, что общается с queue.fal.run, идёт через него. Только этот файл импортирует HTTP-вызовы fal.ai напрямую.
2. **Реестр моделей** — `server/utils/video-models.ts` (505 строк). Centralized source of truth: id, цена, разрешения, длительности, integrated-флаг, tier (budget/standard/premium).
3. **Cost-слой** — `server/utils/video-cost.ts` (557 строк). Расчёт стоимости, presets, optimization tips.
4. **Persisted-tracking** — `server/utils/video-pipeline-db.ts` (217 строк). `falStepRequest` — idempotent reattach с per-step БД-снапшотом.

Все обращения проходят гейт `requirePaidApisEnabled("fal.ai")` из `paid-guard.ts`. Если `ENABLE_PAID_APIS!=true` — операция бросает 403 ещё до сетевого вызова.

### 10.2. Контракт и таймауты

```typescript
const MAX_TIMEOUT_MS = 20 * 60 * 1000   // 20 минут (Kling может идти 10-15 мин)
const INITIAL_DELAY_MS = 2000           // первый poll через 2с
const MAX_DELAY_MS = 30_000             // экспоненциальный backoff с cap 30с
```

`server/utils/fal.ts:24-26`. Дефолтный poll-интервал начинается с 2с и удваивается до 30с — оптимум для cost (мало запросов) и UX (быстрый ответ для коротких задач).

### 10.3. Авторизация

```typescript
function getAuthHeader(): Record<string, string> {
  const config = useRuntimeConfig()
  if (!config.falKey) {
    throw createError({ statusCode: 500, message: "API-ключ fal.ai не настроен. Установите FAL_KEY в .env" })
  }
  return {
    "Authorization": `Key ${config.falKey}`,
    "Content-Type": "application/json",
  }
}
```

`fal.ts:47-61`. fal.ai использует `Key {token}` (не Bearer). Один ключ из `FAL_KEY` для всех моделей и storage.

### 10.4. Парсинг endpoint URL

```typescript
function parseQueueBaseUrl(endpoint: string): string {
  const parts = endpoint.split("/")
  if (parts.length < 2) return `https://queue.fal.run/${endpoint}`
  // owner/alias — первые два сегмента
  const ownerAlias = `${parts[0]}/${parts[1]}`
  return `https://queue.fal.run/${ownerAlias}`
}
```

`fal.ts:37-45`. **Тонкость fal.ai:** для submit нужен полный путь (`fal-ai/flux/dev`), а для status/result/cancel — только owner/alias (`fal-ai/flux`). Эта функция стрипит лишние сегменты.

### 10.5. Обработка ошибок

`classifyFalError(status, url)` в `fal.ts:70-85` диагностирует HTTP-ошибки:

- **403** — нет доступа к модели (workspace/план не покрывает). Сообщение содержит endpoint и совет проверить план.
- **401** — невалидный/истёкший ключ.
- **429** — rate limit.

`fetchWithRetry(url, options, retries=1)` в `fal.ts:87-125` — стратегия retry:

- **403/401** → бросает понятную ошибку без retry (бесполезно).
- **429** → ждёт `retry-after` header (max 30с), затем 1 retry.
- **5xx** → sleep 2с, 1 retry.
- Другие → сразу пробрасывает.

### 10.6. Загрузка файлов в fal Storage

```typescript
export async function falUploadFile(filePath: string, contentType: string): Promise<string> {
  requirePaidApisEnabled("fal.ai")
  // Step 1: initiate
  const initResp = await $fetch<{ upload_url: string; file_url: string }>(
    "https://rest.alpha.fal.ai/storage/upload/initiate",
    {
      method: "POST",
      headers: { "Authorization": `Key ${config.falKey}`, "Content-Type": "application/json" },
      body: { content_type: contentType, file_name: basename(filePath) },
    },
  )
  // Step 2: PUT binary
  const buf = await readFile(filePath)
  await $fetch(initResp.upload_url, { method: "PUT", headers: { "Content-Type": contentType }, body: buf })
  return initResp.file_url
}
```

`fal.ts:136-178`. Двухходовая операция (presigned URL pattern):

1. POST `/storage/upload/initiate` → получаем signed `upload_url` + публичный `file_url`
2. PUT binary в `upload_url`
3. Возвращаем `file_url` для использования в моделях типа sync-lipsync, video-to-video, image-to-video — там нужен публичный URL входного ассета.

⭐ Используется в `lip-sync-runner.ts:160-163` для одновременной загрузки клипа Kling и аудио TTS.

### 10.7. Submit / Poll / Cancel / Reattach

```typescript
export async function falSubmit(endpoint: string, input: object): Promise<FalRequestMeta>
export async function falCheckStatus(endpoint: string, requestId: string): Promise<FalStatusResponse>
export async function falGetResult<T>(endpoint: string, requestId: string): Promise<T>
export async function falPollUntilDone<T>(endpoint, requestId, onStatusUpdate?, externalSignal?): Promise<FalRequestResult<T>>
export async function falCancel(endpoint: string, requestId: string): Promise<void>
export async function falReattach<T>(endpoint, requestId, onStatusUpdate?): Promise<FalRequestResult<T> | null>
```

- `falSubmit` (`fal.ts:184-208`) — POST `https://queue.fal.run/{endpoint}`, регистрирует request в `activeRequests` Map для cancel.
- `falCheckStatus` (`fal.ts:213-221`) — GET `/requests/{id}/status?logs=1`, возвращает {status, error?, logs?}.
- `falGetResult` (`fal.ts:226-234`) — GET `/requests/{id}` — для COMPLETED.
- `falPollUntilDone` (`fal.ts:263-330`) — экспоненциальный polling до 20 мин, проверяет `externalSignal?.aborted` (для hard cancel из pipeline-cancel-registry), вызывает `onStatusUpdate(status)` callback на каждой итерации (для обновления `falQueueStatus`/`falLogsSnapshot` в БД).
- `falCancel` (`fal.ts:239-256`) — PUT `/requests/{id}/cancel`, помечает request aborted в map. Многие модели не поддерживают cancel — это не критично.
- `falReattach` (`fal.ts:338-369`) — переподключение к существующему job. Если COMPLETED → fetch result; FAILED → null; IN_QUEUE/IN_PROGRESS → продолжить poll. Используется при resume рестартованного pipeline.

### 10.8. Probe доступа

`falProbeAccess(endpoint)` (`fal.ts:408-482`) — лёгкий preflight:

- GET `/requests/probe-nonexistent-000/status` (несуществующий ID)
- 403 → нет доступа (текущий ключ не покрывает модель)
- 404/422 → доступ есть (request просто не найден — ожидаемо)
- 401 → невалидный ключ
- Кэш TTL = 5 минут (избегает лишних probe при повторных запусках)

`falProbeAccessBatch(endpoints[])` — параллельная проверка для preflight в `video-pipeline.ts:146-171`. Перед началом генерации проверяются все нужные модели сразу — если хоть одна закрыта, юзер сразу получает понятную ошибку.

### 10.9. Реестр моделей

`server/utils/video-models.ts` экспортирует:

```typescript
export const IMAGE_MODELS: ModelMeta[]   // 2: FLUX.1 Schnell, FLUX.1 Dev
export const VIDEO_MODELS: ModelMeta[]   // 3: Kling 3.0 Standard/Pro, Hailuo-02 Standard
export const TTS_MODELS: ModelMeta[]     // 4: Kokoro EN, Kokoro RU, PlayAI v3, ElevenLabs Turbo
export const LIP_SYNC_MODELS: ModelMeta[] // 1: Sync Lipsync v1
export const MUSIC_MODELS: ModelMeta[]   // 1: Mubert
```

Каждая модель — `{ id, name, task, provider, pricing: {unit, base, withAudio?}, resolutions, durationRange?, durationOptions?, strengths[], tradeoffs[], avgGenerationTime, integrated, tier }`.

#### Видео-модели

| ID | Цена | Длительность | Tier | Integrated |
|----|------|--------------|------|-----------|
| `fal-ai/kling-video/v3/standard/text-to-video` | $0.084/с (без audio), $0.126/с (с audio) | 3-15с | standard | ✅ |
| `fal-ai/kling-video/v3/pro/text-to-video` | $0.112/с (без), $0.168/с (с) | 3-15с | premium | ❌ |
| `fal-ai/minimax/hailuo-02/standard/text-to-video` | $0.045/с | [5, 10] | budget | ❌ |

#### TTS-модели

| ID | Цена | Languages | Tier | Integrated |
|----|------|-----------|------|-----------|
| `fal-ai/kokoro/american-english` | $0.00025/audio_sec (~$0.015/мин) | EN | budget | ✅ |
| `fal-ai/kokoro/russian` | $0.00025/audio_sec | RU | budget | ✅ |
| `fal-ai/playai/tts/v3` | $0.00003/character (~$0.03/1000 chars) | multi | standard | ✅ |
| `fal-ai/elevenlabs/tts/turbo-v2.5` | $0.00015/character | 29 | premium | ❌ (opt-in) |

#### Lip-sync

| ID | Цена | Tier | Integrated |
|----|------|------|-----------|
| `fal-ai/sync-lipsync` | $0.067/output_sec | premium | ✅ |

### 10.10. Cost Presets

`server/utils/video-cost.ts:404-448`:

```typescript
export const COST_PRESETS: CostPreset[] = [
  { key: "budget",   imageModelId: "fal-ai/flux/schnell", sceneCount: 3, clipDuration: 3, generateAudio: false, enableMusic: false, voiceoverEnabled: false, quality: "720p" },
  { key: "balanced", imageModelId: "fal-ai/flux/dev",     sceneCount: 3, clipDuration: 5, generateAudio: true,  enableMusic: true,  voiceoverEnabled: true,  quality: "1080p" },
  { key: "quality",  imageModelId: "fal-ai/flux/dev",     sceneCount: 5, clipDuration: 10, generateAudio: true, enableMusic: true,  voiceoverEnabled: true, lipSyncEnabled: true, quality: "1080p" },
]
```

⭐ `quality.lipSyncEnabled=true` добавлено в коммите `ca92a51` (2026-04-25). ⭐ `balanced.voiceoverEnabled=true` исправлено в том же коммите — раньше дефолтный false проглатывал звук, даже когда сценарий запланировал реплики.

### 10.11. Persisted Step Tracking

`falStepRequest<T>(stepId, endpoint, input, subKey?)` в `video-pipeline-db.ts:146-217` — главный паттерн вызова fal.ai в pipeline-генерации. Контракт:

1. Если у step уже есть `falRequestId` + `falEndpoint` + `falSubKey` совпадает → `falReattach`. Если результат COMPLETED — возвращаем сразу, не сжигая API. Если FAILED → submit нового.
2. Если `falSubKey` НЕ совпадает (старый job был от другой сцены) → submit нового, лог объясняет причину.
3. Иначе — `falSubmit` + сохраняем `falRequestId/falEndpoint/falSubKey/falSubmittedAt/falQueueStatus=IN_QUEUE`.
4. `falPollUntilDone` с callback'ом, обновляющим `falQueueStatus` и `falLogsSnapshot` в БД на каждой итерации.
5. После COMPLETED — обновляем `falCompletedAt` и `falResultUrl`.

⭐ `falSubKey` (миграция `add_fal_subkey` от 2026-04-17) добавлен для **per-scene изоляции** — один `VideoGenerationStep` (например, `clip_generation`) генерирует N клипов, и каждый со своим `requestId`. Без `subKey` reattach при retry мог поднять чужой клип из соседней сцены.

### 10.12. Где используется fal.ai

#### Image generation (FLUX)
`video-pipeline-steps.ts:generateSceneImagePrompts/generateImages` — `fal-ai/flux/schnell` (быстрый, дешёвый) или `fal-ai/flux/dev` (качество). Запрос: `{ prompt, image_size: { width, height }, num_inference_steps }`. Цена: `ceil(megapixels) × unitPrice`.

#### Video generation (Kling)
`video-pipeline-steps.ts:328-513`:

```typescript
const result = await falStepRequest<FalVideoResult>(
  step.id,
  videoModelId,
  {
    prompt: scene.prompt,
    duration: String(scene.durationSec),    // "3"-"15"
    aspect_ratio: aspectRatio,              // "9:16" | "16:9" | "1:1"
    generate_audio: generateAudio,
    negative_prompt: negativePrompt,        // см. ниже
  },
  scene.key,                                // ⭐ subKey="scene_1", "scene_2", ...
)
```

⭐ **Negative prompt** (коммит `240f06a`) собирается из:
```typescript
const negativeParts = [
  "blur, distort, low quality",
  "morphing faces, extra limbs, warped hands, sliding feet, floating limbs",
  "text overlay, watermark",
  ...(storyPlan?.negativeConstraints ?? []),
  ...(storyPlan?.continuityBible?.forbiddenElements ?? []),
]
const negativePrompt = [...new Set(negativeParts.filter(Boolean))].join(", ")
```

⭐ Сама генерация промпта (коммит `240f06a`) обогащена 5 блоками контекста для Claude Sonnet:
1. Story Arc (premise/conflict/turningPoint/resolution)
2. Emotional Journey (scene.order → эмоция)
3. Visual Code (lighting/environment/subtitle accent)
4. Platform Context (targetPlatform/format)
5. Reference Prompts (top-3 FavoritePrompt как style compass без копирования)

`max_tokens` для Claude поднят с 3072 до 4096. Инструкция: 8-14 предложений, 150-250 слов, 13 критических правил, sequential action, motion intensity 0.3-0.9 от эмоции.

#### TTS (synthesizeSpeech)
`server/utils/tts.ts:200-256` — единый интерфейс для всех TTS-провайдеров через fal.ai:

```typescript
const result = await falRequest<Record<string, unknown>>(model.id, input)
const remoteUrl = extractAudioUrl(result)
await downloadFile(remoteUrl, options.outputPath)
const durationSec = await probeAudioDuration(options.outputPath)
const costUsd = computeSynthesisCost(model, characters, durationSec)
```

`computeSynthesisCost` в `tts.ts:180-190`:
```typescript
if (unit === 'character') return characters * model.pricing.base
if (unit === 'audio_second') return durationSec * model.pricing.base
```

Реальная длительность аудио важна для:
- **Reconciliation** — сравниваем планируемую длительность сцены с TTS-длительностью и решаем `accept/atempo/trim`
- **Точный cost** — для audio_second нужна реальная длительность

#### Lip-sync (sync-lipsync)
`server/utils/lip-sync-runner.ts:runLipSyncStep` — премиум-runner:

```typescript
// 1. TTS spokenLine
const tts = await synthesizeSpeech({ text: scene.spokenLine!, outputPath: audioPath, ... })

// 2. Загружаем клип и аудио в fal storage
const [videoUrl, audioUrl] = await Promise.all([
  falUploadFile(clipAsset.filePath, "video/mp4"),
  falUploadFile(audioPath, "audio/mpeg"),
])

// 3. Submit lip-sync
const meta = await falSubmit(model.id, {
  video_url: videoUrl,
  audio_url: audioUrl,
  sync_mode: "cut_off",          // обрезать аудио по длине видео
})
const result = await falPollUntilDone<FalLipSyncResult>(model.id, meta.requestId)
const lipSyncedUrl = result.data?.video?.url

// 4. Скачиваем lip-synced клип, заменяем оригинал
await downloadFile(lipSyncedUrl, lipSyncedPath)
await prisma.videoAsset.update({ where: { id: clipAsset.id }, data: { filePath: lipSyncedPath, fileUrl: ... } })
```

Цена: `sceneSec * 0.067`. Гейт: `lipSyncEnabled=true` AND есть сцены со `spokenLine`. Включён в `COST_PRESETS.quality`.

### 10.13. Полный flow генерации видео (story-driven)

`server/utils/video-pipeline.ts` — последовательность шагов:

| # | Step | Endpoint | Что делает |
|---|------|----------|-----------|
| 1 | `prompt_generation` | Anthropic | Claude Sonnet генерирует scene-prompts с обогащённым контекстом |
| 2 | `image_generation` | `fal-ai/flux/{schnell,dev}` | 1-N изображений (для thumbnails и обложек) |
| 3 | `clip_generation` | `fal-ai/kling-video/v3/standard/text-to-video` | N клипов per-scene с `falSubKey="scene_{n}"` |
| 4 | ⭐ `lip_sync_generation` | `fal-ai/sync-lipsync` | TTS spokenLine → upload → sync-lipsync (только если `lipSyncEnabled` и есть сцены со spokenLine) |
| 5 | `voiceover_generation` | TTS-модель + ffmpeg | TTS voiceoverPlan + reconciliation + ducking |
| 6 | `music_generation` | Mubert | Фоновая музыка (опц.) |
| 7 | `assembly` | FFmpeg (локально) | concat demuxer + audio lanes + drawtext субтитры |

**Cost tracking:**
- `estimatedCost` per step (preflight)
- `actualCost` per step (после)
- `totalCostActual = sum(all actualCost)` записывается в `Video.totalCostActual`

**Error handling:**
- timeout (`isTimeout = message.includes("таймаут") || message.includes("timeout")`) → `Video.status = "timeout"`
- иначе → `failed`
- `errorMessage` обрезается до 1000 символов

### 10.14. Strategy и Auto-pick

`recommendModels(strategy, options)` в `video-models.ts:411-486` — рекомендации по стратегии:

| Strategy | Image | Video | TTS |
|----------|-------|-------|-----|
| `budget` | FLUX.1 Schnell | Hailuo Standard (если integrated) или default | Kokoro |
| `balanced` | FLUX.1 Dev | Kling 3.0 Standard | Kokoro |
| `story_continuity` | FLUX.1 Dev | Kling 3.0 Standard | PlayAI |
| `high_realism` | FLUX.1 Dev | Kling 3.0 Pro (если доступна) | ElevenLabs |

`video-pipeline.ts:99-128` — авто-выбор для `strategy='auto'`:
- Если `voiceoverEnabled && sceneCount >= 3` → `story_continuity`
- Иначе если `sceneCount >= 3` → `balanced`
- Иначе → `fast_draft`

Только модели с `integrated=true` могут быть выбраны runtime'ом — premium-модели (Kling Pro, ElevenLabs) opt-in через UI.

### 10.15. Стандарты использования fal.ai в проекте

> Свод правил, найденных в коде и зафиксированных в коммитах:

1. **Один FAL_KEY на все модели и storage.** Не разделять по моделям — fal.ai даёт один ключ на workspace.
2. **Только через `server/utils/fal.ts`.** Никогда не вызывать `queue.fal.run` напрямую из других модулей — потеряешь retry, paid-guard, abort, audit.
3. **Запрос → submit + poll, не subscribe.** Все длинные модели (Kling, sync-lipsync) идут через queue API. `subscribe` или sync-вызовы не используются.
4. **Persisted job ID.** Любой submit обязан сохранять `falRequestId`/`falEndpoint` в `VideoGenerationStep` — иначе нельзя сделать reattach при перезапуске.
5. **Per-scene `falSubKey`.** Когда один step генерирует N независимых ассетов (по сценам), `subKey="scene_{n}"` обязателен. Без него reattach поднимет чужой ассет.
6. **`onStatusUpdate` callback.** При polling всегда обновлять `falQueueStatus` и `falLogsSnapshot` в БД — иначе UI прогресс «висит».
7. **Preflight через `falProbeAccessBatch`.** Перед началом тяжёлой генерации проверить доступ ко всем нужным моделям, чтобы не сжигать API на половине pipeline'а.
8. **`requirePaidApisEnabled("fal.ai")`.** Каждая публичная функция (`falSubmit`, `falUploadFile`) обязана пройти этот гейт. Чёрный режим (ENABLE_PAID_APIS=false) должен блокировать ещё до сетевого вызова.
9. **External signal.** Любой polling должен поддерживать `AbortSignal` — иначе hard cancel из pipeline-cancel-registry не сработает.
10. **Файлы в fal storage только публичные URL.** Если модель требует video_url/audio_url/image_url — всегда `falUploadFile` (двухходовая операция). Не отправлять local file paths или раздавать через `/api/files` (требует авторизации).
11. **negative_prompt — единая строка через дедуп.** Собирается из anti-artifacts + storyPlan.negativeConstraints + continuityBible.forbiddenElements, дедупится через `Set`. Кириллица и double-negation санитизируются ⭐ (после коммита `ca92a51`).
12. **EN-only для negative_prompt.** Story-architect и continuity-director обязаны генерировать только EN без формулировок «отсутствие/missing/no» — иначе Kling инвертирует смысл. Санитайзер чистит кириллицу.
13. **`generate_audio` для Kling.** Если включён, цена выше на 50% (`pricing.withAudio`). По умолчанию выключен — звук добавляется через voiceover lane в FFmpeg.
14. **Длительность Kling — `String`, не Number.** API ожидает строку: `duration: String(scene.durationSec)`.
15. **Aspect ratio.** `"9:16"` для portrait (TikTok/Reels), `"16:9"` для landscape (YouTube), `"1:1"` для square. Маппится из `Video.format`.
16. **Lip-sync `sync_mode`.** Использовать `"cut_off"` — обрезает аудио по длине видео. Альтернативы (`pad_audio`, `loop`) могут вносить артефакты.

### 10.16. Распространённые ошибки и решения

| Симптом | Причина | Решение |
|---------|---------|---------|
| HTTP 403 на одной модели | Workspace fal.ai не покрывает модель | Проверить план, использовать `falProbeAccess` для диагностики |
| HTTP 401 на всех запросах | Невалидный/истёкший FAL_KEY | Перевыпустить ключ в fal.ai dashboard |
| Polling висит 20 минут и таймаутит | fal.ai workers перегружены / job завис | Reattach при следующем запуске поднимет результат, если он завершился |
| Reattach поднял клип не той сцены | Не указан `falSubKey` | Передавать `scene.key` как 4-й аргумент `falStepRequest` |
| Lip-sync падает на upload | Файл больше лимита fal storage | Проверить размер клипа (Kling выдаёт 5-15с — обычно <30MB, лимит ~100MB) |
| TTS короче плана сцены | OK — accept | Reconciliation `accept` (без правки) |
| TTS длиннее плана | OK — atempo до 1.2x | Reconciliation `atempo`. Если ускорение >1.2x не помогает — `trim` с fade-out |
| Kling выдаёт чёрные кадры | Слабый prompt или конфликт constraint'ов | Усилить story arc + visual code блоки в Claude prompt |
| Kling негатив-промпт инвертирует смысл | Кириллица или double-negation | Санитайзер `storyPlan.negativeConstraints` (коммит `ca92a51`) |

---

## 11. Хроника изменений 2026-04-16 → 2026-04-25

> ⭐ Новый раздел. Все 38 коммитов с момента предыдущего аудита, сгруппированные по логическим темам.

### 11.1. Story-driven сценарный контур v3
**Коммиты:** `491b00e`, `d91c08b`, `b54cb5f`, `a40a12e`

Фундаментальная переработка сценарного pipeline — переход от генерации одиночных клипов к полноценному повествованию. Каждый сценарий теперь генерирует **`StoryPlan`** — комплексный JSON c `premise/conflict/turningPoint/resolution`, 3-6 сцен (`SceneCard` с durations 3-9с, `spokenLine`, visual mood, props), `protagonistBible` (характер, паттерны), `continuityBible` (anti-loop, forbiddenElements), `subtitleStyleProfile`.

**5 AI-агентов:**
- `story-architect-agent.ts` — дуга, инжекция accountStyle/referenceContext
- `scene-planner-agent.ts` — декомпозиция, spokenLine, haiku repair-pass при ratio<50%
- `continuity-director-agent.ts` — мёрж по `order`, заполнение protagonist
- `subtitle-director-agent.ts` — 4 слова/строка, anti-occlusion
- `optimization-memory-agent.ts` — `ScenarioFeedback` → `ScenarioMemory.requirements/recommendations`

**Бюджет** — `sceneCountStrategy`: minimal (3 сцены × 3-4с ≈ $1) … cinematic (6 × 9с ≈ $5). Жёсткий clamp в validation.

**Новые модели:** `ScenarioGenerationProfile`, `ScenarioFeedback`, `ScenarioMemory`. `ScenarioVariant` расширен на `storyPlan` (JSON), `feedbackCount`, `memoryId`. **Миграция:** `20260415172048_story_driven_scenario_pipeline`.

**Новые файлы:** `app/components/scenario/ScenarioStoryPlan.vue`, `ScenarioFeedbackForm.vue`, 5 агентов в `server/utils/agents/`, `shared/types/story.ts` (189 строк), 4 endpoint'а scenarios/feedback|memory|profiles.

### 11.2. Reference-driven generation
**Коммиты:** `080e1a3`

Глубокий анализ медиа-референсов (YouTube) с anti-copy трансформацией. Двухстадийный AI разбирает видео на patterns/scenes/narrative/visual/transcript и абстрагирует в **safe-to-reuse принципы** без копирования.

**Pipeline:**
1. `transcript-extractor.ts` (225 строк) — YT captions с таймкодами через ffprobe + yt-dlp
2. `reference-analyzer-agent.ts` (279 строк) — двухстадийный Claude Sonnet
3. `reference-pipeline.ts` (173 строки) — оркестрация
4. Инъекция в Story Architect (narrativePatterns), Scene Planner (visualPatterns), Subtitle Director (transcript)

**Idea расширен:** `referenceVideoUrl`, `referenceAnalysis` (JSON: sceneBreakdowns/narrativePatterns/visualPatterns/mechanicsInsights/characterDevelopment/transcript).

**Новый компонент:** `IdeaReferenceAnalysis.vue` (406 строк) — 5 закрытых секций. **Endpoint:** `POST /api/ideas/[id]/analyze-reference.post.ts`. **Миграция:** `20260416103145_add_reference_analysis_fields`.

### 11.3. Account-level style system
**Коммиты:** `f4fdd10`

Бренд-DNA на уровне SocialAccount. Один раз настроил `AccountStyleProfile` — всё творчество автоматически следует ему.

**`AccountStyleProfile.data`** содержит 7 аспектов: Tone&Voice, Visual Identity, Subtitle Style, Hero/Character archetype, Editing&Pacing, CTA&Branding. **`AccountStyleRevision`** хранит history с timestamp/changeType/diff/applied.

**`AccountGroup`** расширен на `styleMode` (inherit/custom/override) и `stylePolicy`.

**Резолвер** `account-style-context.ts` — иерархия: account → group → fallback.

**Интеграция в Scenario Pipeline v3.2:** Story Architect получает `accountStyle.tone`, Visual Style — `visualIdentity`, Subtitle Director — `subtitleStyle`. `analytics-ai.ts` пропагирует style-recommendations как pending revisions.

**UI:** `AccountStyleProfileEditor.vue` (7 табов), `AccountStyleStatusBadge.vue`. **Миграция:** `20260416110959_add_account_style_profile`.

### 11.4. MarketingCamp Ideas sync (двусторонняя)
**Коммиты:** `2506432`, `4ac063f`

Двусторонняя синхронизация `Idea` ↔ MarketingCamp. **Расширение Idea:** `externalId` (UUID на MC), `syncStatus` (none/synced/pending_*/conflict/error), `syncDirection` (push/pull/bidirectional/none), `remoteSnapshot` (JSON), `lastSyncedAt`, `lastSyncError`, `localDirty`.

**Conflict resolution:** last-modified wins; при diff в обеих системах с разными timestamp → `conflict`, ждёт ручного merge.

**Новые endpoints:**
- На стороне Zavod: `POST /api/ideas/sync/import|export`, `GET /api/ideas/sync/status`, `POST /api/ideas/[id]/sync`
- Внешний API для MC: `GET /api/zavod/health|ideas|ideas/[id]` под `requireZavodAuth` (Bearer)

**UI:** `IdeaSyncToolbar.vue`, `IdeaSyncInfo.vue`, sync-бейджи на карточках. **Composable** `useIdeaSync.ts`. **Миграция:** `20260416122630_add_idea_marketingcamp_sync`.

### 11.5. Pipeline runs и центр мониторинга
**Коммиты:** `96fcf62`, `fc4ffca`, `ed7186a`, `f36881b`, `d54f242`, `784bb36`

Двухблочная архитектура `/pipeline`: каталог + полноценный центр мониторинга с polling 3с, фильтрами, детализацией шагов, hard cancel.

**Сквозная фильтрация runId/pipelineId.** Все 5 domain-таблиц (Scenario/Trend/Video/Upload/Idea) получили nullable FK с onDelete:SetNull. 7 endpoint'ов принимают `?runId=&pipelineId=`. Composable `useRunPipelineFilter.ts` синхронизирует URL со сторами. Бейдж `RunPipelineFilterBadge.vue` на 6 страницах.

**Новые компоненты pipeline/monitor/:** Block, Card, DirectoryBlock, Empty, Row, Run, **`RunSteps.vue`** (детализация шагов внутри рана), RunsList, StepDataNode, StepDataViewer, Toolbar.

**Composables:** `usePipelineMonitor.ts` (debounced search 300мс, polling), `usePipelineMonitorUrlSync.ts` (search/runs/sort/page/view ↔ URL).

**Hard cancel:** `pipeline-cancel-registry.ts` хранит `AbortController` per run, cancel API abort'ит signal, каскадно отменяет video pipeline (`falCancel`) и child sub-pipelines. Все executor'ы (video/scenario/trendwatcher/upload/idea/wait/http/sub_pipeline) проверяют signal.

**Hydration mismatch fix:** store `pipelineMonitor` инвертирован — храним свёрнутые id, localStorage читается только в `onMounted` через `hydrateFromStorage`.

**Рефакторинг:** `pipeline-status.ts`, `pipeline-format.ts`, `PipelineRunCard.vue`, `PipelineRunStats.vue` вынесены в shared.

**Permissions:** добавлен `canWrite` для owner/admin, пробрасывается из `monitor.get.ts` в workflow.

**Миграции:** `20260423120509_add_pipeline_run_tracking`, `20260423162150_add_trendwatcher_skip_breakdown`.

### 11.6. App enrichment и multi-source store parsing
**Коммиты:** `de9a769`, `4feb391`, `27ec546`

Замена хрупкого regex-парсинга на multi-source extraction:

1. **JSON-LD primary** — `<script type="application/ld+json">` с `@type: SoftwareApplication`
2. **Meta tags fallback** — og:title, og:description, og:image
3. **DOM selectors** — поддерживаемые селекторы
4. **Regex** — последняя линия защиты
5. **AI backfill** — Claude Sonnet дозаполняет required fields, помечая `source=ai_fallback`

**FieldProvenance** на каждое поле: `{ source: json_ld|meta|dom|regex|ai_fallback, confidence: 0.0-0.9 }`. **StoreExtractionReport** возвращает `found`/`missing`/`requiredMissing`/`aiBackfilled`.

**Specifika Google Play:** парсинг `data-g-id` block для full description.

**Geo/locale:** `useUrlLocale` чекбокс в AppForm — locale из URL (`apps.apple.com/ru/`). Дефолт US/EN.

**Pipeline engine:** disconnected notification nodes теперь выполняются на последнем уровне; `scenariosCount/Skipped` корректно резолвятся в variable registry.

**UI:** AppForm — бейджи required, FieldProvenance breakdown, confidence scores. AppCard — кнопка удаления через ввод "УДАЛИТЬ" с `AppDeleteConfirmModal.vue`. `enrich-preview.post.ts` возвращает parsed данные при partial success.

### 11.7. Reference images приложения
**Коммиты:** `9c2bdd9`, `7ca589d`

`App.referenceImageUrls[]` — пользовательские картинки приложения, инжектируемые в Story Architect/Scene Planner как визуальные эталоны.

**Хранилище:** `storage/uploads/app-references/{appId}/` с **SHA1 dedup**. Multipart `POST /api/admin/apps/[id]/reference-images`, `DELETE` для удаления. Раздача через `/api/files/[...path]` с cache headers.

**UI:**
- `AppReferenceImagesManager.vue` — inline на странице приложения
- `AppReferenceImagesModal.vue` — модалка с drag&drop, кнопкой «Вставить из буфера» (`navigator.clipboard.read`), Ctrl+V paste-catcher (невидимый contenteditable div, автофокус при открытии модалки и после fail clipboard API)

**Composable:** `useAppReferenceImages.ts`. **Миграция:** `20260422130306_add_app_reference_image_urls`.

### 11.8. Trendwatcher node автономия
**Коммиты:** `c25f4be`, `eae3fa0`, `86e8a1d`, `6b53364`, `4852f19`, `bfbac17`

Trendwatcher из standalone-модуля стал автономной нодой pipeline. **Linked mode** — выбор существующего профиля. **Inline mode** — конфиг прямо в ноде материализуется в скрытый `TrendwatcherProfile` с `isInline=true`, `sourceNodeId/sourcePipelineId`. Кнопка saveAsProfile превращает в reusable.

**AI autofill:** `POST /api/ai/suggest/trendwatcher-config` заполняет весь блок (actor, keywords, platforms, geo/lang, пороги) с контекстом приложения и diff-preview.

**Sanitize actor IDs:** обнаружены несуществующие Apify акторы (`apify/tiktok-scraper`, `apify/youtube-scraper`). Введён `sanitizeActorId` мapping deprecated→working, миграция `20260416231500_backfill_broken_actor_ids` пересчитала legacy записи.

**Universal AI Autofill skip:** `nodeTypesWithCustomAiAutofill` registry — для Trendwatcher универсальный `PipelineAiAutofill` скрывается, специализированный AiAutofill переехал в верх формы.

**Dropdown z-index fix:** PipelineTagPicker уходил под `<dialog>` (top layer). Решение — `Teleport` ищет ближайший `<dialog>`-ancestor вместо body, reposition на scroll/resize, Escape закрывает только dropdown.

**Pipeline trigger fix** (`bfbac17`): runId/pipelineId теперь цепляются через `connect`, не scalar — `prisma.trend.create` падал типовой ошибкой и тихо улетал в catch warnings. Добавлены отдельные счётчики `dedupSkipCount/viewCountSkipCount/warningCount`. Catch логирует реальный текст ошибки.

**Миграции:** `20260416220154_trendwatcher_inline_profile`, `20260416230943_update_default_actor_id`, `20260416231500_backfill_broken_actor_ids`, `20260423162150_add_trendwatcher_skip_breakdown`.

### 11.9. Voiceover и TTS (fal.ai)
**Коммиты:** `0faeffe`

Озвучка из StoryPlan стала реально звучать. **`server/utils/tts.ts`** (332 строки) — единый провайдер через fal.ai:
- Kokoro EN (`fal-ai/kokoro/american-english`) и Kokoro RU
- PlayAI v3 (`fal-ai/playai/tts/v3`)
- ElevenLabs Turbo (`fal-ai/elevenlabs/tts/turbo-v2.5`, opt-in)

**Per-scene синтез:** каждая сцена имеет `voiceoverLine` (закадр) и `spokenLine` (речь персонажа). Реальная длительность через ffprobe.

**Reconciliation modes** (atempo vs trim):
- TTS короче плана → accept
- TTS длиннее → atempo до 1.2x
- Если >1.2x → trim с fade-out

**FFmpeg 3 lanes:** clip, music (-20dB), voiceover (-0dB с ducking). Ducking настраивается слайдером в VideoConfig.

**AssetType расширен:** `voiceover`, `voiceover_mix`. **VideoStepKey:** `voiceover_generation`.

**Video поля:** `voiceoverProvider`, `voiceoverModelId`, `voiceoverVoiceId`, `voiceoverLanguage`, `voiceoverPacing` (slow/moderate/fast), `voiceoverReconciliation`. **Миграция:** `20260416194312_add_voiceover_runtime`.

**UI:** VideoConfig.vue — секции «Стратегия» и «Озвучка» (provider/language/voice/pacing/reconciliation/ducking).

### 11.10. Premium Lip-sync
**Коммиты:** `ca92a51`

⭐ Новый шаг `lip_sync_generation` между clip и voiceover. **`server/utils/lip-sync-runner.ts`** (241 строка):

1. Гейт: `lipSyncEnabled=true` AND есть сцены со `spokenLine`
2. TTS spokenLine через `synthesizeSpeech` (выбранная voiceoverModel)
3. `falUploadFile` параллельно для клипа + аудио
4. `falSubmit` `fal-ai/sync-lipsync` с `{video_url, audio_url, sync_mode: "cut_off"}`
5. `falPollUntilDone` → скачать lip-synced клип → заменить `VideoAsset.filePath`

**Цена:** `sceneSec × $0.067`. **Гейт:** заблокирован на стратегии `fast_draft`, авто-сбрасывается при переключении в неё.

**Video поля:** `lipSyncEnabled`, `lipSyncModelId`. **VideoStepKey:** `lip_sync_generation`. **`COST_PRESETS.quality`** включает `lipSyncEnabled: true`.

**UI:** VideoConfig.vue — чекбокс «AI Lip-sync персонажа» с premium-бейджем.

**Также в этом коммите:**
- `voiceoverEnabled` фолбэчит на `storyPlan.voiceoverPlan.enabled` в pipeline-executors.ts и generate.post.ts
- `COST_PRESETS.balanced/quality.voiceoverEnabled = true` — раньше дефолтный false проглатывал звук
- Story-architect и continuity-director: жёсткие правила EN-only без формулировок «отсутствие/missing/no» для negativeConstraints. Санитайзер чистит кириллицу и double-negation в `storyPlan.negativeConstraints` и `continuityBible.forbiddenElements` — Kling negative_prompt больше не инвертирует смысл.
- Scene-planner: усилена инструкция spokenLine для person-протагониста + Haiku repair-pass когда ratio заполненных <50%.

**Миграция:** `20260425070159_add_video_lip_sync`.

### 11.11. Subtitles standard 4 words
**Коммиты:** `e7a51f1`, `d34cbb7`

Стандарт: 4 слова в строке вместо 5. Выравнено по всему pipeline:
- `render.ts` — FFmpeg drawtext с `wrapLimit=4` дефолт
- `subtitle-director-agent.ts` — `wordsPerLine=4` с границами 3-5
- subtitleCopy: 8-12 слов на сцену в 2-3 строки
- `VideoSubtitleEditor.vue` — дефолт 4, метка «TikTok стандарт» переехала с 5 на 4
- `shared/types/story.ts` — комментарии и доктекст обновлены

### 11.12. Favorite prompts library
**Коммиты:** `0011922`, `9ee2441`, `240f06a`

Библиотека лучших практик. Маркетолог отмечает удачный `VideoAsset.prompt` звездой — фиксируется immutable snapshot в `FavoritePrompt.promptText`. При генерации сценария Story Architect получает до 5 таких промтов как **«ОРИЕНТИР, не копия»**.

**Модель `FavoritePrompt`:** userId, appId? (null = универсальный), promptText, sourceVideoAssetId? (onDelete:SetNull), tags[] **GIN-индекс**, notes, isPublic, usageCount, lastUsedAt.

**5 endpoints:** `index.get/post`, `[id].get/put/delete`. RBAC + appAccess фильтр. **Миграция:** `20260423080754_add_favorite_prompts`.

**Источник через VideoAsset:** listing endpoint включает `sourceVideoAsset.video` для построения href кнопки «К источнику» (`9ee2441`).

**UI:**
- `/prompts-library` страница (CRUD, фильтры, DaisyUI delete dialog)
- `FavoritePromptButton.vue` ★ в детали видео рядом с промтом сцены
- В Scenario-ноде секция «Лучшие практики» с manual/AI-auto режимом (`FavoritePromptsPicker.vue`)

**Inject в Story Architect** (`buildStoryArchitectPrompt`) — top-3 промтов с инструкцией «ориентир, не копируй». Fire-and-forget `bumpUsage` после успеха.

**Kling enrichment** (`240f06a`):
- 5 блоков контекста для Claude в `generateSceneImagePrompts`: Story Arc, Emotional Journey, Visual Code, Platform Context, Reference Prompts
- Инструкция переписана: 8-14 предложений, 150-250 слов, 13 правил, motion intensity 0.3-0.9 от эмоции, sequential action
- `max_tokens` 3072 → 4096
- В FAL-вызов Kling добавлен отдельный `negative_prompt` (default + antiartifacts + storyPlan.negativeConstraints + continuityBible.forbiddenElements)
- `FavoritePrompt.usageCount` инкремент fire-and-forget после успеха

### 11.13. Pipeline idempotency, hardening, no_data, hard cancel
**Коммиты:** `a8ac6a8`, `07210c6`, `9d65b56`, `6aa8ccb`, `d54f242`

**Идемпотентность executors:** retry scenario/video больше не создаёт дубли. Проверка по `runStartedAt` scope. Upload `idempotencyKey` исправлен с `Date.now()` на стабильный hash.

**Race condition в трендах:** cycle-orchestrator атомарно захватывает тренды (DB row lock) — защита от race с прямым импортом из Trendwatcher UI.

**Лимитеры:** `maxTrends`/`maxVideos` в UI. Pre-run forecast warning — fan-out cardinality (3 сцены × 3 варианта = 9 видео).

**Sub-pipeline защита:** depth limit + ancestry chain в БД, `parentRunId` реально инжектируется. **Video pipeline lock** атомарный DB-level claim.

**Декомпозиция `video-pipeline.ts`:** разбит на `video-pipeline.ts` (575) + `video-pipeline-db.ts` (217) + `video-pipeline-steps.ts` (1172). Validator проверяет self-reference, mutual recursion, опасные video config комбинации.

**No-data контракт:** `StepStatus.no_data` (миграция `20260416210232_add_step_no_data_status`). Engine ставит для domain-узлов с `_noData=true`. Унифицированный контракт executors:
```typescript
{ _noData: boolean, _noDataReason: string, _domainStatus: 'found'|'no_data'|'partial'|'failed' }
```
`propagate` утилита передаёт downstream. Notification executor получает политики `skipOnNoData`/`treatNoDataAsWarning` (default true). Run detail показывает жёлтый блок «Нет данных: reason».

**Resume from crashed step:** engine на старте грузит prior steps в success/partial/no_data/skipped, восстанавливает output в Map, пропускает через `completedNodeIds`. Recover orphaned runs финализирует зомби-шаги. Retry-step API + UI кнопка на failed/cancelled. AI-ноды с дефолтным `retryCount=1`.

### 11.14. Story-driven video runtime + budget control
**Коммиты:** `a40a12e`, `b54cb5f`, `d13deae`

`StoryPlan` исполняется как scene-level video plan. **Per-scene duration:** каждая `SceneCard.durationSec` управляет длительностью своего клипа. Вместо uniform 30с теперь `[4s, 6s, 5s, 9s, ...]`.

**Synchronization Scenario↔Video:** `executeVideoNode` читает `storyPlan` из upstream scenario, синхронизирует `sceneCount`/`clipDuration` в Video record. `estimateVideoCost(scenarioId, variantIdx)` считает по реальным durations.

**Upstream context resolution:** `GET /api/pipelines/[id]/nodes/[nodeId]/upstream-context.get.ts` — BFS по edges находит ближайшую scenario-ноду. VideoConfig использует для баннера «Параметры синхронизированы со сценарием» и блокировки слайдеров.

**Pipeline-node-schema:** video расширена с 3 до 22 полей. **Humanize fallback** в `PipelineAiAutofill` — голые ключи (videoModelId) → русские названия («Модель видео»).

**Subtitle timing:** не 3 статичных overlay, а привязка к таймингу каждого клипа через ffprobe.

**Image generation skipping:** clip-only mode — если у сцены уже есть клип, image gen пропускается (для rework).

**Model strategy runtime override:** реально переопределяет `imageModelId/videoModelId/voiceoverModelId` (раньше стратегия висела помощником).

**Account style + app context + negative constraints** инжектируются в scene prompts.

### 11.15. Scenario node v2 в pipeline
**Коммиты:** `d91c08b`

Полная переработка ScenarioConfig. **`ScenarioConfigEditor.vue`** — модальный редактор с 4 табами:
1. **Сценарий** — protagonist, continuity (strict/flexible), anti-loop
2. **Субтитры** — placement (top/bottom/side), anti-occlusion
3. **Приложение** — `ScenarioAppSelector.vue` с enrichment badge, contextMode (describe/reference)
4. **Озвучка** — провайдер/голос/темп/reconciliation

**Status badges** для каждой секции (📝 / ⚙️ / ✅).

**AI autofill с зависимостями:** `POST /api/ai/suggest/scenario-config.post.ts` (новый endpoint) понимает `app → storytelling → subtitles → voiceover` зависимости. Doable с верхнего уровня ноды и внутри модала.

**Executor + Validator:** профильные настройки и расширенный app context передаются в генератор. Validator проверяет appId в БД и cross-section consistency (например, испанская озвучка для US-приложения = warning).

### 11.16. Closure-pass enrichment data flow
**Коммиты:** `ae7a5a7`, `27ec546`

`creativeAngles` и `scenarioContext` больше не теряются в create flow. Partial preview возвращает parsed данные. Статусы completed/partial/failed валидируются по обязательным полям. Geo/language из URL магазина с fallback US/EN.

Video pipeline переведён на scene-level промпты из StoryPlan вместо legacy hook/body/cta. Subtitle style profile маппится на ffmpeg render с placement presets и anti-occlusion. AI bundle получил post-generation coherence check.

### 11.17. Spoken line, budget UI, subtitle editor
**Коммиты:** `f0d0bb4`

**`SceneCard.spokenLine`** — речь персонажа в кадре (vs `subtitleCopy` экранный текст и `voiceoverLine` закадр). Scene-planner генерит явной директивой `<spoken>...</spoken>`. Continuity-director сохраняет при правке через мёрж по order.

**Budget UI:** `sceneCountStrategy` selector в основном UI. Palette пользователя (profileSettings) передаётся в storyArchitect и visual-style как обязательное ограничение «ПРИОРИТЕТ ПОЛЬЗОВАТЕЛЯ».

**`VideoSubtitleEditor.vue`:** inline-редактор после генерации, можно изменить текст и wordsPerLine перед финальным рендером.

### 11.18. Bearer-auth для MarketingCamp
**Коммиты:** `4ac063f`

Новые endpoints под `requireZavodAuth` для pull идей со стороны MarketingCamp:
- `GET /api/zavod/health.get.ts`
- `GET /api/zavod/ideas.get.ts`
- `GET /api/zavod/ideas/[id].get.ts`

Симметрично нашему клиенту `/api/zavod/creatives` на стороне MC.

### 11.19. Hard cancel via AbortController
**Коммиты:** `d54f242`

`pipeline-cancel-registry.ts` — registry per run. Cancel API:
- `controller.abort()`
- Каскадно `falCancel` на активных fal.ai-job
- Отменяет child sub-pipeline runs
- Все executors (video/scenario/trendwatcher/upload/idea/wait/http/sub_pipeline) проверяют `signal.aborted` и прерываются

UI честно показывает «отмена в процессе» / «остановлено». Telegram alert с реальным статусом.

### 11.20. Резюм рана и идемпотентность fal.ai
**Коммиты:** `6aa8ccb`

Pipeline engine при resume грузит prior steps (success/partial/no_data/skipped), восстанавливает output в Map, пропускает через `completedNodeIds`. После crash сервера упавший run не дублирует уже выполненные ноды и не сжигает API повторно.

`falStepRequest` использует `falReattach` если есть сохранённый `falRequestId` + `falEndpoint` + совпадение `falSubKey` — поднимает результат COMPLETED job без нового submit.

### 11.21. Trendwatcher AI блок и устаревшие Apify акторы
**Коммиты:** `4852f19`

AI-промпт предлагает стратегию поиска. Бэкенд подгружает strategy taxonomy items, передаёт в системный промпт со slug/name/use cases. AI выбирает по target audience и уже заполненным полям. Парсятся deprecated акторы (`apify/tiktok-scraper` → `clockworks/streamers`) с inline-warning и suggest fix.

Сводный список новых и переименованных акторов мигрирован в `actor_id_mapping.json` с автоконверсией при load профиля. Проверка совместимости при validate. Inline-warning в форме при выборе deprecated.

### 11.22. Hardening и idempotency для pipeline executors
**Коммиты:** `a8ac6a8`, `07210c6`

Sub-pipeline защищён от рекурсии через depth limit (max=5) и ancestry chain в БД, `parentRunId` реально инжектируется в child run'ы. Video pipeline lock — атомарный DB-level claim (вместо read-then-write).

Validator усилен проверками enum values, опасных video config combinations (`clipOnly=true` + `imageModelId=gpt4-vision` бессмысленно).

Retry scenario/video не создаёт дубли (idempotency через `runStartedAt` scope). Upload idempotencyKey — стабильный hash content вместо `Date.now()`.

### 11.23. No-data edge case closure
**Коммиты:** `9d65b56`

`StepStatus.no_data` через миграцию. Унифицированный executor контракт (`_noData/_noDataReason/_domainStatus`). Notification executor с политиками. Telegram больше не шлёт ложные ✅ когда ни одна domain-нода не произвела данных. Run detail показывает жёлтый блок «Нет данных».

### 11.24. Pipeline scenario sync
**Коммиты:** `d13deae`

`executeVideoNode` читает `storyPlan` из upstream scenario, синхронизирует `sceneCount/clipDuration` в Video. `estimateVideoCost` принимает `scenarioId+variantIdx` — реальные durations, не uniform.

---

## 12. Хроника изменений 2026-04-25 → 2026-05-05

> 26 коммитов с прошлого аудита. Период разделён на 3 крупных направления: **(A) Доводка Story-driven cценария / Kling**, **(B) Social Automation Stack** (треки A→G), **(C) Тестовая инфраструктура и Mock-режим**.

### 12.1. Интеграция аккаунтов и групп с Upload-нодой конвейера
**Коммит:** `939cad4`

`SocialAccount.lastPostedAt` (для round-robin), `AccountGroup.dispatchMode` (round_robin/all/first_active), `Upload.accountGroupId` FK SetNull + `Upload.dispatchMode` для трассировки. Миграция `accounts_pipeline_integration`.

`executeUploadNode` переписан через `resolveUploadTarget` — режимы account/group, round_robin сортирует по lastPostedAt, all создаёт Upload на каждого active-члена, first_active по id. lastPostedAt тикается сразу при create для честной ротации.

`pipeline-validator.ts` потерял жёсткий REQUIRED accountId, получил структурную+DB-проверку (error на missing/inactive, warning на platform mismatch с upstream video).

Новый `AccountPicker.vue` (табы Аккаунт/Группа, поиск, фильтр платформы, inline-предупреждения) подключён в `UploadConfig.vue` вместо мёртвого SharedAsyncSelect, который бил в несуществующий endpoint. На `/admin/apps/[id]` появилась карточка `AppAccountsManager.vue` с CRUD групп.

### 12.2. AppReferenceImage как image-to-video для Kling
**Коммит:** `8ac6edd`

Миграция `app_reference_images_metadata` создаёт `AppReferenceImage` с `aiTags`/`aiCaption`/`aiHasUI`/`aiPrimaryAction`/`aiAnalyzedAt` и **backfill из `App.referenceImageUrls` через UNNEST** (legacy-промпты остались как есть).

Новый `screen-tagger-agent.ts` гонит каждую загрузку через **Anthropic Vision Sonnet** с controlled-vocab из 23 тегов, fire-and-forget при upload и синхронный rerun через `/admin/apps/[id]/reference-images/[refId]/analyze`.

`scene-planner-agent.ts` получил блок ДОСТУПНЫЕ СКРИНШОТЫ с инструкцией класть `imageId` в `SceneCard.appScreenRef`. Validate приклеивает snapshot fileUrl и отбрасывает выдуманные id. `continuity-director-agent.ts` восстанавливает поле как spokenLine.

В `runClipGeneration` сцены с `appScreenRef` уезжают на `fal-ai/kling-video/v2.1/standard/image-to-video` через `falUploadFile` с clamp длительности до 5/10с. При удалении исходника откат на text-to-video с WARN.

UI: `AppReferenceImagesManager.vue` переписан под карточный грид с AI-блоком и polling 4с пока есть pending. `ScenarioStoryPlan.vue` показывает миниатюру 40x40 с intent-бейджем у сцен с image-to-video.

### 12.3. Защита от бага «экран на задней крышке устройства»
**Коммит:** `2bf56a1`

Новый `shared/utils/video-prompt-helpers.ts` — единый источник правды (`DEVICE_NEGATIVES`, `buildDeviceOrientationBlock`, `DEVICE_RULES_NOTE_FOR_AGENTS`, `APP_SCREEN_ANCHOR_NEGATIVE`).

`SceneCard` и `SceneRuntimeUnit` получили `devicesInScene`. scene-planner инструктирует AI заполнять массив устройств в кадре с санитайзером. story-architect и continuity-director получили device rules note в системные промпты, continuity-director восстанавливает `devicesInScene` из исходных сцен по order.

В `video-helpers.ts:generateSceneImagePrompts` per-scene **DEVICE ORIENTATION RULES** блок с CRITICAL RULE 14. `runClipGeneration` строит `negative_prompt` per scene через `buildDeviceNegativesForScene` с `APP_SCREEN_ANCHOR_NEGATIVE` для image-to-video. `runImageGeneration` добавляет AVOID-суффикс прямо в FLUX prompt с логированием для post-mortem.

### 12.4. Синхронизация wordsPerLine для субтитров
**Коммит:** `723c864`

Единая точка истины — `Video.subtitlesStyle`. Новый `shared/types/story.ts`: `SUBTITLE_WORDS_PER_LINE_MIN/MAX/DEFAULT (3/6/4)` с required `wordsPerLine`. Новый `server/utils/subtitle-style.ts` — `normalizeSubtitleStyle`/`mergeSubtitleStyle` с clamp и compat snake_case.

`render.ts` получил clamp 3..6 и убитый legacy chars-mode fallback. `runAssembly` принимает `subtitleStyleOverride` и читает live `Video.subtitlesStyle` вместо `storyPlan.subtitleStyle`. `edit-subtitles` переписан на запись в `Video.subtitlesStyle` с per-scene текстом в storyPlan и валидацией 3..6.

`subtitle-director-agent` теперь требует `wordsPerLine` в JSON-output с санитайзером. `scenario-pipeline` инжектит дефолт 4 inline. `VideoSubtitleEditor.vue` читает `video.subtitlesStyle` первым и показывает badge «Из сценария / Изменено вручную» с кнопкой сброса. Новый endpoint `/api/videos/[id]/rerender-assembly` и one-off скрипт `scripts/normalize-video-subtitles-style.ts`.

### 12.5. Production-grade Kling-промпты + FavoritePrompt pattern analysis
**Коммит:** `237c514`

Миграция `add_favorite_prompt_pattern_analysis` даёт `FavoritePrompt.aiPatternAnalysis/aiAnalyzedAt/aiAnalysisError/aiAnalysisAttempts` и enum `TaxonomyType.kling_pattern`.

Новая директория `server/utils/video-prompts/` декомпозирует `generateSceneImagePrompts` на 8 модулей (types/extras/scene-description/system-prompt/context-blocks/anthropic-call/post-validation/index) с **9 контекстными блоками** (Story Arc, Emotional Journey, Visual Code, Platform, Reference Patterns с structured analysis, App Context structured, Account Style, Continuity Bible, App Screen Reference) и 21 правилом для Kling. `max_tokens` поднят 4096 → 6144 у Sonnet.

2 Haiku-агента:
- `prompt-pattern-extractor.ts` — fire-and-forget с hard-cap `aiAnalysisAttempts >= 3`, кеширует pattern в `FavoritePrompt`
- `scene-prompt-validator.ts` — post-pass coherence check с возвратом original при count mismatch

Новый `call-anthropic-cached.ts` ставит `cache_control: ephemeral` на статичный system prompt с graceful degradation на 400. `video-helpers.ts` ужат 438 → 119 строк через re-export.

`runPromptGeneration` пробрасывает `appId+socialAccountId` в extras и пишет полный промпт-chain в `inputSnapshot.promptGenerationDebug`. `scripts/backfill-favorite-prompt-patterns.ts` через standalone PrismaClient + fetch для прогона существующих FavoritePrompt.

### 12.6. Финализация FavoritePrompts + полный цикл AI-анализа Idea-видео
**Коммит:** `f49f349`

`FavoritePromptCard.vue` показывает 4 pattern-badges (camera/lighting/mood/intensity) с тремя статусами анализа и кнопкой Повторить, polling 5с в библиотеке пока есть pending. Endpoint `/api/favorite-prompts/[id]/reanalyze.post.ts`.

`scenario-pipeline` собирает **STYLE COMPASS** блок со structured patterns и заставляет AI заполнять `SceneCard.appliedReferences`, inline-валидатор фильтрует галлюцинированные id и неизвестные aspects. `ScenarioStoryPlan.vue` показывает badge «Эталоны: N» с tooltip применённых промптов.

Полный цикл анализа Idea-видео через миграцию `add_idea_analysis_progress`: yt-dlp download + ffmpeg frames + `fal-ai/whisper` + Claude vision batch на 12 кадров с prompt caching через `video-frame-analyzer-agent.ts` и `video-scene-synthesizer-agent.ts`. Новые директории `server/utils/video-tools/` и `server/automation/` с watchdog в scheduler. `IdeaReferenceProgress.vue` с polling прогресса.

### 12.7. Subtitle-пресеты в стиле Opus.pro
**Коммит:** `3699005`

10 пресетов через ASS/libass с word-by-word highlighting (karaoke `\kf`), animation tags (fade/move/scale/glow), AI keyword detection через Haiku с heuristic-fallback.

Декомпозиция в `server/utils/subtitles/` — preset-registry, ass-builder (header/dialogue/animation-tags/keyword-emphasis), font-resolver, word-timings, render-ass с try/catch fallback на drawtext.

Новые компоненты `VideoSubtitlePresetPicker.vue` и `VideoSubtitlePresetCard.vue` с CSS-имитацией превью, расширен `VideoSubtitleEditor.vue` вкладками Стиль/Сцены, picker встроен в `VideoConfig.vue` для pipeline-level дефолта.

Шрифты Anton/Montserrat-Bold/Black/Inter-Bold с поддержкой кириллицы в `storage/fonts/` с лицензиями OFL. Backward-compat для tiktok_classic/tiktok_bold_yellow/tiktok_boxed/minimal через LEGACY_ALIASES.

### 12.8. FFmpeg-фиксы и ESCAPE-цикл для drawtext
**Коммиты:** `87ebc76`, `3a8afe1`, `fdb6445`

Серия фиксов FFmpeg-сборки:

1. `escapeDrawtext` сначала экранировал запятую как `\\,` потому что в filtergraph между фильтрами идёт запятой и текст «Hello, world» в `drawtext text='...'` ломал весь chain
2. Затем откат избыточного escape для двоеточия и запятой — по доке ffmpeg внутри одинарных кавычек `text='...'` все символы кроме `\` и `'` идут литералами. Двойной escape `:` → `\:` ломал drawtext
3. Pre-normalize клипов перед concat: `assembleVideo` прогоняет каждый клип через `normalizeClip` с H.264 high@4.1 yuv420p, 30fps, фиксированным timebase и AAC 44.1k stereo (silent track через `anullsrc` filter source внутри filter_complex без `-f lavfi` демуксера). Складывает `_norm.mp4` рядом с исходником с кэшем по mtime

В `assembleVideo` подключены `on('start')` и `on('stderr')` хуки с кольцевым буфером последних 40 строк stderr и хвостом command line — при ошибке всё попадает в текст исключения.

Превью пресетов субтитров: `listPresets` null-ит `sampleVideoUrl` если public-файла нет, `VideoSubtitlePresetCard` рендерит CSS-имитацию всегда фоном а видео overlay'ем с opacity-0 до canplay (в dev режиме SPA-fallback HTML на 404 не вызывает event 'error' и прежняя логика прятала имитацию вместе с битым видео).

### 12.9. Серия fal.ai фиксов
**Коммиты:** `be25ff8`, `bc1976c`, `d80f4d4`, `d7993c0`

- `parseQueueBaseUrl` колебался: сначала возвращал полный endpoint (для playai/tts/v3), потом снова обрезали до owner/alias. Финальный фикс — обрезание до owner/alias для FLUX/Kling/PlayAI как в реальном response submit.
- Кнопка «Пропустить шаг» для опциональных voiceover_generation/music_generation через новый endpoint `/api/videos/[id]/skip-step` с whitelist
- `runVideoPipeline` preflight стал resume-aware — модели уже completed/skipped не пробуются (нет смысла валидировать FLUX когда изображение давно сгенерировано)
- `falProbeAccess` результат `probe_error` больше не кэшируется на 5 минут (один transient HTTP 405 залипал и блокировал все resume)
- Mandatory app integration в сценарии: scene-planner/subtitle-director/story-architect жёстко требуют `app.name` в spokenLine/subtitleCopy/voiceoverLine хотя бы одной центральной сцены и CTA финальной. Новый `scenario-marketing-validator.ts` с Haiku auto-repair блокирует storyPlan без бренда
- Kling system-prompt 200-280 → 250-500 слов, max_tokens 6144 → 8192, anthropic timeout 60с → 240с
- Бюджет сценария явно подписан с ценами в `ScenarioConfigEditor.vue`, `VideoConfig` читает `sceneCountStrategy` реактивно из pipeline editor store через `shared/utils/scene-budget` вместо устаревшего useFetch endpoint
- Фикс пустого `errorMessage` у Idea видео-анализа: `getRunner` в yt-dlp.ts стал async и автоматически находит `/usr/bin/yt-dlp` если postinstall youtube-dl-exec не отработал, env-override `YT_DLP_BIN_PATH`. `describeSubprocessError` дампит constructor name, code, exitCode, signal, command, stderr/stdout, stack. Clamp errorMessage в analyze-reference поднят 500 → 2000 символов

### 12.10. Трек A — Social Automation Foundation (итерация 1)
**Коммит:** `85a356e`

**Расширение `SocialAccount`:** login/password/recovery/2FA (encrypted), notes, birthDate, registrationSource, proxyId, indigoProfileId, warmupStatus, totalPostsPublished.

**Новые модели:** `Proxy`, `ProxyHealthCheck`, `SecretAccessLog`. **Enums:** ProxyType, ProxyStatus, WarmupStatus, RegistrationSource.

**Crypto** расширен `encryptSecret`/`decryptSecret`. Новый `secret-access.ts` — `readSecret` поверх `SecretAccessLog`, `sanitizeForLog`, `maskHost`, `buildSecretAccessContext`.

**Proxy-checker:** TCP connect через node:net + HTTP probe через https-proxy-agent с **leak-detection** (сравнение с серверным IP от ipify). `runProxyHealthCheck` сохраняет историю и пересчитывает status/consecutiveFailures. `assertProxyHealthyBeforeSession` для будущего runner.

**11 endpoints** — `/api/proxies` CRUD + check/checks/reveal и `/api/accounts/[id]/credentials` + `credentials/reveal` + `proxy`. Страница `/proxies`. 5 компонентов proxy/, 4 компонента account (CredentialsForm с per-field reveal через причину, EditModal с табами Доступы/Прокси/Indigo).

Scheduler получил **5-й setInterval раз в 4 часа** для проверки прокси с Telegram алертом на leak/dead.

Подняты `https-proxy-agent` и `socks-proxy-agent`. Миграция `social_automation_foundation`.

### 12.11. Расширение Proxy.protocol + HTTP-only fallback
**Коммит:** `4825579`

Миграция `add_proxy_protocol` с дефолтом http. `probe.ts` разделён на `probeHttps` (CONNECT туннель к ipinfo.io) и `probeHttp` (forward через http-proxy-agent к api.ipify.org без CONNECT) — при падении первой пробы автоматически дёргается вторая. Покрывает NodeMaven и других провайдеров с HTTP-only портом без CONNECT method. Для socks5 ветка единая через socks-proxy-agent.

`classifyProbeError` расширен распознаванием EPROTO/wrong version number с подсказкой про неверный протокол. `parseProxyString` понимает префиксы `http://`, `https://`, `socks5://` в shortcut вводе.

UI: radio-выбор протокола в `ProxyAddModal.vue` (mobile=SOCKS5), badge с протоколом в `ProxyCard.vue`, разворачиваемое details сообщение об ошибке в `ProxyCheckHistoryModal.vue` с показом errorCategory. API endpoints POST/PUT валидируют protocol через `PROXY_PROTOCOLS`.

### 12.12. Закрытие 4 критичных долгов Foundation
**Коммит:** `4319d85`

1. **Дедупликация Telegram-алёртов прокси** через `Proxy.alertHistory` Json и `server/utils/proxy/alert-dedup.ts` с quiet period 24ч для leak/consecutive_failures_3, 12ч для auth_failed, 7д для expired. Scheduler оборачивает `sendTelegramAlert` в `shouldSendAlert` + `recordAlert` с подсчётом suppressed в финальном AgentLog. `ProxyCard` показывает inline-блок с историей категорий и tooltip 'утечка IP: 3х (последний 30.04 14:25), след. через 18ч'
2. **ENCRYPTION_KEY UX:** `openssl rand -hex 32` в `.env.example` с предупреждением о необратимой потере данных, оба error-сообщения crypto.ts включают команду генерации, разделы Setup/backup в `docs/architecture/social_automation.md` и **Управление ENCRYPTION_KEY** в `docs/COMPLIANCE.md` с указанием инцидент-уровня high
3. **AccountCredentialsForm pre-load** через новый `GET /api/accounts/:id/credentials-meta` — возвращает только non-secret поля и hasLogin\* boolean без плейнтекста. `onMounted` заполняет birthDate/registrationSource/warmupStatus/notes, placeholder'ы шифрованных полей «не изменено» vs «не задано», валидация birthDate не в будущем
4. **Параллельная массовая проверка** `POST /api/proxies/check-all` с concurrency=5 через Promise.allSettled и chunks вместо последовательного await в for. `checkAllProxies` в composable, dismissable toast с агрегатом

Миграция `proxy_alert_dedup`. Smoke test `scripts/test-alert-dedup.ts` 24/24 pass.

### 12.13. Трек C — Mock-инфраструктура для всех внешних API
**Коммит:** `519f65b`

5 отдельных env-флагов `PROXY/INDIGO/ANTHROPIC/FAL/TELEGRAM_MOCK_MODE` с обходом `requirePaidApisEnabled`. Общая точка входа в `server/utils/mock/` (mode, fixture-loader, anthropic-mock, fal-mock).

Standalone HTTP-моки `server/__mocks__/proxy-server.ts` на 18888 и `indigo-server.ts` на 35001 со сценариями через query или X-Mock-Scenario header. Proxy mock работает short-circuit'ом в `checkProxy` по host (mock-happy_path/mock-leak/mock-auth_failed/mock-timeout) без сетевых запросов, потому что https-proxy-agent CONNECT через localhost не поднимется.

Anthropic mock через `agentName` в `callAnthropicAgent` грузит фикстуры из `server/__fixtures__/agents/`. **7 готовых фикстур:** story-architect, scene-planner, subtitle-director, prompt-pattern-extractor, trend-analyzer, idea-analyzer, visual-style.

`fal.ts` замокирован на submit/poll/getResult/uploadFile/probeAccess/checkStatus с `mock://` URL схемой. `downloadFile` в video-helpers распознаёт схему и генерит placeholder MP4/MP3/PNG через ffmpeg в `storage/uploads/_mock_cache/` с кешем по kind. Telegram messaging логирует payload в stdout.

Скрипты `mock:proxy/mock:indigo/mock:all` через tsx. `.env.example` с секцией Mock Mode. Раздел Mock Development в `docs/architecture/social_automation.md`. Smoke-тест `scripts/test-mock-mode.ts`.

### 12.14. Трек B — Indigo Browser API client (итерация 2)
**Коммит:** `40ea234`

**Prisma модель `IndigoProfile`** с миграцией `indigo_profile`, **`IndigoSyncStatus` enum** (synced/local_only/remote_only/conflict/deleted_remote/error). **opaque `config:Json` snapshot** для устойчивости к расширению Indigo schema без миграций. Индексируемые denormalized поля name/platformType/os/userAgent/language/timezone. Связи 1:1 с SocialAccount и n:1 с Proxy.

**Server/utils/indigo/ модульный client** (max client.ts = 302 строки):
- `client.ts` — authenticate (MD5 password) + list/create/update/delete + start/stop, single base `launcher.indigobrowser.com:45001` (mock через `INDIGO_MOCK_MODE` на localhost:35001)
- `rate-limiter.ts` — token bucket 80 RPM
- `token-manager.ts` — `PipelineCredential[indigo:auth_token]` с refresh за 5 мин и `withIndigoToken` 401-retry wrapper
- `credentials.ts` — `PipelineCredential[indigo:workspace]` с шифрованным JSON email/password
- `sync.ts` — двусторонняя синхронизация по indigoId с пометкой conflict при name diff и deleted_remote для исчезнувших
- `dto.ts` — маппер без секретов

**Critical security:** `IndigoClient.startProfile` обязательно вызывает `assertProxyHealthyBeforeSession` ДО hit к Indigo, без прокси 503 и нет старта.

**14 API endpoints** `/api/indigo/profiles` CRUD + start/stop/link-account/unlink-account, `/api/indigo/sync`, `/api/indigo/credentials` PUT/DELETE + status и test.

UI: страница `/indigo` с фильтрами по syncStatus и поиском, кнопки Sync/Создать/Credentials. Страница `/admin/integrations` с карточкой Indigo workspace и Test connection. 6 компонентов indigo/. `AccountIndigoTab.vue` заменил заглушку в AccountEditModal таб Indigo. Пункт Indigo в навигации `default.vue`.

Composables `useIndigoActions` и `useIndigoProfiles`, store `indigoFilters`, `shared/types/indigo.ts`. Smoke test `scripts/test-indigo-mock.ts` PASS.

### 12.15. Треки D + E — Posting + Warming
**Коммиты:** `a17d9e8`, `492cc6f`

**Трек D — PostingJob state machine.** Модели `PostingJob`/`PostingJobLog`, миграция `posting_jobs`, 6 API endpoints под social-upload, `server/utils/posting/` — state-machine + job-service + worker + mock-runner (10% сбой для retry). 6-й setInterval scheduler 30 сек под флагом `POSTING_WORKER_ENABLED`. Страница `/posting-jobs` с фильтрами и 5 компонентов posting/, composables и store.

**Доводка по ревью** (`492cc6f`): переход `preparing → retry_queued` добавлен в state machine (без него jobs застревали при retryable pre-flight ошибке прокси). Миграция `posting_jobs_fk_and_index` — FK createdById/cancelledById на ZavodUser onDelete SetNull и **композитный индекс status+retryAt** для эффективного обхода retry_queued в worker tick. Exhaust-check default в `runner-mock.ts:postUrl` чтобы TS подсветил при добавлении новой Platform. Smoke test 18/18 pure state machine.

**Трек E — Account Warming Planner.** Планировщик ежедневной human-like активности с **детерминистическим seedable XorShift32** по seed `${accountId}:YYYY-MM-DD`. **Account-age aware:** new<7д, warming<30д, mature с 9 ключами распределений (tiktok/youtube/instagram × new/warming/mature).

Миграция `warmup_models` с моделями `WarmupSession` + `WarmupKeywordPool`. Дедуп ежедневных сессий через dayKey с 409 + replace flag. 11 API endpoints под moduleSlug social-upload. `server/utils/warmup/` из 9 модулей (rng/distributions/comment-pool/age-classifier/planner/keyword-pool/session-service/dto/validation).

UI: 4-й таб Прогрев в `AccountEditModal.vue` с превью-модалом и историей сессий + DELETE. Страница `/admin/warmup-keywords` с CRUD пулов и PageGuide. 6 компонентов warmup/.

Скрипты `seed-warmup-keywords` (7 default pools RU/EN по верткалям tech/lifestyle/fitness/education/music) и `test-warmup-planner` (31/31 PASS).

### 12.16. Трек F — Content Uniqueness Pipeline
**Коммит:** `2eff963`

ffmpeg-сервис per-platform уникализации видео перед постингом. **Prisma модель `VideoUniqueVariant`** с миграцией `add_video_unique_variants` и unique constraint videoId+platform+paramsHash.

`server/utils/video-uniqifier/` из 4 файлов (params/ffmpeg/service/index) с детерминистическим **XorShift32** seed `videoId:platform:v1` и кешем по paramsHash.

2 API endpoint: `uniqify` (canRunAgent, platform tiktok/youtube, instagram → 400) и `variants.get` (canRead).

UI: `VideoUniqueVariantsSection.vue` с DaisyUI tabs-lift, alert-info disclaimer о perceptual hashing, table table-xs с params, badge-soft бейджи и rounded-box. Интегрирован в `/videos/[id]` для completed-видео.

Composables `useVideoVariants` (MaybeRefOrGetter с toValue) и `useVideoVariantActions`. Скрипт `test-uniqifier.ts` с 4 assert (hash differs, tiktok!=youtube, duration ±5%, детерминизм paramsHash+fileHash) и cleanup TEST_DIR.

Round 2 фиксы по ревью: upsert вместо create против race condition при force=true (P2002), try/catch cleanup orphan-файла при ошибке ffmpeg, реактивный key-функция в useFetch.

Раздел **Content Uniqueness Pipeline (Track F)** в `docs/architecture/social_automation.md` с disclaimer что ffmpeg меняет file hash и base metadata, но **не обходит perceptual hashing TikTok/Meta**.

### 12.17. Трек G — Account Observability Dashboard
**Коммит:** `bd84a2b`

Дашборд состояния аккаунтов **без миграций** — агрегация на существующих полях через **13 параллельных Prisma-запросов** и **completeness scoring 8 критериев по 12.5%** (login/2FA/proxy/proxy healthy/indigo/warmup ready/warmup до 7д/active).

Endpoint `/api/admin/accounts-health.get.ts` под `requirePermission canAdmin` без утечки секретов — только `hasLoginCredentials` и `has2FA` boolean. Fallback `proxyStatus=unverified` при race-удалении.

Страница `/admin/accounts-health.vue` с 6 stat-cards, horizontal bar по платформам без сторонних либ, таблицей сортированной по completeness ASC и кликом на AccountEditModal. Плюс 4 компонента admin/ (Summary, CompletenessBar h-1/h-2 с aria-valuenow, ByPlatform, Table с lock+shield в Кредах).

### 12.18. Тестовая инфраструктура (Vitest + @nuxt/test-utils + Playwright)
**Коммит:** `08689b5`

**Стек:** Vitest 2 + @nuxt/test-utils 3 + Playwright 1 + supertest 7 + happy-dom.

`vitest.config.ts` с singleThread и alias под Nuxt. `playwright.config.ts` с **4 viewport проектами** (1920/1280/768/375) на порт 3100 (3001 занят MarketingCamp).

`tests/` структура c **`setup.ts` safety guards** (порт 5436 + имя 'tests' иначе блок). `global-setup.ts` с одноразовой `prisma migrate deploy`, TRUNCATE CASCADE в afterEach. Helpers (auth/api/factories) и smoke тесты unit/integration/e2e.

`TEST_AUTH_BYPASS` в `server/utils/rbac.ts:getAuthContext` с **двойным гейтом** NODE_ENV ≠ production + TEST_AUTH_BYPASS=1 + сверка заголовков `x-test-auth-token` и `x-test-user-id` с резолвом ZavodUser из БД, без активации в проде.

**Универсальный гейт `SCHEDULERS_ENABLED=false`** первой строкой в 4 плагина scheduler/trendwatcher-scheduler/pipeline-scheduler/telegram (раньше у trendwatcher и pipeline env-флага не было).

10 npm scripts (test/test:unit/test:integration/test:e2e/test:db:migrate). Skill `webapp-testing-extended`. `.env.test` и `.env.test.example` с расширением `.env.example` блоком Test infrastructure и `!.env.test.example` в `.gitignore`.

DoD 14/14 PASS — 6/6 vitest за 17 секунд, 1/1 playwright Desktop Chrome 1280, typecheck 0 ошибок, build PASS 30.5 MB, safety check блокирует чужую БД с понятным сообщением global-setup BLOCKED.

### 12.19. Skill visual-audit
**Коммит:** `c5d9cb5`

Skill для UI-аудита через Playwright MCP. Workflow на **4 viewport** (1920/1280/768/375 как в playwright.config.ts), severity BLOCKER/MAJOR/MINOR и verdict NEEDS REWORK/PASS WITH NOTES/CLEAN. Шаблоны overflow/tap-target/modal-overflow/contrast.

Хранилище `tests/visual/` с README и naming convention, screenshots в `.gitignore`, отчёты в md коммитятся.

### 12.20. E2E Critical Path Tests на Playwright
**Коммит:** `8e75560`

Покрытие 5 user flows (auth, proxy lifecycle, account setup, mobile navigation, settings) с авто-прогоном на 4 viewport. **15 тестов в 6 spec'ах = 59 passed/5 skipped/0 failed за 1.6 минуты.**

Test-bypass инфраструктура: 2 endpoint'а `server/api/_test/` (login через `setUserSession` и cleanup TRUNCATE CASCADE) с **тройным гейтом** NODE_ENV + TEST_AUTH_BYPASS + x-test-auth-token. 2 helper'а `tests/helpers/` (playwright.ts с login/disableAnimations/cleanupDatabase и e2e-setup.ts с setupTestData через реальные API endpoints). Per-platform счётчик displayName. `_template.spec.ts.example` для будущих фич.

**Критический фикс `nuxt.config.ts`:** `session.cookie.secure = NODE_ENV === 'production'` — без него Playwright получал Secure cookie и не отправлял её обратно по HTTP, ломая всё в 401.

Параллельно подняты **API contract тесты** `tests/api/` (27 тестов в 3 spec'ах под @nuxt/test-utils): proxies-crud, proxies-security, accounts-credentials-security.

---

## 13. Social Automation Stack ⭐ NEW

> Полный антидетект + публикационный стек, реализованный за период 2026-04-29 … 2026-05-05 в виде 7 треков (A→G). Все треки задокументированы в `.claude/agent-memory/architect/track_*.md`.

### 13.1. Архитектура

```
┌────────────┐         ┌────────────┐         ┌──────────────┐
│ SocialAcct │ ──1:1── │  Indigo    │ ──n:1── │    Proxy     │
│ (creds в.  │         │ Profile    │         │ (encrypted   │
│ encrypted) │         │ (config J) │         │  port/auth)  │
└──────┬─────┘         └──────┬─────┘         └──────┬───────┘
       │                      │                       │
       │ 1:N                  │                       │ 1:N
       ▼                      ▼                       ▼
┌────────────┐         ┌────────────┐         ┌──────────────┐
│ PostingJob │         │ Warmup-    │         │ ProxyHealth  │
│ (FSM 8     │         │ Session    │         │ Check (lat,  │
│  states)   │         │ (per day)  │         │  ipDetected) │
└────────────┘         └────────────┘         └──────────────┘
```

**Layered guards:**
1. `requirePaidApisEnabled` — сетевые операции
2. `assertProxyHealthyBeforeSession` — ДО Indigo start
3. `SecretAccessLog.readSecret` — на каждый decrypt с reason

**Mock-режим** (env per-сервис):
- `PROXY_MOCK_MODE=1` — short-circuit в `checkProxy`
- `INDIGO_MOCK_MODE=1` — `localhost:35001` вместо `launcher.indigobrowser.com:45001`
- `ANTHROPIC_MOCK_MODE=1` — фикстуры
- `FAL_MOCK_MODE=1` — `mock://` URL + ffmpeg-плейсхолдеры
- `TELEGRAM_MOCK_MODE=1` — stdout

### 13.2. Карта треков

| Трек | Тема | Модели | Миграции |
|------|------|--------|----------|
| **A** | Foundation (Proxy/SocialAccount creds/SecretAccessLog) | Proxy, ProxyHealthCheck, SecretAccessLog + расширение SocialAccount | `social_automation_foundation`, `add_proxy_protocol`, `proxy_alert_dedup` |
| **B** | Indigo Browser API (workspace/profiles/sync) | IndigoProfile + 1:1 SocialAccount | `indigo_profile` |
| **C** | Mock-инфраструктура (5 env-флагов, 7 фикстур) | — | — |
| **D** | PostingJob state machine | PostingJob, PostingJobLog | `posting_jobs`, `posting_jobs_fk_and_index` |
| **E** | Account Warming Planner (XorShift32 + age-aware) | WarmupSession, WarmupKeywordPool | `warmup_models` |
| **F** | Content Uniqueness Pipeline (per-platform ffmpeg) | VideoUniqueVariant | `add_video_unique_variants` |
| **G** | Account Observability Dashboard | — (агрегация) | — |

### 13.3. PostingJob state machine

```
pending → preparing → awaiting_proxy → in_progress → succeeded
                          │                  │
                          └─→ retry_queued ←─┘ (network/proxy retryable)
                                  │
                                  ▼
                              failed (после maxAttempts) | cancelled
```

⭐ Переход `preparing → retry_queued` добавлен в `492cc6f` (без него jobs застревали при retryable pre-flight ошибке прокси network_error/proxy_dead). Композитный индекс **status+retryAt** для эффективного обхода retry_queued в worker tick.

### 13.4. Warmup Planner (детерминистический)

```typescript
const seed = `${accountId}:${dayKey}` // dayKey=YYYY-MM-DD
const rng = new XorShift32(seed)       // pure deterministic
const profile = ageProfile(account)    // new<7d, warming<30d, mature
const distribution = DISTRIBUTIONS[`${platform}_${profile}`]
const actions = planner.plan(rng, distribution, keywordPool)
```

9 распределений (tiktok/youtube/instagram × new/warming/mature). Дедуп через `dayKey unique-per-account` с 409 при повторе без `replace=true`. 7 default-pool через `seed-warmup-keywords.ts`.

### 13.5. Content Uniqueness disclaimer

`docs/architecture/social_automation.md` явно проговаривает: ffmpeg меняет **file hash** (через bitrate/CRF jitter, padding) и **base metadata** (encoder name, creation date), но **не обходит perceptual hashing** TikTok/Meta. Уникализация работает только против простых fingerprint-систем.

---

## 14. Тестовая инфраструктура и Mock-режим ⭐ NEW

### 14.1. Стек

| Уровень | Инструмент | Что покрывает |
|---------|-----------|---------------|
| Unit | Vitest 2 + happy-dom | Чистые функции, сериализация, RNG |
| Integration | Vitest 2 + Prisma | Миграции БД, transaction, RLS |
| API contract | @nuxt/test-utils + supertest 7 | HTTP endpoint'ы, RBAC, secret reveal |
| E2E | Playwright 1 | User flows, мобильная навигация, формы |
| Visual | Playwright MCP + skill visual-audit | Скриншоты на 4 viewport, severity matrix |

### 14.2. Защита от прода

`tests/setup.ts` блокирует выполнение если БД не на порту 5436 ИЛИ имя БД не `tests` — global-setup BLOCKED с понятным сообщением. **safety**: невозможно случайно прогнать TRUNCATE CASCADE на проде.

### 14.3. TEST_AUTH_BYPASS

`server/utils/rbac.ts:getAuthContext` имеет двойной гейт:
1. `NODE_ENV !== 'production'`
2. `TEST_AUTH_BYPASS === '1'`
3. Сверка `x-test-auth-token` и `x-test-user-id` с резолвом ZavodUser из БД

В проде гейт никогда не активируется — `TEST_AUTH_BYPASS` отсутствует в `.env.example` для production.

### 14.4. SCHEDULERS_ENABLED

Универсальный гейт `SCHEDULERS_ENABLED=false` первой строкой во **всех 4 плагинах** (scheduler, trendwatcher-scheduler, pipeline-scheduler, telegram). Раньше у trendwatcher и pipeline env-флага не было, что мешало изолированному тест-прогону.

### 14.5. Mock-режим (5 флагов)

| Flag | Что мокирует |
|------|--------------|
| `PROXY_MOCK_MODE=1` | `checkProxy` short-circuit по host (mock-happy_path/mock-leak/mock-auth_failed/mock-timeout) |
| `INDIGO_MOCK_MODE=1` | base URL → localhost:35001, server `__mocks__/indigo-server.ts` |
| `ANTHROPIC_MOCK_MODE=1` | `callAnthropicAgent` грузит фикстуру по agentName из `__fixtures__/agents/` |
| `FAL_MOCK_MODE=1` | submit/poll/getResult/uploadFile/probeAccess с `mock://` URL, ffmpeg-плейсхолдеры в `_mock_cache/` |
| `TELEGRAM_MOCK_MODE=1` | payload в stdout |

Все обходят `requirePaidApisEnabled`, dev в полном mock-режиме встаёт на :3000.

### 14.6. Visual-audit workflow

| Severity | Verdict |
|----------|---------|
| BLOCKER (overflow viewport, contrast <3:1, нерабочий tap-target <40px) | NEEDS REWORK |
| MAJOR (модалка > viewport на мобиле, текст обрезан) | NEEDS REWORK |
| MINOR (gap inconsistency) | PASS WITH NOTES |
| Нет issues | CLEAN |

Шаблоны: overflow, tap-target, modal-overflow, contrast.

---

## 15. Сводная статистика

| Метрика | Значение | Δ за период |
|---------|----------|-------------|
| Vue компоненты | **208** | +12 |
| Pages (роуты) | **38** | +7 |
| Layouts / Middleware / Plugins | 2 / 3 / 1 | — |
| Composables | **69** | +14 |
| Pinia stores | **15** | +4 |
| App utils | 4 | — |
| Серверные утилиты | **~80** | +~20 (proxy/, indigo/, posting/, warmup/, mock/, video-uniqifier/, video-prompts/, subtitles/, video-tools/) |
| AI-агенты | **25** | +7 (prompt-pattern-extractor, scene-prompt-validator, screen-tagger, scenario-marketing-validator, subtitle-keyword, video-frame-analyzer, video-scene-synthesizer) |
| API endpoints | **261** | +50 (proxies, indigo, posting-jobs, warmup, _test, accounts-health, video uniqify/variants, skip-step, rerender-assembly, favorite-prompts/reanalyze) |
| Server plugins | 4 | — (все с SCHEDULERS_ENABLED gate) |
| Prisma моделей | **59** | +23 (Proxy, ProxyHealthCheck, IndigoProfile, SecretAccessLog, PostingJob, PostingJobLog, WarmupSession, WarmupKeywordPool, VideoUniqueVariant, AppReferenceImage, ...) |
| Prisma enum | **40** | +10 (ProxyType/Protocol/Status, WarmupStatus/SessionStatus, RegistrationSource, IndigoSyncStatus, PostingJobStatus, PostingErrorCategory, kling_pattern в TaxonomyType) |
| Миграций БД | **71** (от 2026-03-31 до 2026-05-05) | +13 |
| Shared types | 24 | +8 (account-style, kling-pattern, pipeline-subtitle-config, posting-job, proxy, indigo, warmup, accounts-health, subtitle-preset) |
| Shared utils | 8 | +2 (scene-budget, video-prompt-helpers) |
| Claude agents | 7 | — |
| Claude skills | 10 | +2 (visual-audit, webapp-testing-extended) |
| TS файлов | 500+ | +~100 |
| Строк кода | ~180k+ | +~30k |
| Коммитов с прошлого аудита | **26** (2026-04-25 → 2026-05-05) | — |
| Тестов (vitest + playwright) | **6 unit + 27 API + 15 E2E** | +новая инфра |

### Ключевые добавления 2026-04-25 → 2026-05-05 (26 коммитов)

| Тип | Имя | Локация |
|-----|-----|---------|
| Prisma model | `Proxy`, `ProxyHealthCheck` | prisma/schema.prisma |
| Prisma model | `IndigoProfile` | prisma/schema.prisma |
| Prisma model | `SecretAccessLog` | prisma/schema.prisma |
| Prisma model | `PostingJob`, `PostingJobLog` | prisma/schema.prisma |
| Prisma model | `WarmupSession`, `WarmupKeywordPool` | prisma/schema.prisma |
| Prisma model | `VideoUniqueVariant` | prisma/schema.prisma |
| Prisma model | `AppReferenceImage` | prisma/schema.prisma |
| Prisma enum | ProxyType, ProxyProtocol, ProxyStatus | prisma/schema.prisma |
| Prisma enum | WarmupStatus, WarmupSessionStatus, RegistrationSource | prisma/schema.prisma |
| Prisma enum | IndigoSyncStatus | prisma/schema.prisma |
| Prisma enum | PostingJobStatus, PostingErrorCategory | prisma/schema.prisma |
| Расширение SocialAccount | login/password/recovery/2FA (encrypted), proxyId, indigoProfileId, warmupStatus, lastPostedAt | prisma/schema.prisma |
| Расширение AccountGroup | dispatchMode (round_robin/all/first_active) | prisma/schema.prisma |
| Расширение Upload | accountGroupId FK, dispatchMode | prisma/schema.prisma |
| Расширение FavoritePrompt | aiPatternAnalysis, aiAnalyzedAt, aiAnalysisError, aiAnalysisAttempts | prisma/schema.prisma |
| Server util | `crypto.ts:encryptSecret/decryptSecret`, `secret-access.ts` | server/utils/ |
| Server util dir | `proxy/` (alert-dedup, dto, probe, proxy-checker) | server/utils/proxy/ |
| Server util dir | `indigo/` (client, credentials, dto, rate-limiter, sync, token-manager, types) | server/utils/indigo/ |
| Server util dir | `posting/` (state-machine, job-service, worker, runner-mock, error-classifier) | server/utils/posting/ |
| Server util dir | `warmup/` (rng, distributions, comment-pool, age-classifier, planner, keyword-pool, session-service, dto, validation) | server/utils/warmup/ |
| Server util dir | `mock/` (mode, fixture-loader, anthropic-mock, fal-mock) | server/utils/mock/ |
| Server util dir | `video-uniqifier/` (params, ffmpeg, service, index) | server/utils/video-uniqifier/ |
| Server util dir | `video-prompts/` (8 модулей декомпозиции generateSceneImagePrompts) | server/utils/video-prompts/ |
| Server util dir | `subtitles/` (ass-builder, font-resolver, preset-registry, render-ass, word-timings) | server/utils/subtitles/ |
| Server util dir | `video-tools/` (ffmpeg, subtitle-parsers, yt-dlp) | server/utils/video-tools/ |
| Server util | `subtitle-style.ts` (clamp 3..6, snake_case compat) | server/utils/ |
| Mock-инфра | `__mocks__/proxy-server.ts:18888`, `indigo-server.ts:35001` | server/__mocks__/ |
| Mock-инфра | 7 фикстур агентов | server/__fixtures__/agents/ |
| Automation | `automation/` (watchdog для idea-анализа) | server/ |
| AI-агент | `prompt-pattern-extractor.ts` | server/utils/agents/ |
| AI-агент | `scene-prompt-validator.ts` | server/utils/agents/ |
| AI-агент | `screen-tagger-agent.ts` | server/utils/agents/ |
| AI-агент | `scenario-marketing-validator.ts` | server/utils/agents/ |
| AI-агент | `subtitle-keyword-agent.ts` | server/utils/agents/ |
| AI-агент | `video-frame-analyzer-agent.ts`, `video-scene-synthesizer-agent.ts` | server/utils/agents/ |
| AI-агент | `call-anthropic-cached.ts` (cache_control: ephemeral) | server/utils/agents/ |
| API endpoint | `/api/proxies/*` (CRUD + check + check-all + reveal + checks) | server/api/proxies/ |
| API endpoint | `/api/indigo/*` (profiles + start/stop + link/unlink + sync + credentials) | server/api/indigo/ |
| API endpoint | `/api/posting-jobs/*` (CRUD + retry + cancel + logs + stats) | server/api/posting-jobs/ |
| API endpoint | `/api/warmup/*` (sessions + keywords + accounts/preview/schedule) | server/api/warmup/ |
| API endpoint | `/api/_test/{login,cleanup}.post.ts` (тройной гейт NODE_ENV+TEST_AUTH_BYPASS+x-test-auth-token) | server/api/_test/ |
| API endpoint | `/api/admin/accounts-health.get.ts` (13 параллельных Prisma + 8 критериев) | server/api/admin/ |
| API endpoint | `/api/accounts/[id]/credentials-meta.get.ts` (только non-secret + hasLoginX boolean) | server/api/accounts/ |
| API endpoint | `/api/videos/[id]/uniqify.post.ts`, `variants.get.ts`, `skip-step.post.ts`, `rerender-assembly.post.ts` | server/api/videos/ |
| API endpoint | `/api/favorite-prompts/[id]/reanalyze.post.ts` | server/api/favorite-prompts/ |
| API endpoint | `/api/admin/apps/[id]/reference-images/[refId]/analyze.post.ts` | server/api/admin/apps/ |
| Page | `/proxies` | app/pages/proxies/index.vue |
| Page | `/indigo` | app/pages/indigo/index.vue |
| Page | `/posting-jobs` | app/pages/posting-jobs/index.vue |
| Page | `/admin/accounts-health` | app/pages/admin/accounts-health.vue |
| Page | `/admin/integrations` | app/pages/admin/integrations/index.vue |
| Page | `/admin/warmup-keywords` | app/pages/admin/warmup-keywords.vue |
| Vue dir | `account/` (+7: AccountEditModal, AccountCredentialsForm/RevealModal, AccountIndigoTab/WarmupTab, AccountProxyPicker, AccountPicker) | app/components/account/ |
| Vue dir | `proxy/` (5 компонентов) | app/components/proxy/ |
| Vue dir | `indigo/` (6 компонентов) | app/components/indigo/ |
| Vue dir | `posting/` (5 компонентов) | app/components/posting/ |
| Vue dir | `warmup/` (6 компонентов) | app/components/warmup/ |
| Vue components | AccountsHealthSummary/ByPlatform/Table, AccountCompletenessBar, AppAccountsManager | app/components/admin/ |
| Vue components | VideoSubtitlePresetCard/Picker, VideoUniqueVariantsSection | app/components/video/ |
| Composable | useProxies/useProxyActions, useIndigoProfiles/useIndigoActions, usePostingJobs/usePostingJobActions, useWarmupSessions/useWarmupActions/useWarmupKeywords | app/composables/ |
| Composable | useAccountCredentials, useAccountsHealth, useVideoVariants/useVideoVariantActions, useSubtitlePresets | app/composables/ |
| Store | proxyFilters, indigoFilters, postingJobFilters, warmupFilters | app/stores/ |
| Shared type | proxy, indigo, posting-job, warmup, accounts-health, kling-pattern, pipeline-subtitle-config, subtitle-preset | shared/types/ |
| Shared util | scene-budget, video-prompt-helpers | shared/utils/ |
| Tests | tests/ (vitest + @nuxt/test-utils + Playwright + supertest + helpers/visual) | tests/ |
| Scripts | 11 ts-скриптов (test-proxy-checker, test-alert-dedup, test-mock-mode, test-indigo-mock, test-posting-state-machine, test-warmup-planner, test-uniqifier, seed-warmup-keywords, backfill-favorite-prompt-patterns, normalize-video-subtitles-style, generate-subtitle-samples) | scripts/ |
| Skills | visual-audit, webapp-testing-extended | .claude/skills/ |
| Docs | docs/COMPLIANCE.md, docs/architecture/social_automation.md | docs/ |
| Storage | storage/fonts/ (Anton/Montserrat/Inter OFL), storage/uploads/unique/, storage/uploads/_mock_cache/ | storage/ |
| Migrations | 13 (от accounts_pipeline_integration до posting_jobs_fk_and_index) | prisma/migrations/ |

### Ключевые добавления за предыдущий период 2026-04-16 → 2026-04-25 (38 коммитов)

| Тип | Имя | Файл/локация |
|-----|-----|--------------|
| Prisma model | `ScenarioGenerationProfile` | schema.prisma:1339 |
| Prisma model | `ScenarioFeedback` | schema.prisma:1354 |
| Prisma model | `ScenarioMemory` | schema.prisma:1371 |
| Prisma model | `FavoritePrompt` | schema.prisma:1392 |
| Prisma model | `AccountStyleProfile` | schema.prisma:594 |
| Prisma model | `AccountStyleRevision` | schema.prisma:608 |
| AI-агент | `story-architect-agent.ts` | server/utils/agents/ |
| AI-агент | `scene-planner-agent.ts` | server/utils/agents/ |
| AI-агент | `continuity-director-agent.ts` | server/utils/agents/ |
| AI-агент | `subtitle-director-agent.ts` | server/utils/agents/ |
| AI-агент | `optimization-memory-agent.ts` | server/utils/agents/ |
| AI-агент | `reference-analyzer-agent.ts` | server/utils/agents/ |
| AI-агент | `favorite-prompts-loader.ts` | server/utils/agents/ |
| Runner | `lip-sync-runner.ts` | server/utils/ |
| Service | `tts.ts` | server/utils/ |
| Service | `account-style-context.ts` | server/utils/ |
| Service | `analytics-ai.ts` | server/utils/ |
| Service | `feedback-loop.ts` | server/utils/ |
| Service | `idea-sync.ts` | server/utils/ |
| Service | `reference-pipeline.ts` | server/utils/ |
| Service | `transcript-extractor.ts` | server/utils/ |
| Service | `app-enrichment-pipeline.ts` | server/utils/ |
| Service | `app-store-parser.ts` | server/utils/ |
| Service | `story-video-planner.ts` | server/utils/ |
| Service | `pipeline-cancel-registry.ts` | server/utils/ |
| Service | `pipeline-sub-executor.ts` | server/utils/ |
| Vue component | `ScenarioStoryPlan.vue` | app/components/scenario/ |
| Vue component | `ScenarioFeedbackForm.vue` | app/components/scenario/ |
| Vue component | `ScenarioConfigEditor.vue` | app/components/pipeline/config/ |
| Vue component | `ScenarioAppSelector.vue` | app/components/pipeline/config/ |
| Vue component | `FavoritePromptsPicker.vue` | app/components/pipeline/config/ |
| Vue component | `IdeaReferenceAnalysis.vue` | app/components/idea/ |
| Vue component | `IdeaSyncInfo.vue`, `IdeaSyncToolbar.vue` | app/components/idea/ |
| Vue component | `AppReferenceImagesManager.vue`, `AppReferenceImagesModal.vue`, `AppDeleteConfirmModal.vue` | app/components/admin/ |
| Vue component | `AccountStyleProfileEditor.vue`, `AccountStyleStatusBadge.vue` | app/components/account/ |
| Vue components | 4 в `favorite-prompt/` | app/components/favorite-prompt/ |
| Vue components | 11 в `pipeline/monitor/` | app/components/pipeline/monitor/ |
| Vue components | 5 в `pipeline/config/trendwatcher/` | app/components/pipeline/config/trendwatcher/ |
| Vue component | `PipelineRunCard.vue`, `PipelineRunStats.vue` | app/components/pipeline/ |
| Vue component | `RunPipelineFilterBadge.vue` | app/components/shared/ |
| Vue component | `VideoSubtitleEditor.vue` | app/components/video/ |
| Page | `/prompts-library/index.vue`, `/pipeline/[id]/runs/`, `/pipeline/[id]/runs/[runId]` | app/pages/ |
| Composable | `usePipelineMonitor.ts`, `usePipelineMonitorUrlSync.ts` | app/composables/ |
| Composable | `useRunPipelineFilter.ts`, `useIdeaSync.ts` | app/composables/ |
| Composable | `useAppEnrich.ts`, `useAppReferenceImages.ts` | app/composables/ |
| Composable | `useFavoritePrompts.ts`, `useFavoritePromptDetail.ts`, `useFavoritePromptActions.ts` | app/composables/ |
| Store | `pipelineMonitor.ts`, `favoritePromptFilters.ts` | app/stores/ |
| Shared type | `account-style.ts`, `favorite-prompt.ts`, `reference.ts`, `story.ts`, `video-runtime.ts` | shared/types/ |
| Shared util | `pipeline-format.ts`, `pipeline-status.ts` | shared/utils/ |
| API endpoint | `scenarios/feedback.{get,post}.ts`, `memory.get.ts`, `profiles/...` | server/api/scenarios/ |
| API endpoint | `ideas/[id]/analyze-reference.post.ts`, `[id]/sync.post.ts`, `sync/...` | server/api/ideas/ |
| API endpoint | `admin/apps/[id]/reference-images.{post,delete}.ts`, `enrich-preview.post.ts`, `enrich.post.ts` | server/api/admin/apps/ |
| API endpoint | `favorite-prompts/...` (5 endpoints) | server/api/favorite-prompts/ |
| API endpoint | `pipelines/monitor.get.ts`, `[id]/nodes/[nodeId]/upstream-context.get.ts`, `[runId]/retry-step.post.ts` | server/api/pipelines/ |
| API endpoint | `ai/suggest/trendwatcher-config.post.ts`, `scenario-config.post.ts` | server/api/ai/ |
| API endpoint | `zavod/health.get.ts`, `ideas.get.ts`, `ideas/[id].get.ts` | server/api/zavod/ |
| API endpoint | `videos/[id]/edit-subtitles.post.ts` | server/api/videos/ |
| Migrations | 17 (см. таблицу в разделе 3) | prisma/migrations/ |

---

> **Дата актуализации:** 2026-05-05.
> **Следующий аудит:** при достижении ≥30 коммитов либо при крупном архитектурном изменении (новый домен, замена ключевой технологии).
>
> **За период 2026-04-25 → 2026-05-05:** проект кардинально расширен антидетект-инфраструктурой Social Automation Stack (треки A-G), Mock-режимом для 5 внешних API, и тестовой инфраструктурой (Vitest + @nuxt/test-utils + Playwright + supertest). Параллельно завершён цикл AI-анализа Idea-видео (yt-dlp + ffmpeg + whisper + Claude vision), доводка Kling-промптов (9 контекстных блоков), pattern-анализ FavoritePrompt и стандарт wordsPerLine для субтитров.
