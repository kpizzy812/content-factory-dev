# История прокси-функционала ZavodCamp

Документ собирает всё, что касается прокси-подсистемы, в хронологическом порядке трёх ключевых коммитов. Внутри каждой главы — модели БД, бэкенд-утилиты, REST API, фронтенд-компоненты, страницы, composables, стор, scheduler и тестовые скрипты, появившиеся именно в этом коммите.

В проекте нет страницы `/admin/proxy` — прокси живут в разделе `/proxies` (доступ через `module-access` middleware с `moduleSlug: "social-upload"`), плюс вкладка "Прокси" в `AccountEditModal` и picker в `AccountProxyPicker`. Везде, где упоминаются "admin/proxy", речь о пути `app/components/proxy/*` и `server/api/proxies/*`.

## Оглавление

- [Глава 1 — `85a356e`: Social Automation Foundation (29.04.2026)](#глава-1--85a356e-social-automation-foundation-29042026)
  - [Схема БД и миграция](#11-схема-бд-и-миграция)
  - [Shared types](#12-shared-types)
  - [Backend: probe + checker + DTO](#13-backend-probe--checker--dto)
  - [REST API (11 endpoints)](#14-rest-api-11-endpoints)
  - [Scheduler integration](#15-scheduler-integration)
  - [Frontend: composables и store](#16-frontend-composables-и-store)
  - [Frontend: UI компоненты](#17-frontend-ui-компоненты)
  - [Frontend: страница `/proxies`](#18-frontend-страница-proxies)
  - [Smoke test](#19-smoke-test-scriptstest-proxy-checkerts)
- [Глава 2 — `cfef3b6`: Глубокая диагностика (14.05.2026)](#глава-2--cfef3b6-глубокая-диагностика-14052026)
  - [Probe.ts: warn-логирование leak](#21-probets-warn-логирование-leak)
  - [Backend: diagnostic.ts (540 строк)](#22-backend-diagnosticts-540-строк)
  - [REST API endpoint](#23-rest-api-endpoint)
  - [Frontend: ProxyDiagnoseModal](#24-frontend-proxydiagnosemodal)
  - [Frontend: интеграция в ProxyCard и страницу](#25-frontend-интеграция-в-proxycard-и-страницу)
  - [Smoke test](#26-smoke-test-scriptstest-proxy-diagnosticts)
- [Глава 3 — `4319d85`: Alert dedup + bulk check (30.04.2026)](#глава-3--4319d85-alert-dedup--bulk-check-30042026)
  - [Миграция и схема](#31-миграция-и-схема)
  - [Shared types: ProxyAlertReason / Summary](#32-shared-types-proxyalertreason--summary)
  - [Backend: alert-dedup.ts](#33-backend-alert-deduppts)
  - [Backend: DTO интеграция](#34-backend-dto-интеграция)
  - [REST API: check-all](#35-rest-api-check-all)
  - [Scheduler: dedup wiring](#36-scheduler-dedup-wiring)
  - [Frontend: composable extension](#37-frontend-composable-extension)
  - [Frontend: ProxyCard alert tooltip](#38-frontend-proxycard-alert-tooltip)
  - [Frontend: /proxies — кнопка "Проверить все"](#39-frontend-proxies--кнопка-проверить-все)
  - [Smoke test](#310-smoke-test-scriptstest-alert-deduplts)

---

## Глава 1 — `85a356e`: Social Automation Foundation (29.04.2026)

> Первый коммит, в котором прокси-подсистема появилась целиком: модели БД, шифрование, probe + leak detection, 11 endpoints, 5 UI компонентов, страница `/proxies`, scheduler-задача и smoke-тест.

### 1.1 Схема БД и миграция

Новые модели в `prisma/schema.prisma` и миграция (см. файл миграции `prisma/migrations/...add_proxy_models/migration.sql`):

```prisma
enum ProxyType {
  mobile
  residential
  datacenter
}

enum ProxyStatus {
  unverified
  healthy
  degraded
  dead
  expired
}

model Proxy {
  id                  String             @id @default(cuid())
  label               String
  provider            String? // 'iproyal' | 'proxyempire' | 'mobile_proxy_space' | 'other'
  type                ProxyType
  // Зашифрованные credentials (AES-256-GCM)
  host                String
  port                Int
  username            String?
  password            String?
  rotationUrl         String?
  expectedCountry     String?
  expectedCity        String?
  status              ProxyStatus        @default(unverified)
  lastCheckedAt       DateTime?
  lastCheckResult     Json?
  consecutiveFailures Int                @default(0)
  monthlyTrafficGB    Float?
  expiresAt           DateTime?
  createdById         Int
  notes               String?
  createdAt           DateTime           @default(now())
  updatedAt           DateTime           @updatedAt
  socialAccounts      SocialAccount[]
  healthChecks        ProxyHealthCheck[]

  @@index([status])
  @@index([type, status])
  @@index([createdById])
}

model ProxyHealthCheck {
  id              String   @id @default(cuid())
  proxyId         String
  proxy           Proxy    @relation(fields: [proxyId], references: [id], onDelete: Cascade)
  checkedAt       DateTime @default(now())
  triggeredBy     String   // 'manual' | 'scheduled' | 'pre_session'
  tcpConnectOk    Boolean
  httpProbeOk     Boolean
  detectedIp      String?
  detectedCountry String?
  detectedCity    String?
  latencyMs       Int?
  isLeaking       Boolean?
  errorCategory   String?
  errorMessage    String?
  rawProbeData    Json?

  @@index([proxyId, checkedAt(sort: Desc)])
}
```

Также `SocialAccount` получил `proxyId String?` + relation на `Proxy`.

### 1.2 Shared types

`shared/types/proxy.ts` — типы, разделяемые между фронтом и бэком:

```ts
export type ProxyType = "mobile" | "residential" | "datacenter"
export type ProxyProtocol = "http" | "https" | "socks5"
export type ProxyStatus = "unverified" | "healthy" | "degraded" | "dead" | "expired"
export type ProxyCheckTrigger = "manual" | "scheduled" | "pre_session"
export type ProxyCheckErrorCategory =
  | "timeout"
  | "connection_refused"
  | "auth_failed"
  | "leak"
  | "private_ip"
  | "unknown"

export interface ProxyCredentials {
  protocol: ProxyProtocol
  host: string
  port: number
  username?: string
  password?: string
}

export interface ProxyCheckResult {
  tcpConnectOk: boolean
  httpProbeOk: boolean
  detectedIp?: string
  detectedCountry?: string
  detectedCity?: string
  latencyMs?: number
  isLeaking?: boolean
  errorCategory?: ProxyCheckErrorCategory
  errorMessage?: string
  rawProbeData?: unknown
}

/** DTO для API responses (host маскируется через maskHost). */
export interface ProxyDto {
  id: string
  label: string
  provider: string | null
  type: ProxyType
  protocol: ProxyProtocol
  hostMasked: string
  port: number
  hasCredentials: boolean
  hasRotationUrl: boolean
  expectedCountry: string | null
  expectedCity: string | null
  status: ProxyStatus
  lastCheckedAt: string | null
  consecutiveFailures: number
  monthlyTrafficGB: number | null
  expiresAt: string | null
  notes: string | null
  attachedAccountsCount: number
  createdAt: string
  updatedAt: string
}

export interface ProxyHealthCheckDto { /* зеркало ProxyHealthCheck row */ }
export interface ProxyCreateInput {
  label: string
  provider?: string | null
  type: ProxyType
  protocol?: ProxyProtocol
  host: string
  port: number
  username?: string | null
  password?: string | null
  rotationUrl?: string | null
  expectedCountry?: string | null
  expectedCity?: string | null
  monthlyTrafficGB?: number | null
  expiresAt?: string | null
  notes?: string | null
}
export type ProxyUpdateInput = Partial<ProxyCreateInput>

/** Парсер строки "[scheme://]host:port[:user:pass]" для быстрого ввода в UI. */
export function parseProxyString(input: string): { protocol?, host, port, username?, password? } | null
```

### 1.3 Backend: probe + checker + DTO

#### `server/utils/proxy/probe.ts`

В первом коммите содержал базовый набор:

- `tcpConnect(host, port)` — TCP-handshake через `node:net` с таймаутом 10 сек.
- `getServerIp()` — внешний IP сервера через `https://api.ipify.org` (для leak detection), кеш в module-scope.
- `fetchJson(url, agent, timeoutMs)` — низкоуровневый GET через `http.request` / `https.request` (явный `options` object, чтобы Node правильно мерджил agent).
- `buildProxyUrl(creds)` — URL прокси с auth (`scheme://user:pass@host:port`).
- `buildHttpsAgent(creds)` — `HttpsProxyAgent` для CONNECT-туннеля.
- `buildHttpAgent(creds)` — `HttpProxyAgent` для forward HTTP.
- `classifyProbeError(err)` — категоризация ошибок (`timeout`, `auth_failed`, `connection_refused`, и т.д.).
- `isPrivateIp(ip)` — детекция приватных диапазонов.
- `checkProxy(creds)` — главная функция, шаги:
  1. TCP connect.
  2. HTTPS probe через CONNECT (`https://ipinfo.io/json`) — даёт `detectedIp / country / city / latencyMs`.
  3. Fallback HTTP forward probe (`http://api.ipify.org`).
  4. Leak detection: сравнение `probe.ip` c `getServerIp()`.
  5. Приватный IP → `isLeaking=true, errorCategory="private_ip"`.

Полный текст сильно эволюционировал в последующих коммитах (multi-source consensus, header probe, mock mode, SOCKS5 lib path). Актуальная версия — в файле `server/utils/proxy/probe.ts` (~720 строк).

#### `server/utils/proxy/proxy-checker.ts`

```ts
const STALE_CHECK_THRESHOLD_MS = 60 * 60 * 1000

function computeProxyStatus(result: ProxyCheckResult, prevFails: number): ProxyStatus {
  if (result.httpProbeOk && !result.isLeaking) return "healthy"
  const fails = prevFails + 1
  if (fails >= 3) return "dead"
  return "degraded"
}

/**
 * Запускает проверку прокси, сохраняет результат в ProxyHealthCheck,
 * обновляет Proxy.status / lastCheckedAt / consecutiveFailures.
 * Используется ручной кнопкой /check, scheduler'ом и pre_session ассертом.
 */
export async function runProxyHealthCheck(
  proxyId: string,
  triggeredBy: ProxyCheckTrigger,
): Promise<ProxyCheckResult> {
  const proxy = await prisma.proxy.findUniqueOrThrow({ where: { id: proxyId } })

  const result = await checkProxy({
    protocol: proxy.protocol,
    host: decryptSecret(proxy.host),
    port: proxy.port,
    username: proxy.username ? decryptSecret(proxy.username) : undefined,
    password: proxy.password ? decryptSecret(proxy.password) : undefined,
  })

  await prisma.proxyHealthCheck.create({
    data: {
      proxyId,
      triggeredBy,
      tcpConnectOk: result.tcpConnectOk,
      httpProbeOk: result.httpProbeOk,
      detectedIp: result.detectedIp ?? null,
      detectedCountry: result.detectedCountry ?? null,
      detectedCity: result.detectedCity ?? null,
      latencyMs: result.latencyMs ?? null,
      isLeaking: result.isLeaking ?? null,
      errorCategory: result.errorCategory ?? null,
      errorMessage: result.errorMessage ?? null,
      rawProbeData: (result.rawProbeData ?? null) as never,
    },
  })

  const consecutiveFailures =
    result.httpProbeOk && !result.isLeaking ? 0 : proxy.consecutiveFailures + 1
  const newStatus = computeProxyStatus(result, proxy.consecutiveFailures)

  await prisma.proxy.update({
    where: { id: proxyId },
    data: {
      status: newStatus,
      lastCheckedAt: new Date(),
      lastCheckResult: result as never,
      consecutiveFailures,
    },
  })

  return result
}

/**
 * Обязательный ассерт перед сессией использующей прокси.
 * Если stale (>1ч) или status != healthy → re-check.
 * При re-fail throw 503 — Indigo НЕ запустится.
 */
export async function assertProxyHealthyBeforeSession(proxyId: string): Promise<void> { /* ... */ }
```

#### `server/utils/proxy/dto.ts`

```ts
export function toProxyDto(proxy: Proxy, attachedAccountsCount: number): ProxyDto {
  return {
    id: proxy.id,
    label: proxy.label,
    provider: proxy.provider,
    type: proxy.type,
    protocol: proxy.protocol,
    hostMasked: maskHost(decryptSecret(proxy.host)),
    port: proxy.port,
    hasCredentials: !!proxy.username && !!proxy.password,
    hasRotationUrl: !!proxy.rotationUrl,
    expectedCountry: proxy.expectedCountry,
    expectedCity: proxy.expectedCity,
    status: proxy.status,
    lastCheckedAt: proxy.lastCheckedAt?.toISOString() ?? null,
    consecutiveFailures: proxy.consecutiveFailures,
    monthlyTrafficGB: proxy.monthlyTrafficGB,
    expiresAt: proxy.expiresAt?.toISOString() ?? null,
    notes: proxy.notes,
    attachedAccountsCount,
    createdAt: proxy.createdAt.toISOString(),
    updatedAt: proxy.updatedAt.toISOString(),
  }
}

export function toProxyHealthCheckDto(row: ProxyHealthCheck): ProxyHealthCheckDto { /* зеркало */ }
```

`maskHost(decryptSecret(...))` гарантирует, что host наружу уходит маскированным (`pro***.example.com`), даже если в БД зашифрован.

### 1.4 REST API (11 endpoints)

Все защищены `requireScopedAccess(event, { permissions, moduleSlug: "social-upload" })`.

| Метод  | Путь                              | Permissions    | Назначение |
|--------|-----------------------------------|----------------|------------|
| GET    | `/api/proxies`                    | `canRead`      | Список + фильтры (`status`, `type`, `search`) |
| POST   | `/api/proxies`                    | `canCreate`    | Создание (шифрование host/username/password/rotationUrl) |
| GET    | `/api/proxies/:id`                | `canRead`      | Детали без расшифровки секретов |
| PUT    | `/api/proxies/:id`                | `canWrite`     | Частичное обновление (атомарная пара username/password) |
| DELETE | `/api/proxies/:id`                | `canDelete`    | 409 если есть привязанные аккаунты |
| POST   | `/api/proxies/:id/check`          | `canWrite`     | Ручной запуск `runProxyHealthCheck(id, "manual")` |
| GET    | `/api/proxies/:id/checks`         | `canRead`      | История (последние 50 по `checkedAt desc`) |
| POST   | `/api/proxies/:id/reveal`         | `canRead`      | Расшифровка с audit-логом (reason ≥ 10 символов) |
| PUT    | `/api/accounts/:id/proxy`         | `canWrite`     | Привязка прокси к аккаунту (`{ proxyId: string \| null }`) |
| PUT    | `/api/accounts/:id/credentials`   | `canWrite`     | Связан с прокси косвенно (доступы) |
| POST   | `/api/accounts/:id/credentials/reveal` | `canRead` | Связан с прокси косвенно |

Ключевые куски:

**`POST /api/proxies`** (`server/api/proxies/index.post.ts`):

```ts
export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ["canCreate"],
    moduleSlug: "social-upload",
  })
  const body = await readBody<ProxyCreateInput>(event)
  // label: string ≤ 120, type ∈ {mobile, residential, datacenter}
  // host: string ≤ 253, port: integer 1..65535
  // username и password — оба или ни одного (atomic pair)
  // ...валидация...

  const proxy = await prisma.proxy.create({
    data: {
      label: body.label.trim(),
      provider: body.provider?.trim() || null,
      type: body.type,
      host: encryptSecret(body.host.trim()),
      port: body.port,
      username: hasUsername ? encryptSecret(body.username as string) : null,
      password: hasPassword ? encryptSecret(body.password as string) : null,
      rotationUrl: body.rotationUrl ? encryptSecret(body.rotationUrl) : null,
      expectedCountry: body.expectedCountry?.trim() || null,
      expectedCity: body.expectedCity?.trim() || null,
      monthlyTrafficGB: body.monthlyTrafficGB ?? null,
      expiresAt,
      notes: body.notes?.trim() || null,
      createdById: user.id,
    },
  })

  setResponseStatus(event, 201)
  return { data: toProxyDto(proxy, 0) }
})
```

**`GET /api/proxies`** (`server/api/proxies/index.get.ts`):

```ts
const where: Prisma.ProxyWhereInput = {}
if (typeof query.status === "string" && VALID_STATUSES.includes(query.status))
  where.status = query.status as ProxyStatus
if (typeof query.type === "string" && VALID_TYPES.includes(query.type))
  where.type = query.type as ProxyType
if (typeof query.search === "string" && query.search.trim()) {
  const term = query.search.trim()
  where.OR = [
    { label: { contains: term, mode: "insensitive" } },
    { provider: { contains: term, mode: "insensitive" } },
    { expectedCountry: { contains: term, mode: "insensitive" } },
  ]
}
const proxies = await prisma.proxy.findMany({
  where,
  orderBy: { createdAt: "desc" },
  include: { _count: { select: { socialAccounts: true } } },
})
return { data: proxies.map((p) => toProxyDto(p, p._count.socialAccounts)) }
```

**`POST /api/proxies/:id/check`** (`server/api/proxies/[id]/check.post.ts`):

```ts
const proxy = await prisma.proxy.findUnique({ where: { id }, select: { id: true } })
if (!proxy) throw createError({ statusCode: 404, message: "Прокси не найден" })
const result = await runProxyHealthCheck(id, "manual")
return { data: result }
```

**`GET /api/proxies/:id/checks`** — `take: 50, orderBy: { checkedAt: "desc" }`.

**`POST /api/proxies/:id/reveal`** (`server/api/proxies/[id]/reveal.post.ts`):

```ts
const reason = typeof body?.reason === "string" ? body.reason.trim() : ""
if (reason.length < 10 || reason.length > 500) {
  throw createError({ statusCode: 400, message: "Укажите причину доступа (минимум 10 символов)" })
}
const proxy = await prisma.proxy.findUnique({ where: { id } })
const ctx = buildSecretAccessContext(event, user, reason)

const host = await readSecret(proxy.host,
  { entityType: "Proxy.host", entityId: proxy.id, action: "view" }, ctx)
const username = await readSecret(proxy.username,
  { entityType: "Proxy.username", entityId: proxy.id, action: "view" }, ctx)
const password = await readSecret(proxy.password,
  { entityType: "Proxy.password", entityId: proxy.id, action: "view" }, ctx)
const rotationUrl = await readSecret(proxy.rotationUrl,
  { entityType: "Proxy.rotationUrl", entityId: proxy.id, action: "view" }, ctx)

const formatted = [host, String(proxy.port), username, password]
  .filter((v): v is string => typeof v === "string" && v.length > 0)
  .join(":")

return { data: { host, port: proxy.port, username, password, rotationUrl, formatted } }
```

`readSecret(...)` пишет audit-row в `SecretAccessLog` (entityType + entityId + reason + userId + IP).

**`DELETE /api/proxies/:id`** — 409 если `proxy._count.socialAccounts > 0` ("отвяжите перед удалением").

**`PUT /api/proxies/:id`** — валидирует пары username/password атомарно (нельзя поменять одно без другого), шифрует только переданные поля, остальные не трогает.

**`PUT /api/accounts/:id/proxy`** — body `{ proxyId: string | null }`, проверяет существование аккаунта и прокси, делает `prisma.socialAccount.update({ where: { id }, data: { proxyId } })`.

### 1.5 Scheduler integration

В `server/plugins/scheduler.ts` появился **5-й setInterval** (включается по `config.proxyHealthCheckEnabled`):

```ts
if (config.proxyHealthCheckEnabled) {
  const proxyHealthTimer = setInterval(async () => {
    try {
      const staleMs = config.schedulerProxyHealthStaleMs as number
      const threshold = new Date(Date.now() - staleMs)

      const candidates = await prisma.proxy.findMany({
        where: {
          status: { not: "expired" },
          OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: threshold } }],
        },
        select: { id: true, label: true, consecutiveFailures: true },
        take: 50,
      })

      if (candidates.length === 0) return
      let leakCount = 0, deadCount = 0

      for (const proxy of candidates) {
        try {
          const result = await runProxyHealthCheck(proxy.id, "scheduled")
          if (result.isLeaking) {
            leakCount += 1
            await sendTelegramAlert(
              "critical_error",
              `Прокси ${proxy.label} подозревается на утечку IP`,
              sanitizeForLog({ proxyId: proxy.id, label: proxy.label, errorCategory: result.errorCategory, errorMessage: result.errorMessage }) as string,
            ).catch(() => {})
          } else if (!result.httpProbeOk && proxy.consecutiveFailures + 1 >= 3) {
            deadCount += 1
            await sendTelegramAlert(
              "critical_error",
              `Прокси ${proxy.label} помечен dead (3+ провала подряд)`,
              sanitizeForLog({ /* ... */ }) as string,
            ).catch(() => {})
          }
        } catch (err) { /* logAgent */ }
        await new Promise((r) => setTimeout(r, 5_000)) // 5с пауза между проверками
      }

      await logAgent("scheduler", "info",
        `Proxy health: проверено ${candidates.length}, leak=${leakCount}, dead=${deadCount}`)
    } catch (err) { /* ... */ }
  }, config.schedulerProxyHealthIntervalMs as number) // дефолт 4 часа
  timers.push(proxyHealthTimer)
}
```

В коммите 4319d85 этот код будет обернут в `shouldSendAlert` + `recordAlert` (см. главу 3).

### 1.6 Frontend: composables и store

#### `app/composables/useProxies.ts`

```ts
export function useProxies() {
  const filters = useProxyFiltersStore()
  return useFetch<{ data: ProxyDto[] }>("/api/proxies", {
    query: computed(() => filters.query),
  })
}
```

Реактивно перефетчит при изменении фильтров через `query: computed`.

#### `app/composables/useProxyActions.ts` (версия 85a356e — без `checkAllProxies`)

```ts
export function useProxyActions() {
  const isBusy = ref(false)
  const error = ref<string | null>(null)

  async function createProxy(input: ProxyCreateInput): Promise<ProxyDto | null>
  async function updateProxy(id, input): Promise<ProxyDto | null>
  async function deleteProxy(id): Promise<boolean>
  async function checkProxy(id): Promise<ProxyCheckResult | null>
  async function getCheckHistory(id): Promise<ProxyHealthCheckDto[]>
  async function revealProxy(id, reason): Promise<RevealedProxyCredentials | null>

  return { isBusy, error, createProxy, updateProxy, deleteProxy, checkProxy, getCheckHistory, revealProxy }
}
```

Все методы выставляют `isBusy` и нормализуют ошибки через `extractError(e)` (`e.data.message` → `e.message` → "Неизвестная ошибка").

#### `app/stores/proxyFilters.ts`

```ts
export const useProxyFiltersStore = defineStore("proxyFilters", () => {
  const status = ref<ProxyStatus | "">("")
  const type = ref<ProxyType | "">("")
  const search = ref<string>("")
  const query = computed(() => ({
    ...(status.value ? { status: status.value } : {}),
    ...(type.value ? { type: type.value } : {}),
    ...(search.value.trim() ? { search: search.value.trim() } : {}),
  }))
  function reset() { status.value = ""; type.value = ""; search.value = "" }
  return { status, type, search, query, reset }
})
```

### 1.7 Frontend: UI компоненты

Из коммита `85a356e` родились 5 компонентов в `app/components/proxy/` + `AccountProxyPicker.vue`.

#### `ProxyHealthBadge.vue`

Простой badge с конфигом по статусу:

```ts
const config: Record<ProxyStatus, { label, badgeClass, icon }> = {
  unverified: { label: "Не проверен", badgeClass: "badge-ghost", icon: "mingcute:question-line" },
  healthy:    { label: "Здоров",     badgeClass: "badge-success", icon: "mingcute:check-circle-line" },
  degraded:   { label: "Деградирует", badgeClass: "badge-warning", icon: "mingcute:warning-line" },
  dead:       { label: "Мёртв",      badgeClass: "badge-error",   icon: "mingcute:close-circle-line" },
  expired:    { label: "Истёк",      badgeClass: "badge-neutral", icon: "mingcute:time-line" },
}
```

```html
<span class="badge gap-1" :class="[current.badgeClass, sizeClass]">
  <Icon :name="current.icon" class="text-xs" />
  {{ current.label }}
</span>
```

#### `ProxyCard.vue` (исходная версия)

Карточка прокси с emits `updated | deleted | edit | history | reveal`, кнопками "Проверить / История / Креды / Редактировать / Удалить" и confirm-диалогом на удаление. (Кнопки `Diagnose` и блока alert-summary в этом коммите ещё не было — добавятся в `cfef3b6` и `4319d85`.)

Главное вычисление:

```ts
const typeConfig: Record<ProxyDto["type"], { label, icon }> = {
  mobile:      { label: "Mobile",      icon: "mingcute:cellphone-line" },
  residential: { label: "Residential", icon: "mingcute:home-3-line" },
  datacenter:  { label: "Datacenter",  icon: "mingcute:server-line" },
}
const lastCheckedLabel = computed(() => /* ru-RU localeString из proxy.lastCheckedAt */)
const expiresLabel     = computed(() => /* ru-RU date из proxy.expiresAt */)
const locationLabel    = computed(() => [country, city].filter(Boolean).join(", "))

async function handleCheck() {
  isChecking.value = true
  try {
    const result = await checkProxy(props.proxy.id)
    if (result) emit("updated")
  } finally { isChecking.value = false }
}

async function handleDelete() {
  const ok = await deleteProxy(props.proxy.id)
  if (ok) { showDeleteConfirm.value = false; emit("deleted") }
}
```

Разметка собрана из DaisyUI: `card bg-base-100 shadow-sm` + `card-body`, заголовок с label/provider справа `ProxyHealthBadge`, ниже badges типа/протокола/хоста, метаданные (locale, accounts, last check, expires, failures), `card-actions` с кнопками-действиями и `dialog.modal` для confirm удаления.

#### `ProxyAddModal.vue`

Двухрежимный modal (create / edit) с полями:
- `label*`, `provider` (select из IPRoyal/ProxyEmpire/Mobile Proxy Space/other),
- `type*` (radio mobile/residential/datacenter),
- `protocol*` (radio http/https/socks5),
- `shortcut` — быстрый ввод `host:port:user:pass` или `socks5://user:pass@host:port` (через `parseProxyString` watcher автоматически заполняет поля),
- `host`, `port` (1..65535),
- `username`, `password`,
- `rotationUrl`,
- `expectedCountry`, `expectedCity`,
- `monthlyTrafficGB`, `expiresAt` (input type=date),
- `notes` (textarea).

Внутри `submit()` в edit-режиме отправляются только явно изменённые поля (если username/password оба пустые — не передаются, host пустой — не меняется); в create — полная валидация (host обязателен, port в диапазоне).

#### `ProxyCheckHistoryModal.vue`

Таблица истории по `getCheckHistory(proxyId)`:

```
| Когда | Триггер | TCP | HTTP | IP | Локация | Латенси | Лик | Ошибка |
```

Триггер локализуется (`manual → "Ручная"`, `scheduled → "Авто"`, `pre_session → "Перед сессией"`). Ячейки TCP/HTTP — иконки success/error. Колонка "Ошибка" — `<details>` с категорией внутри (truncated в summary, развёрнуто в open).

#### `ProxyRevealCredentialsModal.vue`

Двухшаговый flow:
1. **Шаг 1**: поле `reason` (textarea, минимум 10 символов, ≤500) + предупреждение что действие будет в audit-логе.
2. **Шаг 2**: после `revealProxy(id, reason)` показывает host/port/username/password/rotationUrl с кнопками копирования (`navigator.clipboard.writeText`), + готовая строка `host:port:user:pass`, кнопка "Скопировать" с feedback через `copiedField.value`.

Закрытие сбрасывает все поля (`reset()`).

#### `AccountProxyPicker.vue` (вкладка "Прокси" в `AccountEditModal`)

```html
<select v-model="selected" class="select select-sm w-full">
  <option value="">Без прокси (прямое подключение)</option>
  <option v-for="p in proxies" :key="p.id" :value="p.id">
    {{ p.label }} · {{ p.type }} · {{ p.status }}
  </option>
</select>
```

После выбора показывает превью карточки с `ProxyHealthBadge`. Кнопка "Сохранить" вызывает `useAccountCredentials().setProxy(accountId, proxyId)`, которая шлёт `PUT /api/accounts/:id/proxy`. Plus ссылка `<NuxtLink to="/proxies">` — открыть список.

В этом же коммите блока "Deep Proxy Check" ещё нет — он появится позже в Уровне C (отдельный коммит, не входит в эту тройку).

### 1.8 Frontend: страница `/proxies`

`app/pages/proxies/index.vue` (исходная версия 85a356e, до изменений в 4319d85):

```ts
definePageMeta({
  layout: "default",
  middleware: "module-access",
  moduleSlug: "social-upload",
})
useHead({ title: "Прокси" })

const filters = useProxyFiltersStore()
const { data: proxiesData, pending, error, refresh } = useProxies()
const proxies = computed<ProxyDto[]>(() => proxiesData.value?.data ?? [])

const addModalRef     = ref<{ open: (proxy?: ProxyDto) => void }>()
const historyModalRef = ref<{ open: (id: string, label: string) => void }>()
const revealModalRef  = ref<{ open: (id: string, label: string) => void }>()

// Debounced search 300ms
const searchInput = ref(filters.search)
watch(searchInput, (val) => {
  if (searchTimeout) clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => { filters.search = val }, 300)
})

const statusOptions = [ /* unverified/healthy/degraded/dead/expired */ ]
const typeOptions   = [ /* mobile/residential/datacenter */ ]
```

Разметка:

```html
<div class="space-y-6">
  <!-- Заголовок: total/healthy/problem counters + "Добавить прокси" -->
  <div class="flex items-center justify-between flex-wrap gap-3">
    <div>
      <h1 class="text-2xl font-bold">Прокси</h1>
      <p class="text-sm text-base-content/60">
        Всего: {{ totalCount }} · Здоровых: {{ healthyCount }} · С проблемами: {{ problemCount }}
      </p>
    </div>
    <button class="btn btn-primary btn-sm" @click="openAddModal">
      <Icon name="mingcute:add-line" /> Добавить прокси
    </button>
  </div>

  <!-- Фильтры: search + status + type + reset -->
  <div class="card bg-base-100 shadow-sm">
    <div class="card-body p-4 grid grid-cols-1 md:grid-cols-4 gap-2">
      <input v-model="searchInput" placeholder="label, провайдер, страна" />
      <select v-model="filters.status"> ... </select>
      <select v-model="filters.type"> ... </select>
      <button @click="filters.reset(); searchInput = ''">Сбросить</button>
    </div>
  </div>

  <!-- Loading / Error / Empty / Grid -->
  <div v-if="pending"> <span class="loading loading-spinner loading-lg" /> </div>
  <div v-else-if="error" role="alert" class="alert alert-error"> ... </div>
  <SharedEmptyState v-else-if="proxies.length === 0" icon="mingcute:wifi-line" ... />

  <div v-else class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
    <ProxyCard v-for="proxy in proxies" :key="proxy.id" :proxy="proxy"
      @updated="onUpdated" @deleted="onDeleted" @edit="onEdit"
      @history="onHistory" @reveal="onReveal" />
  </div>

  <ProxyAddModal ref="addModalRef" @saved="onSaved" />
  <ProxyCheckHistoryModal ref="historyModalRef" />
  <ProxyRevealCredentialsModal ref="revealModalRef" />
</div>
```

### 1.9 Smoke test `scripts/test-proxy-checker.ts`

Standalone-скрипт, не зависит от Nuxt runtime и Prisma. Вызывает `checkProxy` напрямую:

```bash
bun run scripts/test-proxy-checker.ts <host> <port> [<user>] [<pass>]
```

Алгоритм:
1. `getServerIp()` — выводит внешний IP сервера.
2. `checkProxy({ host, port, username, password })` (со временем).
3. Печатает результат как JSON, total время.
4. Exit codes:
   - `0` — `httpProbeOk && !isLeaking` (всё ок).
   - `2` — `isLeaking` (использовать нельзя).
   - `2` — иначе (см. errorCategory).
   - `1` — usage error.

```ts
const serverIp = await getServerIp()
console.log(`Server external IP: ${serverIp ?? "(не удалось получить)"}`)
const result = await checkProxy({ host: hostArg, port, username: userArg || undefined, password: passArg || undefined })
console.log(JSON.stringify(result, null, 2))
if (result.httpProbeOk && !result.isLeaking) { console.log("✓ Прокси работает корректно"); process.exit(0) }
if (result.isLeaking) { console.log("✗ прокси передаёт реальный IP сервера"); process.exit(2) }
console.log("✗ Прокси не работает"); process.exit(2)
```

---

## Глава 2 — `cfef3b6`: Глубокая диагностика (14.05.2026)

> Добавлен полноценный root-cause-анализ прокси через 4 разных метода + curl baseline. Используется, когда обычный health-check показывает `isLeaking=true`, но непонятно где собака — в NodeMaven, в нашем коде или в Node v22+/SocksProxyAgent.

### 2.1 Probe.ts: warn-логирование leak

В `server/utils/proxy/probe.ts` (внутри ветки leak detection) добавлен structured warning, который не меняет поведение, но помогает заметить проблему в проде:

```ts
// Diagnostic logging — НЕ меняет поведение, помогает дальше дебажить.
// Если в логах продакшна часто видим этот варн — запускаем
// POST /api/proxies/:id/diagnose для root cause analysis.
console.warn('[probe] LEAK DETECTED', {
  proxyHost: creds.host,
  proxyProtocol: creds.protocol,
  detectedIp: probe.ip,
  serverIp,
  httpProbeOk: result.httpProbeOk,
  probeMethod: usedFallback ? 'http-forward' : 'https-connect',
  hadHeaderProbe: !!headerData,
  proxyHeadersFound,
  headerProbeOrigin,
  hint: 'POST /api/proxies/:id/diagnose for deep analysis',
})
```

### 2.2 Backend: `diagnostic.ts` (540 строк)

Создана отдельная утилита `server/utils/proxy/diagnostic.ts`. Запускает прокси через **5 параллельных независимых методов** + curl baseline, агрегирует и определяет verdict.

#### Структура ответа

```ts
export interface ProxyDiagnostic {
  proxyHost: string
  proxyPort: number
  protocol: string
  timestamp: string
  containerIp: { via_v4: string | null; via_v6: string | null; error: string | null }
  tcp: { connectMs: number | null; error: string | null }
  curlBaseline: {
    command: string         // с маскировкой proxy-user
    exitCode: number
    stdout: string
    stderr: string
    durationMs: number
    detectedIp: string | null
    isLeakingViaCurl: boolean
  }
  rawNodeRequest: TracedNodeRequestResult   // production path
  nativeFetch: NativeFetchResult            // ОЖИДАЕМО leak — undici игнорирует agent
  socks5hVariant: NodeRequestResult         // DNS через proxy
  rawSocksLib: RawSocksLibResult            // socks lib + manual TLS
  agentDebug: AgentDebug                    // что увидел SocksProxyAgent при парсинге
  verdict: Verdict                          // auto-determined корень проблемы
}
```

#### Шаги диагностики

1. **`fetchContainerIp()`** — два `curl --max-time 10 ifconfig.me`: один `-4`, один `-6`. Без baseline IP leak detection невозможна.
2. **`probeTcp(host, port)`** — простой TCP handshake через `node:net`, замеряет `connectMs`.
3. **`runCurlBaseline(creds, containerIp)`** — ground truth:
   ```ts
   if (creds.protocol === "socks5")
     args.push("--socks5-hostname", `${creds.host}:${creds.port}`)
   else
     args.push("--proxy", `${scheme}://${creds.host}:${creds.port}`)
   if (creds.username) args.push("--proxy-user", `${creds.username}:${creds.password ?? ""}`)
   args.push("-s", "--max-time", "15", "-w", "\nHTTP_CODE:%{http_code}", "https://ifconfig.me")
   ```
   Парсит IPv4 ИЛИ IPv6 plain text из stdout, сравнивает с `containerIp.via_v4 / via_v6` соответствующего семейства.
4. **`runRawNodeRequest`** (production path):
   - Для SOCKS5: использует `socksHttpsGet` из `socks-fetch.ts` (socks lib + manual TLS, обходит SocksProxyAgent — известный баг agent-base@9 + Node v24+).
   - Для HTTP/HTTPS: `https.request(options, cb)` с `HttpsProxyAgent`.
   - Trace: вызывается ли connect(), к какому IP открылся сокет (proxy IP vs target IP), сколько занял handshake. Главное поле — `socketRemoteAddress` в attempts.
5. **`runNativeFetch`** — намеренно "ломанный" путь: `fetch(url, { agent })`. В Node 18+ это игнорируется (undici под капотом ждёт `dispatcher`). Это документация поведения: код, использующий native fetch + agent → leak.
6. **`runSocks5hVariant`** — `socks5h://` (DNS через proxy) через `https.request` + `SocksProxyAgent`. Имеет смысл только для socks5 прокси.
7. **`runRawSocksTest`** — socks lib напрямую (зеркало шага 4 для socks5, как альтернативный путь).
8. **`inspectAgent(agent, protocol)`** — снимок `SocksProxyAgent.proxy`: `proxyHost`, `proxyPort`, `socksType`, `hasUserId`, `userIdLength`, `hasPassword` (без самого пароля). Логируется в server logs для проверки, что парсинг кредов прошёл правильно.

#### Verdict-логика (`determineVerdict`)

Приоритетная цепочка:

1. `containerIp.via_v4 === null && via_v6 === null` → `unknown`, рекомендация починить curl/сеть в контейнере.
2. `curlBaseline.detectedIp === null` → `nodemaven_broken` (curl не ответил — проблема на стороне провайдера, whitelist/auth/firewall).
3. `!proxyReallyWorks` (curl показывает container IP) → `nodemaven_broken` — трафик идёт мимо прокси либо transparent. Рекомендация: проверить whitelist, login/password, overlapping pool.
4. `proxyReallyWorks && nodeRequestWorks` → `all_methods_work`. `nativeFetch.isLeaking=true` тут expected, упоминается что undici игнорирует `agent`.
5. `proxyReallyWorks && !nodeRequestWorks` → `fetchJson_fallback`. Для socks5 — проверить socks-fetch.ts; для http/https — версию https-proxy-agent.
6. `socks5hHelpsAtAll` (только socks5h работает) → `socks5h_required` — поменять buildProxyUrl на socks5h.
7. Иначе `unknown`.

```ts
verdict.suspectedRoot:
  | "nodemaven_broken"
  | "node_fetch_ignores_agent"
  | "fetchJson_fallback"
  | "whitelist_issue"
  | "socks5h_required"
  | "all_methods_work"
  | "unknown"
```

#### Главная функция

```ts
export async function diagnoseProxy(creds: ProxyCredentials): Promise<ProxyDiagnostic> {
  const containerIp = await fetchContainerIp()
  const tcp = await probeTcp(creds.host, creds.port)
  const curlBaseline = await runCurlBaseline(creds, containerIp)

  const [rawNodeRequest, nativeFetch, socks5hVariant, rawSocksLib] =
    await Promise.all([
      runRawNodeRequest(creds, containerIp),
      runNativeFetch(creds, containerIp),
      runSocks5hVariant(creds, containerIp),
      runRawSocksTest(creds, containerIp),
    ])

  const agent = buildAgent(creds)
  const agentDebug = inspectAgent(agent, creds.protocol)
  console.log("[diagnostic] proxy agent snapshot", { proxyHost: creds.host, protocol: creds.protocol, agentDebug })

  const diagnostic: ProxyDiagnostic = {
    proxyHost: creds.host, proxyPort: creds.port, protocol: creds.protocol,
    timestamp: new Date().toISOString(),
    containerIp, tcp, curlBaseline, rawNodeRequest, nativeFetch,
    socks5hVariant, rawSocksLib, agentDebug,
    verdict: { /* skeleton */ },
  }
  diagnostic.verdict = determineVerdict(diagnostic)
  return diagnostic
}
```

#### Безопасность секретов

В response:
- username/password **не попадают** в diagnostic.
- `curlBaseline.command` маскирует proxy-user (`***:***`) перед сохранением.

### 2.3 REST API endpoint

`server/api/proxies/[id]/diagnose.post.ts`:

```ts
import { diagnoseProxy } from "~~/server/utils/proxy/diagnostic"

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canWrite"],
    moduleSlug: "social-upload",
  })

  const id = getRouterParam(event, "id")
  if (!id?.trim()) throw createError({ statusCode: 400, message: "Неверный идентификатор прокси" })

  const proxy = await prisma.proxy.findUnique({
    where: { id },
    select: { id: true, label: true, protocol: true, host: true, port: true, username: true, password: true },
  })
  if (!proxy) throw createError({ statusCode: 404, message: "Прокси не найден" })

  const diagnostic = await diagnoseProxy({
    protocol: proxy.protocol,
    host: decryptSecret(proxy.host),
    port: proxy.port,
    username: proxy.username ? decryptSecret(proxy.username) : undefined,
    password: proxy.password ? decryptSecret(proxy.password) : undefined,
  })

  // Только summary в server logs — без credentials.
  console.log("[proxy-diagnostic]", JSON.stringify({
    proxyId: proxy.id, proxyLabel: proxy.label, protocol: proxy.protocol,
    verdict: diagnostic.verdict,
    containerIp_v4: diagnostic.containerIp.via_v4,
    curl_detectedIp: diagnostic.curlBaseline.detectedIp,
    curl_leak: diagnostic.curlBaseline.isLeakingViaCurl,
    rawNode_detectedIp: diagnostic.rawNodeRequest.detectedIp,
    rawNode_leak: diagnostic.rawNodeRequest.isLeaking,
    fetch_detectedIp: diagnostic.nativeFetch.detectedIp,
    fetch_leak: diagnostic.nativeFetch.isLeaking,
    socks5h_detectedIp: diagnostic.socks5hVariant.detectedIp,
    nodeVersion: diagnostic.nativeFetch.nodeVersion,
  }))

  return { data: diagnostic }
})
```

Permissions: `canWrite + social-upload` (как обычный `/check`).

### 2.4 Frontend: `ProxyDiagnoseModal`

Новый компонент `app/components/proxy/ProxyDiagnoseModal.vue`. Открывается через `defineExpose({ open })` API:

```ts
function open(id: string, label: string) {
  proxyLabel.value = label
  result.value = null
  error.value = null
  dialogRef.value?.showModal()
  void runDiagnose(id)
}

async function runDiagnose(id: string) {
  isLoading.value = true
  try {
    const res = await $fetch<{ data: DiagnosticData }>(`/api/proxies/${id}/diagnose`, { method: "POST" })
    result.value = res.data
  } catch (e) { error.value = e?.data?.message ?? e?.message ?? "Не удалось запустить диагностику" }
  finally { isLoading.value = false }
}

const verdictColorClass = computed(() => {
  if (!result.value) return ""
  const root = result.value.verdict.suspectedRoot
  if (root === "all_methods_work") return "alert-success alert-soft"
  if (root === "unknown")         return "alert-warning alert-soft"
  return "alert-error alert-soft"
})

function copyJson() { navigator.clipboard.writeText(JSON.stringify(result.value, null, 2)) }
```

UI:
- Заголовок "Глубокая диагностика прокси", лейбл прокси.
- Loading: spinner + "Проверяю прокси через 4 метода + curl baseline. До 60 секунд."
- Verdict — `alert` с цветом из `verdictColorClass` и текстом recommendation.
- Сетка 6 карточек:
  - **Container IP**: IPv4 / IPv6.
  - **TCP к прокси**: connectMs / error.
  - **Curl baseline (ground truth)**: detectedIp + badge `LEAK | OK`, exitCode, durationMs, stderr (truncated).
  - **Raw https.request + agent**: detectedIp, isLeaking, httpStatus, error.
  - **Native fetch + agent**: то же + Node version, expected leak.
  - **socks5h:// (DNS через proxy)**: для не-socks5 показывает "skipped".
- `<details>` "Полный JSON отчёт (raw)" — pre с `JSON.stringify(result, null, 2)`.
- Footer: "Скопировать JSON" + "Закрыть".

### 2.5 Frontend: интеграция в ProxyCard и страницу

#### ProxyCard.vue

Добавлен emit `diagnose: [proxy: ProxyDto]` и кнопка в `card-actions`:

```html
<button class="btn btn-xs btn-warning btn-soft gap-1" @click="emit('diagnose', proxy)">
  <Icon name="mingcute:search-line" class="text-sm" />
  Diagnose
</button>
```

Дифф +8 строк.

#### `pages/proxies/index.vue`

Добавлен ref + handler + слот для модалки (+7 строк):

```ts
const diagnoseModalRef = ref<{ open: (id: string, label: string) => void }>()
function onDiagnose(proxy: ProxyDto) {
  diagnoseModalRef.value?.open(proxy.id, proxy.label)
}
```

```html
<ProxyCard ... @diagnose="onDiagnose" />
<ProxyDiagnoseModal ref="diagnoseModalRef" />
```

### 2.6 Smoke test `scripts/test-proxy-diagnostic.ts`

```bash
bun run scripts/test-proxy-diagnostic.ts                            # dry-run против fake-host
bun run scripts/test-proxy-diagnostic.ts --proxy-id <uuid>          # против реального
bun run scripts/test-proxy-diagnostic.ts --label "NodeMaven 1"      # по label
```

- Dry-run использует `proxy-test-nonexistent.invalid:1080 (socks5)` — валидирует error paths (`connection_refused` / `timeout`).
- Real-run грузит Proxy из БД через динамический import Prisma, расшифровывает host/username/password.
- Stderr — короткий summary (proxy, container IP, TCP, curl, raw node, fetch, socks5h, verdict, recommendation, elapsed).
- Stdout — полный JSON (можно `> file.json`).

Гарантирует, что output JSON **не содержит credentials**: username/password не попадают в result, curl.command маскирует proxy-user.

---

## Глава 3 — `4319d85`: Alert dedup + bulk check (30.04.2026)

> Закрыл 4 критичных долга итерации 1. Главное по прокси: дедупликация Telegram-алёртов (чтобы scheduler не спамил 6× в сутки на одну битую прокси), параллельная массовая проверка через `POST /api/proxies/check-all`, alert-tooltip в UI карточки.

### 3.1 Миграция и схема

`prisma/migrations/20260429155210_proxy_alert_dedup/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "Proxy" ADD COLUMN     "alertHistory" JSONB;
```

В `prisma/schema.prisma`:

```prisma
model Proxy {
  // ...предыдущие поля...
  consecutiveFailures Int                @default(0)
  // Дедупликация Telegram-алёртов: { [reason]: { lastAt: ISO-string, count: number } }
  // reasons: 'leak' | 'consecutive_failures_3' | 'auth_failed' | 'expired'
  alertHistory        Json?
  monthlyTrafficGB    Float?
  // ...
}
```

### 3.2 Shared types: ProxyAlertReason / Summary

В `shared/types/proxy.ts` добавлено:

```ts
export type ProxyAlertReason =
  | "leak"
  | "consecutive_failures_3"
  | "auth_failed"
  | "expired"

export interface ProxyAlertSummary {
  reason: ProxyAlertReason
  lastAt: string
  count: number
  nextAllowedInMs: number
}
```

И в `ProxyDto` добавлено поле:

```ts
export interface ProxyDto {
  // ...
  attachedAccountsCount: number
  alertSummary: ProxyAlertSummary[]   // ← новое
  createdAt: string
  updatedAt: string
}
```

### 3.3 Backend: `alert-dedup.ts`

Новый модуль `server/utils/proxy/alert-dedup.ts`. Без него scheduler с 4-часовым интервалом отправлял бы 6 алёртов в сутки на одну битую прокси — оператор отключит уведомления и пропустит реальные проблемы.

#### Quiet periods (подобраны под характер проблемы)

```ts
const QUIET_PERIODS_MS: Record<AlertReason, number> = {
  leak:                   24 * 60 * 60 * 1000,    // 24ч — критичный
  consecutive_failures_3: 24 * 60 * 60 * 1000,    // 24ч — критичный
  auth_failed:            12 * 60 * 60 * 1000,    // 12ч
  expired:                7 * 24 * 60 * 60 * 1000, // 7д — некритичный
}
```

#### Структура истории

```ts
export interface AlertHistoryEntry {
  lastAt: string  // ISO
  count: number
}
export type AlertHistory = Record<string, AlertHistoryEntry>
```

Хранится в `Proxy.alertHistory JSONB` как `{ [reason]: { lastAt, count } }`.

#### Публичный API

```ts
export function shouldSendAlert(history: unknown, reason: AlertReason): boolean
export function recordAlert(history: unknown, reason: AlertReason): AlertHistory
export function msUntilNextAlert(history: unknown, reason: AlertReason): number | null
export function summarizeAlertHistory(history: unknown): AlertHistorySummary[]
```

- `parseHistory(value)` — защита от мусора в БД (`null` / массив / не-объект → возвращает `null`, дальше `shouldSendAlert` вернёт `true`).
- `shouldSendAlert` — `true` если истории нет, или для категории первый алёрт, или `elapsedMs ≥ QUIET_PERIODS_MS[reason]`. Повреждённая дата (`NaN`) → `true`.
- `recordAlert` — **не мутирует** исходный объект (spread copy), готов для `prisma.update({ data: { alertHistory: recordAlert(...) } })`.
- `summarizeAlertHistory` — массив `{ reason, lastAt, count, nextAllowedInMs }` для всех 4 reasons, у которых есть запись.

```ts
export function shouldSendAlert(history: unknown, reason: AlertReason): boolean {
  const parsed = parseHistory(history)
  if (!parsed) return true
  const last = parsed[reason]
  if (!last) return true
  const elapsedMs = Date.now() - new Date(last.lastAt).getTime()
  if (Number.isNaN(elapsedMs)) return true
  return elapsedMs >= QUIET_PERIODS_MS[reason]
}

export function recordAlert(history: unknown, reason: AlertReason): AlertHistory {
  const updated: AlertHistory = { ...(parseHistory(history) ?? {}) }
  const prev = updated[reason]
  updated[reason] = {
    lastAt: new Date().toISOString(),
    count: (prev?.count ?? 0) + 1,
  }
  return updated
}
```

### 3.4 Backend: DTO интеграция

`server/utils/proxy/dto.ts` получил подключение `summarizeAlertHistory`:

```ts
import { summarizeAlertHistory } from "./alert-dedup"
import type { ProxyAlertSummary } from "../../../shared/types/proxy"

export function toProxyDto(proxy: Proxy, attachedAccountsCount: number): ProxyDto {
  return {
    // ...предыдущие поля...
    attachedAccountsCount,
    alertSummary: summarizeAlertHistory(proxy.alertHistory) as ProxyAlertSummary[],
    createdAt: proxy.createdAt.toISOString(),
    updatedAt: proxy.updatedAt.toISOString(),
  }
}
```

Теперь любой response с прокси несёт алёрт-summary, без раскрытия секретов.

### 3.5 REST API: check-all

`server/api/proxies/check-all.post.ts`:

```ts
const CONCURRENCY_LIMIT = 5

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canWrite"],
    moduleSlug: "social-upload",
  })

  const proxies = await prisma.proxy.findMany({
    where: { status: { not: "expired" } },
    select: { id: true, label: true },
    orderBy: { createdAt: "asc" },
  })
  if (proxies.length === 0) return { data: { total: 0, successful: 0, failed: 0, results: [] } }

  const results: CheckAllResult[] = []
  for (let i = 0; i < proxies.length; i += CONCURRENCY_LIMIT) {
    const chunk = proxies.slice(i, i + CONCURRENCY_LIMIT)
    const chunkResults = await Promise.allSettled(
      chunk.map(async (p) => {
        const r = await runProxyHealthCheck(p.id, "manual")
        return {
          id: p.id,
          label: p.label,
          ok: r.httpProbeOk && !r.isLeaking,
          errorCategory: r.errorCategory ?? null,
          errorMessage: r.errorMessage ?? null,
        }
      }),
    )
    for (let idx = 0; idx < chunkResults.length; idx += 1) {
      const r = chunkResults[idx]
      const source = chunk[idx]
      if (r.status === "fulfilled") results.push(r.value)
      else {
        const message = r.reason instanceof Error ? r.reason.message : String(r.reason ?? "unknown error")
        results.push({ id: source.id, label: source.label, ok: false, errorCategory: "unknown", errorMessage: message.slice(0, 200) })
      }
    }
  }

  const successful = results.filter((r) => r.ok).length
  const failed = results.length - successful
  return { data: { total: proxies.length, successful, failed, results } }
})
```

`chunks × Promise.allSettled` гарантирует:
- параллельность 5 проверок одновременно (не больше — берегём probe service и ipify),
- одна упавшая проверка не валит всю партию (rejected → попадает в результаты как `ok=false, errorCategory="unknown"`),
- expired прокси пропускаются.

### 3.6 Scheduler: dedup wiring

В `server/plugins/scheduler.ts` 5-й setInterval обёрнут в dedup. Дифф:

```ts
import type { AlertReason } from "../utils/proxy/alert-dedup"

const candidates = await prisma.proxy.findMany({
  where: { /* ... */ },
  select: {
    id: true, label: true, consecutiveFailures: true,
    alertHistory: true,   // ← новое
  },
  take: 50,
})

let leakCount = 0, deadCount = 0, suppressedCount = 0  // ← suppressed появилось

for (const proxy of candidates) {
  try {
    const result = await runProxyHealthCheck(proxy.id, "scheduled")
    const reason: AlertReason | null = result.isLeaking
      ? "leak"
      : !result.httpProbeOk && proxy.consecutiveFailures + 1 >= 3
        ? "consecutive_failures_3"
        : null

    if (reason) {
      if (!shouldSendAlert(proxy.alertHistory, reason)) {
        suppressedCount += 1
        await logAgent("scheduler", "info",
          `Proxy ${proxy.label}: алёрт ${reason} подавлен (quiet period)`)
          .catch(() => {})
      } else {
        if (reason === "leak") leakCount += 1
        else deadCount += 1

        const title = reason === "leak"
          ? `Прокси ${proxy.label} подозревается на утечку IP`
          : `Прокси ${proxy.label} помечен dead (3+ провала подряд)`

        await sendTelegramAlert("critical_error", title,
          sanitizeForLog({ proxyId: proxy.id, label: proxy.label, errorCategory: result.errorCategory, errorMessage: result.errorMessage }) as string,
        ).catch(() => {})

        await prisma.proxy
          .update({
            where: { id: proxy.id },
            data: { alertHistory: recordAlert(proxy.alertHistory, reason) as never },
          })
          .catch(() => {})
      }
    }
  } catch (err) { /* logAgent */ }
  await new Promise((r) => setTimeout(r, 5_000))
}

await logAgent("scheduler", "info",
  `Proxy health: проверено ${candidates.length}, leak=${leakCount}, dead=${deadCount}, suppressed=${suppressedCount}`)
```

Финальный AgentLog теперь содержит `suppressed=N` — видно сколько раз scheduler промолчал.

### 3.7 Frontend: composable extension

В `app/composables/useProxyActions.ts` добавлен `checkAllProxies` + типы:

```ts
export interface BulkCheckResultItem {
  id: string
  label: string
  ok: boolean
  errorCategory: string | null
  errorMessage: string | null
}
export interface BulkCheckResult {
  total: number
  successful: number
  failed: number
  results: BulkCheckResultItem[]
}

async function checkAllProxies(): Promise<BulkCheckResult | null> {
  isBusy.value = true
  error.value = null
  try {
    const res = await $fetch<{ data: BulkCheckResult }>(
      "/api/proxies/check-all",
      { method: "POST" },
    )
    return res.data
  } catch (e: unknown) {
    error.value = extractError(e)
    return null
  } finally {
    isBusy.value = false
  }
}

return {
  isBusy, error,
  createProxy, updateProxy, deleteProxy,
  checkProxy, checkAllProxies, getCheckHistory, revealProxy,
}
```

### 3.8 Frontend: ProxyCard alert tooltip

В `ProxyCard.vue` добавлены lookup-таблица, форматтеры и блок отображения. +61 строка.

```ts
const alertReasonLabels: Record<string, string> = {
  leak: "утечка IP",
  consecutive_failures_3: "3+ провала подряд",
  auth_failed: "ошибка авторизации",
  expired: "истёк срок",
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return "доступен сейчас"
  const hours = Math.floor(ms / (60 * 60 * 1000))
  if (hours >= 24) {
    const days = Math.floor(hours / 24)
    const remainHours = hours % 24
    return remainHours > 0 ? `через ${days}д ${remainHours}ч` : `через ${days}д`
  }
  if (hours >= 1) return `через ${hours}ч`
  const minutes = Math.max(1, Math.floor(ms / (60 * 1000)))
  return `через ${minutes}мин`
}

function formatAlertDate(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit", month: "2-digit",
    hour: "2-digit", minute: "2-digit",
  })
}

const alertSummary = computed(() => props.proxy.alertSummary ?? [])
const hasAlerts    = computed(() => alertSummary.value.length > 0)
const alertTooltip = computed(() => alertSummary.value
  .map((a) => {
    const label = alertReasonLabels[a.reason] ?? a.reason
    const next  = formatRemaining(a.nextAllowedInMs)
    return `${label}: ${a.count}× (последний ${formatAlertDate(a.lastAt)}), след. ${next}`
  })
  .join("\n"))
```

Разметка (inline-блок в card-body):

```html
<div v-if="hasAlerts" class="tooltip tooltip-left text-left" :data-tip="alertTooltip">
  <div class="flex items-center gap-1.5 text-base-content/70">
    <Icon name="mingcute:notification-line" class="text-sm" />
    <span class="text-xs">
      Алёрты:
      <template v-for="(a, idx) in alertSummary" :key="a.reason">
        <span>{{ alertReasonLabels[a.reason] ?? a.reason }} ({{ a.count }})</span>
        <span v-if="idx < alertSummary.length - 1">, </span>
      </template>
    </span>
  </div>
</div>
```

При наведении DaisyUI `tooltip` показывает многострочный текст вида:

```
утечка IP: 3× (последний 30.04 14:25), след. через 18ч
ошибка авторизации: 1× (последний 29.04 09:10), след. через 6ч
```

### 3.9 Frontend: `/proxies` — кнопка "Проверить все"

В `app/pages/proxies/index.vue` добавлено (+61 строка):

```ts
const { checkAllProxies } = useProxyActions()
const bulkChecking = ref(false)
const bulkSummary = ref<{ total, successful, failed } | null>(null)
const bulkSummaryTimer = ref<ReturnType<typeof setTimeout> | null>(null)

async function checkAll() {
  if (proxies.value.length === 0) return
  bulkChecking.value = true
  bulkSummary.value  = null
  if (bulkSummaryTimer.value) {
    clearTimeout(bulkSummaryTimer.value)
    bulkSummaryTimer.value = null
  }
  try {
    const result = await checkAllProxies()
    if (result) {
      bulkSummary.value = { total: result.total, successful: result.successful, failed: result.failed }
      bulkSummaryTimer.value = setTimeout(() => { bulkSummary.value = null }, 8000)
    }
    await refresh()
  } finally { bulkChecking.value = false }
}

onBeforeUnmount(() => {
  if (bulkSummaryTimer.value) clearTimeout(bulkSummaryTimer.value)
})
```

Разметка:

```html
<button class="btn btn-sm btn-ghost gap-1" :disabled="bulkChecking || totalCount === 0" @click="checkAll">
  <span v-if="bulkChecking" class="loading loading-spinner loading-xs" />
  <Icon v-else name="mingcute:refresh-3-line" />
  {{ bulkChecking ? "Проверяю прокси..." : "Проверить все" }}
</button>

<!-- Toast с агрегатом, авто-исчезает через 8с, можно закрыть вручную -->
<div v-if="bulkSummary" role="alert" class="alert text-sm"
     :class="bulkSummary.failed === 0 ? 'alert-success alert-soft' : 'alert-warning alert-soft'">
  <Icon :name="bulkSummary.failed === 0 ? 'mingcute:check-circle-line' : 'mingcute:warning-line'" />
  <span>
    Проверено {{ bulkSummary.total }}: {{ bulkSummary.successful }} OK, {{ bulkSummary.failed }} с проблемами
  </span>
  <button class="btn btn-xs btn-ghost ml-auto" @click="bulkSummary = null">
    <Icon name="mingcute:close-line" />
  </button>
</div>
```

### 3.10 Smoke test `scripts/test-alert-dedup.ts`

Standalone-тест на 8 групп проверок (`24/24 passed`):

1. **Пустая история — все категории разрешены.** `shouldSendAlert(null, r) === true` для всех 4 reasons.
2. **Первый leak записан → второй подавлен.** После `recordAlert(history, "leak")` `count === 1` и `shouldSendAlert` стал `false`.
3. **5 подряд recordAlert** через `consecutive_failures_3` — реально разрешена только 1, `count === 1`.
4. **Симуляция выхода из quiet period.** История с `lastAt = 25 часов назад` → `shouldSendAlert = true`. С `lastAt = 2 часа назад` → `false`.
5. **Разные категории не блокируют друг друга.** `leak` записан → `consecutive_failures_3` всё ещё разрешён; затем оба записаны → оба подавлены.
6. **`msUntilNextAlert` корректен.** До первой записи → `null`. После — `> 0` и `≤ 24h`.
7. **`summarizeAlertHistory`.** После двух `recordAlert` (`leak`, `auth_failed`) summary содержит ровно 2 элемента с правильными reasons, без `expired`.
8. **Защита от мусора в БД.** `undefined`, `[]`, `{ leak: { lastAt: "not-a-date", count: 1 } }` — все возвращают `shouldSendAlert = true` (graceful degradation).

Запуск: `bun run scripts/test-alert-dedup.ts`. Exit code = 0 при всех passed.

---

## Приложения

### A. Что ещё связано с прокси, но появилось в других коммитах (не входит в эту тройку)

Чтобы документ давал полную картину, отмечу что после `cfef3b6` подсистема продолжала эволюционировать:

- `app/components/account/AccountProxyPicker.vue` получил блок **"Глубокая проверка через Indigo browser"** (`POST /api/accounts/:id/deep-proxy-check`) с прогресс-индикатором, `force-stop` зависшей сессии и result-card. Это Уровень C — отдельный коммит за пределами этой тройки.
- `server/utils/proxy/probe.ts` получил **multi-source consensus** для `getServerIp()` (3 параллельных IP-сервиса вместо одного ipify), **header probe** через httpbin/postman-echo (отличить direct-connect от transparent proxy при detectedIp == serverIp), **mock mode** (`PROXY_MOCK_MODE=true` с парсингом сценариев из host), **SOCKS5 lib path** через `socksHttpsGet` минуя SocksProxyAgent.
- `server/utils/proxy/socks-fetch.ts` (`595eb97`, `1baaec1`, `b833d0a`, `efe74d1`) — отдельная история фикса TLS handshake hang на Node v24+ для SOCKS5.

### B. Файлы прокси-подсистемы (актуальный snapshot)

```
shared/types/proxy.ts
server/utils/proxy/
  ├── probe.ts                 # checkProxy, getServerIp, mock mode, header probe
  ├── proxy-checker.ts         # runProxyHealthCheck, assertProxyHealthyBeforeSession
  ├── dto.ts                   # toProxyDto, toProxyHealthCheckDto
  ├── alert-dedup.ts           # shouldSendAlert, recordAlert, summarizeAlertHistory
  ├── diagnostic.ts            # diagnoseProxy (5 методов + verdict)
  ├── agent-tracer.ts          # createTracedSocksAgent для diagnostic
  └── socks-fetch.ts           # socksHttpGet / socksHttpsGet для SOCKS5 lib path
server/api/proxies/
  ├── index.get.ts             # GET    /api/proxies
  ├── index.post.ts            # POST   /api/proxies
  ├── [id].get.ts              # GET    /api/proxies/:id
  ├── [id].put.ts              # PUT    /api/proxies/:id
  ├── [id].delete.ts           # DELETE /api/proxies/:id
  ├── check-all.post.ts        # POST   /api/proxies/check-all
  └── [id]/
      ├── check.post.ts        # POST   /api/proxies/:id/check
      ├── checks.get.ts        # GET    /api/proxies/:id/checks
      ├── reveal.post.ts       # POST   /api/proxies/:id/reveal
      └── diagnose.post.ts     # POST   /api/proxies/:id/diagnose
server/api/accounts/[id]/proxy.put.ts          # PUT /api/accounts/:id/proxy
app/composables/
  ├── useProxies.ts
  └── useProxyActions.ts
app/stores/proxyFilters.ts
app/pages/proxies/index.vue
app/components/proxy/
  ├── ProxyCard.vue
  ├── ProxyHealthBadge.vue
  ├── ProxyAddModal.vue
  ├── ProxyCheckHistoryModal.vue
  ├── ProxyRevealCredentialsModal.vue
  └── ProxyDiagnoseModal.vue
app/components/account/AccountProxyPicker.vue  # вкладка "Прокси" в AccountEditModal
scripts/
  ├── test-proxy-checker.ts
  ├── test-proxy-diagnostic.ts
  └── test-alert-dedup.ts
tests/e2e/proxy-lifecycle.spec.ts
prisma/migrations/
  ├── ..._add_proxy_models/migration.sql
  └── 20260429155210_proxy_alert_dedup/migration.sql
```
