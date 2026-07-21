# 02. Стек, библиотеки, конфигурация

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
