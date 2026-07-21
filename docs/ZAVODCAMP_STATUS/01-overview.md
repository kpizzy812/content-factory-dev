# 01. Обзор проекта

## Что такое ZavodCamp

**ZavodCamp** — No-Code платформа для маркетологов, закрывающая полный цикл производства и публикации видео-контента в социальных сетях. Оператор без программистских навыков ведёт поток от тренда до опубликованного видео и аналитики через визуальные интерфейсы.

### Девиз модели работы

> Тренды → Идея → Сценарий → Видео → Публикация → Аналитика → (улучшение через AI-критика и метрики)

Каждый этап автоматизируется AI-агентами (Anthropic Claude), внешними сервисами (fal.ai, Mubert, Apify) и собственными модулями (browser automation через Indigo, прокси, warmup-планировщики).

---

## Целевая аудитория

| Роль | Что делает в системе |
|------|---------------------|
| **Маркетолог / Producer** | Запускает циклы, утверждает сценарии и видео, читает аналитику |
| **Оператор / Operator** | Управляет аккаунтами, прокси, постингом, проверяет diagnostic-панели |
| **Аналитик / Analyst** | Дашборды, метрики, top CTR, выводы по платформам |
| **Администратор / Admin** | Пользователи, приложения, циклы, Telegram-бот, баланс сервисов |

Все интерфейсы спроектированы под **No-Code** опыт: никаких консолей, JSON-редакторов, технических деталей. Pipeline-конструктор — drag-n-drop граф нод.

---

## Контекстная связь с MarketingCamp

ZavodCamp **не самодостаточен** — он работает в связке с родительской платформой MarketingCamp:

| Что делает MarketingCamp | Что делает ZavodCamp |
|--------------------------|----------------------|
| **Единый источник истины RBAC** (пользователи, роли, права, модули, приложения) | Синхронизирует RBAC при каждом логине через `POST /api/auth/login` |
| Библиотека креативов (read-only из ZC) | Каталог собственных креативов из трендов/идей |
| Save-to-Drive, Трендвотчер (legacy) | Импорт из Google Drive в видео-пайплайн |
| Управление командой, тарифами | Хранение операционных данных (видео, аккаунты, прокси, метрики) |

**Архитектурный принцип:** MarketingCamp = админка, ZavodCamp = production-цех. Контент-операции живут здесь, политика доступа — там.

### RBAC философия

`validate-external` отдаёт 4 блока:

1. **`permissions`** — 8 boolean флагов:
   - `canRead`, `canWrite`, `canCreate`, `canDelete`, `canApprove`, `canRunAgent`, `canApplyChanges`, `canAdmin`
2. **`modules`** — массив slug'ов модулей, к которым есть доступ
3. **`apps`** — `UserAppAssignment[]` с `accessLevel` (`none` / `read_only` / `full`), `accounts`, `geos`, `permissions`
4. **`rolePreset`** — enum роли (`admin` / `producer` / `operator` / `analyst` / `observer`)

**Fail-fast:** если MC не вернул блок `permissions` — логин падает с 502 (раньше тихо падал в `observer`).

**Admin bypass — только для модулей и приложений:**
- `requirePermission(canX)` — НЕТ bypass: `canAdmin=true` НЕ даёт автоматически `canRunAgent`
- `requireModuleAccess(slug)` / `requireAppAccess(appId)` — bypass для админа

Локально (в ZC) можно менять только `isActive` — это локальная блокировка. Все RBAC-поля управляются в MC и перезатираются при логине.

---

## Основные модули продукта

10 функциональных модулей, у каждого — slug в `UserModuleAccess`:

| Модуль | Slug | Что закрывает | Связанные страницы |
|--------|------|---------------|---------------------|
| Поиск трендов | `trendwatcher` | Apify-парсеры TikTok, YouTube, Instagram, Telegram; ручной импорт; AI-анализ тренда | `/trends`, `/trends/[id]`, `/creatives` |
| Генератор сценариев | `script-generator` | AI-сценарии в нескольких вариантах, AI-критик качества, ручная правка, библиотека идей | `/scenarios`, `/scenarios/[id]`, `/ideas`, `/ideas/[id]`, `/prompts-library` |
| Генератор видео | `video-generator` | 6-шаговый пайплайн (prompt → image → video → voiceover → music → assembly), субтитры (10 пресетов), уникализация per-platform | `/videos`, `/videos/[id]` |
| Социальные загрузки | `social-upload` | OAuth (YouTube/TikTok/Instagram), browser automation через Indigo, очередь публикации, retry | `/uploads`, `/uploads/[id]`, `/accounts`, `/posting-jobs` |
| Аналитика | `analytics` | Сбор метрик из API соцсетей, дашборд, история CTR | `/analytics`, `/analytics/[uploadId]` |
| Конвейер | `pipeline` | Визуальный no-code конструктор (DAG-граф нод), версии, расписание, webhook | `/pipeline`, `/pipeline/[id]`, `/pipeline/[id]/runs/[runId]` |
| Indigo | (в `social-upload`) | Управление anti-detect браузерами (профили, fingerprint, cookies, sessions) | `/indigo`, `/indigo/[id]` |
| Прокси | (в `social-upload`) | Резидентные прокси (NodeMaven), health checks, диагностика | `/proxies` |
| Google Drive | (в `trendwatcher`) | Service Account, импорт файлов в видео, синхронизация | `/google-drive` |
| Администрирование | (доступ через `canAdmin`) | Пользователи, приложения, циклы, Telegram, логи (8 источников), балансы | `/admin/*` (13 страниц) |

---

## Ключевые архитектурные принципы

### 1:1:1 на постинг
Один SocialAccount = одно Indigo-профило = один прокси. Hard-block: нельзя запустить постинг, если связка нарушена.

### Шифрование секретов
Все секреты (access tokens, пароли, recovery email, cookies, прокси-пароли, credential data) шифруются AES-256-GCM (`server/utils/crypto.ts`). Расшифровка идёт через `decryptSecret()` с audit-log в `SecretAccessLog` (userId, entityType, action, IP, UA, reason).

### Storage на GCS
Видео, ассеты, фреймы — в Google Cloud Storage (bucket `marketingcamp-creatives` под префиксом `zavodcamp/`). `PrefixGuard` запрещает работу за пределами префикса. Driver выбирается через `getStorageDriver()` (gcs/local/mock).

### Мock-режим для всех внешних API
Каждый внешний сервис имеет `*_MOCK_MODE=true`: Anthropic (fixtures), fal.ai (ffmpeg-генерация MP4/PNG), Telegram (stdout), Indigo/Proxy (короткое замыкание), Google Drive (REST v3 mock на порту 18889). Это даёт стабильные тесты и dev без расходов.

### Pipeline-ориентированная архитектура
Любой воркфлоу описывается как DAG (узлы + рёбра + конфиги). Узлы могут быть встроенные (HttpRequest, Code, If, Loop, Wait) или доменные (Trendwatcher, ScenarioGenerator, VideoGenerator, Upload, DriveScanner, CaptionGenerator). Версии хранятся, можно откатиться.

### Тестовая инфраструктура — first-class citizen
- Vitest для unit/integration/API contract-тестов
- Playwright для E2E на 4 viewport'ах (1920, 1280, 768, 375)
- Отдельная test-БД (порт 5436), TRUNCATE между тестами, singleThread Vitest
- Test-bypass авторизации через заголовки `x-test-auth-token` + `x-test-user-id`

---

## История проекта (сжато)

| Период | Что доминировало |
|--------|-----------------|
| 2026-03 | Базовое ТЗ (init_schema, Trend/Scenario/Video/Upload/SocialAccount), RBAC, Ideas, Pipeline |
| 2026-04 | Трендвотчер с Apify, варианты сценариев, AI-критик, Pipeline-credentials, AI-audit-log |
| 2026-04→05 | Social Automation v1-4 (proxy, Indigo browser profiles, account style, warmup planner) |
| 2026-05 (1-я половина) | Subtitle presets, Test Infra (Vitest+Playwright), Account Observability, Content Uniqueness, Scenario Quality Critic |
| 2026-05 (2-я половина) | Google Drive (Stage 1-3), Drive Auto-Caption Pipeline, GCS Storage Migration, RBAC v2 sync с MC, Manual Account Creation, Posting Method (api/browser_automation), Indigo UX, Apify Account Metrics |

Подробная история — в `.claude/agent-memory/tester/MEMORY.md` (per-feature reports со статусом PASS/FAIL).

---

## Источники истины

| Информация | Где |
|-----------|-----|
| Системные правила | `CLAUDE.md` |
| Базовое ТЗ | `docs/SPEC.md` |
| Pipeline-спецификация | `docs/PIPELINE_SPEC.md` |
| Аккаунты-feature | `docs/accounts-feature.md` |
| Indigo-интеграция | `docs/indigo-code-state.md` |
| Прокси-история | `docs/proxy-history.md` |
| Стек и правила разработки | `.claude/skills/web-dev/SKILL.md` |
| Компоненты UI | `.claude/skills/daisyUI/SKILL.md` |
| Темы | `app/assets/css/main.css` |
| Этот документ | `docs/ZAVODCAMP_STATUS/` |
