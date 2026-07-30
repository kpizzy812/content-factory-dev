# Legacy Contour Shutdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Выключить по умолчанию унаследованный от VideoCamp контур, который запрещён ТЗ или не нужен заказчику — DuoPlus/ADB-постинг, пул прокси, warmup, Google Drive и обмен идеями с MarketingCamp — не удаляя код, пока официальная замена не подтверждена на живом аккаунте.

**Architecture:** Единственный источник правды — чистый модуль `shared/utils/legacy-modules.ts`, который читает env и отдаёт карту включённых зон. Его читают три потребителя: Nitro middleware (блокирует HTTP-префиксы выключенных зон), планировщики (не поднимают воркеры выключенных зон) и клиент через `/api/product-modules` (не показывает пункты меню и элементы UI). Код зон остаётся на месте: `docs/superpowers/specs/2026-07-22-content-factory-design.md` §13 шаг 10 разрешает удаление только после подтверждённой замены.

**Tech Stack:** Nuxt 4/Nitro, TypeScript, Bun, Vitest, Prisma/PostgreSQL.

## Global Constraints

- Никаких удалений файлов, моделей Prisma и миграций. Только гейты.
- Зоны выключены по умолчанию. Включение — только явным env-флагом.
- Выключенная зона отдаёт `404`, а не `403`: наличие запрещённого контура не рекламируется наружу.
- Гейт зоны не должен ломать соседние страницы. Если UI показывал элемент выключенной зоны, элемент скрывается, а не падает с ошибкой запроса.
- Не расширять `server/automation` и не добавлять новые пути к device-постингу (`AGENTS.md`, Product boundaries).
- Изменения env документируются в `.env.example` в том же коммите.
- Тесты пишутся первыми: один падающий тест, наблюдаемый провал, минимальная реализация, повторный прогон.
- Только Bun-команды. Только Prisma-миграции, `prisma db push` запрещён.

---

### Task 1: Карта унаследованных зон

**Files:**
- Create: `tests/unit/legacy-modules.spec.ts`
- Create: `shared/utils/legacy-modules.ts`
- Modify: `vitest.pure.config.ts`

**Interfaces:**
- Produces: `LEGACY_MODULE_IDS`, тип `LegacyModuleId`, тип `LegacyModuleMap`, `readLegacyModules(env: Record<string, string | undefined>): LegacyModuleMap`, `isLegacyPathBlocked(path: string, modules: LegacyModuleMap): boolean`.

- [ ] **Шаг 1: Написать падающий тест**

Создать `tests/unit/legacy-modules.spec.ts`:

```ts
import { describe, expect, it } from "vitest"

import {
  isLegacyPathBlocked,
  LEGACY_MODULE_IDS,
  readLegacyModules,
} from "~~/shared/utils/legacy-modules"

describe("legacy module map", () => {
  it("выключает все унаследованные зоны по умолчанию", () => {
    const modules = readLegacyModules({})
    for (const id of LEGACY_MODULE_IDS) {
      expect(modules[id]).toBe(false)
    }
  })

  it("включает зону только точным значением true", () => {
    expect(readLegacyModules({ LEGACY_DEVICE_AUTOMATION_ENABLED: "true" }).deviceAutomation).toBe(true)
    expect(readLegacyModules({ LEGACY_DEVICE_AUTOMATION_ENABLED: "1" }).deviceAutomation).toBe(false)
    expect(readLegacyModules({ LEGACY_DEVICE_AUTOMATION_ENABLED: "TRUE" }).deviceAutomation).toBe(false)
    expect(readLegacyModules({ LEGACY_PROXY_POOL_ENABLED: "true" }).proxyPool).toBe(true)
    expect(readLegacyModules({ LEGACY_GOOGLE_DRIVE_ENABLED: "true" }).googleDrive).toBe(true)
    expect(readLegacyModules({ LEGACY_MARKETING_CAMP_SYNC_ENABLED: "true" }).marketingCampSync).toBe(true)
  })

  it("блокирует пути выключенных зон и пропускает включённые", () => {
    const allOff = readLegacyModules({})
    expect(isLegacyPathBlocked("/api/device-profiles", allOff)).toBe(true)
    expect(isLegacyPathBlocked("/api/posting-jobs/42/cancel", allOff)).toBe(true)
    expect(isLegacyPathBlocked("/api/warmup/sessions", allOff)).toBe(true)
    expect(isLegacyPathBlocked("/api/proxies/7/reveal", allOff)).toBe(true)
    expect(isLegacyPathBlocked("/api/google-drive", allOff)).toBe(true)
    expect(isLegacyPathBlocked("/api/ideas/sync/export", allOff)).toBe(true)

    const proxyOn = readLegacyModules({ LEGACY_PROXY_POOL_ENABLED: "true" })
    expect(isLegacyPathBlocked("/api/proxies/7/reveal", proxyOn)).toBe(false)
  })

  it("не трогает пути фабрики и соседние префиксы", () => {
    const allOff = readLegacyModules({})
    expect(isLegacyPathBlocked("/api/factory/batches", allOff)).toBe(false)
    expect(isLegacyPathBlocked("/api/videos/12", allOff)).toBe(false)
    expect(isLegacyPathBlocked("/api/ideas", allOff)).toBe(false)
    expect(isLegacyPathBlocked("/api/ideas/12", allOff)).toBe(false)
    expect(isLegacyPathBlocked("/api/proxies-report", allOff)).toBe(false)
  })
})
```

- [ ] **Шаг 2: Подключить тест в DB-free конфиг**

В `vitest.pure.config.ts` в массив `include` добавить строку после `"tests/unit/dev-auth.spec.ts",`:

```ts
      "tests/unit/legacy-modules.spec.ts",
```

- [ ] **Шаг 3: Прогнать тест и убедиться, что он падает**

Run: `bun run test --config vitest.pure.config.ts tests/unit/legacy-modules.spec.ts`
Expected: FAIL — `Failed to resolve import "~~/shared/utils/legacy-modules"`.

- [ ] **Шаг 4: Реализовать модуль**

Создать `shared/utils/legacy-modules.ts`:

```ts
/**
 * Карта унаследованных от VideoCamp зон, которые не входят в согласованный
 * контур ContentFactory. Все зоны выключены по умолчанию и включаются только
 * явным env-флагом со значением ровно "true".
 *
 * Код зон намеренно не удаляется: docs/superpowers/specs/2026-07-22-content-factory-design.md
 * §13 шаг 10 разрешает удаление только после подтверждённой официальной замены.
 */

export const LEGACY_MODULE_IDS = [
  "deviceAutomation",
  "proxyPool",
  "googleDrive",
  "marketingCampSync",
] as const

export type LegacyModuleId = typeof LEGACY_MODULE_IDS[number]
export type LegacyModuleMap = Record<LegacyModuleId, boolean>

const ENV_FLAGS: Record<LegacyModuleId, string> = {
  deviceAutomation: "LEGACY_DEVICE_AUTOMATION_ENABLED",
  proxyPool: "LEGACY_PROXY_POOL_ENABLED",
  googleDrive: "LEGACY_GOOGLE_DRIVE_ENABLED",
  marketingCampSync: "LEGACY_MARKETING_CAMP_SYNC_ENABLED",
}

/** Префиксы API, принадлежащие каждой зоне. Совпадение строгое: по сегментам пути. */
const PATH_PREFIXES: Record<LegacyModuleId, string[]> = {
  deviceAutomation: ["/api/device-profiles", "/api/posting-jobs", "/api/posting", "/api/warmup"],
  proxyPool: ["/api/proxies"],
  googleDrive: ["/api/google-drive"],
  marketingCampSync: ["/api/ideas/sync"],
}

export function readLegacyModules(env: Record<string, string | undefined>): LegacyModuleMap {
  const map = {} as LegacyModuleMap
  for (const id of LEGACY_MODULE_IDS) {
    map[id] = env[ENV_FLAGS[id]] === "true"
  }
  return map
}

function matchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`)
}

export function isLegacyPathBlocked(path: string, modules: LegacyModuleMap): boolean {
  const clean = path.split("?")[0]!
  for (const id of LEGACY_MODULE_IDS) {
    if (modules[id]) continue
    if (PATH_PREFIXES[id].some(prefix => matchesPrefix(clean, prefix))) return true
  }
  return false
}
```

- [ ] **Шаг 5: Прогнать тест и убедиться, что он проходит**

Run: `bun run test --config vitest.pure.config.ts tests/unit/legacy-modules.spec.ts`
Expected: PASS, 4 теста.

- [ ] **Шаг 6: Коммит**

```bash
git add shared/utils/legacy-modules.ts tests/unit/legacy-modules.spec.ts vitest.pure.config.ts
git commit -m "feat: add legacy module map"
```

---

### Task 2: HTTP-гейт выключенных зон

**Files:**
- Create: `tests/api/legacy-contour-gate.spec.ts`
- Create: `server/middleware/legacy-contour.ts`

**Interfaces:**
- Consumes: `readLegacyModules`, `isLegacyPathBlocked` из Task 1.
- Produces: Nitro middleware, отдающий `404` на всех путях выключенных зон до того, как отработает их обработчик.

- [ ] **Шаг 1: Написать падающий тест**

Создать `tests/api/legacy-contour-gate.spec.ts`:

```ts
import { describe, expect, it } from "vitest"
import { setup, $fetch } from "@nuxt/test-utils/e2e"

describe("legacy contour HTTP gate", async () => {
  await setup({ server: true })

  it("отдаёт 404 на путях выключенных зон", async () => {
    for (const path of ["/api/proxies", "/api/device-profiles", "/api/warmup/sessions", "/api/google-drive"]) {
      await expect($fetch(path)).rejects.toMatchObject({ statusCode: 404 })
    }
  })

  it("не трогает действующие пути фабрики", async () => {
    await expect($fetch("/api/factory/batches")).rejects.not.toMatchObject({ statusCode: 404 })
  })
})
```

- [ ] **Шаг 2: Прогнать тест и убедиться, что он падает**

Run: `bun run test:api tests/api/legacy-contour-gate.spec.ts`
Expected: FAIL — `/api/proxies` отвечает не 404 (401/403/200 в зависимости от сессии), потому что middleware ещё нет.

- [ ] **Шаг 3: Реализовать middleware**

Создать `server/middleware/legacy-contour.ts`:

```ts
import { isLegacyPathBlocked, readLegacyModules } from "~~/shared/utils/legacy-modules"

/**
 * Гасит унаследованный контур на входе. 404, а не 403: наличие запрещённого
 * ТЗ device/proxy-пути не должно быть видно снаружи.
 */
export default defineEventHandler((event) => {
  const path = event.path || ""
  if (!path.startsWith("/api/")) return

  const modules = readLegacyModules(process.env)
  if (!isLegacyPathBlocked(path, modules)) return

  throw createError({ statusCode: 404, message: "Not Found" })
})
```

- [ ] **Шаг 4: Прогнать тест и убедиться, что он проходит**

Run: `bun run test:api tests/api/legacy-contour-gate.spec.ts`
Expected: PASS, 2 теста.

- [ ] **Шаг 5: Прогнать соседние api-тесты и зафиксировать ожидаемые падения**

Run: `bun run test:api`
Expected: падают `proxies-crud.spec.ts`, `proxies-security.spec.ts`, `device-profiles-list.spec.ts`, `device-profile-accounts.spec.ts`, `posting-jobs-*.spec.ts`, `accounts-proxy-put-one-to-one.spec.ts`, `google-drive.spec.ts`, `pipeline-drive-uploader-endpoint.spec.ts` — они бьют по выключенным зонам.

- [ ] **Шаг 6: Включить зоны для этих suites через env**

В каждом из перечисленных файлов добавить env в вызов `setup`, например для `tests/api/proxies-crud.spec.ts`:

```ts
  await setup({
    server: true,
    env: {
      LEGACY_PROXY_POOL_ENABLED: "true",
    },
  })
```

Для device/posting suites использовать `LEGACY_DEVICE_AUTOMATION_ENABLED: "true"`, для drive — `LEGACY_GOOGLE_DRIVE_ENABLED: "true"`. Для `accounts-proxy-put-one-to-one.spec.ts` — `LEGACY_PROXY_POOL_ENABLED: "true"`.

- [ ] **Шаг 7: Прогнать полный api-набор**

Run: `bun run test:api`
Expected: PASS полностью.

- [ ] **Шаг 8: Коммит**

```bash
git add server/middleware/legacy-contour.ts tests/api
git commit -m "feat: gate legacy API zones behind opt-in flags"
```

---

### Task 3: Планировщики выключенных зон не стартуют

**Files:**
- Modify: `server/plugins/scheduler.ts:16-18`
- Create: `tests/unit/legacy-scheduler-gate.spec.ts`
- Create: `server/utils/legacy-scheduler.ts`

**Interfaces:**
- Consumes: `readLegacyModules` из Task 1.
- Produces: `isPostingWorkerEnabled(env)`, `isProxyHealthCheckEnabled(env)`, `isGoogleDriveSchedulerEnabled(env)` — все три возвращают `false`, пока зона не включена.

- [ ] **Шаг 1: Написать падающий тест**

Создать `tests/unit/legacy-scheduler-gate.spec.ts`:

```ts
import { describe, expect, it } from "vitest"

import {
  isGoogleDriveSchedulerEnabled,
  isPostingWorkerEnabled,
  isProxyHealthCheckEnabled,
} from "~~/server/utils/legacy-scheduler"

describe("legacy scheduler gate", () => {
  it("не поднимает воркеры выключенных зон даже при старом флаге", () => {
    const env = {
      POSTING_WORKER_ENABLED: "true",
      PROXY_HEALTH_CHECK_ENABLED: "true",
      GOOGLE_DRIVE_SCHEDULER_ENABLED: "true",
    }
    expect(isPostingWorkerEnabled(env)).toBe(false)
    expect(isProxyHealthCheckEnabled(env)).toBe(false)
    expect(isGoogleDriveSchedulerEnabled(env)).toBe(false)
  })

  it("поднимает воркер, когда зона включена и старый флаг не выключен явно", () => {
    expect(isPostingWorkerEnabled({ LEGACY_DEVICE_AUTOMATION_ENABLED: "true" })).toBe(true)
    expect(isProxyHealthCheckEnabled({ LEGACY_PROXY_POOL_ENABLED: "true" })).toBe(true)
    expect(isGoogleDriveSchedulerEnabled({ LEGACY_GOOGLE_DRIVE_ENABLED: "true" })).toBe(true)
  })

  it("оставляет старым флагам право выключить воркер внутри включённой зоны", () => {
    expect(isPostingWorkerEnabled({
      LEGACY_DEVICE_AUTOMATION_ENABLED: "true",
      POSTING_WORKER_ENABLED: "false",
    })).toBe(false)
  })
})
```

В `vitest.pure.config.ts` в `include` добавить:

```ts
      "tests/unit/legacy-scheduler-gate.spec.ts",
```

- [ ] **Шаг 2: Прогнать тест и убедиться, что он падает**

Run: `bun run test --config vitest.pure.config.ts tests/unit/legacy-scheduler-gate.spec.ts`
Expected: FAIL — `Failed to resolve import "~~/server/utils/legacy-scheduler"`.

- [ ] **Шаг 3: Реализовать гейт**

Создать `server/utils/legacy-scheduler.ts`:

```ts
import { readLegacyModules } from "~~/shared/utils/legacy-modules"

type Env = Record<string, string | undefined>

/** Зона важнее старого флага: выключенная зона не поднимает воркер никогда. */
function enabled(env: Env, zone: boolean, legacyFlag: string): boolean {
  if (!zone) return false
  return env[legacyFlag] !== "false"
}

export function isPostingWorkerEnabled(env: Env): boolean {
  return enabled(env, readLegacyModules(env).deviceAutomation, "POSTING_WORKER_ENABLED")
}

export function isProxyHealthCheckEnabled(env: Env): boolean {
  return enabled(env, readLegacyModules(env).proxyPool, "PROXY_HEALTH_CHECK_ENABLED")
}

export function isGoogleDriveSchedulerEnabled(env: Env): boolean {
  return enabled(env, readLegacyModules(env).googleDrive, "GOOGLE_DRIVE_SCHEDULER_ENABLED")
}
```

- [ ] **Шаг 4: Подключить гейт в планировщик**

В `server/plugins/scheduler.ts` заменить строки 16-18:

```ts
  const proxyHealthCheckEnabled = process.env.PROXY_HEALTH_CHECK_ENABLED !== "false"
  const postingWorkerEnabled = process.env.POSTING_WORKER_ENABLED !== "false"
  const googleDriveSchedulerEnabled = process.env.GOOGLE_DRIVE_SCHEDULER_ENABLED !== "false"
```

на:

```ts
  const proxyHealthCheckEnabled = isProxyHealthCheckEnabled(process.env)
  const postingWorkerEnabled = isPostingWorkerEnabled(process.env)
  const googleDriveSchedulerEnabled = isGoogleDriveSchedulerEnabled(process.env)
```

И добавить импорт после существующего импорта `refreshDriveFileMetadata` (строка 7):

```ts
import {
  isGoogleDriveSchedulerEnabled,
  isPostingWorkerEnabled,
  isProxyHealthCheckEnabled,
} from "../utils/legacy-scheduler"
```

- [ ] **Шаг 5: Прогнать тест и убедиться, что он проходит**

Run: `bun run test --config vitest.pure.config.ts tests/unit/legacy-scheduler-gate.spec.ts`
Expected: PASS, 3 теста.

- [ ] **Шаг 6: Коммит**

```bash
git add server/utils/legacy-scheduler.ts server/plugins/scheduler.ts tests/unit/legacy-scheduler-gate.spec.ts vitest.pure.config.ts
git commit -m "feat: stop legacy workers unless their zone is enabled"
```

---

### Task 4: Навигация и UI не показывают выключенные зоны

**Files:**
- Create: `server/api/product-modules.get.ts`
- Create: `app/composables/useLegacyModules.ts`
- Modify: `app/layouts/default.vue:40` и `app/layouts/default.vue:48-51`
- Create: `tests/unit/legacy-navigation-contract.spec.ts`

**Interfaces:**
- Consumes: `readLegacyModules`, `LegacyModuleMap` из Task 1.
- Produces: `GET /api/product-modules` → `{ data: LegacyModuleMap }`; composable `useLegacyModules(): Ref<LegacyModuleMap>`.

- [ ] **Шаг 1: Написать падающий тест**

Создать `tests/unit/legacy-navigation-contract.spec.ts`:

```ts
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const file = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8")

describe("legacy navigation contract", () => {
  it("публикует карту зон для клиента", () => {
    expect(existsSync(resolve(process.cwd(), "server/api/product-modules.get.ts"))).toBe(true)
    expect(existsSync(resolve(process.cwd(), "app/composables/useLegacyModules.ts"))).toBe(true)
  })

  it("прячет пункты меню выключенных зон", () => {
    const layout = file("app/layouts/default.vue")
    expect(layout).toContain("useLegacyModules")
    expect(layout).toContain("legacyModules.value.deviceAutomation")
    expect(layout).toContain("legacyModules.value.proxyPool")
    expect(layout).toContain("legacyModules.value.googleDrive")
  })
})
```

В `vitest.pure.config.ts` в `include` добавить:

```ts
      "tests/unit/legacy-navigation-contract.spec.ts",
```

- [ ] **Шаг 2: Прогнать тест и убедиться, что он падает**

Run: `bun run test --config vitest.pure.config.ts tests/unit/legacy-navigation-contract.spec.ts`
Expected: FAIL — файла `server/api/product-modules.get.ts` не существует.

- [ ] **Шаг 3: Реализовать endpoint**

Создать `server/api/product-modules.get.ts`:

```ts
import { readLegacyModules } from "~~/shared/utils/legacy-modules"

/**
 * Карта включённых унаследованных зон для клиента. Это не секрет, а конфигурация
 * поставки: интерфейс не должен предлагать то, что сервер отдаёт как 404.
 */
export default defineEventHandler(() => {
  return { data: readLegacyModules(process.env) }
})
```

- [ ] **Шаг 4: Реализовать composable**

Создать `app/composables/useLegacyModules.ts`:

```ts
import type { LegacyModuleMap } from '~~/shared/utils/legacy-modules'
import { LEGACY_MODULE_IDS } from '~~/shared/utils/legacy-modules'

const ALL_OFF = Object.fromEntries(LEGACY_MODULE_IDS.map(id => [id, false])) as LegacyModuleMap

export function useLegacyModules() {
  const state = useState<LegacyModuleMap>('legacy-modules', () => ({ ...ALL_OFF }))

  const load = async () => {
    try {
      const response = await $fetch<{ data: LegacyModuleMap }>('/api/product-modules')
      state.value = response.data
    } catch {
      state.value = { ...ALL_OFF }
    }
  }

  return { legacyModules: state, loadLegacyModules: load }
}
```

- [ ] **Шаг 5: Подключить в навигацию**

В `app/layouts/default.vue` после строки 5 (`const { can, canAccessModule } = usePermissions()`) добавить:

```ts
const { legacyModules, loadLegacyModules } = useLegacyModules()
// Без await: navGroups — computed и сам перерисуется, когда карта приедет.
// Стартовое состояние «всё выключено», поэтому запрещённые пункты не мигают.
loadLegacyModules()
```

Заменить строку 40:

```ts
  if (canAccessModule('trendwatcher')) production.push({ to: '/google-drive', label: 'Google Drive', icon: 'mingcute:cloud-line', module: 'trendwatcher' })
```

на:

```ts
  if (canAccessModule('trendwatcher') && legacyModules.value.googleDrive) production.push({ to: '/google-drive', label: 'Google Drive', icon: 'mingcute:cloud-line', module: 'trendwatcher' })
```

Заменить строки 48, 50 и 51:

```ts
  if (canAccessModule('social-upload')) media.push({ to: '/posting-jobs', label: 'Постинг', icon: 'mingcute:send-line', module: 'social-upload' })
  if (canAccessModule('social-upload')) media.push({ to: '/proxies', label: 'Прокси', icon: 'mingcute:wifi-line', module: 'social-upload' })
  if (canAccessModule('social-upload')) media.push({ to: '/devices', label: 'DuoPlus', icon: 'mingcute:safari-line', module: 'social-upload' })
```

на:

```ts
  if (canAccessModule('social-upload') && legacyModules.value.deviceAutomation) media.push({ to: '/posting-jobs', label: 'Постинг', icon: 'mingcute:send-line', module: 'social-upload' })
  if (canAccessModule('social-upload') && legacyModules.value.proxyPool) media.push({ to: '/proxies', label: 'Прокси', icon: 'mingcute:wifi-line', module: 'social-upload' })
  if (canAccessModule('social-upload') && legacyModules.value.deviceAutomation) media.push({ to: '/devices', label: 'DuoPlus', icon: 'mingcute:safari-line', module: 'social-upload' })
```

- [ ] **Шаг 6: Прогнать тест и убедиться, что он проходит**

Run: `bun run test --config vitest.pure.config.ts tests/unit/legacy-navigation-contract.spec.ts`
Expected: PASS, 2 теста.

- [ ] **Шаг 7: Проверить страницу аккаунтов вручную**

Run: `bun run dev`
Открыть `/accounts` и убедиться, что страница грузится без ошибок при выключенном `LEGACY_PROXY_POOL_ENABLED`. Если страница делает запрос к `/api/proxies` и показывает ошибку — обернуть этот блок в `v-if="legacyModules.proxyPool"` в `app/pages/accounts/index.vue` и повторить проверку.

- [ ] **Шаг 8: Коммит**

```bash
git add server/api/product-modules.get.ts app/composables/useLegacyModules.ts app/layouts/default.vue app/pages/accounts/index.vue tests/unit/legacy-navigation-contract.spec.ts vitest.pure.config.ts
git commit -m "feat: hide legacy zones from navigation"
```

---

### Task 5: Документация и полная верификация

**Files:**
- Modify: `.env.example:154-161`
- Modify: `.env.example:240-242`
- Modify: `docs/PROJECT_CONTEXT.md`
- Create: `docs/operations/legacy-contour.md`

- [ ] **Шаг 1: Описать флаги в `.env.example`**

Добавить блок перед строкой 154 (`# Proxy health check (Social Automation).`):

```dotenv
# ─── Унаследованный контур VideoCamp ───────────────────────────────────────
# Все зоны выключены по умолчанию. Включение — только значением ровно "true".
# Выключенная зона отдаёт 404 на своих API и не показывается в навигации.
# Удалять код зон нельзя, пока официальная замена не подтверждена на живом
# аккаунте (docs/superpowers/specs/2026-07-22-content-factory-design.md, §13 шаг 10).
LEGACY_DEVICE_AUTOMATION_ENABLED=false
LEGACY_PROXY_POOL_ENABLED=false
LEGACY_GOOGLE_DRIVE_ENABLED=false
LEGACY_MARKETING_CAMP_SYNC_ENABLED=false
```

Рядом со старыми флагами `PROXY_HEALTH_CHECK_ENABLED`, `POSTING_WORKER_ENABLED` и `GOOGLE_DRIVE_SCHEDULER_ENABLED` дописать по одной строке комментария: `# Работает только внутри включённой зоны, см. LEGACY_*_ENABLED выше.`

- [ ] **Шаг 2: Написать операционный документ**

Создать `docs/operations/legacy-contour.md` с разделами: список зон и что в каждую входит (модели Prisma, API-префиксы, страницы, планировщики); как временно включить зону и зачем это может понадобиться; почему зоны не удалены; условие удаления — подтверждённый Meta canary для device-постинга и собственная авторизация для MarketingCamp.

- [ ] **Шаг 3: Обновить контекст проекта**

В `docs/PROJECT_CONTEXT.md` в §16 в абзац о том, что не сделано, добавить предложение: «Унаследованный контур DuoPlus/ADB, прокси, warmup, Google Drive и обмен идеями с MarketingCamp выключен по умолчанию через флаги `LEGACY_*_ENABLED`, код сохранён до подтверждения официальной замены.»

- [ ] **Шаг 4: Прогнать всё**

Run: `bun run test --config vitest.pure.config.ts`
Expected: PASS.

Run: `bun run test:unit`
Expected: PASS.

Run: `bun run test:api`
Expected: PASS.

Run: `bun run build`
Expected: сборка без ошибок.

- [ ] **Шаг 5: Проверить, что запрещённый контур не стартует**

Run: `SCHEDULERS_ENABLED=true bun run dev`
Expected: в логе старта нет строк о posting worker, proxy health check и Google Drive sync.

- [ ] **Шаг 6: Коммит**

```bash
git add .env.example docs/operations/legacy-contour.md docs/PROJECT_CONTEXT.md
git commit -m "docs: document the legacy contour shutdown"
```
