# Testing — структура и паттерны

Документ описывает:
- слои тестов (`unit / integration / api / e2e / visual`),
- какие тесты обязательны для нового кода (DoD),
- паттерн API contract-тестов (`tests/api/`),
- правила безопасности (защита prod-БД от тестов).

---

## 1. Слои тестов

| Слой | Где | Окружение | Что покрывает |
|------|-----|-----------|---------------|
| Unit | `tests/unit/**` | happy-dom | Чистая логика без побочных эффектов: shared/utils, форматтеры, утилиты warmup-планировщика, валидаторы. Не ходит в БД и не поднимает Nuxt. |
| Integration | `tests/integration/**` | happy-dom + `setup({ server: true })` из `@nuxt/test-utils` | Поднимает Nuxt-Nitro в дочернем процессе. Проверяет заведение в БД, плагины, серверные утилиты вместе. |
| API | `tests/api/**` | то же, что Integration | Contract-тесты HTTP-эндпоинтов: shape ответа, статусы, валидация, авторизация, audit-логи. См. §3. |
| E2E | `tests/e2e/**` | Playwright, отдельный browser | Полные пользовательские сценарии (UI). Запускается через `bun run test:e2e`. |
| Visual | `tests/visual/**` | Playwright (через скилл `visual-audit`) | Скриншоты на 4 viewport'ах, ручной audit overflow/налезаний. См. соответствующий skill. |

`vitest.config.ts` подключает `unit`, `integration`, `api` в одном прогоне (singleThread). E2E и visual прогоняются отдельно.

---

## 2. Скрипты

| Команда | Что делает |
|---------|-----------|
| `bun run test` | весь vitest (unit + integration + api) |
| `bun run test:unit` | только `tests/unit/**` |
| `bun run test:integration` | только `tests/integration/**` |
| `bun run test:api` | только `tests/api/**` |
| `bun run test:e2e` | Playwright |
| `bun run test:db:migrate` | `prisma migrate deploy` против test-БД |
| `bun run test:db:reset` | `prisma migrate reset --force` против test-БД |

---

## 3. API contract-тесты — обязательный паттерн

Каждому новому HTTP-эндпоинту должен сопутствовать spec-файл в `tests/api/`. Цель — обнаруживать регрессии shape, валидации и утечек секретов на уровне «контракт API ↔ клиент».

### 3.1 Что обязательно покрывать

Для нового эндпоинта (минимум 3 теста):

1. **Happy path** — корректный shape ответа и статус (200/201/204).
2. **Auth** — без TEST_AUTH_BYPASS-заголовков → 401.
3. **Validation** — минимум один пример 400 (невалидное тело / enum / range).

Если эндпоинт читает или пишет secret-поля (host/password/loginPassword/twoFASecret/accessToken и т.п.) — добавить отдельный `*-security.spec.ts` со следующими проверками:

- list/detail НЕ возвращает plain секреты (только `hostMasked` / `hasCredentials` / `hasLoginCredentials`-флаги);
- reveal-эндпоинт пишет `SecretAccessLog` (правильный `entityType`, `userId`, `reason`, `action`);
- `reason` валидируется (длина ≥10 символов, ≤500);
- audit-log создаётся **до** decrypt — даже при сломанном ciphertext запись остаётся.

### 3.2 Naming convention

`tests/api/{feature}-{aspect}.spec.ts`, где:
- `feature` — имя ресурса в URL: `proxies`, `accounts-credentials`, `uploads`, `posting-jobs`.
- `aspect` — `security` | `crud` | `validation` | `pagination` | `concurrency`.

Примеры из текущей кодобазы:
- `proxies-security.spec.ts` — list shape, hostMasked, audit-log.
- `proxies-crud.spec.ts` — POST/PUT/DELETE, валидация enum/range, 409 при FK.
- `accounts-credentials-security.spec.ts` — encryption at rest, reveal audit, whitelist.

### 3.3 Шаблон

`tests/api/_template.spec.ts.example` — копировать как стартовую точку. Расширение `.ts.example` отбрасывается vitest-glob'ом (`*.{test,spec}.ts`), поэтому шаблон не запускается как тест.

### 3.4 Базовые блоки

```ts
import { describe, it, expect } from "vitest"
import { setup, $fetch } from "@nuxt/test-utils/e2e"
import { createTestUser, authHeaders } from "../helpers/auth"
import { createTestProxy } from "../helpers/factories"
import { nuxtTestEnv } from "../helpers/nuxt-env"

await setup({ dev: true, server: true, browser: false, env: nuxtTestEnv })

describe("FEATURE", () => {
  it("does X", async () => {
    const user = await createTestUser({ canAdmin: true })
    const res = await $fetch<{ data: unknown }>("/api/...", {
      headers: authHeaders(user.id),
    })
    expect(res.data).toBeDefined()
  })
})
```

Для проверки 4xx-ответов используется `rejects.toMatchObject({ statusCode: 400 })` — `$fetch` бросает на не-2xx.

---

## 4. Фабрики (`tests/helpers/factories.ts`)

| Фабрика | Создаёт | Шифрование |
|---------|---------|-----------|
| `createTestUser({ canAdmin, ... })` | `ZavodUser` (по умолчанию admin) | — |
| `createTestApp({ name, keywords })` | `App` | — |
| `createTestProxy({ host, password, ... })` | `Proxy` + автоматически `ZavodUser`, если `createdById` не передан | host/username/password/rotationUrl шифруются `testEncrypt()` |
| `createTestSocialAccount({ loginEmail, loginPassword, ... })` | `SocialAccount` + автоматически `App`, если `appId` не передан | login*-поля шифруются `testEncrypt()` |

`testEncrypt()` (`tests/helpers/test-crypto.ts`) использует тот же AES-256-GCM формат `iv:authTag:ciphertext`, что и `server/utils/crypto.ts`, но читает ключ из `process.env.ENCRYPTION_KEY` напрямую (без `useRuntimeConfig()`, который недоступен в чистом vitest).

---

## 5. Auth bypass

Подробности — в `server/utils/rbac.ts:getAuthContext`. Кратко:

Bypass активируется ТОЛЬКО при ВСЕХ условиях одновременно:
- `NODE_ENV !== "production"`,
- `TEST_AUTH_BYPASS=1`,
- В запросе `x-test-auth-token` совпадает с `process.env.TEST_AUTH_TOKEN`,
- В запросе `x-test-user-id` указывает на активного `ZavodUser`.

В прод-окружении гейты гарантируют, что bypass НЕ срабатывает даже случайно.

`authHeaders(userId)` (`tests/helpers/auth.ts`) собирает оба заголовка из `process.env.TEST_AUTH_TOKEN`. Если переменная отсутствует — функция бросает понятную ошибку.

---

## 6. Защита prod-БД от тестов

`tests/setup.ts` блокирует прогон, если:
- `NODE_ENV=production`, или
- `DATABASE_URL` не указывает на test-БД (порт **5436** + подстрока **«tests»** в имени).

`afterEach` делает `TRUNCATE ... RESTART IDENTITY CASCADE` по всем public-таблицам, кроме `_prisma_migrations`. Поэтому каждый тест стартует с чистой БД, а singleThread-режим vitest гарантирует отсутствие гонок между файлами.

`tests/global-setup.ts` один раз применяет миграции (`prisma migrate deploy`) перед всем прогоном.

---

## 7. Definition of Done нового эндпоинта

- [ ] Создан `tests/api/{feature}-{aspect}.spec.ts` минимум с 3 тестами (happy/auth/validation).
- [ ] Если эндпоинт трогает секреты — есть `*-security.spec.ts`.
- [ ] `bun run test:api` зелёный.
- [ ] `bunx tsc` без ошибок в новых файлах.
- [ ] Документация в этом файле (или `docs/architecture/social_automation.md`) обновлена, если эндпоинт меняет контракт.
