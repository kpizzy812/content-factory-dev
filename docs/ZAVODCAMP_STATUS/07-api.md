# 07. REST API

**Всего 311 endpoints** в 28 разделах. Все защищены через `getAuthContext` → `requirePermission` / `requireScopedAccess` / `requireUserSession` за исключением health-check'ов.

## Общие соглашения

| Аспект | Правило |
|--------|---------|
| Формат ответа успех | `{ data: T, error: null, meta?: {...} }` |
| Формат ошибки | `{ data: null, error: { code, message, details? } }` (с HTTP 4xx/5xx) |
| Auth | Cookie-сессия (nuxt-auth-utils) или `Authorization: Bearer <ZAVOD_API_KEY>` для `/api/zavod/*` |
| Test bypass | Заголовки `x-test-auth-token` + `x-test-user-id` (только NODE_ENV≠production) |
| Pagination | `?page=1&perPage=20`, ответ `{ data: [...], meta: { total, page, perPage } }` |
| Сортировка | `?sort=field` или `?sort=-field` (DESC) |
| Permission flag | См. [01-overview.md](01-overview.md#rbac-философия): 8 флагов + `moduleAccess` + `appAssignments` |

---

## Auth (3)

| Метод | Путь | Описание |
|-------|------|----------|
| POST | `/api/auth/login` | Email/password → синк из MarketingCamp → сохранение RBAC payload + session cookie. Fail-fast (502) если MC не вернул `permissions` |
| POST | `/api/auth/logout` | Очистка сессии |
| GET | `/api/auth/permissions` | Полный RBAC-контекст: `rolePreset`, 8 boolean флагов, `moduleAccess`, `appAssignments` |
| GET | `/api/health` | Health-check сервиса (`{ status: "ok", service, timestamp }`) |

---

## Accounts (15)

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/accounts` | Список с фильтром (appId, platform, status) + `profileCompleteness` (0-100%) + `hasLoginCredentials` flag |
| POST | `/api/accounts` | Создание вручную (multi-step wizard). Опциональный `accessToken` для browser_automation метода. Нормализация `platformHandle` (`@username`) |
| DELETE | `/api/accounts/[id]` | Удаление с проверкой отсутствия активных Upload/PostingJob |
| GET | `/api/accounts/[id]/credentials-meta` | Метаданные учётных данных (без plain secrets) |
| PUT | `/api/accounts/[id]/credentials` | Сохранение (login/password/recovery/2FA) — шифрование AES-256-GCM |
| POST | `/api/accounts/[id]/credentials/reveal` | Raw-расшифровка с `reason` → audit-log в `SecretAccessLog` |
| PUT | `/api/accounts/[id]/proxy` | Привязка прокси (1:1) |
| POST | `/api/accounts/[id]/check-login` | Проверка статуса входа (через Indigo CDP) |
| POST | `/api/accounts/[id]/deep-proxy-check` | Детальная диагностика прокси через аккаунт |
| GET | `/api/accounts/[id]/metrics` | Снимок метрик из `AccountMetricsSnapshot` |
| POST | `/api/accounts/[id]/metrics/fetch` | Принудительный сбор метрик через Apify (idempotent 24h) |
| GET | `/api/accounts/[id]/style/index` | Стиль-профиль Indigo |
| PUT | `/api/accounts/[id]/style/index` | Обновление стиля |
| POST | `/api/accounts/[id]/style/suggest` | AI-рекомендация стиля |
| POST | `/api/accounts/[id]/style/apply-suggestion` | Применить AI-рекомендацию |

---

## Account-groups (4)

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/account-groups` | Список групп |
| POST | `/api/account-groups` | Создать |
| PUT | `/api/account-groups/[id]` | Обновить (название, состав) |
| DELETE | `/api/account-groups/[id]` | Удалить |

---

## Admin (49)

### Users / Apps

- `GET /api/admin/users` — список пользователей
- `GET /api/admin/users/[id]` — один
- `PUT /api/admin/users/[id]` — только `isActive` (остальное из MC)
- `GET /api/admin/apps` — список приложений
- `POST /api/admin/apps` — создать
- `GET /api/admin/apps/[id]` — один
- `PUT /api/admin/apps/[id]` — обновить
- `DELETE /api/admin/apps/[id]` — удалить
- `POST /api/admin/apps/[id]/enrich` — AI-обогащение метаданных
- `POST /api/admin/apps/enrich-preview` — preview без сохранения
- `GET /api/admin/apps/[id]/reference-images` — справочные картинки
- `POST /api/admin/apps/[id]/reference-images` — добавить
- `DELETE /api/admin/apps/[id]/reference-images` — удалить
- `POST /api/admin/apps/[id]/reference-images/[refId]/analyze` — анализ картинки

### Cycles / Logs

- `GET /api/admin/cycles` — история циклов
- `POST /api/admin/cycles/start` — запустить новый
- `GET /api/admin/cycles/[id]` — один
- `POST /api/admin/cycles/[id]/stop` — остановить
- `GET /api/admin/logs` — унифицированная лента (8 источников)
- `PUT /api/admin/logs/[id]/resolve` — пометить разрешённым

### Health / Storage / Balances

- `GET /api/admin/dashboard` — главный дашборд
- `GET /api/admin/storage-health` — здоровье GCS
- `GET /api/admin/accounts-health` — здоровье аккаунтов
- `GET /api/admin/balances` — остатки сервисов
- `PUT /api/admin/balances/[service]` — ручной ввод остатка

### Telegram

- `GET /api/admin/telegram/{status,keys,chats,templates,variables,deliveries,audit}` — все разделы
- `POST /api/admin/telegram/{test,restart}` — управление ботом
- `POST /api/admin/telegram/keys` — создать API-ключ
- `PUT /api/admin/telegram/keys/[id]` / `DELETE` / `POST .../rotate` — управление ключом
- `PUT /api/admin/telegram/chats/[id]` / `DELETE` — редактирование чата
- `POST /api/admin/telegram/templates` — создать шаблон
- `PUT /api/admin/telegram/templates/[id]` / `DELETE` / `POST .../test` — управление
- `POST /api/admin/telegram/templates/generate` — AI-генерация шаблона
- `GET /api/admin/telegram/deliveries` — лог доставок
- `POST /api/admin/telegram/deliveries/[id]/resend` — повторить отправку

### Indigo admin

- `POST /api/admin/indigo/profiles/[id]/force-stop` — force-остановка профиля

---

## AI / suggest (14)

| Метод | Путь | Описание |
|-------|------|----------|
| POST | `/api/ai/suggest/block` | Подсказка для блока сценария |
| POST | `/api/ai/suggest/description` | Описание видео |
| POST | `/api/ai/suggest/field` | Универсальный саджест поля |
| POST | `/api/ai/suggest/hooks` | Хуки сценария |
| POST | `/api/ai/suggest/keywords` | Ключевые слова |
| POST | `/api/ai/suggest/platform-adaptation` | Адаптация под платформу |
| POST | `/api/ai/suggest/posting-time` | Время публикации |
| POST | `/api/ai/suggest/scenario-config` | Конфигурация сценария |
| POST | `/api/ai/suggest/scenario` | Генерация сценария |
| POST | `/api/ai/suggest/taxonomy` | Подсказки таксономии |
| POST | `/api/ai/suggest/trendwatcher-config` | Конфиг trendwatcher |
| POST | `/api/ai/suggest/visual-style` | Визуальный стиль |
| GET | `/api/ai/audit` | Аудит AI-предложений |
| PUT | `/api/ai/audit` | Обновить статус (applied/dismissed) |

Все логируются в `AiAuditLog` с `costUsd`, `model`, `prompt`, `suggestions`, `appliedFields`.

---

## Analytics (5)

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/analytics/dashboard` | Сводка: views, engagement, CTR |
| GET | `/api/analytics/posts` | Таблица постов с метриками |
| GET | `/api/analytics/posts/[uploadId]` | Метрики одной загрузки |
| POST | `/api/analytics/analyze/[uploadId]` | AI-анализ метрик с рекомендациями |
| POST | `/api/analytics/collect` | Принудительный сбор метрик |

---

## Apps (2)

- `GET /api/apps` — список приложений (auto-filtered by user assignments)
- `GET /api/apps/[id]/context` — контекст приложения (модули, аккаунты, ассеты)

---

## Creatives, References, Favorite prompts

- `GET /api/creatives` — каталог
- `GET /api/references` — образцы
- `GET /api/favorite-prompts` — список
- `POST /api/favorite-prompts` — создать
- `GET /api/favorite-prompts/[id]` — один
- `PUT /api/favorite-prompts/[id]` — обновить
- `DELETE /api/favorite-prompts/[id]` — удалить
- `POST /api/favorite-prompts/[id]/reanalyze` — пере-анализ паттерна (Kling)

---

## Google Drive (5)

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/google-drive/files` | Список файлов в подключенной папке |
| GET | `/api/google-drive/folders` | Список папок |
| POST | `/api/google-drive/files/[id]/download` | Скачать файл из GDrive в storage |
| POST | `/api/google-drive/files/[id]/import-to-video` | Импорт в `Video` (создаёт system-Scenario fallback если нет) |
| POST | `/api/google-drive/sync` | Полная синхронизация |

---

## Ideas (11)

- `GET /api/ideas` — список (status, source, appId, пагинация)
- `POST /api/ideas` — создать (из URL)
- `GET /api/ideas/[id]` — деталь
- `PUT /api/ideas/[id]` — обновить
- `DELETE /api/ideas/[id]` — удалить
- `POST /api/ideas/[id]/reanalyze` — пере-анализ AI
- `POST /api/ideas/[id]/sync` — sync с MarketingCamp
- `POST /api/ideas/[id]/to-scenario` — преобразование в Scenario
- `POST /api/ideas/[id]/analyze-reference` — сравнение с референсами
- `GET /api/ideas/sync/{status,export,import}` — синхронизация (status/export/import)

---

## Indigo (36)

### Профили

- `GET /api/indigo/profiles` — список
- `POST /api/indigo/profiles` — создать
- `GET /api/indigo/profiles/[id]` — деталь
- `PUT /api/indigo/profiles/[id]` — обновить
- `DELETE /api/indigo/profiles/[id]` — удалить (archive)
- `POST /api/indigo/profiles/[id]/start` — запустить (с stepper)
- `POST /api/indigo/profiles/[id]/start-prepare` — подготовка к запуску
- `POST /api/indigo/profiles/[id]/stop` — остановить
- `POST /api/indigo/profiles/[id]/stop-prepare` — подготовка к остановке
- `POST /api/indigo/profiles/[id]/test` — тест fingerprint
- `POST /api/indigo/profiles/[id]/resync` — повторная синхронизация с workspace
- `POST /api/indigo/profiles/[id]/sync-state` — sync статуса
- `POST /api/indigo/profiles/[id]/session-record` — зафиксировать сессию
- `POST /api/indigo/profiles/[id]/session-end` — завершить сессию

### Привязка к аккаунтам

- `POST /api/indigo/profiles/[id]/link-account` — привязать
- `POST /api/indigo/profiles/[id]/unlink-account` — отвязать
- `GET /api/indigo/profiles/[id]/accounts/[accountId]` — детали привязки
- `POST /api/indigo/profiles/[id]/accounts/[accountId]/primary` — назначить основным
- `DELETE /api/indigo/profiles/[id]/accounts/[accountId]` — удалить привязку

### Cookies и теги

- `POST /api/indigo/profiles/[id]/cookies/import` — импорт cookies
- `POST /api/indigo/profiles/[id]/cookies/export` — экспорт
- `GET /api/indigo/profiles/tags` — список тегов
- `POST/PUT/DELETE /api/indigo/profiles/tags` — CRUD тегов

### Credentials

- `GET /api/indigo/credentials/status` — статус подключения
- `PUT /api/indigo/credentials/index` — обновить API-ключ
- `DELETE /api/indigo/credentials/index` — удалить
- `POST /api/indigo/credentials/test` — тест

### Sync и cleanup

- `POST /api/indigo/sync` — общая синхронизация
- `GET /api/indigo/admin/cleanup-orphans` — найти "осиротевшие"
- `POST /api/indigo/admin/cleanup-orphans` — удалить
- `POST /api/indigo/admin/cleanup-remote-duplicates` — очистка дубликатов в Indigo workspace

---

## Pipelines (47)

### CRUD

- `GET /api/pipelines` — список (own + shared, пагинация)
- `POST /api/pipelines` — создать
- `GET /api/pipelines/[id]` — деталь (включая graphData)
- `PUT /api/pipelines/[id]` — обновить
- `DELETE /api/pipelines/[id]` — удалить
- `GET /api/pipelines/[id]/export` — экспорт в JSON
- `POST /api/pipelines/import` — импорт из JSON

### Runs

- `POST /api/pipelines/[id]/run` — запустить
- `GET /api/pipelines/[id]/runs` — история
- `GET /api/pipelines/[id]/runs/[runId]` — деталь
- `POST /api/pipelines/[id]/runs/[runId]/cancel` — отмена
- `POST /api/pipelines/[id]/runs/[runId]/replay` — повтор
- `POST /api/pipelines/[id]/runs/[runId]/retry-step` — повтор узла
- `GET /api/pipelines/[id]/validate` — валидация графа
- `GET /api/pipelines/monitor` — мониторинг
- `GET /api/pipelines/runtime-stats` — статистика runtime

### Versions

- `GET /api/pipelines/[id]/versions` — список версий
- `POST /api/pipelines/[id]/versions` — снапшот
- `POST /api/pipelines/[id]/versions/[versionId]/restore` — восстановить

### Schedule & Webhook

- `GET/PUT/DELETE /api/pipelines/[id]/schedule` — cron-расписание
- `POST /api/pipelines/[id]/webhook` — создать webhook
- `DELETE /api/pipelines/[id]/webhook` — удалить
- `GET /api/pipelines/[id]/webhook-logs` — логи webhook'а

### Nodes & Presets & Tags

- `POST /api/pipelines/nodes/test` — изолированный тест узла
- `GET /api/pipelines/[id]/nodes/[nodeId]/upstream-context` — контекст для узла
- `GET /api/pipelines/presets` — пресеты
- `GET /api/pipelines/tags` — теги
- `POST/PUT/DELETE /api/pipelines/tags` — CRUD тегов

### Credentials

- `GET /api/pipelines/credentials` — список
- `POST /api/pipelines/credentials` — создать
- `GET /api/pipelines/credentials/[id]` — деталь
- `PUT /api/pipelines/credentials/[id]` — обновить
- `DELETE /api/pipelines/credentials/[id]` — удалить
- `POST /api/pipelines/credentials/[id]/test` — тест
- `POST /api/pipelines/credentials/[id]/test-drive` — тест Drive credential
- `POST /api/pipelines/credentials/[id]/revoke` — revoke
- `POST /api/pipelines/credentials/[id]/unrevoke` — un-revoke
- `GET /api/pipelines/credentials/[id]/usage` — использование

---

## Posting-jobs (8)

- `GET /api/posting-jobs` — список
- `POST /api/posting-jobs` — создать
- `GET /api/posting-jobs/[id]` — деталь
- `GET /api/posting-jobs/[id]/logs` — логи
- `POST /api/posting-jobs/[id]/cancel` — отмена
- `POST /api/posting-jobs/[id]/retry` — retry
- `GET /api/posting-jobs/stats` — статистика
- `GET /api/posting/screenshot-url` — скриншот опубликованного поста

---

## Proxies (10)

- `GET /api/proxies` — список
- `POST /api/proxies` — добавить
- `GET /api/proxies/[id]` — деталь
- `PUT /api/proxies/[id]` — обновить
- `DELETE /api/proxies/[id]` — удалить
- `POST /api/proxies/[id]/check` — проверить один
- `POST /api/proxies/check-all` — проверить все
- `GET /api/proxies/[id]/checks` — история проверок
- `POST /api/proxies/[id]/diagnose` — детальная диагностика
- `POST /api/proxies/[id]/reveal` — раскрытие пароля (с reason)

---

## Scenarios (23)

- `GET /api/scenarios` — список (trendId, status)
- `POST /api/scenarios/generate` — генерация вариантов
- `GET /api/scenarios/[id]` — деталь
- `PUT /api/scenarios/[id]` — обновить
- `DELETE /api/scenarios/[id]` — удалить
- `POST /api/scenarios/[id]/critic` — оценить AI-критиком
- `PUT /api/scenarios/[id]/critic/best` — лучший вариант
- `GET /api/scenarios/[id]/critic-reviews` — отзывы критика
- `POST /api/scenarios/[id]/regenerate-block` — регенерация блока (hook/body/CTA)
- `POST /api/scenarios/[id]/rework` — переделать
- `POST /api/scenarios/[id]/rework-regenerate` — rework + regenerate
- `PUT /api/scenarios/[id]/reject` — статус rejected
- `PUT /api/scenarios/[id]/select` — статус selected
- `POST /api/scenarios/[id]/improve-visual-style` — улучшить стиль
- `GET /api/scenarios/memory` — история сценариев
- `GET /api/scenarios/feedback` — отзывы
- `POST /api/scenarios/feedback` — оставить отзыв
- `GET /api/scenarios/profiles` — профили генерации
- `POST /api/scenarios/profiles` — создать профиль
- `DELETE /api/scenarios/profiles/[id]` — удалить

---

## Social (OAuth) (2)

- `GET /api/social/connect/[platform]` — OAuth подключение (TikTok/YouTube/Instagram) — **DEPRECATED 410** с manual creation
- `GET /api/social/callback/[platform]` — OAuth callback — **DEPRECATED 410**

OAuth заменён ручным созданием через AccountCreateModal + Indigo browser-automation.

---

## Subtitles (2)

- `POST /api/subtitles/keywords` — AI-определение keywords для karaoke-эффекта
- `GET /api/subtitles/presets` — список 10 пресетов

---

## Taxonomy (5)

- `GET /api/taxonomy` — список с фильтром по типу
- `POST /api/taxonomy` — создать item
- `PUT /api/taxonomy/[id]` — обновить
- `DELETE /api/taxonomy/[id]` — удалить
- `POST /api/taxonomy/seed` — загрузить системные

---

## Trends (8)

- `GET /api/trends` — список
- `GET /api/trends/[id]` — деталь
- `POST /api/trends/[id]/analyze` — AI-анализ
- `PUT /api/trends/[id]` — обновить
- `PUT /api/trends/[id]/app` — назначить app
- `PUT /api/trends/[id]/status` — изменить статус
- `DELETE /api/trends/[id]` — удалить
- `GET /api/trends/stats` — статистика

---

## Trendwatcher (15)

### Profiles

- `GET /api/trendwatcher/profiles` — список
- `POST /api/trendwatcher/profiles` — создать
- `GET /api/trendwatcher/profiles/[id]` — деталь
- `PUT /api/trendwatcher/profiles/[id]` — обновить
- `DELETE /api/trendwatcher/profiles/[id]` — удалить
- `POST /api/trendwatcher/profiles/[id]/validate` — валидация
- `POST /api/trendwatcher/profiles/[id]/duplicate` — дублировать
- `PUT /api/trendwatcher/profiles/[id]/schedule` — расписание

### Runs

- `POST /api/trendwatcher/run` — запустить
- `GET /api/trendwatcher/runs/active` — активные
- `GET /api/trendwatcher/runs` — история
- `GET /api/trendwatcher/runs/[id]` — деталь
- `DELETE /api/trendwatcher/runs/[id]` — удалить
- `POST /api/trendwatcher/runs/[id]/retry` — повторить

---

## Uploads (6)

- `GET /api/uploads` — список
- `POST /api/uploads/create` — создать
- `GET /api/uploads/[id]` — деталь
- `GET /api/uploads/[id]/attempts` — попытки публикации
- `POST /api/uploads/[id]/retry` — retry
- `GET /api/uploads/module-status` — статус модуля (ENABLE_SOCIAL_POSTING)

---

## Videos (25)

### Базовые

- `GET /api/videos` — список
- `POST /api/videos/generate` — запуск генерации
- `GET /api/videos/[id]` — деталь
- `DELETE /api/videos/[id]` — удалить
- `GET /api/videos/[id]/progress` — polling прогресса
- `POST /api/videos/[id]/cancel` — отмена
- `POST /api/videos/[id]/resume` — возобновление
- `POST /api/videos/[id]/skip-step` — пропустить шаг
- `POST /api/videos/[id]/rerun-step` — повторить шаг
- `POST /api/videos/[id]/rerender-assembly` — пере-рендер финальной сборки
- `POST /api/videos/[id]/uniqify` — создать уникальные варианты per-platform
- `GET /api/videos/[id]/playback-url` — URL для проигрывания (signed GCS)
- `GET /api/videos/[id]/storage-status` — статус в storage

### Variants

- `GET /api/videos/[id]/variants` — уникальные варианты

### Captions (per-platform метаданные)

- `GET /api/videos/[id]/captions` — все подписи
- `POST /api/videos/[id]/captions` — создать
- `PUT /api/videos/[id]/captions/[platform]` — обновить
- `DELETE /api/videos/[id]/captions/[platform]` — удалить
- `PUT /api/videos/[id]/captions/approve` — одобрить
- `POST /api/videos/[id]/captions/regenerate` — регенерация AI

### Misc

- `POST /api/videos/[id]/edit-subtitles` — редактирование субтитров
- `POST /api/videos/estimate-cost` — оценка стоимости
- `GET /api/videos/models` — доступные fal.ai модели

---

## Warmup (11)

### Keywords

- `GET /api/warmup/keywords` — список пулов
- `POST /api/warmup/keywords` — добавить
- `PUT /api/warmup/keywords/[id]` — обновить
- `DELETE /api/warmup/keywords/[id]` — удалить

### Sessions

- `GET /api/warmup/sessions` — все сессии
- `GET /api/warmup/sessions/[id]` — детали
- `DELETE /api/warmup/sessions/[id]` — удалить
- `POST /api/warmup/sessions/[id]/cancel` — отмена

### Per-account

- `POST /api/warmup/accounts/[accountId]/schedule` — построить расписание
- `POST /api/warmup/accounts/[accountId]/preview` — превью
- `GET /api/warmup/accounts/[accountId]/sessions` — сессии аккаунта

---

## Webhooks

- `POST /api/webhooks/[token]` — универсальный webhook endpoint для pipeline. Валидация HMAC (`webhookSecret`), запись в `WebhookLog`, запуск pipeline-run.

---

## Zavod (inter-service)

Требует `Authorization: Bearer <ZAVOD_API_KEY>`.

- `GET /api/zavod/health` — health для MC
- `GET /api/zavod/ideas` — экспорт идей в MC

---

## Test endpoints (NODE_ENV=test)

- `POST /api/_test/login` — авторизация в тестах (генерация cookie)
- `POST /api/_test/cleanup` — очистка test-БД
- `POST /api/_test/analyze-creative-video` — анализ креатива (для тестов)

---

## Utility

- `POST /api/import` — общий импорт
- `GET /api/files/[...path]` — отдача файлов из storage (с auth)
- `GET /api/integration/status` — статус интеграций

---

## Permission matrix (фрагмент)

| Endpoint | Permission |
|----------|-----------|
| `GET /api/accounts` | `canRead`, module `social-upload` |
| `POST /api/accounts` | `canCreate`, module `social-upload` |
| `DELETE /api/accounts/[id]` | `canDelete`, module `social-upload` |
| `POST /api/videos/generate` | `canRunAgent`, module `video-generator` |
| `POST /api/scenarios/generate` | `canRunAgent`, module `script-generator` |
| `PUT /api/scenarios/[id]/select` | `canApprove`, module `script-generator` |
| `POST /api/uploads/create` | `canApplyChanges`, module `social-upload` |
| `GET /api/admin/*` | `canAdmin` |
| `POST /api/admin/users/[id]` (только isActive) | `canAdmin` |
| `POST /api/pipelines/[id]/credentials` | `canCreate`, module `pipeline` |

Полная матрица — в коде через `requirePermission` / `requireScopedAccess` каждого endpoint'а.
