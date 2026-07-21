# ZAVODCAMP — Тотальное описание проекта

> **Версия:** 1.0
> **Дата создания:** 2026-05-21
> **Тип:** живой документ (предназначен для регулярного дополнения новым контентом)

## Назначение

Документ описывает состояние проекта на дату последнего обновления:
- архитектуру (фронт, бэк, БД)
- весь реализованный функционал
- стек, библиотеки, инфраструктуру
- команду агентов Claude и доступные скиллы
- инструменты разработки и тестирования (включая MCP Playwright)

## Содержание

1. [Обзор проекта](#1-обзор-проекта) — миссия, целевая аудитория, RBAC, связь с MarketingCamp
2. [Стек, библиотеки, конфигурация](#2-стек-библиотеки-конфигурация)
3. [Иерархия файлов](#3-иерархия-файлов) — структура папок проекта
4. [Страницы](#4-страницы) — 42 страницы UI
5. [Компоненты](#5-компоненты) — 194 Vue-компонента
6. [Composables, Stores, Middleware, Plugins](#6-composables-stores-middleware-plugins)
7. [REST API](#7-rest-api) — 311 endpoints
8. [Серверная логика](#8-серверная-логика) — utils, automation, schedulers
9. [База данных](#9-база-данных) — 75+ моделей Prisma
10. [Темы и стили](#10-темы-и-стили) — DaisyUI 5 + custom
11. [Агенты Claude](#11-агенты-claude) — 7 специализированных агентов
12. [Скиллы](#12-скиллы) — 10 скиллов
13. [MCP Playwright](#13-mcp-playwright) — скриншоты и тестирование
14. [Реализованный функционал](#14-реализованный-функционал) — карта фич по модулям
15. [Changelog](#changelog) — история изменений документа

## Краткий портрет проекта

**ZavodCamp** — производственная No-Code платформа для полного цикла видеоконтента:

`Тренды → Идея → Сценарий → Видео → Публикация → Аналитика`

Платформа интегрирована с **MarketingCamp** (единый источник RBAC) и закрывает 10 модулей.

## Метрики проекта (на дату документа)

| Категория | Кол-во |
|-----------|--------|
| Страниц (`app/pages/`) | 42 |
| Компонентов (`app/components/`) | 197 |
| Composables (`app/composables/`) | 86 |
| Pinia stores | 16 |
| API endpoints (`server/api/`) | 312 |
| Server utils (`server/utils/`) | 66 |
| Postgres моделей (Prisma) | 75+ |
| Миграций БД | 89 |
| Shared TypeScript типов | 31 |
| Активных тем DaisyUI | 5 + 2 кастомных |
| Агентов Claude | 7 |
| Скиллов | 10 |
| Mock-серверов | 3 (proxy, indigo, drive) |
| Schedulers (фоновых) | 4 |

## Как обновлять документ

1. **При добавлении новой фичи** — обновляется соответствующий раздел (страницы/компоненты/API/функционал)
2. **При архитектурных изменениях** — раздел 1 или 3
3. **При смене стека** — раздел 2
4. **При появлении нового агента/скилла** — раздел 11 или 12
5. **Любое изменение** — короткая запись в [Changelog](#changelog)

## Связанные внешние документы

| Документ | Где | Зачем |
|----------|-----|-------|
| `CLAUDE.md` | корень репо | Системные инструкции (язык, RBAC, антипаттерны) |
| `docs/SPEC.md` | docs/ | Базовое ТЗ |
| `docs/PIPELINE_SPEC.md` | docs/ | Спецификация Pipeline-движка |
| `docs/accounts-feature.md` | docs/ | Модуль аккаунтов |
| `docs/indigo-code-state.md` | docs/ | Состояние Indigo-интеграции |
| `docs/proxy-history.md` | docs/ | История прокси-стека |
| `.claude/agent-memory/tester/MEMORY.md` | .claude/ | Лента изменений от тестировщика |
| `.claude/agent-memory/architect/MEMORY.md` | .claude/ | Архитектурные планы |

Этот документ даёт **горизонтальный срез** (всё про всё), внешние — **вертикальный** (детали одной фичи).

---

# 1. Обзор проекта

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

---

# 2. Стек, библиотеки, конфигурация

## Основной стек

| Слой | Технология | Версия | Назначение |
|------|-----------|--------|-----------|
| Runtime | Bun | latest | ES modules, Node.js-совместимый |
| Frontend framework | Nuxt | 4.4.2 | SSR, file-based routing, auto-imports |
| UI library | Vue | 3.5.30 | Composition API + `<script setup lang="ts">` |
| State | Pinia | 3.0.4 | Глобальный стейт, через `@pinia/nuxt` |
| Styling | Tailwind CSS | 4.2.1 | Утилитарные классы, CSS-only config |
| Components | DaisyUI | 5.5.19 | 53 компонента, темная/светлая тема |
| ORM | Prisma | 7.4.2 | PostgreSQL adapter (pg) |
| Auth | nuxt-auth-utils | 0.5.29 | Cookie-сессии с CSRF |
| Color mode | @nuxtjs/color-mode | 4.0.0 | 5 активных тем + 2 кастомных |
| Icons | @nuxt/icon + Mingcute | 2.2.1 | SVG-mode |
| Animations | @vueuse/motion + @formkit/auto-animate | 3.0 / 0.9 | Переходы и списки |
| Graph editor | @vue-flow/core + minimap | 1.48 / 1.5 | Pipeline DAG-редактор |
| Drag & drop | vue-draggable-plus | 0.6.1 | Переупорядочивание |
| Video processing | fluent-ffmpeg + ffmpeg/ffprobe | 2.1.3 | Рендер, субтитры, lip-sync, фреймы |
| Downloader | youtube-dl-exec + yt-dlp | 3.1.5 | Видео-референсы |
| Browser automation | puppeteer-core | 24.43 | Indigo CDP-подключение, скриншоты |
| 2FA | otpauth | 9.5.1 | TOTP/HOTP |
| Markdown | marked + isomorphic-dompurify | 17 / 3.8 | Безопасный рендеринг |
| Storage | @google-cloud/storage | 7.19 | Persistent GCS |
| Proxy agents | http/https/socks-proxy-agent | 9 / 9 / 8 | Сетевой трафик через прокси |

## Тестовый стек

| Инструмент | Версия | Назначение |
|-----------|--------|-----------|
| Vitest | 2.1 | Unit / integration / contract HTTP |
| @vitest/ui | 2.1 | Web-UI |
| @nuxt/test-utils | 3.14 | `setup({ server: true })` для Nitro |
| supertest | 7.0 | HTTP API контракты |
| happy-dom | 15 | Лёгкий DOM (вместо jsdom) |
| Playwright | 1.48 | E2E на 4 viewport'ах |
| tsx | 4.21 | TS-скрипты под Bun |
| dotenv | 17.3 | `.env.test` |
| @types/pg | 8.18 | Типы для pg-драйвера |
| @types/supertest | 6.0 | Типы для supertest |
| prisma CLI | 7.4.2 | Миграции, генерация |

---

## npm scripts

### Основные

| Команда | Что делает |
|---------|-----------|
| `bun run dev` | Dev-сервер на :3000 c HMR |
| `bun run build` | Production build (`.output/`) |
| `bun run generate` | SSG-генерация |
| `bun run preview` | Просмотр собранного |
| `bun run postinstall` | `nuxt prepare` после deps |

### Mock-серверы

| Команда | Порт | Что мокает |
|---------|------|-----------|
| `bun run mock:proxy` | 18888 | Health-check прокси |
| `bun run mock:indigo` | 35001 | Indigo Browser API (auth, profiles, start/stop) |
| `bun run mock:drive` | 18889 | Google Drive REST v3 |
| `bun run mock:all` | — | proxy + indigo параллельно |

### Seed и тестовые скрипты

| Команда | Назначение |
|---------|-----------|
| `bun run seed:warmup` | Глобальные WarmupKeywordPool (idempotent) |
| `bun run seed:drive-template` | Draft pipeline Drive→Analyzer→Caption→Upload |
| `bun run test:warmup` | Логика warmup-планировщика |
| `bun run test:uniqifier` | Дедупликатор уникальных вариантов |

### Тесты

| Команда | Что запускает |
|---------|---------------|
| `bun run test` | Всё (unit + integration + api) |
| `bun run test:watch` | Watch-режим |
| `bun run test:ui` | Vitest UI (web) |
| `bun run test:unit` | Только unit |
| `bun run test:integration` | Только integration с Nuxt |
| `bun run test:api` | Только contract-тесты HTTP |
| `bun run test:e2e` | Playwright (4 viewport'а) |
| `bun run test:e2e:ui` | Playwright UI |
| `bun run test:e2e:install` | Установить Chromium |

### Prisma / БД

| Команда | Назначение |
|---------|-----------|
| `bun run test:db:migrate` | Применить миграции к test-БД |
| `bun run test:db:reset` | Сброс test-БД (без seed) |

> **Внимание:** `prisma db push` ЗАПРЕЩЁН (см. CLAUDE.md). Только `migrate dev` / `migrate deploy`.

---

## Зависимости по категориям

### Vue / Nuxt ядро
- `vue@3.5.30`, `vue-router@5.0.4`, `nuxt@4.4.2`
- `pinia@3.0.4`, `@pinia/nuxt@0.11.3`

### UI и стилизация
- `tailwindcss@4.2.1`, `@tailwindcss/vite@4.2.1`
- `daisyui@5.5.19`
- `@nuxt/icon@2.2.1`, `@iconify-json/mingcute@1.2.7`
- `@vueuse/motion@3.0.3`, `@formkit/auto-animate@0.9.0`
- `@nuxtjs/color-mode@4.0.0`

### Визуальные конструкторы
- `@vue-flow/core@1.48.2` + `@vue-flow/minimap@1.5.4` — pipeline DAG
- `vue-draggable-plus@0.6.1`

### Auth и безопасность
- `nuxt-auth-utils@0.5.29`
- `otpauth@9.5.1` (TOTP)

### БД и ORM
- `@prisma/client@7.4.2`, `@prisma/adapter-pg@7.4.2`, `pg@8.19.0`

### Контент-обработка
- `marked@17.0.4`, `isomorphic-dompurify@3.8.0`

### Видео / медиа
- `fluent-ffmpeg@2.1.3`
- `youtube-dl-exec@3.1.5`
- `puppeteer-core@24.43.1`

### Сеть и прокси
- `http-proxy-agent@9.0.0`, `https-proxy-agent@9.0.0`
- `socks-proxy-agent@8.0.5`, `socks@2.8.8`

### Cloud
- `@google-cloud/storage@7.19.0`

---

## Nuxt конфигурация (`nuxt.config.ts`)

```ts
{
  compatibilityDate: "2025-07-15",
  devtools: { enabled: true },
  css: ["./app/assets/css/main.css"],

  modules: [
    "nuxt-auth-utils",
    "@pinia/nuxt",
    "@nuxt/icon",
    "@vueuse/motion/nuxt",
    "@nuxtjs/color-mode"
  ],

  components: [
    { path: "~/components/google-drive", pathPrefix: false }, // Drive* без префикса
    "~/components"
  ],

  colorMode: {
    preference: "bumblebee",
    fallback: "bumblebee",
    dataValue: "theme",
    classSuffix: "",
    storageKey: "nuxt-color-mode",
    storage: "cookie"
  },

  app: {
    head: {
      titleTemplate: "%s — Контент-Завод",
      title: "Контент-Завод"
    }
  },

  runtimeConfig: {
    session: {
      name: "zavod-session",
      password: "", // подхватывается из NUXT_SESSION_PASSWORD
      maxAge: 7 * 24 * 60 * 60,
      cookie: { secure: process.env.NODE_ENV === "production" }
    }
  },

  vite: {
    plugins: [tailwindcss()],
    server: { allowedHosts: true }
  }
}
```

**Принцип runtime config:** только session-параметры через `runtimeConfig`. Все остальные конфиги читаются на сервере напрямую через `process.env`, чтобы **секреты не запекались в server-bundle** при build.

---

## CSS-архитектура

Единственный файл стилей: `app/assets/css/main.css`.

```css
@import "tailwindcss";
@plugin "daisyui" {
  themes: bumblebee --default, coffee --prefersdark, halloween, luxury, caramellatte;
};

@source inline(/* семантические utilities принудительно: bg-primary, text-secondary и т.д. */);

[data-theme="nightfly"] { /* кастомная тёмная тема */ ... }
[data-theme="caramelwork"] { /* кастомная светлая тема */ ... }
```

Подробнее — в [10-themes.md](10-themes.md).

---

## TypeScript

`tsconfig.json` минимальный — наследует от `.nuxt/tsconfig.json` (генерируется при `nuxt prepare`).

Strict mode включён по умолчанию через Nuxt.

---

## Vitest конфигурация (`vitest.config.ts`)

```ts
{
  test: {
    globals: true,
    environment: "happy-dom",
    pool: "threads",
    poolOptions: { threads: { singleThread: true } }, // критично для TRUNCATE
    setupFiles: ["tests/setup.ts"],
    globalSetup: ["tests/global-setup.ts"],
    testTimeout: 30000,
    hookTimeout: 120000,
    include: ["tests/**/*.spec.ts"],
    exclude: ["tests/e2e/**"]
  }
}
```

---

## Playwright конфигурация (`playwright.config.ts`)

```ts
{
  testDir: "./tests/e2e",
  webServer: {
    command: "bun run dev --port 3100 --host 127.0.0.1",
    port: 3100,
    env: {
      NODE_ENV: "test",
      PROXY_MOCK_MODE: "true",
      INDIGO_MOCK_MODE: "true",
      ANTHROPIC_MOCK_MODE: "true",
      FAL_MOCK_MODE: "true",
      TELEGRAM_MOCK_MODE: "true",
      TEST_AUTH_BYPASS: "1"
    }
  },
  projects: [
    { name: "desktop_xl", viewport: { width: 1920, height: 1080 } },
    { name: "desktop_md", viewport: { width: 1280, height: 800 } },
    { name: "tablet",     viewport: { width: 768,  height: 1024 } },
    { name: "mobile",     viewport: { width: 375,  height: 812 } }
  ],
  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  }
}
```

---

## Docker & Deployment

### `Dockerfile` (multi-stage)

**Stage 1 — Build** (`oven/bun:1`):
- `bun install --frozen-lockfile`
- `prisma generate` (с dummy DATABASE_URL)
- `nuxt build` → `.output/`

**Stage 2 — Runtime** (`oven/bun:1-slim`):
- **ffmpeg + ffprobe** — видео-рендер
- **yt-dlp** (PyInstaller static binary) — референсы
- **Indigo X agent** + **Xvfb** — headless Chrome с anti-detect
- Все deps для Chrome (libgtk, libnss, libxss, libpango, libasound, fonts-liberation, fonts-noto-color-emoji и т.д.)
- Volumes: `/app/storage/uploads`, `/app/storage/frames`
- EXPOSE 3000, HOST=0.0.0.0

### `entrypoint.sh`

1. **Pre-flight:** проверяет наличие ffmpeg, ffprobe, yt-dlp; обязательные env (`DATABASE_URL`, `NUXT_SESSION_PASSWORD`, `ENCRYPTION_KEY`=64 hex, `MARKETING_CAMP_URL`, `INTER_SERVICE_API_KEY`, `ZAVOD_API_KEY`)
2. **Storage:** проверка mount-point (warning при overlayfs)
3. **Migrations:** `prisma migrate deploy` (fail-fast)
4. **Seed:** опционально `RUN_SEED=true`
5. **Indigo + Xvfb:** запускает агент в фоне, ждёт `/api/v1/version` до 60s
6. **App:** `exec bun .output/server/index.mjs`

---

## Environment Variables

### REQUIRED (без них не стартует)
- `NODE_ENV` — production / development / test
- `DATABASE_URL` — Postgres connection
- `NUXT_SESSION_PASSWORD` — сессионный секрет (≥32 символа)
- `ENCRYPTION_KEY` — AES-256-GCM (ровно 64 hex = 32 байта)
- `MARKETING_CAMP_URL` — URL родительской платформы
- `INTER_SERVICE_API_KEY` — для `/api/auth/validate-external`
- `ZAVOD_API_KEY` — Bearer для `/api/zavod/*`

### AI и внешние API
- `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (`claude-sonnet-4-20250514`), `ANTHROPIC_HAIKU_MODEL` (`claude-haiku-4-5-20251001`)
- `FAL_KEY` (генерация изображений/видео/TTS)
- `MUBERT_KEY` (генерация музыки)
- `APIFY_TOKEN` (Apify-парсеры трендов, баланс)
- `NODEMAVEN_API_KEY` (резидентные прокси)
- `DEFAULT_TTS_MODEL_ID=fal-ai/kokoro/american-english`, `DEFAULT_TTS_VOICE_EN=af_heart`, `DEFAULT_TTS_VOICE_RU=bf_emma`
- `ELEVENLABS_API_KEY` (опционально)
- `ENABLE_VOICEOVER_BY_DEFAULT` (default false)

### Safety switches
- `ENABLE_PAID_APIS=false` — глобальный switch (Anthropic/fal.ai/Mubert)
- `ENABLE_SOCIAL_POSTING=false` — публикация в соцсети

### Социальные платформы
- `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`
- `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`
- `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`
- `TELEGRAM_BOT_TOKEN`

### Schedulers
- `SCHEDULER_UPLOAD_INTERVAL_MS=300000`
- `SCHEDULER_METRICS_INTERVAL_MS=3600000`
- `SCHEDULER_CYCLE_CHECK_INTERVAL_MS=21600000`
- `SCHEDULER_CYCLE_TIMEOUT_MS=1800000`
- `SCHEDULER_REFERENCE_WATCHDOG_INTERVAL_MS=300000`
- `SCHEDULER_REFERENCE_WATCHDOG_TIMEOUT_MS=600000`
- `PROXY_HEALTH_CHECK_ENABLED=true`, `SCHEDULER_PROXY_HEALTH_INTERVAL_MS=14400000`
- `POSTING_WORKER_ENABLED=true`, `SCHEDULER_POSTING_INTERVAL_MS=30000`
- `GOOGLE_DRIVE_SCHEDULER_ENABLED=true`, `SCHEDULER_GOOGLE_DRIVE_INTERVAL_MS=1800000`
- `REFERENCE_THRESHOLD_VIEWS=10000`, `REFERENCE_THRESHOLD_WATCH_THROUGH=50`

### Mock-mode
- `PROXY_MOCK_MODE`, `PROXY_MOCK_URL=http://localhost:18888`
- `INDIGO_MOCK_MODE`, `INDIGO_MOCK_URL=http://localhost:35001`, `INDIGO_API_BASE`, `INDIGO_LAUNCHER_BASE`
- `ANTHROPIC_MOCK_MODE` (fixtures из `server/__fixtures__/agents/`)
- `FAL_MOCK_MODE` (ffmpeg-generated MP4/MP3/PNG)
- `TELEGRAM_MOCK_MODE` (stdout-логирование)
- `GOOGLE_DRIVE_MOCK_MODE=true`, `GOOGLE_DRIVE_MAX_DOWNLOAD_BYTES=524288000`

### Storage
- `STORAGE_DRIVER` — `gcs` / `local` / `mock`
- `STORAGE_LOCAL_ROOT=./storage`
- `GCS_PROJECT_ID=marketingcamp-drive`
- `GCS_BUCKET_NAME=marketingcamp-creatives`
- `GCS_CREDENTIALS_JSON_BASE64` (основной) / `GCS_CREDENTIALS_JSON` / `GOOGLE_APPLICATION_CREDENTIALS` (file path)
- `FRAME_STORAGE_PATH=storage/frames`

### Critic (AI-критика сценариев)
- `SCENARIO_CRITIC_ENABLED=true`
- `CRITIC_MOCK_VARIANT` — `''` / `rework`

### Test infrastructure (`.env.test`)
- `SCHEDULERS_ENABLED=false`
- `TEST_AUTH_BYPASS=1`
- `TEST_AUTH_TOKEN` — синтетический токен

### Deployment helpers
- `YT_DLP_BIN_PATH=/usr/local/bin/yt-dlp`
- `RUN_SEED=true`

---

## Сводный размер проекта

| Метрика | Значение |
|---------|----------|
| `bun.lock` | ~294 KB |
| `package.json` | 2.7 KB |
| `node_modules/` | 731 пакет |
| `package-lock.json` | 386 KB (но используется bun.lock) |
| Production-зависимостей | ~30 |
| Dev-зависимостей | ~11 |
| Размер production build | ~38-39 MB (`.output/`) |

---

# 3. Иерархия файлов

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

---

# 4. Страницы

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
| `/uploads` | `uploads/index.vue` | Список загрузок (API/OAuth публикации). Каждая карточка несёт 1:1:1 бейджи (postingMethod / Indigo / ProxyHealth), `AccountDiagnosticPanel` (JSON↔human toggle + копирование), chip связанного PostingJob (Upload 1:1 opt-in), proxy-gating preview. Разводящая подпись отделяет от browser_automation очереди в `/posting-jobs` и видео-креативов в `/videos`. URL ↔ store sync через `route.query.socialAccountId` | `module-access:social-upload` | `useUploads` |
| `/uploads/[id]` | `uploads/[id].vue` | Детали загрузки: видео, платформы, мета (заголовок/описание/хештеги), статус публикации | `module-access:social-upload` | `useUploadDetail`, `useUploadActions` |
| `/accounts` | `accounts/index.vue` | Управление аккаунтами: подключение, группировка, прокси, style-профили (Indigo), метрики, warmup-статус | `module-access:social-upload` | `useAccounts`, `useAccountGroups`, `useAccountActions` |
| `/posting-jobs` | `posting-jobs/index.vue` | Очередь постинга (browser_automation): расписание, статусы, retry, отмена, логи. Кнопка «Создать задачу» открывает `PostingJobCreateModal` (выбор аккаунта/видео + предпросмотр 1:1:1 бейджей + scheduledAt asap/scheduled/random + хэштеги-парсер). Карточки используют `AccountDiagnosticPanel` с suggestion по errorCategory (Part D: login_required, browser_connect_failed, selector_not_found, upload_failed), ссылку на скриншот через signed URL. URL → store sync, stats stats-vertical → sm:stats-horizontal на мобиле | `module-access:social-upload` | `usePostingJobs`, `usePostingJobActions` |
| `/proxies` | `proxies/index.vue` | Прокси: добавление, health-checks (latency, бан), логи, диагностика | `module-access:social-upload` | `useProxies`, `useProxyActions` |
| `/indigo` | `indigo/index.vue` | Indigo browser profiles: синк с workspace, очистка дубликатов, диагностика | `module-access:social-upload` | `useIndigoProfiles`, `useIndigoActions` |
| `/indigo/[id]` | `indigo/[id].vue` | Детали профиля: сеансы, статус, fingerprints, запуск (stepper), логи | `module-access:social-upload` | `useIndigoStartFlow` |

---

## Analytics — Аналитика

| Маршрут | Файл | Описание | Middleware | Composables |
|---------|------|----------|-----------|-------------|
| `/analytics` | `analytics/index.vue` | 3 таба: Summary (общие метрики), По аккаунту, **Аккаунты** (Apify per-account метрики). Дашборд, таблица постов с сортировкой, графики CTR. На табе «Аккаунты» — aggregate-плашка (всего аккаунтов / со снимками / Σ followers / средний engagement) + grid `AccountsSummaryCard` (lg:grid-cols-2) с последним snapshot + sparkline + бейджем свежести. Метрики через Apify покрывают любой `postingMethod` (api OAuth / browser_automation). `AnalyticsCollectButton` скрыт на этом табе | `module-access:analytics` | `useAnalyticsDashboard`, `useAnalyticsPosts`, `useAnalyticsAccountsSummary` |
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

---

# 5. Компоненты

Всего **194 компонента** в 19 категориях. Все автоматически импортируются Nuxt — в шаблонах используются как `<TrendCard />` (PascalCase).

---

## shared/ — Универсальные (11)

| Компонент | Назначение |
|-----------|-----------|
| `EmptyState.vue` | Заглушка для пустых списков (иконка, заголовок, описание) |
| `Pagination.vue` | Постраничная навигация (номера, стрелки) |
| `AsyncSelect.vue` | Select с асинхронной загрузкой опций |
| `FieldHint.vue` | Подсказка для поля формы (tooltip) |
| `AiSuggestButton.vue` | Кнопка AI-подсказок в формах |
| `PageGuide.vue` | Встроенное руководство для страницы (коллапс) |
| `TaxonomyPicker.vue` | Выбор из таксономии (dropdown с иерархией) |
| `TaxonomyManager.vue` | Управление таксономией (add/edit/delete) |
| `TagInput.vue` | Ввод тегов с автодополнением |
| `TagPicker.vue` | Выбор тегов из списка |
| `RunPipelineFilterBadge.vue` | Badge фильтра по запуску/конвейеру |

---

## trend/ — Тренды (17)

| Компонент | Назначение |
|-----------|-----------|
| `TrendCard.vue` | Карточка тренда (миниатюра, заголовок, статус, платформа) |
| `TrendFilters.vue` | Фильтры: статус, платформа, поиск, язык, гео, хештеги |
| `TrendStatusBadge.vue` | Badge статуса (new, processing, ready, published, rejected) |
| `TrendPlatformBadge.vue` | Badge платформы (TikTok/Instagram Reels/YouTube/Telegram) |
| `TrendSourceBadge.vue` | Badge источника (Apify, manual import) |
| `TrendDetailSidebar.vue` | Сайдбар детали тренда |
| `TrendBriefCard.vue` | Творческий бриф |
| `TrendInsightCard.vue` | Карточка инсайта (legacy) |
| `TrendAiAnalyzeButton.vue` | Кнопка AI-анализа |
| `TrendMetrics.vue` | Метрики тренда |
| `AppSelector.vue` | Выбор приложения (платформы) |
| `ProfileCard.vue` | Карточка профиля парсинга Apify |
| `ProfileForm.vue` | Форма CRUD профиля парсинга |
| `ScheduleForm.vue` | Расписание (cron) |
| `RunHistory.vue` | История запусков парсинга |
| `RunDetail.vue` | Детали одного запуска |
| `TrendStatusActions.vue` | Действия со статусом (mark ready/rejected) |

---

## scenario/ — Сценарии (14)

| Компонент | Назначение |
|-----------|-----------|
| `ScenarioCard.vue` | Карточка сценария |
| `ScenarioFilters.vue` | Фильтры |
| `ScenarioStatusBadge.vue` | Badge статуса (generating/ready/selected/rejected) |
| `VariantStatusBadge.vue` | Badge статуса варианта |
| `ScenarioDetail.vue` | Полное отображение варианта (hook, body, CTA, стиль) |
| `ScenarioEditor.vue` | Редактор варианта |
| `ScenarioVariantTabs.vue` | Табы вариантов с оценкой critic |
| `ScenarioActions.vue` | Select/Reject/Edit/Regenerate |
| `ScenarioGenerateButton.vue` | Запуск генерации |
| `ScenarioCriticBadge.vue` | Badge AI-оценки |
| `ScenarioCriticReportModal.vue` | Детальный отчёт критика |
| `ScenarioFeedbackForm.vue` | Обратная связь продюсера |
| `ScenarioReviewHistory.vue` | История ревью |
| `ScenarioStoryPlan.vue` | План истории сценария |

---

## video/ — Видео (14)

| Компонент | Назначение |
|-----------|-----------|
| `VideoCard.vue` | Карточка видео |
| `VideoFilters.vue` | Фильтры |
| `VideoStatusBadge.vue` | Badge статуса |
| `VideoPlayer.vue` | HTML5 плеер |
| `VideoGenerateButton.vue` | Запуск генерации |
| `VideoActions.vue` | Скачать/Удалить/Пересоздать |
| `VideoProgress.vue` | Прогресс генерации (stage, %) |
| `VideoOutputConfig.vue` | Формат/разрешение/FPS/стиль |
| `VideoImageLightbox.vue` | Лайтбокс для превью |
| `VideoSubtitleEditor.vue` | Редактор субтитров (импорт/правка/стиль) |
| `VideoSubtitlePresetCard.vue` | Карточка пресета (шрифт/цвет/позиция) |
| `VideoSubtitlePresetPicker.vue` | Выбор пресета |
| `VideoAiVisualButton.vue` | AI-рекомендации стиля |
| `VideoUniqueVariantsSection.vue` | Уникализированные варианты per-platform |
| `VideoCaptionsSection.vue` | Управление подписями |

---

## idea/ — Идеи (11)

| Компонент | Назначение |
|-----------|-----------|
| `IdeaCard.vue` | Карточка идеи |
| `IdeaFilters.vue` | Фильтры |
| `IdeaStatusBadge.vue` | Badge статуса |
| `IdeaSourceBadge.vue` | Badge источника (chat/pipeline/manual) |
| `IdeaActions.vue` | Approve/Reject/Edit/Delete |
| `IdeaSubmitForm.vue` | Форма создания идеи |
| `IdeaAnalysis.vue` | AI-анализ идеи |
| `IdeaReferenceAnalysis.vue` | Сравнение с референсами |
| `IdeaReferenceProgress.vue` | Прогресс reference-сравнения |
| `IdeaSyncInfo.vue` | Информация о синке с MC |
| `IdeaSyncToolbar.vue` | Toolbar синхронизации |

---

## pipeline/ — Конвейер (27)

| Компонент | Назначение |
|-----------|-----------|
| `PipelineCard.vue` | Карточка конвейера (название, иконка, тег) |
| `PipelineCanvas.vue` | Визуальный редактор (@vue-flow): узлы, рёбра, drag-n-drop |
| `PipelineNode.vue` | Базовый узел |
| `PipelineNoteNode.vue` | Узел-заметка |
| `PipelineStatusBadge.vue` | Badge статуса (active/inactive) |
| `PipelineToolbar.vue` | Toolbar: save, undo/redo, add node |
| `PipelineRightPanel.vue` | Правая панель: конфиг узла, тест |
| `PipelineSidebar.vue` | Левая панель: каталог узлов |
| `PipelineNodeSettings.vue` | Настройки узла |
| `PipelineNodeConfigForm.vue` | Форма конфига по типу |
| `PipelineNodeTestPanel.vue` | Тестирование узла |
| `PipelineNodeLastRun.vue` | Последний запуск узла |
| `PipelineAiAuditLog.vue` | AI-аудит конвейера |
| `PipelineAiAutofill.vue` | AI-автозаполнение |
| `PipelineCreateModal.vue` | Создание (название, иконка, цвет) |
| `PipelineDeleteConfirmModal.vue` | Подтверждение удаления |
| `PipelineUnsavedModal.vue` | Несохранённые изменения |
| `PipelineWebhookModal.vue` | Управление webhook'ом |
| `PipelineScheduleModal.vue` | Расписание (cron) |
| `PipelineVersionsModal.vue` | История версий + rollback |
| `PipelineImportModal.vue` | Импорт из JSON/YAML |
| `PipelinePresetsModal.vue` | Пресеты конвейеров |
| `PipelinePreviewModal.vue` | Превью перед сохранением |
| `PipelineRunCard.vue` | Карточка исполнения |
| `PipelineRunsModal.vue` | История исполнений |
| `PipelineRunStats.vue` | Статистика (success rate, avg time) |
| `PipelineTagPicker.vue` | Выбор тегов |

### pipeline/config/ — Конфигураторы узлов

| Конфиг | Узел |
|--------|------|
| `HttpRequestConfig.vue` | HTTP-вызов внешнего API |
| `CodeConfig.vue` | Sandboxed JS-код |
| `IfConfig.vue` | Условие |
| `LoopConfig.vue` | Цикл |
| `WaitConfig.vue` | Задержка |
| `FilterConfig.vue` | Фильтрация коллекции |
| `SetConfig.vue` | Установка переменных |
| `AnalyticsConfig.vue` | Сбор аналитики |
| `SubPipelineConfig.vue` | Вызов другого pipeline |
| `IdeaConfig.vue` | Создание идеи |
| `ScenarioAppSelector.vue` | Выбор приложения для сценария |

---

## upload/ — Социальные загрузки (7)

| Компонент | Назначение |
|-----------|-----------|
| `UploadCard.vue` | Карточка загрузки с `AccountDiagnosticPanel` (JSON↔human toggle, копирование), 1:1:1 бейджи (postingMethod Auto-Browser/API, Indigo, ProxyHealth), платформенный `badge-soft` с цветом платформы, chip связанного `PostingJob` (Upload 1:1 opt-in → ведёт на `/posting-jobs?socialAccountId=N`). `@click.stop` на панели — клик не триггерит navigateTo |
| `UploadFilters.vue` | Фильтры |
| `UploadStatusBadge.vue` | Badge статуса (pending/published/failed/scheduled) |
| `UploadActions.vue` | Опубликовать/Отменить/Edit |
| `UploadCreateModal.vue` | Создание (выбор видео, платформы) |
| `UploadMetaForm.vue` | Заголовок/описание/хештеги |
| `UploadModuleBanner.vue` | Баннер статуса модуля |

---

## analytics/ — Аналитика (9)

| Компонент | Назначение |
|-----------|-----------|
| `AnalyticsFilters.vue` | Фильтры (статус, аккаунт, период, сортировка) |
| `DashboardStats.vue` | Общие метрики (views, likes, shares) |
| `MetricsHistory.vue` | Линейный график истории |
| `PostsTable.vue` | Таблица постов с sortable колонками |
| `TopCtrList.vue` | Топ постов по CTR |
| `AnalyzeButton.vue` | Запуск анализа |
| `CollectButton.vue` | Сбор метрик (webhook к API соцсети) |
| `AccountsSummaryAggregate.vue` | Aggregate-плашка таба «Аккаунты»: всего аккаунтов / со снимками / Σ followers / средний engagement |
| `AccountsSummaryCard.vue` | Карточка аккаунта в табе «Аккаунты»: иконка платформы, handle, последний ok-снимок через переиспользуемые `AccountMetricsStatCards` + `AccountMetricsSparkline`, бейдж свежести «обновлено N ч/дней назад» (warn при ≥2 дней — Apify 24h idempotent), edge states (нет handle / нет снимков / только error-снимки) |

---

## account/ — Аккаунты (22)

| Компонент | Назначение |
|-----------|-----------|
| `AccountCard.vue` | Карточка аккаунта (платформа, ник, аватар, статус) |
| `AccountConnectButton.vue` | Подключение через OAuth |
| `AccountCreateModal.vue` | Создание вручную (multi-step wizard) |
| `AccountEditModal.vue` | Редактирование |
| `AccountGroupCard.vue` | Карточка группы |
| `AccountGroupEditModal.vue` | Редактирование группы |
| `AccountDiagnosticPanel.vue` | Диагностика (последняя ошибка, статус API) |
| `AccountLoginStatusBadge.vue` | Статус входа (online/offline/suspicious) |
| `AccountLoginCheckButton.vue` | Кнопка проверки входа |
| `AccountLoginInstructionsBlock.vue` | Инструкции по ручному входу (для 2FA) |
| `AccountCredentialsForm.vue` | Форма учётных данных (login, password, recovery email) |
| `AccountCredentialRevealModal.vue` | Раскрытие учётных данных (с reason) |
| `AccountMetricsTab.vue` | Таб метрик (followers, engagement rate) |
| `AccountMetricsStatCards.vue` | Карточки со статами |
| `AccountMetricsSparkline.vue` | Mini-графики динамики |
| `AccountMetricsPostsList.vue` | Список постов аккаунта |
| `AccountWarmupTab.vue` | Таб warmup (статус, история) |
| `AccountProxyPicker.vue` | Выбор прокси |
| `AccountPicker.vue` | Селектор аккаунта (для фильтров) |
| `AccountStyleProfileEditor.vue` | Редактор стиль-профиля Indigo |
| `AccountStyleStatusBadge.vue` | Badge статуса стиля |
| `AccountIndigoTab.vue` | Таб управления Indigo для аккаунта |

---

## admin/ — Администрирование (21)

| Компонент | Назначение |
|-----------|-----------|
| `DashboardStatusCard.vue` | Статус системы (uptime, modules) |
| `DashboardVideoStats.vue` | Статистика видео |
| `DashboardAlerts.vue` | Неразрешённые ошибки |
| `DashboardRecentCycles.vue` | Последние циклы |
| `UserCard.vue` | Карточка пользователя |
| `UserRoleEditor.vue` | Редактор роли (read-only из MC, только isActive) |
| `AppCard.vue` | Карточка приложения |
| `AppForm.vue` | CRUD приложения |
| `AppDeleteConfirmModal.vue` | Подтверждение удаления |
| `AppReferenceImagesManager.vue` | Менеджер справочных изображений |
| `AppReferenceImagesModal.vue` | Upload/delete/crop |
| `CycleCard.vue` | Карточка цикла |
| `CycleStartModal.vue` | Запуск нового цикла |
| `LogEntry.vue` | Одна запись лога |
| `LogFilters.vue` | Фильтры логов |
| `AccountsHealthSummary.vue` | Сводка здоровья по платформам |
| `AccountsHealthTable.vue` | Детальная таблица |
| `AccountsHealthByPlatform.vue` | Распределение по платформам |
| `AccountCompletenessBar.vue` | Bar полноты профиля |
| `IndigoOrphanCleanupSection.vue` | Очистка orphan-профилей |

### admin/telegram/ — Telegram-бот (6)

| Компонент | Назначение |
|-----------|-----------|
| `Overview.vue` | Обзор Telegram-интеграции |
| `Diagnostics.vue` | Диагностика бота |
| `Chats.vue` | Управление чатами |
| `Templates.vue` | Шаблоны сообщений |
| `Deliveries.vue` | Доставленные сообщения |
| `Audit.vue` | Аудит команд |
| `ApiKeys.vue` | API-ключи |

---

## indigo/ — Браузер (12)

| Компонент | Назначение |
|-----------|-----------|
| `IndigoProfileCard.vue` | Карточка профиля браузера |
| `IndigoProfileEditModal.vue` | Редактирование (прокси, fingerprint) |
| `IndigoProfileLinkModal.vue` | Привязка к аккаунту |
| `IndigoSessionStatusBadge.vue` | Статус сеанса (running/idle/error) |
| `IndigoSyncStatusBadge.vue` | Статус синхронизации |
| `IndigoFingerprintSection.vue` | Browser fingerprints (UA, Canvas) |
| `IndigoTestResultModal.vue` | Результаты теста профиля |
| `IndigoCredentialsModal.vue` | Учётные данные Indigo API |
| `IndigoDevicePresetSelector.vue` | Preset устройства (iPhone/Desktop/Android) |
| `IndigoStartProgressStepper.vue` | Stepper запуска сеанса |
| `IndigoSanityPanel.vue` | Health check |
| `IndigoLauncherFallbackModal.vue` | Fallback если не удалось запустить |

---

## proxy/ — Прокси (6)

| Компонент | Назначение |
|-----------|-----------|
| `ProxyCard.vue` | Карточка прокси (адрес, порт, ping) |
| `ProxyHealthBadge.vue` | Здоровье (ok/slow/down) |
| `ProxyAddModal.vue` | Добавление |
| `ProxyCheckHistoryModal.vue` | История пингов |
| `ProxyRevealCredentialsModal.vue` | Раскрытие пароля |
| `ProxyDiagnoseModal.vue` | Диагностика (прямой пинг, тест через API) |

---

## warmup/ — Разогрев (6)

| Компонент | Назначение |
|-----------|-----------|
| `WarmupSessionCard.vue` | Карточка сеанса разогрева |
| `WarmupSessionStatusBadge.vue` | Статус сеанса |
| `WarmupKeywordPoolCard.vue` | Пул ключевых слов |
| `WarmupKeywordPoolEditor.vue` | Редактор пула |
| `WarmupPlanPreviewModal.vue` | Превью плана |
| `WarmupActionList.vue` | Лист действий (follow/like/comment) |

---

## posting/ — Постинг (6)

| Компонент | Назначение |
|-----------|-----------|
| `PostingJobCard.vue` | Карточка задачи: 1:1:1 бейджи (Auto-Browser/API, Indigo, ProxyHealth), `AccountDiagnosticPanel` вместо inline-строки lastError (toggle JSON↔human, копирование, кнопка «Открыть скриншот» через signed URL), маппинг job→`AccountDiagnosticError` с suggestion по errorCategory (Part D), video preview через `rounded-box` (--radius-box) |
| `PostingJobStatusBadge.vue` | Статус (pending/queued/posting/done/failed) |
| `PostingJobLogsModal.vue` | Логи публикации |
| `PostingJobRetryConfirm.vue` | Подтверждение retry |
| `PostingJobCancelModal.vue` | Отмена |
| `PostingJobCreateModal.vue` | Ручное создание задачи постинга: пикер аккаунта (`useAccounts(active)`) + пикер видео (`useVideos(completed)`), превью бейджей под селектами (postingMethod / Indigo / ProxyHealth), client-side 1:1:1 pre-check (визуальный warning — финальный gating всегда серверный 412), радио scheduledAt (asap/scheduled) + «Рандомно (1–24 ч)», парсер хэштегов «#tag1, tag2», серверные 412/409/400/404/500 разворачиваются через `toDiagnosticError` в inline `AccountDiagnosticPanel` |

---

## favorite-prompt/ — Промты (4)

| Компонент | Назначение |
|-----------|-----------|
| `FavoritePromptCard.vue` | Карточка промта (текст, категория, рейтинг) |
| `FavoritePromptModal.vue` | Редактирование |
| `FavoritePromptButton.vue` | Добавить в избранное |
| `FavoritePromptFilters.vue` | Фильтры (категория, рейтинг, поиск) |

---

## google-drive/ — GDrive (7)

Регистрируется без префикса (`Drive*` компоненты).

| Компонент | Назначение |
|-----------|-----------|
| `DriveCredentialsSection.vue` | Управление credentials |
| `DriveCredentialCard.vue` | Карточка credential (email, статус) |
| `DriveBrowserSection.vue` | Браузер папок/файлов |
| `DriveFileRow.vue` | Строка файла |
| `DriveFolderPicker.vue` | Выбор папки для синка |
| `DriveImportToVideoModal.vue` | Импорт файла в видео |
| `ServiceAccountSetupModal.vue` | Инструкции setup Service Account |

---

## creative/ — Креативы (2)

| Компонент | Назначение |
|-----------|-----------|
| `CreativeCard.vue` | Карточка креатива |
| `CreativeFilters.vue` | Фильтры (тип/источник/статус) |

---

## reference/ — Справочники (1)

| Компонент | Назначение |
|-----------|-----------|
| `ReferenceCard.vue` | Карточка образца для вдохновения |

---

## settings/ — Настройки (1)

| Компонент | Назначение |
|-----------|-----------|
| `IntegrationCard.vue` | Карточка интеграции на странице настроек |

---

## Конвенции компонентов

- **Только `<script setup lang="ts">`** + Composition API
- **DaisyUI 5** компоненты перед самописными (btn, card, modal, drawer, table, ...)
- **Tailwind 4 утилиты** для customization; кастомный CSS — только если объективно недостижимо
- **Семантические цвета** DaisyUI (`bg-primary`, `text-base-content/70`) — никаких хардкод-цветов
- **Иконки** через `<Icon name="mingcute:..." />` от `@nuxt/icon` + `@iconify-json/mingcute`
- **Auto-animate** для списков (`v-auto-animate`)
- **VueUse Motion** для переходов
- **Props down, events up** — стандартный Vue data flow
- **Локальный стейт** в `ref/reactive`; глобальный — в Pinia stores
- **Шаблоны иммутабельны** в SSR — никаких `window` без `import.meta.client`

---

# 6. Composables, Stores, Middleware, Plugins

## Composables (86)

Все composables в `app/composables/` автоматически импортируются. Большинство — обёртки `useFetch`/`$fetch` с reactive query, watch, key для кеширования.

### Тренды и парсинг

| Composable | Назначение |
|-----------|-----------|
| `useTrends` | Загрузка списка трендов с фильтрами (status, platform, search, hashtags, geo, language, viewCountMin/Max, analysisStatus, page, sort) |
| `useTrendDetail` | Детали тренда, refresh при изменении ID |
| `useTrendStats` | Статистика (total, recent count за 24h) |
| `useTrendwatcherProfiles` | CRUD профилей Apify (create, update, delete, run) |
| `useTrendwatcherRuns` | История запусков парсинга + polling активных |
| `useCreatives` | Каталог креативов |

### Сценарии и идеи

| Composable | Назначение |
|-----------|-----------|
| `useScenarios` | Список сценариев (с фильтром по тренду) |
| `useScenarioDetail` | Детали + варианты + AI-критика |
| `useScenarioActions` | Select, reject, regenerate |
| `useGenerateScenarios` | Запуск генерации вариантов |
| `useIdeas` | Список идей |
| `useIdeaDetail` | Детали + анализ |
| `useIdeaActions` | Approve, reject |
| `useIdeaSync` | Синхронизация с MarketingCamp (external sync) |
| `useFavoritePrompts` | Лучшие промты |
| `useFavoritePromptDetail` | Один промт с AI-pattern анализом |
| `useFavoritePromptActions` | Save, delete, rate, reanalyze |

### Видео

| Composable | Назначение |
|-----------|-----------|
| `useVideos` | Список видео (фильтр по сценарию/формату) |
| `useVideoDetail` | Детали + ассеты + промты |
| `useVideoActions` | Скачать, удалить, пересоздать |
| `useVideoProgress` | Polling прогресса генерации (stage, %) |
| `useVideoPlayback` | Управление проигрыванием |
| `useVideoVariants` | Уникальные варианты per-platform |
| `useVideoVariantActions` | Действия над вариантами |
| `useSubtitlePresets` | 10 пресетов субтитров (Opus.pro style) |
| `useVideoStorageStatus` | Статус GCS хранилища, очистка, recover |

### Загрузки и постинг

| Composable | Назначение |
|-----------|-----------|
| `useUploads` | Список загрузок |
| `useUploadDetail` | Детали + статус на каждой платформе |
| `useUploadActions` | Опубликовать, отменить, retry |
| `useUploadModuleStatus` | Статус модуля (ENABLE_SOCIAL_POSTING) |
| `usePostingJobs` | Очередь постинга |
| `usePostingJobActions` | Retry, cancel, view logs |

### Аккаунты

| Composable | Назначение |
|-----------|-----------|
| `useAccounts` | Список соц-аккаунтов (фильтр по app/platform) |
| `useAccountGroups` | Группы аккаунтов |
| `useAccountActions` | OAuth подключение/отключение |
| `useAccountCredentials` | Сохранение/raw reveal учётных данных |
| `useAccountMetrics` | Метрики (followers, engagement rate, post stats) |
| `useAccountsHealth` | Дашборд здоровья (/admin) |
| `useLoginCheck` | Проверка статуса входа |
| `useTotp` | 2FA-коды (генерация/верификация) |

### Аналитика

| Composable | Назначение |
|-----------|-----------|
| `useAnalyticsDashboard` | Сводка: views, engagement, CTR |
| `useAnalyticsPosts` | Таблица постов (sortable) |
| `useAnalyticsDetail` | Метрики конкретной загрузки (история) |
| `useAnalyticsActions` | Запуск сбора метрик |
| `useAnalyticsAccountsSummary` | Аккаунты-сводка через Apify (`GET /api/analytics/accounts-summary`). Reactive query через `useFetch` без дублирующего `watch:[query]`. Типизированный response `AccountsSummaryResponse` (items + aggregate + filters echo). Не дублирует `useAccountMetrics` (тот для одного аккаунта в `AccountEditModal`) |

### Конвейер

| Composable | Назначение |
|-----------|-----------|
| `usePipelines` | Список конвейеров |
| `usePipelineDetail` | Детали (граф, конфигурация) |
| `usePipelineActions` | Save, delete, version control |
| `usePipelineRuns` | История исполнений |
| `usePipelineRunDetail` | Детали запуска (логи узлов) |
| `usePipelineMonitor` | Панель мониторинга (каталог + история) |
| `usePipelineMonitorUrlSync` | URL ↔ state синхронизация |
| `useRunPipelineFilter` | Фильтр по запуску/конвейеру в URL |

### Indigo и инфраструктура

| Composable | Назначение |
|-----------|-----------|
| `useIndigoProfiles` | CRUD профилей |
| `useIndigoActions` | Sync с workspace, cleanup duplicates |
| `useIndigoStartFlow` | Запуск сеанса (stepper) |
| `useProxies` | Список прокси |
| `useProxyActions` | Health checks, диагностика |
| `useWarmupSessions` | История сеансов разогрева |
| `useWarmupKeywords` | Пулы ключевых слов |
| `useWarmupActions` | Запуск плана warmup |

### Администрирование

| Composable | Назначение |
|-----------|-----------|
| `useAdminDashboard` | Дашборд админа |
| `useAdminApps` | Приложения |
| `useAdminUsers` | Пользователи |
| `useAdminCycles` | Циклы генерации |
| `useAdminLogs` | Унифицированная лента (8 источников) |
| `useAdminTelegram` | Telegram-бот |
| `useAdminBalances` | Остатки сервисов |
| `useRbacConfig` | Конфигурация RBAC |
| `usePermissions` | `can()`, `canAccessModule()` для UI |

### Интеграции

| Composable | Назначение |
|-----------|-----------|
| `useGoogleDrive` | Drive credentials, files, sync |
| `useAppReferenceImages` | Справочные изображения приложения |
| `useAppEnrich` | Обогащение метаданных приложения |
| `useIntegrationStatus` | Статус Indigo/AI/прокси |

### Общие

| Composable | Назначение |
|-----------|-----------|
| `useTaxonomy` | Таксономии по типу (категории, метки) |
| `useReferences` | Справочные образцы |
| `useMarkdownSafe` | Безопасный markdown-рендеринг |
| `useAiSuggest` | AI-саджесты для полей форм |

---

## Stores (Pinia) — 16

Stores в `app/stores/`. Все — фильтры списков или UI-стейт. Паттерн: `computed query` → `resetPage()` → `watch` на URL-sync.

| Store | Stateful поля | Использование |
|-------|---------------|----------------|
| `trendFilters` | status, platform, search, hashtags, geo, language, viewCountMin/Max, analysisStatus, page, sort | `/trends` |
| `scenarioFilters` | status, trendId, page, perPage | `/scenarios` |
| `videoFilters` | status, scenarioId, format, page, perPage | `/videos` |
| `uploadFilters` | status, platform, search, page, perPage | `/uploads` |
| `ideaFilters` | status, trendId, page, perPage | `/ideas` |
| `creativeFilters` | type, source, status, page, perPage | `/creatives` |
| `analyticsFilters` | socialAccountId, platform, sort field, page | `/analytics` |
| `favoritePromptFilters` | search, category, page, perPage | `/prompts-library` |
| `pipelineMonitor` | viewMode (catalog/monitor), catalogPage, filters; localStorage hydration | `/pipeline` |
| `pipelineEditor` | pipelineId, name, nodes[], edges[], webhookToken, isDirty; **undo/redo история до 50 снапшотов** | `/pipeline/[id]` |
| `proxyFilters` | search, status, page | `/proxies` |
| `indigoFilters` | search, status | `/indigo` |
| `postingJobFilters` | status, platform, page | `/posting-jobs` |
| `warmupFilters` | status, accountId, page | `/admin/warmup-keywords` |
| `adminFilters` | level, module, resolved | `/admin/logs` |
| `aiCache` | результаты саджестов, анализов (в памяти) | глобально |

---

## Middleware (3)

### Глобальный

**`auth.global.ts`** — auth guard. Whitelist: `/auth/login`, `/auth/callback`. При отсутствии сессии — `navigateTo('/auth/login')` с redirect-параметром.

### Именованные

**`module-access.ts`** — проверяет наличие модуля в `moduleAccess`:

```ts
definePageMeta({
  middleware: 'module-access',
  moduleSlug: 'pipeline'
})
```

Fail-open на клиенте — серверный RBAC всё равно поймает.

**`admin-access.ts`** — проверяет `can('canAdmin')`. Применяется к `/admin/*`.

```ts
definePageMeta({ middleware: 'admin-access' })
```

---

## Plugins (1)

**`auth-redirect.client.ts`** — client-only. Перехватывает 401-ответы от `$fetch`:

```ts
export default defineNuxtPlugin(() => {
  $fetch.create({
    onResponseError({ response }) {
      if (response.status === 401) {
        clearUserSession()
        navigateTo('/auth/login')
      }
    }
  })
})
```

Решает проблему "stale session" — при логине в другом браузере текущий клиент автоматически выходит.

---

## Type-safety паттерны

### useFetch с типами

```ts
const { data, refresh, status } = await useFetch<{ data: Trend[] }>(
  '/api/trends',
  { query: computed(() => ({ ...filters.query })) }
)
```

### Pinia с TS

```ts
export const useTrendFiltersStore = defineStore('trendFilters', () => {
  const status = ref<TrendStatus | null>(null)
  const query = computed(() => omitEmpty({ status: status.value }))
  return { status, query, reset() { status.value = null } }
})
```

### Composable + shared type

```ts
import type { Trend } from '~~/shared/types/trend'
export function useTrendDetail(id: MaybeRefOrGetter<number>) {
  return useFetch<{ data: Trend }>(() => `/api/trends/${toValue(id)}`)
}
```

---

## Auto-imports

- **Composables**: `useTrends()` без import
- **Components**: `<TrendCard />` без import
- **Stores**: `useTrendFiltersStore()` без import
- **Vue API**: `ref`, `computed`, `watch`, `onMounted` — без import
- **Nuxt utils**: `$fetch`, `useFetch`, `useRoute`, `useRouter`, `navigateTo`, `definePageMeta` — без import
- **Server utils** (только в `server/`): `prisma`, `getAuthContext`, `requirePermission` — без import (из `server/utils/`)

Shared types из `shared/types/` импортируются явно через `import type`.

---

# 7. REST API

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

## Analytics (6)

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/analytics/dashboard` | Сводка: views, engagement, CTR |
| GET | `/api/analytics/posts` | Таблица постов с метриками |
| GET | `/api/analytics/posts/[uploadId]` | Метрики одной загрузки |
| POST | `/api/analytics/analyze/[uploadId]` | AI-анализ метрик с рекомендациями |
| POST | `/api/analytics/collect` | Принудительный сбор метрик |
| GET | `/api/analytics/accounts-summary` | Per-account Apify-сводка для таба «Аккаунты»: items (последний ok-снимок per account + sparkline + бейдж свежести) + aggregate (Σ followers, средний engagement). Фильтры `appId`, `platform`. Покрывает любой `postingMethod`. Response shape `{data: AccountsSummaryResponse, error: null}` Cloudflare-safe |

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

- `GET /api/indigo/profiles` — список (default: фильтрует `syncStatus='archived'`; явный `?syncStatus=archived` остаётся для admin/audit)
- `POST /api/indigo/profiles` — создать (Indigo X bulk-API: response `data.ids[]`, парсер `parseCreateProfileResponse` пробует 7 candidate paths)
- `GET /api/indigo/profiles/[id]` — деталь
- `PUT /api/indigo/profiles/[id]` — обновить. Buildbody в режиме `partial_update`: выкидывает `parameters.proxy` + `flags.proxy_masking` (Indigo X ругается даже на идентичный re-send). Детектор смены proxy в PUT отдаёт **409** с UX-инструкцией delete+recreate (Indigo Trial не поддерживает proxy mutation на partial_update). `ports_masking` омитится (на /create молча проглатывал без `fingerprint.ports` sub-block, на /partial_update 400 BAD_REQUEST_BODY). Mobile-restriction: `fonts/audio/graphics/graphics_noise/webrtc/screen` masking форсятся в `mask` (на mobile не могут быть `natural`)
- `DELETE /api/indigo/profiles/[id]` — soft-archive (best-effort remote delete + `syncStatus='archived'` + tombstone в `lastSyncError` audit marker)
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

---

# 8. Серверная логика

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

### Indigo (anti-detect)

| Модуль | Назначение |
|--------|-----------|
| `indigo/client.ts` | Клиент к Indigo X HTTP API + local launcher (127.0.0.1:45011): `createProfile`/`partial_update`/`startProfile`/`stopProfile`/`listProfiles`/`probeProfileInfo`/`syncProfileState`/`markPhantomProfile`/`deleteProfile`. `parseCreateProfileResponse` — 7 candidate paths под bulk-style `data.ids[]`. LOCK_PROFILE_ERROR и CORE_DOWNLOADING_STARTED recovery (state=`downloading_core`). Anti-leak guard: `profile.proxyId=null` → 412 ДО hit к Indigo. Stop recovery message-based (already stopped, not running, profile inactive). HTTPS bypass для local launcher через `localLauncherRequest` (node:https напрямую, Bun runtime игнорит ofetch dispatcher) |
| `indigo/build-create-body.ts` | Билдер payload для create / partial_update. Принимает `mode: 'create' \| 'partial_update'`. На `partial_update` выкидывает `parameters.proxy` + `flags.proxy_masking` (Indigo X 'can't update proxy'), всегда омитит `ports_masking` (на /create silent, на /partial_update 400 BAD_REQUEST_BODY). Platform-aware buildFlags: на mobile `fonts/audio/graphics/graphics_noise/webrtc/screen` принудительно `mask`, на desktop разрешён `natural`. Динамический маппинг flags под отправляемые fingerprint sub-blocks. `parameters.proxy` + `flags.proxy_masking='custom'` обязательны (раньше был silent IP-leak — top-level proxy без custom-flag) |
| `indigo/types.ts` | Типы payload Indigo X, IndigoSyncResult (с `skipped` counter), IndigoStartProfileResponse (`state` + `code` для LOCK / CORE recovery) |
| `indigo/sync.ts` | Sync local БД ↔ Indigo workspace. `resolveLocalProxyId` ищет local Proxy по host+port — на create устанавливает `proxyId`, на update backfill только если `proxyId=null` (не перетираем явный выбор оператора). Skipped counter отдельно от errors (dup-check). Skip импорт `__phantom_*` (cleanup-renamed). Защита от воскрешения archived через dup-check |

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

---

# 9. База данных

**Postgres + Prisma 7** (через `@prisma/adapter-pg`).
**75+ моделей**, **40+ enum'ов**, **89 миграций** на 2026-05-21.

Полная схема — `prisma/schema.prisma` (источник истины). Этот файл — высокоуровневая навигация.

---

## Доменные области

### 1. RBAC и аутентификация

| Модель | Назначение |
|--------|-----------|
| `ZavodUser` | Локальная копия пользователя из MarketingCamp. 8 RBAC-флагов + `rolePreset` enum + `roleName/rolePresetName` (для UI badge) + `moduleAccess: String[]` + `externalId` (FK к MC) + `isActive` (локальная блокировка) |
| `UserAppAssignment` | Гранулярная модель доступа: `accessLevel` (none/read_only/full), `accounts` (all\|CSV ID), `geos` (all\|CSV), `permissions` (read\|read+write\|...) |

### 2. Apps и приложения

| Модель | Назначение |
|--------|-----------|
| `App` | Приложение (продукт): Telegram-проект, мобильное приложение и т.д. Содержит slug, name, описание, иконку |
| `AppReferenceImage` | Справочные изображения приложения (для AI-промтов) |
| `AppEnrichmentLog` | Лог AI-обогащения метаданных App |

### 3. Тренды

| Модель | Назначение |
|--------|-----------|
| `Trend` | Тренд из соцсети: URL, миниатюра, метрики (views, likes), платформа, статус, AI-анализ |
| `TrendInsight` | AI-инсайт по тренду |
| `CreativeBrief` | Творческий бриф (предмет, целевая аудитория, тон, рекомендации) |
| `TrendwatcherProfile` | Конфиг парсинга Apify: actor, input params, расписание, валидация |
| `TrendwatcherRun` | Запуск парсинга: статус, метрики (foundCount, importedCount, analyzedCount, skipCount, errorCount), длительность |
| `TrendwatcherRunLog` | Логи запуска |

### 4. Идеи и сценарии

| Модель | Назначение |
|--------|-----------|
| `Idea` | Идея: title, description, source (chat/pipeline/manual), externalId (для MC sync), syncStatus, remoteSnapshot |
| `IdeaAnalysis` | AI-анализ идеи |
| `IdeaOperatorAction` | Лог действий оператора (approve/reject/edit) |
| `Scenario` | Сценарий: title, briefId, status, parentTrendId |
| `ScenarioVariant` | Вариант сценария: hook, body, CTA, visualStyle, status, qualityScore + qualityScoreDetails (от AI-критика) |
| `ScenarioBlockRevision` | История изменений блоков (hook/body/CTA) |
| `VisualStyleRevision` | История изменений визуального стиля |
| `ScenarioReviewAction` | Лог ревью: accept/reject/rework + комментарий |
| `ScenarioGenerationProfile` | Шаблон генерации сценариев (для App) |
| `CriticReview` | AI-критика вариантов (6 dimensions: hook strength, narrative coherence, visual appeal, CTA clarity, audience fit, originality). Unique-индекс по `(scenarioId, iteration)` |
| `ScenarioFeedback` | Обратная связь продюсера |

### 5. Видео-продакшн

| Модель | Назначение |
|--------|-----------|
| `Video` | Финальное видео: filePath, storageKey (GCS), duration, format, status, scenarioId, driveFileId, driveCredentialId, voiceoverEnabled, music settings, subtitle preset, clipDuration, imageCount, lipSync |
| `VideoAsset` | Ассеты видео: clip, image, music, voiceover (содержит prompt, model, cost) |
| `VideoGenerationStep` | Per-step tracking: stepType (prompt/image/clip/voiceover/music/assembly), status, started/completed, error info, output |
| `VideoFrame` | Покадровый анализ (для marketing-grade analysis): timestamp, AI-description, ключевые элементы |
| `VideoUniqueVariant` | Уникализированные копии для разных платформ (paramsHash, ffmpeg-инструкции, output storageKey) |
| `Caption` | Per-platform метаданные публикации: title, description, hashtags, status (draft/approved), platformLimits valid |

### 6. Социальные аккаунты и публикация

| Модель | Назначение |
|--------|-----------|
| `SocialAccount` | Аккаунт в соцсети: appId, platform, displayName, platformHandle (`@username`), credentials (зашифрованы), warmupStatus, postingMethod (`api` / `browser_automation`), proxyId, indigoProfileId, styleProfileId |
| `AccountGroup` | Группа аккаунтов (для bulk-операций) |
| `AccountStyleProfile` | Визуальный стиль (цвета, фильтры, эстетика) — для AI-генерации |
| `AccountStyleRevision` | История изменений стиля |
| `AccountMetricsSnapshot` | Снимок метрик аккаунта: followers, posts, engagement_rate, последние посты (idempotent 24h) |
| `Upload` | Публикация: videoId, accountId, platform, status, mediaUrl, externalPostId, scheduledAt |
| `SocialUploadAttempt` | Попытка публикации (для retry tracking) |
| `PostMetrics` | Метрики поста (views, likes, comments, shares, CTR) |
| `PostingJob` | Очередь автоматического постинга через browser_automation: accountId, videoId, captionId, status FSM, retry count, logs, screenshot |

### 7. Indigo (anti-detect браузеры)

| Модель | Назначение |
|--------|-----------|
| `IndigoProfile` | Профиль браузера: indigoProfileId (внешний), fingerprint config, cookies snapshot, sessionState, syncStatus |
| `IndigoProfileAccount` | Привязка профиля к аккаунту (M:N с primary флагом) |

### 8. Прокси

| Модель | Назначение |
|--------|-----------|
| `Proxy` | Прокси: host/port/username/password (зашифрованы), type (http/https/socks5), status, country, isResidential |
| `ProxyHealthCheck` | История проверок: latency_ms, success, error_code, IP geo |

### 9. Warmup (разогрев аккаунтов)

| Модель | Назначение |
|--------|-----------|
| `WarmupKeywordPool` | Пул ключевых слов: name, keywords[], category (general_en/ru, tech_en, lifestyle_en и т.д.) |
| `WarmupSession` | Сеанс разогрева: accountId, scheduledAt, status, plannedActions[], actualActions[] |

### 10. Конвейер (Pipeline)

| Модель | Назначение |
|--------|-----------|
| `Pipeline` | Конвейер: name, description, icon, color, markdownDescription, graphData (JSON), webhookToken, webhookSecret, schedule, sharedWith[], lastEditedAt |
| `PipelineVersion` | Версия конвейера (для rollback) |
| `PipelineSchedule` | Cron-расписание |
| `PipelineTag` | Тег (M:N с Pipeline) |
| `PipelineCredential` | Шифрованные креды для нод (Google Drive SA, HTTP API keys, OAuth) |
| `WorkflowRun` | Запуск pipeline'а: status, startedAt, completedAt, error info, statistics |
| `WorkflowStep` | Выполнение узла: nodeCanvasId, status, startedAt, completedAt, input, output, errorInfo |
| `WebhookLog` | Лог входящих webhook'ов: sourceIp, userAgent, payload, statusCode |

### 11. Аналитика

| Модель | Назначение |
|--------|-----------|
| `AnalyticsEvent` | Событие аналитики (опционально) |

### 12. Google Drive

| Модель | Назначение |
|--------|-----------|
| `DriveFile` | Файл из Drive: googleFileId, mimeType, name, status (detected/downloaded/imported/failed), localPath, importedVideoId, credentialId |

### 13. Telegram

| Модель | Назначение |
|--------|-----------|
| `TelegramChat` | Чат-получатель: chatId, name, routingTags[], isActive |
| `TelegramMessageTemplate` | Шаблон сообщения: name, body (с переменными `{{...}}`), platform, lang |
| `TelegramDelivery` | Лог доставок: chatId, templateId, status, response, errorMsg |
| `TelegramCommand` | Реакция на команду |
| `TelegramCommandAudit` | Аудит выполнения команд |
| `TelegramApiKey` | API-ключ бота (с rotation) |

### 14. Логирование и аудит

| Модель | Назначение |
|--------|-----------|
| `AgentLog` | Лог AI-агентов (entityType, entityId, level, message, payload) |
| `AiAuditLog` | Все AI-предложения: action, nodeType, model, prompt, suggestions, blockedFields, rejectedFields, appliedFields, status, costUsd |
| `SecretAccessLog` | Append-only: каждая расшифровка с reason |
| `WebhookLog` | Уже описан выше |

### 15. Прочее

| Модель | Назначение |
|--------|-----------|
| `ProductionCycle` | Цикл генерации контента: appId, groupId, status, startedById, статистика (trendsFound/scenariosGen/videosGen/uploadsCount) |
| `FavoritePrompt` | Лучшие промты с AI pattern-анализом (Kling pattern) |
| `ServiceBalanceEntry` | Ручные остатки: fal.ai, anthropic, indigo, nodemaven, mubert |
| `TaxonomyItem` | Словарь терминов: strategy, hook_style, prompt_pattern, pipeline_category, kling_pattern |
| `Reference` | Справочный образец (URL, расшифровка, анализ) |
| `ReferenceBreakdown` | Детальный анализ референса |

---

## Главные enum'ы

| Enum | Значения |
|------|----------|
| `RolePreset` | admin, producer, operator, analyst, observer |
| `Platform` | tiktok, youtube, instagram, telegram |
| `TrendStatus` | new, processing, ready, published, rejected |
| `AnalysisStatus` | pending, in_progress, completed, failed |
| `ScenarioStatus` | generating, ready, selected, rejected |
| `VariantStatus` | draft, ready |
| `VideoStatus` | pending, generating, completed, failed, timeout |
| `VideoStepStatus` | pending, in_progress, completed, partial, failed, no_data, timeout |
| `UploadStatus` | pending, scheduled, posting, published, failed |
| `PostingJobStatus` | pending, queued, posting, done, failed, cancelled |
| `PostingMethod` | api, browser_automation |
| `IndigoSessionState` | not_started, running, stopped, error |
| `IndigoSyncStatus` | synced, drift, archived, missing |
| `ProxyType` | http, https, socks5 |
| `ProxyStatus` | active, banned, slow, unknown |
| `WorkflowRunStatus` | pending, running, completed, failed, cancelled, no_data |
| `WorkflowStepStatus` | pending, running, completed, partial, failed, no_data |
| `CycleStatus` | pending, running, completed, failed, stopped |
| `WarmupStatus` | new, planned, in_progress, completed, paused |
| `IdeaStatus` | new, approved, rejected, synced |
| `IdeaSource` | chat, pipeline, manual |
| `IdeaSyncStatus` | local_only, synced, conflict |
| `IdeaSyncDirection` | from_mc, to_mc, both |
| `TaxonomyType` | strategy, hook_style, prompt_pattern, pipeline_category, kling_pattern |

---

## Связи (упрощённая ER-карта)

```
ZavodUser ─┬─ UserAppAssignment ─→ App
           ├─ ProductionCycle (startedBy)
           ├─ Pipeline (owner + sharedWith)
           ├─ FavoritePrompt
           ├─ AiAuditLog
           ├─ SecretAccessLog
           └─ DriveFile

App ─┬─ Trend ─┬─ TrendInsight
     │        ├─ CreativeBrief
     │        └─ Scenario ─┬─ ScenarioVariant ─┬─ ScenarioBlockRevision
     │                     │                   ├─ VisualStyleRevision
     │                     │                   └─ Video ─┬─ VideoAsset
     │                     │                             ├─ VideoGenerationStep
     │                     │                             ├─ VideoFrame
     │                     │                             ├─ VideoUniqueVariant
     │                     │                             ├─ Caption (per-platform)
     │                     │                             └─ Upload ─→ PostMetrics
     │                     ├─ CriticReview
     │                     ├─ ScenarioReviewAction
     │                     └─ ScenarioFeedback
     ├─ SocialAccount ─┬─ AccountGroup
     │                 ├─ AccountStyleProfile
     │                 ├─ AccountMetricsSnapshot
     │                 ├─ WarmupSession ─→ WarmupKeywordPool
     │                 ├─ PostingJob
     │                 ├─ IndigoProfileAccount ─→ IndigoProfile ─→ Proxy
     │                 └─ Proxy
     ├─ Idea ─┬─ IdeaAnalysis
     │       └─ IdeaOperatorAction
     ├─ TrendwatcherProfile ─→ TrendwatcherRun ─→ TrendwatcherRunLog
     └─ AppReferenceImage

Pipeline ─┬─ PipelineVersion
          ├─ PipelineSchedule
          ├─ PipelineTag (M:N)
          ├─ PipelineCredential ─→ DriveFile
          ├─ WebhookLog
          └─ WorkflowRun ─→ WorkflowStep
              ↳ создаёт: Scenario, Trend, Video, Upload, Idea, PostingJob

ProductionCycle ─→ AgentLog

Proxy ─→ ProxyHealthCheck

IndigoProfile ─→ IndigoProfileAccount (M:N с SocialAccount)

DriveFile ─→ Video (importedVideoId)

TelegramChat ─┬─ TelegramDelivery ─→ TelegramMessageTemplate
              └─ TelegramCommandAudit

ServiceBalanceEntry (standalone)
TaxonomyItem (standalone)
Reference ─→ ReferenceBreakdown
```

---

## Шифрование БД

**Алгоритм:** AES-256-GCM
**Файл:** `server/utils/crypto.ts`

**Функции:**
- `encrypt(text)` / `decrypt(cipher)` — низкоуровневые
- `encryptSecret(plain)` / `decryptSecret({ ... })` — с audit-log

**Формат:** `iv:authTag:ciphertext` (hex), IV=16 байт, tag=16 байт, key=32 байта (`ENCRYPTION_KEY`=64 hex)

**Зашифрованные поля:**
- `SocialAccount`: `accessToken`, `refreshToken`, `loginPassword`, `recoveryEmail`, `recoveryPhone`, `twoFASecret`
- `Proxy`: `host`, `username`, `password`
- `IndigoProfile`: `cookiesSnapshot`
- `PipelineCredential`: `encryptedData`
- Некоторые поля `DriveFile`

**Аудит:** Все расшифровки → `SecretAccessLog` (userId, entityType, entityId, action, clientIp, userAgent, reason).

---

## Миграции (89 на 2026-05-21)

Ключевые вехи в хронологии:

| Дата | Миграция | Содержимое |
|------|----------|-----------|
| 2026-03-31 | init_schema | Базовые: App, Trend, Scenario, TrendInsight, Video, VideoAsset, Upload, SocialAccount |
| 2026-03-31 | add_zavod_user, add_admin_models, add_telegram_chat, add_ideas | RBAC, admin, Telegram, Ideas |
| 2026-04-01 | add_pipeline, add_trendwatcher_profile, add_pipeline_schedule, add_webhook_token | Pipeline и Trendwatcher |
| 2026-04-06 | add_scenario_variants_and_review, ideas_module_v2 | Variants и MC-sync для Ideas |
| 2026-04-09 | pipeline_production_grade, add_pipeline_credentials, pipeline_hardening_webhook_secret | Pipeline hardening |
| 2026-04-10 | ai_audit_log, add_pipeline_context_to_ai_audit | AI audit-trail |
| 2026-04-15 | story_driven_scenario_pipeline, add_voiceover_runtime | Story-планирование + voiceover |
| 2026-04-16 | add_account_style_profile, add_idea_marketingcamp_sync | Account style, Idea sync |
| 2026-04-17 | add_video_subtitle_preset, add_pipeline_subtitle_style | Субтитры пресеты |
| 2026-04-23 | add_favorite_prompts, add_pipeline_run_tracking | FavoritePrompt + run tracking |
| 2026-04-25 | accounts_pipeline_integration, add_video_lip_sync | Lip-sync |
| 2026-04-29 | social_automation_foundation, add_proxy_protocol | Social automation v1 |
| 2026-04-30 | indigo_profile, posting_jobs | Indigo browser + PostingJob FSM |
| 2026-05-04 | warmup_models, add_video_unique_variants | Warmup planner, уникализация |
| 2026-05-06 | scenario_quality_critic, caption_generator, google_drive_integration | Critic + Caption + GDrive |
| 2026-05-07 | video_analysis_modernization | Video Analyzer Stage 2 |
| 2026-05-08 | extend_user_app_access_and_role_metadata, video_drive_upload_fields | RBAC v2 + Drive upload |
| 2026-05-13 | storage_gcs_migration | Storage на GCS |
| 2026-05-14 | balance_tracking | ServiceBalanceEntry |
| 2026-05-19 | add_indigo_profile_account | M:N Indigo↔Account |
| 2026-05-21 | account_manual_creation, add_social_posting_method, account_metrics_snapshot | Manual creation + posting method + Apify metrics |
| 2026-05-22 | add_login_check_and_posting_diagnostics | Login check diagnostics |

---

## Seed-скрипты

| Скрипт | Что делает |
|--------|-----------|
| `seed-warmup-keywords.ts` | Глобальные WarmupKeywordPool (general_en/ru, tech_en, lifestyle_en, fitness_en, education_en, music_en). Idempotent |
| `seed-caption-audit.ts` | Сид для visual audit Caption Generator. TRUNCATE + создание test-данных (ZavodUser, App, Trend, Scenario, 3 Caption, Pipeline) |
| `seed-drive-pipeline-template.ts` | Draft Pipeline `Drive Scanner → Video Analyzer → Caption Generator → Upload`. Additive (без truncate). Требует `userId` |
| `seed-drive-audit.ts` | Сид для visual audit Drive Auto-Caption. Создаёт ZavodUser, App, Trend, System-Scenario, PipelineCredential (mock SA с RSA), 3 DriveFile, Pipeline. TRUNCATE |
| `seed-admin-logs-demo.ts` | Demo-данные для /admin/logs visual testing. Создаёт записи в 8 log-таблиц. Additive. Проверяет test-БД |

**Запуск:** `bun run scripts/seed-warmup-keywords.ts` и аналогично.

---

## Известные особенности

1. **`prisma db push` ЗАПРЕЩЁН** (см. CLAUDE.md) — удаляет данные. Только `prisma migrate dev` / `prisma migrate deploy`.
2. **Generated client:** в репо коммитится `app/generated/prisma/` (типы) — для type-safety без runtime-импорта.
3. **BigInt counters:** YouTube/TikTok views достигают 10⁹+, используется BigInt. `bigint-serializer.ts` патчит `JSON.stringify`.
4. **GIN-индексы:** на `FavoritePrompt.tags`, `TaxonomyItem.tags` (для поиска по элементу массива).
5. **Composite unique:** `CriticReview(scenarioId, iteration)`, `TaxonomyItem(type, slug)`, `IndigoProfileAccount(indigoProfileId, socialAccountId)`.

---

# 10. Темы и стили

## Источник истины

**Единственный файл стилей:** `app/assets/css/main.css`

Конфигурация Tailwind v4 + DaisyUI 5 — целиком в CSS, без `tailwind.config.js` (Tailwind v4 не использует JS-конфиг).

```css
@import "tailwindcss";
@plugin "daisyui" {
  themes: bumblebee --default, coffee --prefersdark, halloween, luxury, caramellatte;
}
```

---

## Доступные темы (7)

| Тема | Тип | Источник | Показывается в UI |
|------|-----|---------|-------------------|
| `bumblebee` | light | DaisyUI встроенная (default) | ✅ |
| `coffee` | dark | DaisyUI встроенная (prefersdark) | ✅ |
| `luxury` | dark | DaisyUI встроенная | ✅ |
| `nightfly` | dark (custom) | Custom alias на основе halloween | ✅ |
| `caramelwork` | light (custom) | Custom alias на основе caramellatte | ✅ |
| `halloween` | dark | DaisyUI встроенная | ❌ (база для nightfly) |
| `caramellatte` | light | DaisyUI встроенная | ❌ (база для caramelwork) |

> **Из user memory:** Halloween и Caramellatte не показывать в UI — они служат базой для кастомных тем nightfly/caramelwork.

---

## Активные темы — детально

### bumblebee (light, default)
- Палитра: жёлтый primary, чёрный neutral
- Используется как fallback и preference

### coffee (dark, prefersdark)
- Палитра: тёплая коричневая
- Срабатывает при `prefers-color-scheme: dark`

### luxury (dark)
- Палитра: фиолетовая/золотая

### nightfly (custom, dark)
Кастомная тёмная тема с OKLCH-цветами:

```css
[data-theme="nightfly"] {
  color-scheme: dark;
  --color-base-100: oklch(21% 0.006 56.043);     /* тёмный с тёплым оттенком */
  --color-base-200: oklch(14% 0.004 49.25);
  --color-base-300: oklch(0% 0 0);
  --color-base-content: oklch(84.955% 0 0);

  --color-primary: oklch(77.48% 0.204 60.62);    /* жёлто-оранжевый */
  --color-primary-content: oklch(19.693% 0.004 196.779);

  --color-secondary: oklch(45.98% 0.248 305.03); /* фиолетовый */
  --color-accent: oklch(64.8% 0.223 136.073);    /* жёлто-зелёный */
  --color-neutral: oklch(24.371% 0.046 65.681);

  --color-info: oklch(54.615% 0.215 262.88);     /* синий */
  --color-success: oklch(62.705% 0.169 149.213); /* зелёный */
  --color-warning: oklch(66.584% 0.157 58.318);  /* оранжевый */
  --color-error: oklch(65.72% 0.199 27.33);      /* красный */

  --radius-selector: 1rem;
  --radius-field: 0.5rem;
  --radius-box: 1rem;
  --border: 1px;
  --depth: 1;
  --noise: 0;
}
```

### caramelwork (custom, light)
Светлая тема с кремовым background и тёплыми коричнево-оранжевыми акцентами:

```css
[data-theme="caramelwork"] {
  color-scheme: light;
  --color-base-100: oklch(98% 0.016 73.684);   /* кремовый */
  --color-base-200: oklch(95% 0.038 75.164);
  --color-base-300: oklch(90% 0.076 70.697);

  --color-primary: oklch(0% 0 0);              /* чёрный */
  --color-secondary: oklch(22.45% 0.075 37.85); /* тёмный коричневый */
  --color-accent: oklch(46.44% 0.111 37.85);    /* оранжево-коричневый */

  --color-info: oklch(42% 0.199 265.638);
  --color-success: oklch(43% 0.095 166.913);
  --color-warning: oklch(82% 0.189 84.429);
  --color-error: oklch(70% 0.191 22.216);

  --radius-selector: 2rem;     /* более скруглённый */
  --radius-field: 0.5rem;
  --radius-box: 1rem;
  --border: 2px;               /* толще бордер */
  --depth: 1;
  --noise: 1;                  /* шум для аутентичной текстуры */
}
```

---

## CSS-переменные в темах

Каждая тема устанавливает набор переменных DaisyUI 5:

### Цвета
- `--color-base-100/200/300` — три уровня фона
- `--color-base-content` — основной текст
- `--color-primary` + `--color-primary-content`
- `--color-secondary` + `--color-secondary-content`
- `--color-accent` + `--color-accent-content`
- `--color-neutral` + `--color-neutral-content`
- `--color-info` + `--color-info-content`
- `--color-success` + `--color-success-content`
- `--color-warning` + `--color-warning-content`
- `--color-error` + `--color-error-content`

### Геометрия
- `--radius-selector` — radius для checkbox/radio
- `--radius-field` — для input/select
- `--radius-box` — для card/modal
- `--size-selector` — размер checkbox
- `--size-field` — размер input
- `--border` — толщина бордера

### Эффекты
- `--depth` — глубина (тени)
- `--noise` — текстура шума

---

## @source inline — принудительная генерация utilities

Tailwind v4 удаляет неиспользованные классы из output. Для семантических классов DaisyUI это проблема — `bg-primary/20` может не оказаться в финальном CSS если не упомянут в коде явно.

Решение — `@source inline(...)`:

```css
@source inline("bg-primary bg-secondary bg-accent bg-neutral
                bg-info bg-success bg-warning bg-error
                bg-base-300
                bg-primary/5 bg-secondary/5 bg-accent/5
                bg-info/5 bg-success/5 bg-warning/5 bg-error/5
                bg-primary/20 bg-secondary/20 bg-accent/20
                bg-info/20 bg-success/20 bg-warning/20 bg-error/20
                text-primary text-secondary text-accent text-neutral
                text-info text-success text-warning text-error
                text-primary-content text-secondary-content text-accent-content
                text-neutral-content text-info-content text-success-content
                text-warning-content text-error-content
                border-primary/30 border-secondary/30 border-accent/30
                border-info/30 border-info/40 border-success/30
                border-warning/30 border-error/30");
```

Это гарантирует, что классы доступны во всех 5 темах и динамическом коде (если генерируется по условию).

---

## Переключение тем

### В UI

На `/settings` есть селектор темы. Сохраняется в cookie через `@nuxtjs/color-mode`:

```ts
const colorMode = useColorMode()
colorMode.preference = 'nightfly'
```

### Программно

В шаблоне переключение через `data-theme`:

```html
<html data-theme="nightfly">
```

`@nuxtjs/color-mode` автоматически устанавливает атрибут.

### Конфигурация (`nuxt.config.ts`)

```ts
colorMode: {
  preference: 'bumblebee',         // дефолт
  fallback: 'bumblebee',
  dataValue: 'theme',              // <html data-theme="...">
  classSuffix: '',                 // не добавлять суффикс
  storageKey: 'nuxt-color-mode',
  storage: 'cookie'                // persistent через cookies
}
```

---

## Правила использования цветов

### ✅ Хорошо — семантические классы

```html
<div class="bg-base-100 text-base-content">
  <button class="btn btn-primary">Сохранить</button>
  <span class="badge badge-info">Новый</span>
  <div class="alert alert-warning">Внимание</div>
</div>
```

### ❌ Плохо — хардкод цветов

```html
<!-- Не адаптируется к темам -->
<div class="bg-white text-gray-900">
  <button class="bg-blue-500 text-white">Сохранить</button>
  <span class="bg-blue-100 text-blue-800">Новый</span>
</div>
```

### Когда допустим хардкод

Только для декоративных элементов, не связанных с темой (например, фиксированный градиент в баннере, brand colors на лендинге).

### Контраст

Всегда сочетать `*-content` цвет на соответствующем фоне:

```html
<div class="bg-primary text-primary-content">...</div>
<div class="bg-secondary text-secondary-content">...</div>
```

---

## Стилист-агент

Узкоспециализированный агент `stylist` (`.claude/agents/stylist.md`) автоматически проверяет компоненты на:

- Хардкод цветов (`bg-amber-500`, `text-blue-600` где должна быть тема)
- Несоответствие `*-content` цвета
- Использование `bg-white` / `border-gray-200` (надо `bg-base-100` / `border-base-300`)
- Совместимость с каждой темой по отдельности

Стилист правит только классы — не трогает логику и структуру компонента.

Подробнее — в [11-agents.md](11-agents.md#stylist).

---

## Visual Audit для тем

Скилл `visual-audit` (`.claude/skills/visual-audit/SKILL.md`) делает скриншоты страниц на 4 viewport'ах через Playwright MCP. Для тем — отдельный аудит требует прогона `data-theme` через `browser_evaluate`.

Подробнее — в [12-skills.md](12-skills.md#visual-audit) и [13-mcp-playwright.md](13-mcp-playwright.md).

---

## Иконки

Через `@nuxt/icon` + `@iconify-json/mingcute`:

```html
<Icon name="mingcute:add-line" />
<Icon name="mingcute:delete-2-line" class="size-5 text-error" />
```

SVG-режим (не webfont) — каждая иконка рендерится как inline SVG, наследует текущий `currentColor`. Совместимо со всеми темами автоматически.

---

## Анимации

### auto-animate (списки)

```html
<ul v-auto-animate>
  <li v-for="item in items" :key="item.id">{{ item.name }}</li>
</ul>
```

### VueUse Motion (переходы)

```html
<div
  v-motion
  :initial="{ opacity: 0, y: 20 }"
  :enter="{ opacity: 1, y: 0, transition: { duration: 300 } }"
>
  Контент
</div>
```

### CSS transitions (DaisyUI)

`btn`, `card`, `modal`, `drawer` — встроенные transitions в DaisyUI, работают со всеми темами.

---

## Известные особенности тем

1. **OKLCH-цвета** в custom-темах — современный colorspace с лучшим восприятием контраста.
2. **`color-scheme: dark/light`** — браузер сам подкрашивает scrollbars, native input controls.
3. **`--noise: 1`** в caramelwork — добавляет визуальный шум (subtle texture).
4. **`--depth: 1`** — DaisyUI применяет дополнительные тени, делая UI более "depth-y".
5. При создании custom-темы — обязательно проверить все 4 viewport через `visual-audit` (overflow, контраст, mobile tap targets).

---

# 11. Агенты Claude

Команда из **7 агентов** в `.claude/agents/`. Каждый — специализированный subagent с:
- собственным набором инструментов (read/write/edit/bash)
- персональным контекстом (`memory: project`)
- ролью в pipeline разработки

Все агенты говорят и пишут на русском (правило CLAUDE.md).

---

## Цепочка разработки

```
Пользователь
   ↓
Архитектор ──→ (опц.) Исследователь
   ↓
Исполнитель ←──→ Критик (брак/одобрение)
   ↓
Стилист (проверка тем)
   ↓
Критик (финальная проверка)
   ↓
Тестировщик ──→ ГОТОВО К КОММИТУ (но не коммитит сам!)
   ↓
Пользователь даёт голосовую команду коммита
   ↓
Анализатор (мета-анализ цикла, документация ошибок)
```

---

## architect — Архитектор

**Файл:** `.claude/agents/architect.md`
**Модель:** opus
**Инструменты:** Read, Glob, Grep, Write, Edit, context7 MCP
**Effort:** high, **maxTurns:** 80

### Что делает
Главный планировщик. Перед началом любой крупной задачи:
1. Читает `docs/SPEC.md`, правила стека `.claude/skills/web-dev/SKILL.md`
2. Просматривает текущую структуру проекта
3. Читает историю от тестировщика `.claude/agent-memory/tester/MEMORY.md`
4. Читает ошибки от анализатора `.claude/agent-memory/analyzer/ERRORS.md`
5. Через MCP context7 проверяет актуальность подходов
6. Формирует структурированный план для исполнителя

### Структура плана
```
## План: [Название задачи]

### Контекст
[Что делаем, зачем, какой модуль из SPEC.md]

### Вопросы для исследования (для researcher)
1. ...

### Архитектура
#### Frontend
- Страницы, компоненты, composables, stores
#### Backend (Nitro)
- API endpoints, middleware, Prisma модели, валидация
#### Взаимодействие
- Как frontend вызывает backend, кэширование

### Задачи для исполнителя
1. [ ] [Чёткое описание с зависимостями]

### Риски и решения
- Потенциальная проблема → Решение
```

### Учитывает
- **Безопасность:** auth на каждом endpoint, валидация на границах, CORS, rate-limiting
- **No-Code UX:** интуитивный интерфейс для маркетолога
- **Стек:** DaisyUI > самописное, Tailwind 4, Prisma 7 на сервере
- **Темы:** все компоненты работают со всеми 5 темами

### Не делает
Не пишет код (только Prisma-схемы и структурные файлы). Не выполняет задачи — только планирует.

---

## implementer — Исполнитель

**Файл:** `.claude/agents/implementer.md`
**Модель:** opus
**Инструменты:** Read, Write, Edit, Bash, Glob, Grep, context7 MCP, nuxt-ui MCP
**Skills:** web-dev, daisyUI
**Effort:** high, **maxTurns:** 120

### Что делает
Сеньор фулл-стек разработчик. Превращает планы архитектора в работающий код. **Реализует и frontend, и backend.**

### Стек (обязательный)
- Vue 3 + `<script setup lang="ts">` + Composition API
- Nuxt 4: file-based routing, auto-imports, `useFetch`/`useAsyncData`
- Pinia для глобального стейта (`stores/`)
- Tailwind CSS 4 (только утилиты)
- DaisyUI 5 (ВСЕГДА проверяет наличие компонента через скилл `daisyUI` и MCP)
- @nuxt/icon (mingcute set)
- @nuxtjs/color-mode (учитывает темы)
- Nitro Server для API
- Prisma 7 для БД (только на сервере)
- nuxt-auth-utils для авторизации

### Запрещено
- Options API, mixins, filters
- Самописные UI при наличии аналога в DaisyUI
- Inline-стили, `<style scoped>` для того, что решается Tailwind
- Прямые SQL (только Prisma)
- Хардкод цветов (только семантика DaisyUI)
- Установка новых deps без явного запроса пользователя
- Практики Nuxt 3 без проверки совместимости с Nuxt 4

### Цикл работы
1. Получает план от архитектора
2. Реализует frontend + backend
3. Если критик забраковал — исправляет по указаниям
4. Передаёт результат стилисту → критику → тестировщику

---

## critic — Критик

**Файл:** `.claude/agents/critic.md`
**Модель:** sonnet
**Инструменты:** Read, Glob, Grep, context7 MCP, nuxt-ui MCP, Write, Edit
**Effort:** high

### Что делает
**Последний рубеж качества** перед тем, как решение попадёт в реализацию или код — на тестирование.

### Принципы
**Критикуешь? Предлагай.** Каждое замечание содержит:
1. Что не так (файл, строка)
2. Почему (правило / ТЗ / документация)
3. Как исправить (конкретное решение)

### Что проверяет

**Соответствие стеку (КРИТИЧНО):**
- Vue 3 Composition + `<script setup>` (Options API = БРАК)
- Tailwind CSS 4 only (custom CSS, `<style scoped>` = БРАК)
- DaisyUI 5 (самописный dropdown/modal при наличии аналога = БРАК)
- Pinia (локальный `ref` где нужен глобальный = БРАК)
- Prisma 7 на сервере (прямые SQL или Prisma на клиенте = БРАК)
- nuxt-auth-utils (самописная авторизация = БРАК)
- `@nuxtjs/color-mode` (хардкод цветов без тем = БРАК)

**Соответствие ТЗ:**
- Фича соответствует `docs/SPEC.md`
- Не пропущены обязательные поля и режимы
- No-Code опыт сохранён

**Качество:**
- Голые поля без валидации = БРАК
- Отсутствие error handling на API = БРАК
- Отсутствие loading/error состояний в UI = БРАК
- Хардкод значений = БРАК
- XSS/SQL/незащищённые endpoints = КРИТИЧЕСКИЙ БРАК

**UX/UI:**
- Компонент не работает с темами = БРАК
- Отсутствие responsive = БРАК
- Отсутствие feedback (toast, loader, empty state) = БРАК

### Не делает
Read-only. Не редактирует код — только выносит вердикт.

---

## tester — Тестировщик

**Файл:** `.claude/agents/tester.md`
**Модель:** sonnet
**Инструменты:** Read, Write, Edit, Bash, Glob, Grep
**Effort:** high, **maxTurns:** 60

### Что делает
**Финальный агент** в цепочке. Проверяет, тестирует, документирует.

### Процесс

1. **Сборка:** `bun run build` + `npx nuxi typecheck`
2. **Проверка файлов:** соответствие плану архитектора, нет console.log/TODO, импорты корректны
3. **Проверка API:** endpoints существуют, валидация, auth, формат ответов
4. **Формирование фидбека:** критичные проблемы (блокируют коммит) + некритичные

### Цикл исправлений
- Отправляет фидбек исполнителю
- Исполнитель исправляет
- Повторная проверка только проблемных мест
- Если ОК → **рапорт "ГОТОВО К КОММИТУ" БЕЗ коммита**

### Критически важно
**НИКОГДА не коммитит самостоятельно.** Ни через скилл `commit`, ни через `git commit`, ни через `git add`. Коммит — голосовая команда пользователя.

### Ведение истории
После коммита обновляет `.claude/agent-memory/tester/MEMORY.md`:
```markdown
## [Дата] — [Краткое описание]
### Реализовано
### Проблемы и исправления
### Текущее состояние
### Известные проблемы
```

---

## researcher — Исследователь

**Файл:** `.claude/agents/researcher.md`
**Модель:** sonnet
**Инструменты:** Read, Glob, Grep, WebSearch, WebFetch, context7 MCP
**Effort:** high

### Что делает
Поиск лучших практик, анализ аналогов, изучение технологий, генерация идей.

### Когда вызывается
- Нужно сравнить варианты решения
- Найти аналоги (продукты с похожей функциональностью)
- Изучить документацию библиотеки через context7
- Брейншторм перед проектированием

### Формат результата
- **Контекст задачи** — что исследовалось, зачем
- **Найденные решения/аналоги** — с ссылками
- **Анализ** — плюсы, минусы, подводные камни
- **Рекомендация** — что подходит для нашего стека и почему
- **Идеи** — дополнительные предложения

### Правила
- Только совместимые со стеком решения (никаких React/Angular)
- Приоритет — простые проверенные решения
- При исследовании API/библиотек — проверка через context7
- Структурированно, без воды

---

## stylist — Стилист

**Файл:** `.claude/agents/stylist.md`
**Модель:** sonnet
**Инструменты:** Read, Glob, Grep, Edit
**Effort:** high

### Что делает
Узкоспециализированный агент. **Единственная задача** — обеспечить корректное отображение во всех 5 темах проекта.

### Источник истины
`app/assets/css/main.css` — здесь определены темы и CSS-переменные.

### Что проверяет

**Хардкод цветов:**
```html
<!-- ПЛОХО -->
<div class="bg-amber-500 text-white">

<!-- ХОРОШО -->
<div class="bg-primary text-primary-content">
```

**Семантические классы:**
- `bg-base-100` (не `bg-white`)
- `text-base-content/70` (не `text-gray-600`)
- `border-base-300` (не `border-gray-200`)
- `btn btn-primary` (не хардкод btn-стилей)
- `badge badge-info` (не `bg-blue-100`)
- `alert alert-warning` (не custom)

**Контрастность:** `*-content` цвет на соответствующем фоне.

### Что делает
Исправляет ТОЛЬКО классы и стили. НЕ трогает логику, `<script>`, HTML-структуру.

### Что не делает
Не работает с бизнес-логикой, не добавляет/удаляет элементы.

### Формат отчёта
```
## Стилевой ревью: [файл]

### Проверка тем
- bumblebee: OK / ПРОБЛЕМА
- coffee: OK / ПРОБЛЕМА
- luxury: OK / ПРОБЛЕМА
- nightfly: OK / ПРОБЛЕМА
- caramelwork: OK / ПРОБЛЕМА

### Исправления
1. file.vue:15 — bg-white → bg-base-100 (хардкод)
2. file.vue:23 — text-gray-600 → text-base-content/70 (не адаптируется)

### Итог: АДАПТИРОВАНО / БЕЗ ЗАМЕЧАНИЙ
```

---

## analyzer — Анализатор

**Файл:** `.claude/agents/analyzer.md`
**Модель:** opus
**Инструменты:** Read, Glob, Grep, Write, Edit
**Effort:** high, **maxTurns:** 80

### Что делает
**Мета-агент.** Анализирует результаты работы всей команды, находит системные проблемы, ведёт документацию ошибок.

### Когда вызывается
- После завершения крупных циклов разработки
- При обнаружении проблем пользователем
- Для аудита состояния проекта

### Источники данных
- `.claude/agent-memory/architect/MEMORY.md` — планы
- `.claude/agent-memory/tester/MEMORY.md` — лента изменений
- `.claude/agent-memory/critic/MEMORY.md` — критика
- `.claude/agent-memory/researcher/MEMORY.md` — исследования
- `.claude/agent-memory/analyzer/ERRORS.md` — собственная документация

### Что анализирует

**Паттерны ошибок критика:**
- Какие проблемы повторялись
- Растёт ли качество от модуля к модулю
- Есть ли архитектурный долг

**Качество исполнения:**
- Файлы превышающие лимит строк
- Дублирование кода
- console.* в production
- Несогласованность типов

**Состояние документации:**
- Актуальность MEMORY.md
- Соответствие SPEC.md реальному коду
- Покрытие .env.example

### Формат отчёта
```
## Анализ ZavodCamp — [Дата]

### Общее состояние
### Системные проблемы
### Повторяющиеся паттерны ошибок
### Рекомендации:
- Для архитектора: ...
- Для исполнителя: ...
- Для критика: ...
### Архитектурный долг
### Обновления ERRORS.md
```

### ERRORS.md
Файл `.claude/agent-memory/analyzer/ERRORS.md` — зона ответственности analyzer'а. Формат записи:
```markdown
## [Дата] — [Описание]
### Проблема
### Причина
### Зона ответственности
### Решение
### Урок
### Статус: pending / resolved / wontfix
```

### Не делает
Не пишет код. Только анализирует и рекомендует.

---

## Память агентов

Каждый агент имеет персональную папку памяти в `.claude/agent-memory/`:

```
.claude/agent-memory/
├── architect/MEMORY.md        # Планы и архитектурные решения
├── tester/MEMORY.md           # Лента изменений (per-feature reports)
├── critic/MEMORY.md           # Лента критики
├── researcher/MEMORY.md       # Результаты исследований
└── analyzer/ERRORS.md         # Документация ошибок
```

Эти файлы — **источник контекста** для следующих циклов разработки. Архитектор начинает каждый цикл с чтения tester и analyzer памяти.

---

## Голосовые команды

Из CLAUDE.md:

| Фраза | Действие |
|-------|----------|
| "Коммить", "Запрашиваю коммит", "Крути шарманку", "Грузи на гит", "Гит", "Делай гит" | Вызвать скилл `commit` |

Только пользователь даёт команду коммита. Агенты могут лишь рапортовать о готовности.

---

## Сводная таблица

| Агент | Модель | Главная роль | Output |
|-------|--------|--------------|--------|
| architect | opus | Планировщик | План для исполнителя |
| implementer | opus | Реализатор | Код (front + back) |
| critic | sonnet | Аудитор качества | Вердикт + список проблем |
| researcher | sonnet | Поиск решений | Аналитическая записка |
| stylist | sonnet | Темы и стили | Правки CSS-классов |
| tester | sonnet | Финальная проверка | Рапорт "ГОТОВО К КОММИТУ" |
| analyzer | opus | Мета-анализ | ERRORS.md + рекомендации |

---

# 12. Скиллы

В `.claude/skills/` живут **10 скиллов** — переиспользуемые наборы инструкций, которые загружаются по триггерам в работе с кодом или вызываются явно.

Скилл = `SKILL.md` файл + (опционально) подкаталоги с references / scripts / templates.

---

## Активные скиллы проекта

| Скилл | Триггер | Назначение |
|-------|---------|-----------|
| `web-dev` | При работе с кодом | Обязательные правила стека и подходы (Vue/Nuxt/Pinia/Tailwind/DaisyUI/Prisma) |
| `daisyUI` | При создании UI | Полный llms.txt DaisyUI 5 с компонентами и API |
| `daisyui-v5` | Альтернативный триггер | Структурированный справочник компонентов с references/ |
| `tailwind-4-docs` | Tailwind v4 вопросы | Snapshot документации Tailwind v4 |
| `commit` | Голосовая команда коммита | Стиль и правила git-коммитов |
| `visual-audit` | После UI-изменений | Playwright MCP визуальный аудит на 4 viewport'ах |
| `webapp-testing` | Тестирование локальных webapp | Python Playwright скрипты (универсальный) |
| `webapp-testing-extended` | Работа с тестами проекта | Vitest + @nuxt/test-utils + Playwright + supertest (ZavodCamp-специфика) |
| `frontend-design` | Создание дизайна | Производство distinctive UI (production-grade) |
| `skill-creator` | Создание/изменение скиллов | Мета-скилл для редактирования других скиллов |

---

## web-dev — Правила разработки

**Файл:** `.claude/skills/web-dev/SKILL.md`
**Триггер:** любая работа с кодом (страницы, компоненты, стили, логика)

### Стек проекта
- Nuxt 4 (SSR, file-based routing, auto-imports)
- Vue 3 (Composition API, `<script setup>`)
- Pinia (через `@pinia/nuxt`)
- Tailwind CSS 4 (утилитарные стили)
- DaisyUI 5 (отдельный скилл)
- Prisma 7 (только на сервере)
- nuxt-auth-utils (аутентификация)
- @formkit/auto-animate, @vueuse/motion, vue-draggable-plus
- @nuxt/icon + @iconify-json/mingcute
- @nuxtjs/color-mode

### Правила
**Обязательно:**
- DaisyUI компоненты вместо самописных (проверять через скилл `daisyUI`)
- При сомнениях в API — context7 MCP
- Стили только Tailwind, кастом CSS если объективно не справляется
- `<script setup lang="ts">` + Composition API
- Серверная логика только в `server/`

**Запрещено:**
- Options API, mixins, filters
- Самописные UI при наличии DaisyUI-аналога
- Inline-стили, `<style scoped>` для того, что решается Tailwind
- Установка новых deps без явного запроса

---

## daisyUI — Компонентная библиотека

**Файл:** `.claude/skills/daisyUI/SKILL.md`
**Триггер:** при создании UI-элементов

Полная выгрузка llms.txt от DaisyUI 5 (5.5.x). Содержит:
- Install notes (DaisyUI 5 требует Tailwind 4, без `tailwind.config.js`)
- Usage rules (component + part + style + color + modifier классы)
- 53 компонента (btn, card, modal, drawer, menu, tab, table, form inputs, alert, badge, progress и т.д.)
- Color system (primary, secondary, accent, neutral, base, info/success/warning/error)
- Theming с `@plugin` syntax

### Базовые принципы
1. Компонент = component class + опциональные part/style/color/size/modifier
2. Кастомизация через Tailwind utilities
3. Только daisyUI классы + Tailwind utilities — никакого custom CSS
4. Flex/grid с responsive prefixes
5. **НЕ** добавлять `bg-base-100 text-base-content` на body без надобности
6. **НЕ** использовать `dark:` prefix с DaisyUI цветами — темы сами справляются

---

## daisyui-v5 — Структурированный справочник

**Файл:** `.claude/skills/daisyui-v5/SKILL.md`
**Триггер:** daisyUI, daisy-ui, Tailwind CSS components, btn class, card class

Альтернатива `daisyUI`-скиллу — с подкаталогом `references/` где компоненты разбиты по файлам для grep'а.

```
.claude/skills/daisyui-v5/
├── SKILL.md
└── references/
    ├── btn.md
    ├── card.md
    ├── modal.md
    └── ...
```

Использование: `grep references/` для поиска нужного компонента перед ответом.

---

## tailwind-4-docs — Tailwind v4 docs

**Файл:** `.claude/skills/tailwind-4-docs/SKILL.md`
**Триггер:** Tailwind v4 вопросы, выбор utilities/variants, миграция v3→v4

Требует инициализации через скрипт:
```bash
python skills/tailwind-4-docs/scripts/sync_tailwind_docs.py --accept-docs-license
```

Снапшот загружается из `tailwindlabs/tailwindcss.com` (source-available, не open-source).

После инициализации:
- `references/docs/` — MDX-документация
- `references/docs-index.tsx` — категории и slugs
- `references/engineering-playbook.md` — implementation guide
- `references/gotchas.md` — миграционные подводные камни

**Если snapshot старше 1 недели** — попросить пользователя запустить sync.

---

## commit — Стиль коммитов

**Файл:** `.claude/skills/commit/SKILL.md`
**Триггер:** голосовая команда пользователя ("коммить", "гит", "грузи на гит")

### Правила
1. Только маленькие тире `-`, не длинные
2. Максимум 4 предложения
3. Стиль: "Что за фичи сделаны, каких коснулись компонентов и как сделаны"

### Команды
```bash
git add --all
git commit -m "Сообщение особого вида"
```

### Примеры стиля (из реальных коммитов)
- "Иконки, размерность и улучшение фильтров"
- "Анимации и улучшенный коллапсер, новый функционал и связка функционалов на страницы Сотрудников и скоупов."
- "Сбор статистики аккаунтов через Apify. Новый таб Статистика в карточке аккаунта с метриками подписчиков/просмотров/engagement..."
- "Накладные изменения, ниже описание базовой логики и техдолга"

---

## visual-audit — Визуальный аудит UI

**Файл:** `.claude/skills/visual-audit/SKILL.md`
**Триггер:** после любой UI-задачи (страница, компонент, модалка, форма, стили)
**applyTo:** `tests/visual/**, app/pages/**, app/components/**`

### Что делает
Автоматизирует обнаружение проблем вёрстки через **Playwright MCP** до того, как их увидит пользователь.

### Viewport-стандарт (совпадает с playwright.config.ts)

| Project | Размер | Назначение |
|---------|--------|-----------|
| `desktop_xl` | 1920×1080 | Большие мониторы |
| `desktop_md` | 1280×800 | Стандартный ноутбук |
| `tablet` | 768×1024 | iPad portrait |
| `mobile` | 375×812 | iPhone 13 / типовой смартфон |

### Workflow

1. **Подготовка:** сервер на :3100 (test) или :3000 (dev), Playwright MCP подключён, аутентификация через `x-test-auth-token`, fixtures в БД
2. **Plan:** список pages × modals × states × viewports
3. **Скриншоты:** `browser_resize` → `browser_navigate` → `browser_wait_for(networkidle)` → отключение анимаций через `browser_evaluate` → `browser_take_screenshot`
4. **Анализ:** Vision + программные сниппеты (overflow detection, tap target size ≥44px, modal viewport check, контраст)
5. **Report:** `tests/visual/{YYYY-MM-DD}-{feature}.md` с findings по severity
6. **Передача:** BLOCKER → NEEDS REWORK (back to implementer); MAJOR/MINOR → PASS WITH NOTES; ничего → CLEAN

### Severity

**BLOCKER (must-fix):**
- Текст обрезан без ellipsis
- Кнопка/инпут вылезает за границу
- Модалка больше viewport
- Скрытые элементы из-за z-index
- Mobile (375): tap target <44px
- Critical button ниже fold
- Контраст <3:1

**MAJOR:**
- Несогласованный gap
- Иконки разного размера в строке
- Кривой padding/margin
- Loading state == empty state визуально
- Error не выделен цветом
- Hover state отсутствует
- DaisyUI классы перекрыты raw tailwind

**MINOR:**
- Сдвиг 1-2px
- Опечатка
- Капитализация

### Шаблоны программных проверок

**Overflow detection:**
```js
Array.from(document.querySelectorAll('*'))
  .filter(el => el.scrollWidth > el.clientWidth + 1)
  .slice(0, 30)
  .map(el => ({ tag: el.tagName, cls: el.className.slice(0, 80), diff: el.scrollWidth - el.clientWidth }))
```

**Tap target size (для mobile):**
```js
Array.from(document.querySelectorAll('button, a, [role="button"]'))
  .filter(el => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44)
  })
```

**Modal viewport check:**
```js
const modal = document.querySelector('[role="dialog"], .modal-box, dialog[open]')
if (modal) {
  const rect = modal.getBoundingClientRect()
  return {
    overflowsX: rect.width > window.innerWidth,
    overflowsY: rect.height > window.innerHeight
  }
}
```

Подробнее об MCP-инструментах — в [13-mcp-playwright.md](13-mcp-playwright.md).

---

## webapp-testing — Python Playwright

**Файл:** `.claude/skills/webapp-testing/SKILL.md`

Универсальный скилл для тестирования локальных webapp. Использует **Python Playwright** (не MCP).

### Helper-скрипты
- `scripts/with_server.py` — управление жизненным циклом сервера (одного или нескольких)

### Decision tree
- Статический HTML → читать файл, писать Playwright скрипт
- Динамический webapp → reconnaissance-then-action (navigate → networkidle → screenshot/inspect → execute)

### Пример
```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto('http://localhost:5173')
    page.wait_for_load_state('networkidle')
    page.screenshot(path='/tmp/inspect.png', full_page=True)
    browser.close()
```

### Common pitfall
❌ Не инспектировать DOM до `networkidle`
✅ Всегда `page.wait_for_load_state('networkidle')`

---

## webapp-testing-extended — ZavodCamp тестовая инфра

**Файл:** `.claude/skills/webapp-testing-extended/SKILL.md`
**applyTo:** `tests/**, vitest.config.ts, playwright.config.ts, .env.test*`

Специфичный для ZavodCamp. Описывает:

### Структура
```
tests/
├── setup.ts                  # dotenv + safety guards + TRUNCATE afterEach
├── global-setup.ts           # prisma migrate deploy (1 раз)
├── helpers/
│   ├── auth.ts               # createTestUser + authHeaders
│   ├── api.ts                # обёртки над $fetch
│   ├── factories.ts          # ZavodUser, App, Proxy, SocialAccount
│   ├── nuxt-env.ts           # env для setup({ server: true })
│   └── test-crypto.ts        # AES-256-GCM как в server/utils/crypto.ts
├── unit/                     # Node-env
├── integration/              # Nuxt env + Prisma + Nitro
├── api/                      # Contract HTTP
└── e2e/                      # Playwright (вне Vitest)
vitest.config.ts
playwright.config.ts
```

### API contract-тесты
Минимум 3 теста на endpoint (happy path, auth=401, validation=400). Если читает/пишет секреты — отдельный `*-security.spec.ts` с проверкой shape и audit-log.

### Безопасность БД (КРИТИЧНО)
`tests/setup.ts` блокирует прогон если:
- Порт ≠ 5436
- Имя БД не содержит "tests"

### Test-bypass
```ts
import { createTestUser, authHeaders } from "~~/tests/helpers/auth"
const user = await createTestUser({ canAdmin: true })
const res = await $fetch("/api/admin/accounts-health", { headers: authHeaders(user.id) })
```

Работает только для endpoint'ов через `getAuthContext`. ~9 endpoint'ов идут через `requireUserSession` напрямую — для них Playwright e2e.

### Schedulers
В `.env.test`: `SCHEDULERS_ENABLED=false`. Иначе тесты получают непредсказуемые writes.

### Команды
```bash
bun run test                  # все
bun run test:unit
bun run test:integration
bun run test:api
bun run test:e2e
bun run test:db:migrate
bun run test:db:reset
```

### Viewports Playwright
- Desktop 1920×1080, 1280×800
- Tablet 768×1024 (iPad gen 7)
- Mobile 375×812 (iPhone 13)

Каждый e2e прогоняется на всех 4-х.

### Порт webServer
**3100** (не 3000 dev, не 3001 MarketingCamp). При изменении — обновить и в config'е, и в документации.

### Known issues
1. `bun run test` падает странно → fallback `npx vitest run`
2. `setup({ server: true })` поднимает Nuxt-процесс на каждый файл (~5-10c overhead)
3. `prisma migrate deploy` падает если набор миграций другой → `test:db:reset`
4. По умолчанию только Chromium
5. `vitest.config.ts` использует `defineConfig`, а не `defineVitestConfig` (Tailwind v4 vite-плагин ломает последний) → нет `#imports` в unit-тестах

---

## frontend-design — Production-grade UI

**Файл:** `.claude/skills/frontend-design/SKILL.md`

Создание distinctive, production-grade интерфейсов. Избегает generic AI-aesthetics.

### Принципы
- **Bold aesthetic direction:** brutalist / maximalist / minimalist / editorial / playful / etc.
- **Typography:** distinctive fonts (не Arial/Inter/Roboto)
- **Color & Theme:** dominant colors с sharp accents
- **Motion:** high-impact моменты (staggered page load > scattered micro-interactions)
- **Spatial Composition:** asymmetry, overlap, diagonal flow
- **Backgrounds:** gradient meshes, noise textures, layered transparencies

### Запреты
- Generic AI aesthetics (purple gradient на white background)
- Inter / Roboto / system fonts
- Cookie-cutter компонентные паттерны
- Predictable layouts

---

## skill-creator — Мета-скилл

**Файл:** `.claude/skills/skill-creator/SKILL.md`

Для создания новых скиллов и итеративного улучшения существующих.

### Процесс
1. Capture intent: что должен делать, когда триггерится, формат вывода
2. Interview & research (через MCP / subagents)
3. Draft + test prompts
4. Eval: generate_review.py + quantitative metrics
5. Rewrite по фидбеку
6. Optimize description (для лучшего триггеринга)

---

## Конвенции скиллов

| Аспект | Правило |
|--------|---------|
| Расположение | `.claude/skills/{name}/SKILL.md` |
| Frontmatter | `name`, `description`, `applyTo` (опц.), `compatibility` (опц.) |
| Триггер | На основе `description` (модель решает по контексту) |
| References | Подкаталог `references/` с детальными файлами для grep |
| Scripts | Подкаталог `scripts/` с исполняемыми утилитами |
| Триггер пользователем | `/skill-name` в чате |

---

## Сводная таблица

| Скилл | Триггер | Кто использует |
|-------|---------|----------------|
| `web-dev` | любая работа с кодом | implementer, critic, architect |
| `daisyUI` | создание UI | implementer, stylist, critic |
| `daisyui-v5` | альт. для UI | implementer |
| `tailwind-4-docs` | Tailwind v4 | implementer |
| `commit` | голосовая команда | пользователь / claude (catch-all) |
| `visual-audit` | после UI-задач | tester, stylist (через MCP Playwright) |
| `webapp-testing` | универсальное тестирование | claude |
| `webapp-testing-extended` | тесты проекта | tester, implementer |
| `frontend-design` | создание дизайна | implementer |
| `skill-creator` | работа со скиллами | редко |

---

# 13. MCP Playwright

**MCP Playwright** — отдельный Model Context Protocol сервер, который даёт агентам прямой контроль над браузером Chromium. Это полноценный инструмент тестирования и автоматизации, **более полезный, чем многие автоматизированные тесты**, потому что:

- Реальный браузер → реальное состояние страницы (CSS, JS, networkidle, rendering)
- Вижуал-тестинг через скриншоты + Vision-модель
- Воспроизведение пользовательских сценариев (клики, ввод, scrolling)
- Доступ к console logs, network requests, DOM-инспекция
- Многошаговые workflow без хрупкости classical selenium

---

## Доступные `browser_*` инструменты (35)

### Навигация и состояние

| Инструмент | Назначение |
|-----------|-----------|
| `browser_navigate` | Открыть URL (`page.goto`) |
| `browser_navigate_back` | Назад в истории |
| `browser_resize` | Изменить размер viewport (для responsive аудита) |
| `browser_close` | Закрыть браузер (обязательно в конце) |
| `browser_wait_for` | Ожидание: `networkidle`, селектор, таймаут, текст |
| `browser_snapshot` | Снять текущее состояние DOM (для анализа) |

### Скриншоты и медиа

| Инструмент | Назначение |
|-----------|-----------|
| `browser_take_screenshot` | Полный скриншот страницы (`fullPage: true` для длинных) или конкретного элемента |

### Взаимодействие — мышь и тачскрин

| Инструмент | Назначение |
|-----------|-----------|
| `browser_click` | Клик по селектору |
| `browser_hover` | Hover (полезно для tooltip, dropdown) |
| `browser_drag` / `browser_drop` | Drag-n-drop |
| `browser_mouse_click_xy` | Клик по координатам |
| `browser_mouse_move_xy` | Перемещение мыши |
| `browser_mouse_down` / `browser_mouse_up` | Низкоуровневые события |
| `browser_mouse_drag_xy` | Drag по координатам |
| `browser_mouse_wheel` | Прокрутка |

### Клавиатура и ввод

| Инструмент | Назначение |
|-----------|-----------|
| `browser_type` | Ввод текста в input/textarea |
| `browser_press_key` | Нажатие клавиши (Enter, Tab, Escape) |
| `browser_fill_form` | Заполнение формы целиком |
| `browser_select_option` | Выбор в `<select>` |
| `browser_file_upload` | Загрузка файла |

### Диалоги и табы

| Инструмент | Назначение |
|-----------|-----------|
| `browser_handle_dialog` | accept/dismiss confirm/alert/prompt |
| `browser_tabs` | Управление вкладками |

### Программный доступ

| Инструмент | Назначение |
|-----------|-----------|
| `browser_evaluate` | Выполнить JS на странице (для DOM-инспекции, отключения анимаций, эмуляции toast'ов) |
| `browser_run_code_unsafe` | Unsafe JS execution (с привилегиями) |
| `browser_console_messages` | Получить console logs (error/warn/info) |
| `browser_network_request` | Один запрос (детали) |
| `browser_network_requests` | Все запросы сессии |

---

## Сценарии использования в проекте

### 1. Визуальный аудит UI

Самый частый use-case. Скилл [`visual-audit`](12-skills.md#visual-audit) использует MCP Playwright:

```
1. browser_resize({ width: 1920, height: 1080 })       // viewport
2. browser_navigate('http://127.0.0.1:3100/proxies')
3. browser_wait_for({ state: 'networkidle' })
4. browser_evaluate(/* disable animations */)
5. browser_click('button:has-text("Добавить")')          // открыть модалку
6. browser_wait_for({ selector: '.modal-box' })
7. browser_take_screenshot({ fullPage: true, path: '.../proxies_modal_mobile.png' })
8. browser_close()
```

Прогоняется на 4 viewport'ах для responsive проверки.

### 2. E2E-тесты конкретного сценария

Например, создание аккаунта через multi-step wizard:

```
1. Login через test-bypass headers
2. Navigate /accounts
3. Click "Добавить аккаунт"
4. Fill wizard step 1 (платформа, displayName)
5. Click "Далее"
6. Fill step 2 (login/password)
7. Click "Далее"
8. Step 3 (proxy + Indigo)
9. Click "Создать"
10. Verify: account создан, EditModal auto-open, БД содержит запись
```

### 3. Smoke-тесты после деплоя

Прогон критических путей:
- Логин → Дашборд
- /trends → создание профиля → запуск парсинга
- /scenarios → генерация → variant table
- /videos → генерация → progress polling
- /uploads → создание → mock-публикация

### 4. Debug в development

Когда фронт ведёт себя странно:
```
browser_console_messages()  // что в console
browser_network_requests()  // что в сети
browser_snapshot()          // что в DOM
browser_take_screenshot()   // как выглядит
```

Это быстрее чем переключаться в DevTools вручную.

### 5. AI-управляемый browser flow

Vision-модель смотрит скриншот, решает что нажать дальше:
```
1. screenshot → AI видит "карточку с кнопкой 'Запустить'"
2. browser_click('button:has-text("Запустить")')
3. screenshot → AI видит "stepper с шагами"
4. browser_wait_for({ selector: '.step-success' })
```

Это близко к тому, что делает Claude Computer Use, но через специализированный MCP.

---

## Преимущества над classical e2e тестами

### Классический Playwright тест (`tests/e2e/*.spec.ts`)
```ts
import { test, expect } from '@playwright/test'
test('account creation', async ({ page }) => {
  await page.goto('/accounts')
  await page.click('button:has-text("Добавить")')
  // ... hardcoded steps
})
```

**Минусы:**
- Хрупкие селекторы (`button:has-text` ломается при изменении текста)
- Не воспринимает контекст экрана
- Нужно поддерживать спеки при каждой UI-итерации
- Не показывает agent'у, что фактически на экране

### MCP Playwright подход
```
agent: browser_navigate('/accounts')
agent: browser_snapshot()  → видит actual DOM
agent: browser_click('...') // выбирает селектор по контексту
agent: browser_take_screenshot() → проверяет результат визуально
```

**Плюсы:**
- Адаптивен — агент сам подстраивается под изменения
- Vision-проверка результата (не нужны искусственные `expect()`)
- Один и тот же подход для smoke / audit / debug
- Не требует написания и поддержки спеков

### Когда что использовать

| Use case | Подход |
|----------|--------|
| Regression тесты в CI | Classical Playwright spec'и в `tests/e2e/` |
| Visual audit при разработке | MCP Playwright + visual-audit скилл |
| Smoke после деплоя | MCP Playwright (быстро + flexible) |
| Debug одной фичи | MCP Playwright (быстрее переключаться) |
| Многошаговый wizard верификация | MCP Playwright (агент сам справится) |
| Контрактные тесты API | supertest + Vitest (НЕ Playwright) |

---

## Лучшие практики

### 1. Всегда ждать networkidle

```
browser_navigate('/page')
browser_wait_for({ state: 'networkidle' })  // ОБЯЗАТЕЛЬНО для SPA
```

Иначе DOM не успеет смонтироваться → false negatives.

### 2. Отключать анимации перед скриншотами

```
browser_evaluate(() => {
  document.head.insertAdjacentHTML('beforeend', `
    <style>
      *, *::before, *::after {
        transition: none !important;
        animation: none !important;
      }
    </style>
  `)
})
```

Иначе одни и те же скриншоты получают разный hash из-за in-flight transitions.

### 3. Закрывать браузер

```
// в конце scenario
browser_close()
```

Иначе ресурсы утекают, страница висит в памяти.

### 4. Использовать viewports из playwright.config.ts

4 стандартных размера (1920, 1280, 768, 375). Не выдумывать свои — иначе данные несравнимы с e2e.

### 5. Auth через test-bypass

Для test-сервера (`NODE_ENV=test`, `TEST_AUTH_BYPASS=1`):

```
browser_evaluate(() => {
  document.cookie = `x-test-auth-token=${testToken}`
  document.cookie = `x-test-user-id=${userId}`
})
```

Или через `browser_set_extra_http_headers` (если есть в MCP).

### 6. fullPage для длинных страниц

```
browser_take_screenshot({ fullPage: true, path: '...' })
```

Иначе на /pipeline/[id] или /analytics будет обрезано.

### 7. Vision-инспекция

После скриншота просить модель проанализировать визуально:
- Все элементы видны?
- Контраст читаемый?
- Иконки и текст не налезают?
- На mobile tap targets ≥44px?

---

## Output папка

Все скриншоты по умолчанию идут в `.playwright-mcp-output/` (gitignore). Для visual audit — в `tests/visual/screenshots/{YYYY-MM-DD}/`.

**Из user memory:** скриншоты сохранять в `screens/`, не в корень проекта.

---

## Известные ограничения

1. **Vision не видит мелкий текст:** при 1920 viewport текст 12px на скриншоте может быть нечитаем. Делать дополнительные element-скриншоты.
2. **Анимации:** даже с отключённым `transition` toast/modal могут начать рендериться через RAF → добавить `browser_wait_for(200ms)`.
3. **Reduced motion:** MCP не проверяет `@media (prefers-reduced-motion)`. Ручная проверка через DevTools.
4. **WebKit/Firefox:** по умолчанию Chromium. Safari/iOS-специфичные баги (sticky, backdrop-filter) не ловятся.
5. **Тёмная тема:** для полного аудита прогонять каждую тему через `data-theme` атрибут.

---

## Сводные команды Playwright MCP

| Действие | Инструмент |
|----------|-----------|
| Открыть страницу | `browser_navigate` |
| Подождать загрузку | `browser_wait_for` |
| Скриншот | `browser_take_screenshot` |
| Кликнуть | `browser_click` |
| Ввести текст | `browser_type` |
| Выбрать в select | `browser_select_option` |
| Прокрутить | `browser_mouse_wheel` |
| Получить console logs | `browser_console_messages` |
| Получить network requests | `browser_network_requests` |
| Выполнить JS | `browser_evaluate` |
| Закрыть | `browser_close` |

Полный список — в начале файла (35 инструментов).

---

## Интеграция с агентами

| Агент | Использование MCP Playwright |
|-------|------------------------------|
| `tester` | Финальная проверка фич, smoke-тесты, debug |
| `stylist` | Скриншоты в каждой теме для проверки контраста |
| `implementer` | Debug в процессе разработки |
| `analyzer` | Аудит при обнаружении проблем пользователем |

Critic, architect, researcher напрямую MCP Playwright обычно не используют.

---

## Связанные скиллы

- [`visual-audit`](12-skills.md#visual-audit) — основной потребитель MCP Playwright
- [`webapp-testing`](12-skills.md#webapp-testing) — Python Playwright (альтернатива)
- [`webapp-testing-extended`](12-skills.md#webapp-testing-extended) — для classical e2e в `tests/e2e/`

---

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
- **AccountDiagnosticPanel** на карточках Upload/PostingJob (JSON↔human toggle + копирование + signed-URL скриншот)
- **toDiagnosticError helper** (`shared/types/account-diagnostic.ts`) — единый формат ошибок для всего модуля

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
- **Sync workspace** с Indigo Browser (bulk-style API: `data.ids[]`)
- **Profile management** (CRUD)
- **Fingerprint configuration** (Canvas, UA, WebGL)
- **Platform-aware flags** — на mobile профилях `fonts/audio/graphics/graphics_noise/webrtc/screen` masking форсятся в `mask` (Indigo X на mobile запрещает `natural`)
- **Proxy mandatory** — `parameters.proxy` + `flags.proxy_masking='custom'` обязательны (anti-leak guard 412 на startProfile если `proxyId=null`)
- **Partial update mode** — на `partial_update` payload выкидывает `parameters.proxy` + `flags.proxy_masking` (Indigo Trial не позволяет менять proxy на partial_update). Смена proxy в PUT → **409** с инструкцией delete+recreate
- **Ports omit** — `ports_masking` всегда омитится (на /create silent ignore, на /partial_update 400)
- **Cookies import/export**
- **Multi-account linking** (M:N с SocialAccount)
- **Primary account** на профиль
- **Session lifecycle**: start-prepare → start → session-record → session-end → stop
- **Stop recovery** — message-based detection (already stopped, not running, profile inactive)
- **LOCK_PROFILE_ERROR recovery** — 5×3s retry (15с) перед failed, separate от CORE_DOWNLOADING_STARTED 60×5s (5 мин)
- **Persistent running banner** — зелёная плашка пока профиль работает
- **Stepper запуска** с success alert и портом
- **Phantom cleanup pivot** — Indigo Trial не поддерживает destructive delete, phantoms помечаются через `partial_update name='__phantom_N_<id8>'`, sync skip-on-import не вытягивает их обратно
- **Orphan cleanup** — find/remove "осиротевшие" профили
- **Remote duplicate cleanup** с post-verification (нет false-positive 'удалено')
- **Soft-archive on DELETE** — `syncStatus='archived'`, не воскрешается на sync
- **State honesty** — `IndigoSyncStatusBadge` принимает `indigoId` prop: если null → override на `local_only` 'Не в Indigo' (UI truth первая, не stale БД status)
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
- Connect к Indigo launcher на 127.0.0.1:45011 (Saturn bundled через Dockerfile + xvfb)
- TLS bypass для local launcher через `localLauncherRequest` (node:https напрямую — Bun runtime игнорит ofetch dispatcher)
- `server/utils/indigo/{client,build-create-body,types,sync}.ts`
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
- **Screenshot** после публикации (signed URL для UI)
- **Cancel modal** с подтверждением
- **Force-stop** через admin
- **1:1:1 anti-detect видимость** — на карточке бейджи `postingMethod` (Auto-Browser/API), Indigo, ProxyHealthBadge
- **Proxy gating** — серверный 412 `no_proxy`/`proxy_unhealthy` на `validateJobPreconditions` + POST `/api/posting-jobs`, UI alert согласован
- **Manual create modal** — `PostingJobCreateModal` с пикерами account/video, превью бейджей, scheduledAt asap/scheduled/random 1–24ч, парсер хэштегов, client-side 1:1:1 pre-check (warning, не блокирует)
- **Diagnostics** — `AccountDiagnosticPanel` (JSON↔human, копирование, открытие скриншота через signed URL), suggestion по errorCategory (Part D: login_required, browser_connect_failed, selector_not_found, upload_failed)

### Страницы
- `/posting-jobs` (кнопка «Создать задачу» в хедере, URL → store sync через `?socialAccountId=N`)
- Карточки на `/uploads/[id]`

### API
- `/api/posting-jobs/*` (8)

### Реализация
- `server/automation/poster-runner.ts` — worker FSM
- `server/automation/posters/{tiktok,youtube,instagram}-poster.ts`
- `server/automation/screenshot-uploader.ts`
- `POSTING_WORKER_ENABLED=true`
- `shared/types/account-diagnostic.ts` (toDiagnosticError helper для единого формата ошибок)
- `app/components/posting/PostingJobCreateModal.vue`

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
- **Третий таб «Аккаунты»** (Apify per-account метрики) — покрывает любой `postingMethod` (api OAuth / browser_automation), т.к. скрейпит публичный профиль:
  - Aggregate-плашка: всего аккаунтов / со снимками / Σ followers / средний engagement
  - Grid `AccountsSummaryCard` (lg:grid-cols-2 — overflow fix для xl:grid-cols-3 с 4 horizontal-stat'ами) с последним ok-снимком, sparkline, бейджем свежести «обновлено N ч/дней назад» (warn при ≥2 дней — Apify 24h idempotent)
  - Переиспользует `AccountMetricsStatCards` + `AccountMetricsSparkline` из accounts/AccountMetricsTab — без дублирования
  - Edge states: handle не указан, снимков нет, только error-снимки
  - `AnalyticsCollectButton` скрыт на этом табе (он про per-post через Upload.PostMetrics, не Apify)

### Страницы
- `/analytics` — **3 таба** (Summary, По аккаунту, Аккаунты)
- `/analytics/[uploadId]` — детали загрузки

### API
- `/api/analytics/*` (6) — включая `GET /api/analytics/accounts-summary`

### Реализация
- `app/components/analytics/AccountsSummaryAggregate.vue` + `AccountsSummaryCard.vue`
- `app/composables/useAnalyticsAccountsSummary.ts`
- `shared/types/analytics.ts` (`AccountsSummaryItem`/`Aggregate`/`Response`/`Filters`)
- `server/api/analytics/accounts-summary.get.ts`

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

---

# Changelog

История изменений документа. Каждая запись = одно обновление (атомарный коммит).

Формат: `YYYY-MM-DD — что обновлено — кто (агент/пользователь)`.

---

## 2026-05-22 — Indigo X buildbody mode + platform-aware flags + analytics overflow fix

**Indigo интеграция — пять последовательных fix'ов под реальный Indigo X:**

- `fd417b5` — proxy переехал в `parameters.proxy`, `flags.proxy_masking='custom'` обязателен (раньше был silent IP-leak на top-level). Динамический маппинг flags под отправляемые fingerprint sub-blocks
- `1c5cddc` — platform-aware buildFlags: на mobile профилях `fonts/audio/graphics/graphics_noise/webrtc/screen` masking форсятся в `mask` (Indigo X на mobile запрещает `natural` — BAD_REQUEST_VALUES). +6 unit-тестов
- `0f2c778` — `ports_masking` всегда омитится из payload (на /create silent, на /partial_update 400 BAD_REQUEST_BODY 'invalid ports data'). Indigo берёт default
- `f79ffeb` — buildbody принимает `mode: 'create' | 'partial_update'`. На update выкидывает `parameters.proxy` + `flags.proxy_masking` (Indigo Trial ругается даже на идентичный re-send). Детектор смены proxy в PUT → **409** с UX-инструкцией delete+recreate. +4 anti-regression теста
- `4ede62b` — fix overflow stats в карточке аккаунта на `/analytics`: `grid xl:grid-cols-3 → lg:grid-cols-2` (4 horizontal-stat'а не влезали в узкую колонку, четвёртая обрезалась)

**Что обновлено в документе:**
- `5. Компоненты` — описания `UploadCard.vue`, `PostingJobCard.vue` дополнены
- `7. REST API` — `PUT /api/indigo/profiles/[id]` детализирован (mode partial_update, 409 на смену proxy, mobile-restriction, ports omit)
- `8. Серверная логика` — новая подсекция **Indigo** (`indigo/client.ts`, `indigo/build-create-body.ts`, `indigo/types.ts`, `indigo/sync.ts`)
- `14. Функционал` → модуль **Indigo** — расширен (platform-aware flags, partial_update mode, phantom cleanup pivot, soft-archive, state honesty)
- `14. Функционал` → модуль **Аналитика** — overflow fix отражён в реализации

---

## 2026-05-21 — Phase 1+2 интеграция /uploads, /posting-jobs, /analytics с 1:1:1 + диагностикой

**Серия коммитов от `bc795ef` до `6da4b8f`:**

- `40255a5` + `bc795ef` (Phase 1 backend) — endpoint `GET /api/analytics/accounts-summary` + `shared/types/analytics.ts` (`AccountsSummaryItem`/`Aggregate`/`Response`/`Filters`). Apify-метрики покрывают любой postingMethod. Попутный fix: lazy dynamic import `otpauth` в `useTotp` (раньше падал на старте сервера)
- `dce0138` (Phase 2.1) — `/posting-jobs` UI: `PostingJobCard` переехал на `AccountDiagnosticPanel` + 1:1:1 бейджи (postingMethod / Indigo / ProxyHealth) + proxy gating alert. Новый `PostingJobCreateModal` (multi-step с пикерами account/video + scheduledAt asap/scheduled/random + парсер хэштегов)
- `6dc42a5` (Phase 2.2) — `/analytics` третий таб «Аккаунты»: `AccountsSummaryAggregate` + `AccountsSummaryCard` + composable `useAnalyticsAccountsSummary`. Переиспользование `AccountMetricsStatCards` + `AccountMetricsSparkline`
- `b6bcd03` (Phase 2.3) — `/uploads` UI: `UploadCard` на `AccountDiagnosticPanel` + 1:1:1 бейджи + chip связанного PostingJob (Upload 1:1 opt-in). Backend select расширен в `uploads/index.get.ts`, shared types `UploadSocialAccountDto`/`UploadPostingJobLink`
- `6da4b8f` (Phase 2 fixes) — Critic+Stylist review: `indigoProfileId` в select `/api/accounts`, URL → store sync для `/posting-jobs`, MetricsPlatform вместо Prisma type leak, stats-vertical → sm:stats-horizontal, alert-soft на тёмных темах, rounded-box на video preview

**Что обновлено в документе:**
- Метрики на верху — 194 → 197 компонентов, 85 → 86 composables, 311 → 312 API endpoints
- `4. Страницы` — описания `/uploads`, `/posting-jobs`, `/analytics`
- `5. Компоненты` — `analytics/` (7→9: +`AccountsSummaryAggregate`, +`AccountsSummaryCard`), `posting/` (5→6: +`PostingJobCreateModal`), описания `UploadCard.vue` и `PostingJobCard.vue`
- `6. Composables` — `useAnalyticsAccountsSummary`
- `7. REST API` — Analytics (5→6: +`GET /api/analytics/accounts-summary`)
- `14. Функционал` — модули **Аналитика** (третий таб), **PostingJob** (create modal + 1:1:1 + diagnostic), **Социальные аккаунты** (toDiagnosticError helper)

---

## 2026-05-21 — Версия 1.0 — первичное создание документа

Создана полная структура `docs/ZAVODCAMP_STATUS/`:

- `README.md` — индекс
- `01-overview.md` — обзор проекта (миссия, RBAC, связь с MarketingCamp)
- `02-stack.md` — стек, библиотеки, npm scripts, конфиги, env vars
- `03-structure.md` — иерархия файлов с детальной разбивкой каждой папки
- `04-pages.md` — 42 страницы с маршрутами/middleware/composables
- `05-components.md` — 194 компонента по 19 категориям
- `06-composables-stores.md` — 85 composables, 16 Pinia stores, middleware, plugins
- `07-api.md` — 311 endpoints в 28 разделах
- `08-server.md` — 66 utils, 9 файлов automation, 6 schedulers
- `09-database.md` — 75+ моделей Prisma, 89 миграций, шифрование
- `10-themes.md` — DaisyUI 5 темы + кастомные nightfly/caramelwork
- `11-agents.md` — 7 агентов команды разработки
- `12-skills.md` — 10 скиллов
- `13-mcp-playwright.md` — MCP Playwright для тестирования и визуального аудита
- `14-functionality.md` — карта реализованного функционала по модулям

Источники данных:
- Прямое чтение кода (`app/`, `server/`, `prisma/`, `.claude/`)
- `.claude/agent-memory/tester/MEMORY.md` (история фич)
- `docs/SPEC.md`, `docs/PIPELINE_SPEC.md`, `docs/accounts-feature.md`, `docs/indigo-code-state.md`, `docs/proxy-history.md`
- `.claude/skills/web-dev/SKILL.md` и остальные скиллы
- `package.json`, `nuxt.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `Dockerfile`, `entrypoint.sh`, `.env.example`

---

## Правила ведения CHANGELOG

### Когда добавлять запись

- Новая фича / новый API / новая модель БД → обновить `14-functionality.md` + соответствующий раздел + запись здесь
- Архитектурное изменение (структура папок, RBAC, конвенции) → `01-overview.md` или `03-structure.md` + запись
- Новый стек / библиотека / версия → `02-stack.md` + запись
- Новый агент / скилл → `11-agents.md` или `12-skills.md` + запись
- Новая тема → `10-themes.md` + запись

### Формат записи

```markdown
## YYYY-MM-DD — Краткое описание — Автор

- Что обновлено в `XX-name.md` — конкретные секции
- Что добавлено в `YY-other.md`
- Изменения в `README.md` индексе (если есть)

Причина: [почему понадобилось обновление — фича, рефакторинг, исправление]
```

### Чего не делать

- Не дублировать содержание обновлённых разделов — только ссылки и краткое описание
- Не описывать миграции БД здесь (только в `09-database.md`)
- Не описывать процесс разработки (только результат)

### Шаблон обновления документа после фичи

1. Реализована фича X в коммите Y
2. Тестировщик обновил `.claude/agent-memory/tester/MEMORY.md`
3. Обновляется `docs/ZAVODCAMP_STATUS/`:
   - `14-functionality.md` — раздел модуля X получает новые возможности
   - `04-pages.md` — если появились новые страницы
   - `05-components.md` — если появились новые компоненты
   - `07-api.md` — если появились новые endpoints
   - `09-database.md` — если появились новые модели/миграции
   - `README.md` — обновить метрики если изменились значения (количество страниц/API/etc.)
4. Запись в этом CHANGELOG

---

## Roadmap документа

Возможные расширения в будущих версиях:

- **15-deployment.md** — детали production deploy (Saturn.ac / Render / Fly.io)
- **16-monitoring.md** — observability, метрики, алёрты
- **17-known-issues.md** — лента известных проблем (отделить от `ERRORS.md` analyzer'а)
- **18-roadmap.md** — что планируется (бэклог фич)
- **19-glossary.md** — словарь терминов (RBAC, FSM, DAG, ASS, и т.д.)

Эти файлы создаются по мере необходимости — не плодить раньше времени.
