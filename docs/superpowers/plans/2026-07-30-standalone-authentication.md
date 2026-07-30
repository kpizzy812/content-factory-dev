# Standalone Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ContentFactory аутентифицирует пользователей сам, без родительской платформы MarketingCamp, чтобы установку можно было развернуть клиенту и продать повторно.

**Architecture:** Провайдер авторизации выбирается переменной `AUTH_PROVIDER`, по умолчанию `local`. Локальные учётки хранят пароль в `ZavodUser.passwordHash` в формате scrypt из `node:crypto` — новых зависимостей не добавляется. `externalId` остаётся обязательным: для локальных учёток он выводится детерминированно из email тем же способом, что уже применяет dev-логин, поэтому схема сессии и весь RBAC не меняются. MarketingCamp сохраняется как явно включаемый адаптер и перестаёт быть источником истины. Первый администратор создаётся CLI-скриптом.

**Tech Stack:** Nuxt 4/Nitro, TypeScript, Bun, Vitest, Prisma/PostgreSQL, `nuxt-auth-utils`, `node:crypto`.

## Global Constraints

- Не добавлять npm-зависимости для хеширования. Только `node:crypto` (`scrypt`, `randomBytes`, `timingSafeEqual`).
- Пароль не попадает в логи, ответы API, Prisma snapshots и клиентский bundle. Наружу не отдаётся даже хеш.
- Сравнение секретов только константное по времени. Ответ на неверный email и неверный пароль одинаков.
- `AUTH_PROVIDER` по умолчанию `local`. MarketingCamp работает только при `AUTH_PROVIDER=marketingcamp`.
- Существующий dev-логин и тестовый bypass (`TEST_AUTH_BYPASS`) не ломать: они проверяются до провайдера и остаются как есть.
- Схема сессии `#auth-utils` не меняется: `id`, `externalId`, `email`, `name`, `surname`, `rolePreset`.
- Миграции только additive, `prisma db push` запрещён.
- Тесты пишутся первыми: один падающий тест, наблюдаемый провал, минимальная реализация, повторный прогон.
- Только Bun-команды.

---

### Task 1: Хеширование паролей на node:crypto

**Files:**
- Create: `tests/unit/auth-password.spec.ts`
- Create: `server/utils/auth/password.ts`
- Modify: `vitest.pure.config.ts`

**Interfaces:**
- Produces: `hashPassword(plain: string): Promise<string>`, `verifyPassword(plain: string, stored: string | null): Promise<boolean>`, `assertPasswordPolicy(plain: string): void`.

- [ ] **Шаг 1: Написать падающий тест**

Создать `tests/unit/auth-password.spec.ts`:

```ts
import { describe, expect, it } from "vitest"

import { assertPasswordPolicy, hashPassword, verifyPassword } from "~~/server/utils/auth/password"

describe("password hashing", () => {
  it("подтверждает верный пароль и отвергает неверный", async () => {
    const stored = await hashPassword("correct horse battery")
    expect(await verifyPassword("correct horse battery", stored)).toBe(true)
    expect(await verifyPassword("wrong horse battery", stored)).toBe(false)
  })

  it("даёт разный хеш для одного пароля из-за соли", async () => {
    const first = await hashPassword("same password 123")
    const second = await hashPassword("same password 123")
    expect(first).not.toBe(second)
    expect(await verifyPassword("same password 123", first)).toBe(true)
    expect(await verifyPassword("same password 123", second)).toBe(true)
  })

  it("пишет разбираемый формат scrypt без сырого пароля", async () => {
    const stored = await hashPassword("secret value 12345")
    expect(stored.startsWith("scrypt$")).toBe(true)
    expect(stored.split("$")).toHaveLength(6)
    expect(stored).not.toContain("secret value")
  })

  it("не падает и возвращает false на пустом или битом хеше", async () => {
    expect(await verifyPassword("whatever", null)).toBe(false)
    expect(await verifyPassword("whatever", "")).toBe(false)
    expect(await verifyPassword("whatever", "not-a-hash")).toBe(false)
    expect(await verifyPassword("whatever", "scrypt$16384$8$1$zz$zz")).toBe(false)
  })

  it("требует минимум 12 символов", () => {
    expect(() => assertPasswordPolicy("short")).toThrow()
    expect(() => assertPasswordPolicy("123456789012")).not.toThrow()
  })
})
```

В `vitest.pure.config.ts` в массив `include` добавить строку:

```ts
      "tests/unit/auth-password.spec.ts",
```

- [ ] **Шаг 2: Прогнать тест и убедиться, что он падает**

Run: `bun run test --config vitest.pure.config.ts tests/unit/auth-password.spec.ts`
Expected: FAIL — `Failed to resolve import "~~/server/utils/auth/password"`.

- [ ] **Шаг 3: Реализовать модуль**

Создать `server/utils/auth/password.ts`:

```ts
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto"
import { promisify } from "node:util"

// createError импортируется явно: модуль читают DB-free unit-тесты, где
// авто-импортов Nitro нет.
import { createError } from "h3"

const scryptAsync = promisify(scrypt)

const COST = 16384
const BLOCK_SIZE = 8
const PARALLELIZATION = 1
const KEY_LENGTH = 64
const SALT_BYTES = 16
const MIN_LENGTH = 12

/** Формат хранения: scrypt$N$r$p$saltBase64$hashBase64. Сырой пароль не хранится. */
function encode(salt: Buffer, hash: Buffer): string {
  return [
    "scrypt",
    COST,
    BLOCK_SIZE,
    PARALLELIZATION,
    salt.toString("base64"),
    hash.toString("base64"),
  ].join("$")
}

export function assertPasswordPolicy(plain: string): void {
  if (typeof plain !== "string" || plain.length < MIN_LENGTH) {
    throw createError({
      statusCode: 422,
      message: `Пароль должен содержать минимум ${MIN_LENGTH} символов`,
    })
  }
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  const hash = (await scryptAsync(plain, salt, KEY_LENGTH, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELIZATION,
  })) as Buffer
  return encode(salt, hash)
}

export async function verifyPassword(plain: string, stored: string | null): Promise<boolean> {
  if (!stored) return false
  const parts = stored.split("$")
  if (parts.length !== 6 || parts[0] !== "scrypt") return false

  const cost = Number(parts[1])
  const blockSize = Number(parts[2])
  const parallelization = Number(parts[3])
  if (!Number.isFinite(cost) || !Number.isFinite(blockSize) || !Number.isFinite(parallelization)) return false

  const salt = Buffer.from(parts[4]!, "base64")
  const expected = Buffer.from(parts[5]!, "base64")
  if (salt.length === 0 || expected.length === 0) return false

  try {
    const actual = (await scryptAsync(plain, salt, expected.length, {
      N: cost,
      r: blockSize,
      p: parallelization,
    })) as Buffer
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}
```

- [ ] **Шаг 4: Прогнать тест и убедиться, что он проходит**

Run: `bun run test --config vitest.pure.config.ts tests/unit/auth-password.spec.ts`
Expected: PASS, 5 тестов.

- [ ] **Шаг 5: Коммит**

```bash
git add server/utils/auth/password.ts tests/unit/auth-password.spec.ts vitest.pure.config.ts
git commit -m "feat: add scrypt password hashing"
```

---

### Task 2: Схема локальной учётки

**Files:**
- Modify: `prisma/schema.prisma:18-48`
- Create: `prisma/migrations/20260731090000_add_local_credentials/migration.sql`
- Create: `tests/unit/auth-identity.spec.ts`
- Create: `server/utils/auth/identity.ts`

**Interfaces:**
- Consumes: `devExternalId` из `server/utils/dev-auth.ts`.
- Produces: поле `ZavodUser.passwordHash`; `localExternalId(email: string): number`, `normalizeEmail(value: string): string`.

- [ ] **Шаг 1: Написать падающий тест**

Создать `tests/unit/auth-identity.spec.ts`:

```ts
import { describe, expect, it } from "vitest"

import { devExternalId } from "~~/server/utils/dev-auth"
import { localExternalId, normalizeEmail } from "~~/server/utils/auth/identity"

describe("local account identity", () => {
  it("приводит email к каноническому виду", () => {
    expect(normalizeEmail("  Owner@Example.COM ")).toBe("owner@example.com")
  })

  it("выводит стабильный отрицательный externalId из email", () => {
    const first = localExternalId("owner@example.com")
    expect(first).toBe(localExternalId(" OWNER@example.com "))
    expect(first).toBeLessThan(0)
    expect(localExternalId("other@example.com")).not.toBe(first)
  })

  it("совпадает с dev-логином, чтобы одна почта не давала два аккаунта", () => {
    expect(localExternalId("owner@example.com")).toBe(devExternalId("owner@example.com"))
  })
})
```

В `vitest.pure.config.ts` в `include` добавить:

```ts
      "tests/unit/auth-identity.spec.ts",
```

- [ ] **Шаг 2: Прогнать тест и убедиться, что он падает**

Run: `bun run test --config vitest.pure.config.ts tests/unit/auth-identity.spec.ts`
Expected: FAIL — `Failed to resolve import "~~/server/utils/auth/identity"`.

- [ ] **Шаг 3: Реализовать модуль**

Создать `server/utils/auth/identity.ts`:

```ts
import { devExternalId } from "../dev-auth"

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

/**
 * Локальные учётки не приходят из внешней платформы, поэтому externalId выводится
 * из email детерминированно и всегда отрицательный — так он не может столкнуться
 * с положительными идентификаторами MarketingCamp.
 */
export function localExternalId(email: string): number {
  return devExternalId(normalizeEmail(email))
}
```

- [ ] **Шаг 4: Прогнать тест и убедиться, что он проходит**

Run: `bun run test --config vitest.pure.config.ts tests/unit/auth-identity.spec.ts`
Expected: PASS, 3 теста.

- [ ] **Шаг 5: Добавить поле в схему**

В `prisma/schema.prisma` в модель `ZavodUser` после строки `surname          String?` добавить:

```prisma
  passwordHash     String?
```

- [ ] **Шаг 6: Написать миграцию**

Создать `prisma/migrations/20260731090000_add_local_credentials/migration.sql`:

```sql
-- Локальные учётные данные ContentFactory. Поле nullable: учётки, пришедшие из
-- MarketingCamp, пароля не имеют и логинятся своим провайдером.
ALTER TABLE "ZavodUser" ADD COLUMN "passwordHash" TEXT;
```

- [ ] **Шаг 7: Применить миграцию и сгенерировать клиент**

Run: `bun run test:db:migrate`
Expected: `All migrations have been successfully applied.`

Run: `bunx prisma generate`
Expected: клиент сгенерирован без ошибок.

Run: `bunx prisma validate`
Expected: `The schema at prisma\schema.prisma is valid`.

- [ ] **Шаг 8: Коммит**

```bash
git add prisma/schema.prisma prisma/migrations/20260731090000_add_local_credentials server/utils/auth/identity.ts tests/unit/auth-identity.spec.ts vitest.pure.config.ts app/generated/prisma
git commit -m "feat: store local credentials on the user"
```

---

### Task 3: Выбор провайдера авторизации

**Files:**
- Create: `tests/unit/auth-provider.spec.ts`
- Create: `server/utils/auth/provider.ts`
- Modify: `vitest.pure.config.ts`

**Interfaces:**
- Produces: тип `AuthProvider = "local" | "marketingcamp"`, `resolveAuthProvider(env: Record<string, string | undefined>): AuthProvider`.

- [ ] **Шаг 1: Написать падающий тест**

Создать `tests/unit/auth-provider.spec.ts`:

```ts
import { describe, expect, it } from "vitest"

import { resolveAuthProvider } from "~~/server/utils/auth/provider"

describe("auth provider selection", () => {
  it("по умолчанию использует локальную авторизацию", () => {
    expect(resolveAuthProvider({})).toBe("local")
    expect(resolveAuthProvider({ AUTH_PROVIDER: "" })).toBe("local")
  })

  it("включает MarketingCamp только явно", () => {
    expect(resolveAuthProvider({ AUTH_PROVIDER: "marketingcamp" })).toBe("marketingcamp")
    expect(resolveAuthProvider({ AUTH_PROVIDER: "MarketingCamp" })).toBe("marketingcamp")
  })

  it("падает на неизвестном значении, а не молча откатывается", () => {
    expect(() => resolveAuthProvider({ AUTH_PROVIDER: "ldap" })).toThrow(/AUTH_PROVIDER/)
  })
})
```

В `vitest.pure.config.ts` в `include` добавить:

```ts
      "tests/unit/auth-provider.spec.ts",
```

- [ ] **Шаг 2: Прогнать тест и убедиться, что он падает**

Run: `bun run test --config vitest.pure.config.ts tests/unit/auth-provider.spec.ts`
Expected: FAIL — `Failed to resolve import "~~/server/utils/auth/provider"`.

- [ ] **Шаг 3: Реализовать модуль**

Создать `server/utils/auth/provider.ts`:

```ts
export type AuthProvider = "local" | "marketingcamp"

const SUPPORTED: AuthProvider[] = ["local", "marketingcamp"]

/**
 * По умолчанию ContentFactory логинит сам. MarketingCamp — необязательный адаптер
 * для установок, где родительская платформа действительно есть.
 */
export function resolveAuthProvider(env: Record<string, string | undefined>): AuthProvider {
  const raw = (env.AUTH_PROVIDER ?? "").trim().toLowerCase()
  if (!raw) return "local"
  if (!SUPPORTED.includes(raw as AuthProvider)) {
    throw new Error(`AUTH_PROVIDER must be one of ${SUPPORTED.join(", ")}, got "${raw}"`)
  }
  return raw as AuthProvider
}
```

- [ ] **Шаг 4: Прогнать тест и убедиться, что он проходит**

Run: `bun run test --config vitest.pure.config.ts tests/unit/auth-provider.spec.ts`
Expected: PASS, 3 теста.

- [ ] **Шаг 5: Коммит**

```bash
git add server/utils/auth/provider.ts tests/unit/auth-provider.spec.ts vitest.pure.config.ts
git commit -m "feat: select the auth provider from configuration"
```

---

### Task 4: Локальный вход в `/api/auth/login`

**Files:**
- Create: `server/utils/auth/local-login.ts`
- Modify: `server/api/auth/login.post.ts:53-73`
- Create: `tests/api/auth-local-login.spec.ts`

**Interfaces:**
- Consumes: `verifyPassword` (Task 1), `normalizeEmail` (Task 2), `resolveAuthProvider` (Task 3).
- Produces: `authenticateLocalUser(email: string, password: string): Promise<ZavodUser>` — бросает 401 при любой неудаче, возвращает активного пользователя при успехе.

- [ ] **Шаг 1: Написать падающий тест**

Создать `tests/api/auth-local-login.spec.ts`:

```ts
import { describe, expect, it, beforeAll } from "vitest"
import { setup, $fetch } from "@nuxt/test-utils/e2e"

import { prisma } from "../../server/utils/prisma"
import { hashPassword } from "../../server/utils/auth/password"
import { localExternalId } from "../../server/utils/auth/identity"

describe("local login", async () => {
  await setup({ server: true, env: { AUTH_PROVIDER: "local" } })

  const email = "owner@contentfactory.test"
  const password = "local-owner-password"

  beforeAll(async () => {
    await prisma.zavodUser.upsert({
      where: { email },
      create: {
        externalId: localExternalId(email),
        email,
        name: "Owner",
        rolePreset: "admin",
        passwordHash: await hashPassword(password),
        canRead: true, canWrite: true, canCreate: true, canDelete: true,
        canApprove: true, canRunAgent: true, canApplyChanges: true, canAdmin: true,
        moduleAccess: ["pipeline"],
        isActive: true,
      },
      update: { passwordHash: await hashPassword(password), isActive: true },
    })
  })

  it("пускает с верным паролем и не отдаёт хеш", async () => {
    const response = await $fetch<{ user: Record<string, unknown> }>("/api/auth/login", {
      method: "POST",
      body: { email, password },
    })
    expect(response.user.email).toBe(email)
    expect(response.user.rolePreset).toBe("admin")
    expect(JSON.stringify(response)).not.toContain("scrypt$")
  })

  it("отвечает 401 на неверный пароль и на несуществующего пользователя одинаково", async () => {
    await expect($fetch("/api/auth/login", {
      method: "POST",
      body: { email, password: "wrong-password-here" },
    })).rejects.toMatchObject({ statusCode: 401 })

    await expect($fetch("/api/auth/login", {
      method: "POST",
      body: { email: "nobody@contentfactory.test", password: "wrong-password-here" },
    })).rejects.toMatchObject({ statusCode: 401 })
  })

  it("не пускает выключенного пользователя", async () => {
    await prisma.zavodUser.update({ where: { email }, data: { isActive: false } })
    await expect($fetch("/api/auth/login", {
      method: "POST",
      body: { email, password },
    })).rejects.toMatchObject({ statusCode: 401 })
    await prisma.zavodUser.update({ where: { email }, data: { isActive: true } })
  })
})
```

- [ ] **Шаг 2: Прогнать тест и убедиться, что он падает**

Run: `bun run test:api tests/api/auth-local-login.spec.ts`
Expected: FAIL — вход уходит в MarketingCamp и отдаёт 401 «Аккаунт не найден на родительской платформе» даже при верном пароле.

- [ ] **Шаг 3: Реализовать локальный вход**

Создать `server/utils/auth/local-login.ts`:

```ts
import type { ZavodUser } from "~~/app/generated/prisma/client"

import { normalizeEmail } from "./identity"
import { verifyPassword } from "./password"

/**
 * Ответ на неизвестный email и на неверный пароль одинаков, чтобы форма входа
 * не работала как оракул существующих учёток.
 */
export async function authenticateLocalUser(email: string, password: string): Promise<ZavodUser> {
  const invalid = () => createError({ statusCode: 401, message: "Неверный email или пароль" })

  const user = await prisma.zavodUser.findUnique({ where: { email: normalizeEmail(email) } })
  if (!user || !user.isActive) {
    // Прогоняем проверку вхолостую, чтобы время ответа не выдавало отсутствие учётки.
    await verifyPassword(password, null)
    throw invalid()
  }

  if (!(await verifyPassword(password, user.passwordHash))) throw invalid()

  return prisma.zavodUser.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  })
}
```

- [ ] **Шаг 4: Подключить провайдер в endpoint**

В `server/api/auth/login.post.ts` добавить импорты к существующему импорту `dev-auth`:

```ts
import { authenticateLocalUser } from '../../utils/auth/local-login'
import { resolveAuthProvider } from '../../utils/auth/provider'
```

Сразу после блока dev-логина (после строки `  }` , закрывающей `if (verifyDevAuth(...))`, строка 52) вставить:

```ts
  if (resolveAuthProvider(process.env) === 'local') {
    const localUser = await authenticateLocalUser(email, body.password)
    const sessionUser = {
      id: localUser.id, externalId: localUser.externalId, email: localUser.email,
      name: localUser.name, surname: localUser.surname, rolePreset: localUser.rolePreset,
    }
    await setUserSession(event, { user: sessionUser })
    return { user: sessionUser }
  }
```

Существующий блок с `validateExternalUser` и проверкой `mcUser.permissions` оставить без изменений — он теперь выполняется только при `AUTH_PROVIDER=marketingcamp`.

- [ ] **Шаг 5: Прогнать тест и убедиться, что он проходит**

Run: `bun run test:api tests/api/auth-local-login.spec.ts`
Expected: PASS, 3 теста.

- [ ] **Шаг 6: Убедиться, что режим MarketingCamp не сломан**

Run: `bun run test:api`
Expected: PASS. Если какой-то suite полагался на вход через MarketingCamp, добавить ему `env: { AUTH_PROVIDER: "marketingcamp" }` в вызов `setup`.

- [ ] **Шаг 7: Коммит**

```bash
git add server/utils/auth/local-login.ts server/api/auth/login.post.ts tests/api/auth-local-login.spec.ts
git commit -m "feat: authenticate users without the parent platform"
```

---

### Task 5: Управление учётками в админке

**Files:**
- Create: `server/api/admin/users.post.ts`
- Create: `server/api/admin/users/[id]/password.put.ts`
- Create: `tests/api/admin-user-credentials.spec.ts`
- Modify: `server/api/admin/users.get.ts`

**Interfaces:**
- Consumes: `hashPassword`, `assertPasswordPolicy` (Task 1), `localExternalId`, `normalizeEmail` (Task 2).
- Produces: `POST /api/admin/users` — создание локальной учётки; `PUT /api/admin/users/:id/password` — смена пароля.

- [ ] **Шаг 1: Написать падающий тест**

Создать `tests/api/admin-user-credentials.spec.ts`:

```ts
import { describe, expect, it } from "vitest"
import { setup, $fetch } from "@nuxt/test-utils/e2e"

import { createTestUser, authHeaders } from "../helpers/auth"
import { prisma } from "../../server/utils/prisma"

describe("admin user credentials", async () => {
  await setup({ server: true, env: { AUTH_PROVIDER: "local" } })

  it("создаёт локальную учётку и позволяет ей войти", async () => {
    const admin = await createTestUser({ email: "admin-creds@test.local", canAdmin: true })

    const created = await $fetch<{ data: { id: number; email: string } }>("/api/admin/users", {
      method: "POST",
      headers: authHeaders(admin.id),
      body: {
        email: "New.Operator@Test.local",
        password: "operator-password-1",
        name: "Operator",
        rolePreset: "operator",
        moduleAccess: ["pipeline"],
      },
    })

    expect(created.data.email).toBe("new.operator@test.local")

    const login = await $fetch<{ user: { email: string } }>("/api/auth/login", {
      method: "POST",
      body: { email: "new.operator@test.local", password: "operator-password-1" },
    })
    expect(login.user.email).toBe("new.operator@test.local")
  })

  it("не отдаёт хеш пароля в списке пользователей", async () => {
    const admin = await createTestUser({ email: "admin-list@test.local", canAdmin: true })
    const list = await $fetch("/api/admin/users", { headers: authHeaders(admin.id) })
    expect(JSON.stringify(list)).not.toContain("scrypt$")
  })

  it("меняет пароль и отклоняет короткий", async () => {
    const admin = await createTestUser({ email: "admin-rotate@test.local", canAdmin: true })
    const target = await createTestUser({ email: "rotate-me@test.local" })

    await $fetch(`/api/admin/users/${target.id}/password`, {
      method: "PUT",
      headers: authHeaders(admin.id),
      body: { password: "brand-new-password" },
    })

    const login = await $fetch<{ user: { email: string } }>("/api/auth/login", {
      method: "POST",
      body: { email: "rotate-me@test.local", password: "brand-new-password" },
    })
    expect(login.user.email).toBe("rotate-me@test.local")

    await expect($fetch(`/api/admin/users/${target.id}/password`, {
      method: "PUT",
      headers: authHeaders(admin.id),
      body: { password: "short" },
    })).rejects.toMatchObject({ statusCode: 422 })
  })

  it("не пускает не-админа", async () => {
    const plain = await createTestUser({ email: "plain@test.local", canAdmin: false })
    await expect($fetch("/api/admin/users", {
      method: "POST",
      headers: authHeaders(plain.id),
      body: { email: "x@test.local", password: "some-password-1" },
    })).rejects.toMatchObject({ statusCode: 403 })
  })
})
```

- [ ] **Шаг 2: Прогнать тест и убедиться, что он падает**

Run: `bun run test:api tests/api/admin-user-credentials.spec.ts`
Expected: FAIL — `POST /api/admin/users` отвечает 405, обработчика нет.

- [ ] **Шаг 3: Реализовать создание учётки**

Создать `server/api/admin/users.post.ts`. Guard тот же, что в `server/api/admin/users.get.ts:6` — `requirePermission(event, "canAdmin")`, он авто-импортируется Nitro.

```ts
import { assertPasswordPolicy, hashPassword } from "~~/server/utils/auth/password"
import { localExternalId, normalizeEmail } from "~~/server/utils/auth/identity"

export default defineEventHandler(async (event) => {
  await requirePermission(event, "canAdmin")

  const body = await readBody<{
    email?: string
    password?: string
    name?: string
    surname?: string
    rolePreset?: string
    moduleAccess?: string[]
  }>(event)

  if (!body?.email || !body?.password) {
    throw createError({ statusCode: 400, message: "Email и пароль обязательны" })
  }

  const email = normalizeEmail(body.email)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw createError({ statusCode: 400, message: "Некорректный формат email" })
  }
  assertPasswordPolicy(body.password)

  const existing = await prisma.zavodUser.findUnique({ where: { email }, select: { id: true } })
  if (existing) throw createError({ statusCode: 409, message: "Пользователь с таким email уже есть" })

  const user = await prisma.zavodUser.create({
    data: {
      externalId: localExternalId(email),
      email,
      name: body.name?.trim() || null,
      surname: body.surname?.trim() || null,
      rolePreset: (body.rolePreset as never) ?? "operator",
      passwordHash: await hashPassword(body.password),
      moduleAccess: Array.isArray(body.moduleAccess) ? body.moduleAccess : [],
      isActive: true,
    },
    select: { id: true, email: true, name: true, surname: true, rolePreset: true, moduleAccess: true },
  })

  return { data: user }
})
```

- [ ] **Шаг 4: Реализовать смену пароля**

Создать `server/api/admin/users/[id]/password.put.ts`:

```ts
import { assertPasswordPolicy, hashPassword } from "~~/server/utils/auth/password"

export default defineEventHandler(async (event) => {
  await requirePermission(event, "canAdmin")

  const id = Number(getRouterParam(event, "id"))
  if (!Number.isInteger(id)) throw createError({ statusCode: 400, message: "Некорректный id" })

  const body = await readBody<{ password?: string }>(event)
  if (!body?.password) throw createError({ statusCode: 400, message: "Пароль обязателен" })
  assertPasswordPolicy(body.password)

  const user = await prisma.zavodUser.findUnique({ where: { id }, select: { id: true } })
  if (!user) throw createError({ statusCode: 404, message: "Пользователь не найден" })

  await prisma.zavodUser.update({
    where: { id },
    data: { passwordHash: await hashPassword(body.password) },
  })

  return { data: { ok: true } }
})
```

- [ ] **Шаг 5: Убрать хеш из списка пользователей**

`server/api/admin/users.get.ts:23-28` возвращает модель целиком, поэтому после Task 2 в ответ попадёт `passwordHash`. Заменить запрос на явный `select`:

```ts
    prisma.zavodUser.findMany({
      where,
      skip: offset,
      take: limit,
      orderBy: { createdAt: "desc" },
      select: {
        id: true, externalId: true, email: true, name: true, surname: true,
        rolePreset: true, roleName: true, rolePresetName: true,
        canRead: true, canWrite: true, canCreate: true, canDelete: true,
        canApprove: true, canRunAgent: true, canApplyChanges: true, canAdmin: true,
        moduleAccess: true, telegramChatId: true, isActive: true,
        lastLoginAt: true, createdAt: true, updatedAt: true,
      },
    }),
```

Затем проверить `server/api/admin/users/[id].get.ts` и `server/api/admin/users/[id].put.ts` тем же способом: если они возвращают модель целиком, добавить такой же `select`.

- [ ] **Шаг 6: Прогнать тест и убедиться, что он проходит**

Run: `bun run test:api tests/api/admin-user-credentials.spec.ts`
Expected: PASS, 4 теста.

- [ ] **Шаг 7: Коммит**

```bash
git add server/api/admin/users.post.ts "server/api/admin/users/[id]/password.put.ts" server/api/admin/users.get.ts tests/api/admin-user-credentials.spec.ts
git commit -m "feat: manage local accounts from the admin API"
```

---

### Task 6: Первый администратор и документация

**Files:**
- Create: `scripts/create-admin.ts`
- Modify: `package.json:5-30`
- Modify: `.env.example:31-42`
- Create: `docs/operations/authentication.md`
- Modify: `docs/PROJECT_CONTEXT.md`
- Modify: `AGENTS.md`

- [ ] **Шаг 1: Реализовать bootstrap-скрипт**

Создать `scripts/create-admin.ts`:

```ts
/**
 * Создаёт или обновляет локального администратора ContentFactory.
 * Запуск: bun run scripts/create-admin.ts owner@example.com "длинный пароль"
 *
 * Пароль передаётся аргументом и не пишется в логи. Скрипт идемпотентен:
 * повторный запуск обновляет пароль и права существующей учётки.
 */
import { prisma } from "../server/utils/prisma"
import { assertPasswordPolicy, hashPassword } from "../server/utils/auth/password"
import { localExternalId, normalizeEmail } from "../server/utils/auth/identity"

const [rawEmail, rawPassword] = process.argv.slice(2)

if (!rawEmail || !rawPassword) {
  console.error("Usage: bun run scripts/create-admin.ts <email> <password>")
  process.exit(1)
}

const email = normalizeEmail(rawEmail)
assertPasswordPolicy(rawPassword)

const permissions = {
  rolePreset: "admin" as const,
  canRead: true, canWrite: true, canCreate: true, canDelete: true,
  canApprove: true, canRunAgent: true, canApplyChanges: true, canAdmin: true,
  moduleAccess: ["trendwatcher", "script-generator", "video-generator", "social-upload", "analytics", "pipeline"],
  isActive: true,
}

const passwordHash = await hashPassword(rawPassword)

const user = await prisma.zavodUser.upsert({
  where: { email },
  create: { externalId: localExternalId(email), email, passwordHash, ...permissions },
  update: { passwordHash, ...permissions },
})

console.log(`Администратор готов: id=${user.id} email=${user.email}`)
await prisma.$disconnect()
```

- [ ] **Шаг 2: Добавить скрипт в package.json**

В `package.json` в блок `scripts` после строки `"seed:warmup": ...` добавить:

```json
    "create:admin": "bun run scripts/create-admin.ts",
```

- [ ] **Шаг 3: Проверить скрипт на тестовой БД**

Run: `bun run create:admin owner@contentfactory.test "bootstrap-owner-pass"`
Expected: строка `Администратор готов: id=<число> email=owner@contentfactory.test`.

Run: повторить ту же команду
Expected: та же строка с тем же id — скрипт идемпотентен.

- [ ] **Шаг 4: Описать переменные в `.env.example`**

Заменить блок про MarketingCamp (строки 41-42) на:

```dotenv
# Провайдер авторизации: local (по умолчанию) или marketingcamp.
# local — ContentFactory логинит сам, учётки создаются через админку или
# `bun run create:admin`. marketingcamp — вход делегируется родительской платформе.
AUTH_PROVIDER=local

# Нужен только при AUTH_PROVIDER=marketingcamp и для обмена creatives/ideas
# при включённом LEGACY_MARKETING_CAMP_SYNC_ENABLED.
MARKETING_CAMP_URL=
```

- [ ] **Шаг 5: Написать операционный документ**

Создать `docs/operations/authentication.md` с разделами: два провайдера и когда какой; создание первого администратора через `bun run create:admin`; создание и смена паролей через админку; политика пароля (минимум 12 символов, scrypt, соль на учётку); почему хеш никогда не отдаётся наружу; чем локальный вход отличается от dev-логина и тестового bypass'а; что делать при переходе установки с MarketingCamp на local — выставить `AUTH_PROVIDER=local` и назначить пароли существующим учёткам через `PUT /api/admin/users/:id/password`.

- [ ] **Шаг 6: Обновить контекст и правила**

В `docs/PROJECT_CONTEXT.md` в §16 в перечень сделанного добавить строку: «собственная авторизация: локальные учётки со scrypt-паролем, MarketingCamp переведён в необязательный адаптер через `AUTH_PROVIDER`».

В `AGENTS.md` в раздел `Sources of truth` добавить строку: «Авторизация: `docs/operations/authentication.md`.»

- [ ] **Шаг 7: Прогнать всё**

Run: `bun run test --config vitest.pure.config.ts`
Expected: PASS.

Run: `bun run test:unit`
Expected: PASS.

Run: `bun run test:api`
Expected: PASS.

Run: `bun run test:integration`
Expected: PASS.

Run: `bun run build`
Expected: сборка без ошибок.

Run: `git diff --check` и `git status --short`
Expected: нет висящих пробелов и незакоммиченных файлов сверх ожидаемых.

- [ ] **Шаг 8: Коммит**

```bash
git add scripts/create-admin.ts package.json .env.example docs/operations/authentication.md docs/PROJECT_CONTEXT.md AGENTS.md
git commit -m "feat: bootstrap the first local administrator"
```
