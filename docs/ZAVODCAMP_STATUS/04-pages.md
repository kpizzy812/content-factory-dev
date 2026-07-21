# 04. Страницы

Всего **42 страницы**. File-based routing Nuxt 4 — структура `app/pages/` напрямую соответствует URL.

## Главная и аутентификация

| Маршрут | Файл | Описание | Middleware | Composables |
|---------|------|----------|-----------|-------------|
| `/` | `index.vue` | Дашборд: приветствие, быстрые ссылки к модулям, статистика трендов, последние импорты | — | `useTrendStats`, `useTrends`, `usePermissions` |
| `/auth/login` | `auth/login.vue` | Форма входа email/password. Layout `auth` (без сайдбара) | — | `useUserSession` |
| `/settings` | `settings.vue` | Настройки профиля, выбор темы (5 тем), информация о роли | — | `useUserSession`, `useColorMode` |

---

## Pipeline — Визуальный конструктор

| Маршрут | Файл | Описание | Middleware | Composables |
|---------|------|----------|-----------|-------------|
| `/pipeline` | `pipeline/index.vue` | Каталог конвейеров + панель мониторинга. Две колонки: каталог слева, история исполнений справа | `module-access:pipeline` | `usePipelineMonitor`, `usePipelineMonitorUrlSync` |
| `/pipeline/[id]` | `pipeline/[id]/index.vue` | Редактор: визуальный граф нод (@vue-flow), правая панель конфига, тестирование узлов, версионирование, webhook | `module-access:pipeline` | `usePipelineDetail`, `usePipelineActions` |
| `/pipeline/[id]/runs/[runId]` | `pipeline/[id]/runs/[runId].vue` | Детали запуска: логи каждого узла, метрики, результаты | `module-access:pipeline` | `usePipelineRunDetail`, `usePipelineRuns` |

---

## Trendwatcher — Поиск трендов

| Маршрут | Файл | Описание | Middleware | Composables |
|---------|------|----------|-----------|-------------|
| `/trends` | `trends/index.vue` | 3 таба: Тренды (фильтр), Профили парсинга (CRUD Apify), История запусков (polling) | `module-access:trendwatcher` | `useTrends`, `useTrendwatcherProfiles`, `useTrendwatcherRuns` |
| `/trends/[id]` | `trends/[id].vue` | Детали тренда: видео/миниатюра, статус, AI-анализ, бриф, список сценариев, удаление | `module-access:trendwatcher` | `useTrendDetail`, `useScenarios` |

---

## Scenario Generator — Сценарии и идеи

| Маршрут | Файл | Описание | Middleware | Composables |
|---------|------|----------|-----------|-------------|
| `/scenarios` | `scenarios/index.vue` | Список сценариев: фильтры, карточки, пагинация | `module-access:script-generator` | `useScenarios` |
| `/scenarios/[id]` | `scenarios/[id].vue` | Редактор: варианты (табы), детальное отображение, AI-критика (модалка), feedback, видео для сценария | `module-access:script-generator` | `useScenarioDetail`, `useVideos` |
| `/ideas` | `ideas/index.vue` | Список идей: фильтры, создание, синк с внешними источниками | `module-access:script-generator` | `useIdeas`, `useIdeaSync` |
| `/ideas/[id]` | `ideas/[id].vue` | Детали идеи: анализ, прогресс reference-сравнения, AI-инсайты | `module-access:script-generator` | `useIdeaDetail`, `useIdeaActions` |
| `/prompts-library` | `prompts-library/index.vue` | Лучшие промты с AI-анализом паттернов (Kling pattern), поиск, фильтры, избранное | `module-access:script-generator` | `useFavoritePrompts`, `useFavoritePromptActions` |

---

## Video Generator — Видео-производство

| Маршрут | Файл | Описание | Middleware | Composables |
|---------|------|----------|-----------|-------------|
| `/videos` | `videos/index.vue` | Список видео сеткой: фильтры, карточки, пагинация | `module-access:video-generator` | `useVideos` |
| `/videos/[id]` | `videos/[id].vue` | Плеер, конфиг (формат/стиль/субтитры), ассеты (изображения, промты), скачивание, уникальные варианты, субтитры (10 пресетов) | `module-access:video-generator` | `useVideoDetail`, `useVideoProgress`, `useSubtitlePresets`, `useVideoVariants` |

---

## Social Upload — Публикация

| Маршрут | Файл | Описание | Middleware | Composables |
|---------|------|----------|-----------|-------------|
| `/uploads` | `uploads/index.vue` | Список загрузок: статусы, фильтры | `module-access:social-upload` | `useUploads` |
| `/uploads/[id]` | `uploads/[id].vue` | Детали загрузки: видео, платформы, мета (заголовок/описание/хештеги), статус публикации | `module-access:social-upload` | `useUploadDetail`, `useUploadActions` |
| `/accounts` | `accounts/index.vue` | Управление аккаунтами: подключение, группировка, прокси, style-профили (Indigo), метрики, warmup-статус | `module-access:social-upload` | `useAccounts`, `useAccountGroups`, `useAccountActions` |
| `/posting-jobs` | `posting-jobs/index.vue` | Очередь постинга: расписание, статусы, retry, отмена, логи | `module-access:social-upload` | `usePostingJobs`, `usePostingJobActions` |
| `/proxies` | `proxies/index.vue` | Прокси: добавление, health-checks (latency, бан), логи, диагностика | `module-access:social-upload` | `useProxies`, `useProxyActions` |
| `/indigo` | `indigo/index.vue` | Indigo browser profiles: синк с workspace, очистка дубликатов, диагностика | `module-access:social-upload` | `useIndigoProfiles`, `useIndigoActions` |
| `/indigo/[id]` | `indigo/[id].vue` | Детали профиля: сеансы, статус, fingerprints, запуск (stepper), логи | `module-access:social-upload` | `useIndigoStartFlow` |

---

## Analytics — Аналитика

| Маршрут | Файл | Описание | Middleware | Composables |
|---------|------|----------|-----------|-------------|
| `/analytics` | `analytics/index.vue` | 2 таба: Summary (общие метрики), По аккаунту. Дашборд, таблица постов с сортировкой, графики CTR | `module-access:analytics` | `useAnalyticsDashboard`, `useAnalyticsPosts` |
| `/analytics/[uploadId]` | `analytics/[uploadId].vue` | Детали аналитики для конкретной загрузки: real-time метрики, история, рекомендации | `module-access:analytics` | `useAnalyticsDetail`, `useAnalyticsActions` |

---

## Креативы и справочники

| Маршрут | Файл | Описание | Middleware | Composables |
|---------|------|----------|-----------|-------------|
| `/creatives` | `creatives/index.vue` | Каталог креативов (изображения, видео-клипы) импортированных из трендов/идей | `module-access:trendwatcher` | `useCreatives` |
| `/references` | `references/index.vue` | Справочные образцы для вдохновения | — | `useReferences` |
| `/google-drive` | `google-drive/index.vue` | Синхронизация с Google Drive: credentials, импорт файлов в видео, браузер папок | `module-access:trendwatcher` | `useGoogleDrive` |

---

## Admin — Администрирование (13 страниц)

Все требуют middleware `admin-access` + `canAdmin` на сервере.

| Маршрут | Файл | Описание | Composables |
|---------|------|----------|-------------|
| `/admin` | `admin/index.vue` | Дашборд: статус системы, контент-пайплайн (счётчики), ошибки, циклы | `useAdminDashboard` |
| `/admin/apps` | `admin/apps/index.vue` | CRUD приложений: создание, редактирование, удаление, справочные изображения | `useAdminApps` |
| `/admin/apps/[id]` | `admin/apps/[id].vue` | Детали приложения: интеграции, сценарии, пользователи, справочники | `useAdminApps`, `useAppReferenceImages` |
| `/admin/users` | `admin/users/index.vue` | Управление пользователями: роли (admin/producer/operator/analyst/observer), права | `useAdminUsers`, `useRbacConfig` |
| `/admin/users/[id]` | `admin/users/[id].vue` | Редактирование пользователя: роль (read-only из MC), 2FA, isActive | `useAdminUsers` |
| `/admin/cycles` | `admin/cycles/index.vue` | История циклов генерации: дата, статус, результаты | `useAdminCycles` |
| `/admin/cycles/[id]` | `admin/cycles/[id].vue` | Детали цикла: логи ошибок, результаты по модулям, перезапуск | `useAdminCycles` |
| `/admin/logs` | `admin/logs/index.vue` | Унифицированная лента логов из 8 источников (AgentLog, AppEnrichmentLog, SecretAccessLog, TelegramCommandAudit, TrendwatcherRunLog, WebhookLog, AiAuditLog) | `useAdminLogs` |
| `/admin/telegram` | `admin/telegram.vue` | Telegram-бот: статус, чаты, шаблоны алертов, API-ключи, диагностика | `useAdminTelegram` |
| `/admin/integrations` | `admin/integrations/index.vue` | Внешние интеграции: Indigo, AI, прокси | `useIntegrationStatus` |
| `/admin/warmup-keywords` | `admin/warmup-keywords.vue` | Пулы ключевых слов для warmup-планировщика | `useWarmupKeywords` |
| `/admin/accounts-health` | `admin/accounts-health.vue` | Здоровье аккаунтов: полнота профиля (0-100%), риски, анализ по платформам | `useAccountsHealth` |
| `/admin/balances` | `admin/balances.vue` | Остатки по сервисам: AI (Anthropic, fal.ai), Apify, NodeMaven, Mubert | `useAdminBalances` |
| `/admin/storage-health` | `admin/storage-health.vue` | Здоровье GCS-хранилища: использование, очистка, recover | `useVideoStorageStatus` |

---

## Layouts

| Layout | Файл | Назначение | Что внутри |
|--------|------|-----------|-----------|
| `default` | `app/layouts/default.vue` | Основные страницы | Header, левая навигация (модули), основной контент, footer |
| `auth` | `app/layouts/auth.vue` | Страницы аутентификации | Центрированная карточка на сером фоне |

Применение: `definePageMeta({ layout: 'auth' })`.

---

## Middleware

### Глобальный

**`app/middleware/auth.global.ts`** — auth guard:
- Whitelist публичных маршрутов (`/auth/login`, `/auth/callback`)
- Если нет сессии → редирект на `/auth/login`
- Хранит `redirect` query-параметр для возврата после логина

### Именованные (применяются через `definePageMeta`)

**`app/middleware/module-access.ts`** — `module-access:<slug>`:
- Применяется к модульным страницам
- Проверка `moduleAccess` пользователя
- Fail-open на клиенте (серверный RBAC всё равно поймает)

**`app/middleware/admin-access.ts`** — `admin-access`:
- Применяется к `/admin/*` страницам
- Проверка `canAdmin`
- Fail-open для SSR

---

## Plugins

**`app/plugins/auth-redirect.client.ts`** — client-only:
- Глобальный перехватчик 401-ответов от `$fetch`
- Очищает сессию + редирект на `/auth/login`
- Решает проблему "stale session" при логине в другом браузере

---

## File-based routing summary

```
pages/
├── index.vue                              → /
├── settings.vue                           → /settings
├── auth/login.vue                         → /auth/login
├── trends/index.vue                       → /trends
├── trends/[id].vue                        → /trends/:id
├── scenarios/index.vue                    → /scenarios
├── scenarios/[id].vue                     → /scenarios/:id
├── ideas/index.vue                        → /ideas
├── ideas/[id].vue                         → /ideas/:id
├── videos/index.vue                       → /videos
├── videos/[id].vue                        → /videos/:id
├── uploads/index.vue                      → /uploads
├── uploads/[id].vue                       → /uploads/:id
├── analytics/index.vue                    → /analytics
├── analytics/[uploadId].vue               → /analytics/:uploadId
├── pipeline/index.vue                     → /pipeline
├── pipeline/[id]/index.vue                → /pipeline/:id
├── pipeline/[id]/runs/[runId].vue         → /pipeline/:id/runs/:runId
├── pipeline/[id]/runs/index.vue           → /pipeline/:id/runs
├── accounts/index.vue                     → /accounts
├── posting-jobs/index.vue                 → /posting-jobs
├── proxies/index.vue                      → /proxies
├── indigo/index.vue                       → /indigo
├── indigo/[id].vue                        → /indigo/:id
├── prompts-library/index.vue              → /prompts-library
├── creatives/index.vue                    → /creatives
├── references/index.vue                   → /references
├── google-drive/index.vue                 → /google-drive
└── admin/
    ├── index.vue                          → /admin
    ├── apps/index.vue                     → /admin/apps
    ├── apps/[id].vue                      → /admin/apps/:id
    ├── users/index.vue                    → /admin/users
    ├── users/[id].vue                     → /admin/users/:id
    ├── cycles/index.vue                   → /admin/cycles
    ├── cycles/[id].vue                    → /admin/cycles/:id
    ├── logs/index.vue                     → /admin/logs
    ├── telegram.vue                       → /admin/telegram
    ├── integrations/index.vue             → /admin/integrations
    ├── warmup-keywords.vue                → /admin/warmup-keywords
    ├── accounts-health.vue                → /admin/accounts-health
    ├── balances.vue                       → /admin/balances
    └── storage-health.vue                 → /admin/storage-health
```
