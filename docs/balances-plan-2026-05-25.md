# План реализации: Балансы — автосбор + UX

Дата: 2026-05-25
Автор: architect
Источник ресёрча: `docs/balances-research-2026-05-25.md`

Цель — закрыть задачи B-2, B-3, B-4 (backend) и F-1..F-6 (frontend) **без миграций**,
без новых таблиц, с сохранением эталона модалки `AccountCreateModal.vue` и честной
индикацией MANUAL/ESTIMATE сервисов вместо маскировки под auto.

---

## Раздел 1. Декомпозиция на 2 коммита

### Коммит 1 — Backend fetchers fix (B-2, B-3, B-4)

Заголовок (по правилам skill `commit`):
> Балансы. Авто-фетч NodeMaven/Apify устойчивее: x-api-key для NodeMaven, fallback на monthly-usage для Apify, raw-лог при неожиданной структуре

Файлы:
- `server/utils/balance/providers/nodemaven-api-provider.ts` — auth header + raw log
- `server/utils/balance/providers/apify-api-provider.ts` — monthly fallback + raw log
- (опц.) tests/api/admin-balances.spec.ts — smoke на 200/source field

### Коммит 2 — Frontend UX модалки + честные бейджи (F-1..F-6)

Заголовок:
> Балансы. Модалка вынесена в `app/components/admin/BalanceEditModal.vue` по эталону AccountCreateModal, валюта = select, dashboardHint кликабельный, бейдж «Авто недоступно» для MANUAL/ESTIMATE, причина fallback видна в UI

Файлы:
- `app/components/admin/BalanceEditModal.vue` — новый, ≤220 строк
- `app/pages/admin/balances.vue` — упрощение, использование нового компонента + бейдж F-6
- `app/composables/useAdminBalances.ts` — экспортировать BALANCE_CURRENCIES и helper `isAutoUnavailable(source, service)`

### Зависимости между коммитами

Коммит 1 и 2 независимы. Можно мёрджить в любом порядке. Тестировать на проде Saturn —
после обоих, потому что Tester должен видеть и реальный source=api, и новый UI.

---

## Раздел 2. Backend задачи

### Задача B-2 — Auth header NodeMaven (Bearer → x-api-key)

**Файл:** `server/utils/balance/providers/nodemaven-api-provider.ts`, строки 55-59

**Что было:**
```ts
const json = await $fetch<NodeMavenMeResponse>(`${NODEMAVEN_API_URL}/users/me`, {
  headers: { Authorization: `Bearer ${apiKey}` },
  timeout: REQUEST_TIMEOUT_MS,
})
```

**Что станет** — пробуем сначала `x-api-key` (по NodeMaven Help Center), при 401/403
делаем второй запрос с `Authorization: Bearer` как fallback:

```ts
async function requestNodeMavenMe(apiKey: string): Promise<{ json: NodeMavenMeResponse; authMode: "x-api-key" | "bearer" }> {
  try {
    const json = await $fetch<NodeMavenMeResponse>(`${NODEMAVEN_API_URL}/users/me`, {
      headers: { "x-api-key": apiKey },
      timeout: REQUEST_TIMEOUT_MS,
    })
    return { json, authMode: "x-api-key" }
  } catch (err) {
    const status = (err as { statusCode?: number; status?: number })?.statusCode
      ?? (err as { status?: number })?.status
    if (status !== 401 && status !== 403) throw err
    // 401/403 на x-api-key → пробуем Bearer
    const json = await $fetch<NodeMavenMeResponse>(`${NODEMAVEN_API_URL}/users/me`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: REQUEST_TIMEOUT_MS,
    })
    return { json, authMode: "bearer" }
  }
}
```

И в `fetchBalance()`:

```ts
const { json, authMode } = await requestNodeMavenMe(apiKey)
// дальше как было, плюс metadata.authMode для диагностики
```

В возврат добавить `metadata.authMode` — чтобы видеть в `/admin/balances` который сработал.

**Edge cases:**
1. Сетевой fail (ECONNRESET, timeout) — должен попасть в общий `catch`, не во второй запрос.
   Различаем: 401/403 = протокольный auth-fail (пробуем Bearer); всё остальное = throw → fallback.
2. NodeMaven отвечает 200 + HTML (capcha/login page) — `$fetch` распарсит как text/throw,
   попадёт в общий catch → fallback с raw-логом (B-4).
3. Двойной запрос увеличит latency до ~2× при первом запуске после неверного формата.
   Это нормально, кеш TTL 5 мин амортизирует.

**Default:** `x-api-key` первым — потому что это формат документации NodeMaven Help Center
(ресёрч D-2). Bearer оставляем как safety-net для legacy ключей.

**DoD:**
- Если `NODEMAVEN_API_KEY` есть и валиден — `services[].balance.source === "api"`,
  `metadata.authMode` присутствует.
- Если ключ невалидный — fallback, в `notes` остаётся `[fallback: ...]`, status корректный.
- Если ключа нет — поведение не меняется (как сейчас).
- typecheck чистый.

---

### Задача B-3 — Apify monthly-usage fallback

**Файл:** `server/utils/balance/providers/apify-api-provider.ts`, строки 55-69

**Что было:**
```ts
const json = await $fetch<ApifyMeResponse>(`${APIFY_API_URL}/users/me`, {
  query: { token },
  timeout: REQUEST_TIMEOUT_MS,
})

const limit = json.data?.plan?.maxMonthlyUsageUsd
const used = json.data?.usage?.monthlyUsageUsd

if (typeof limit !== "number" || typeof used !== "number") {
  return this.fallbackToManual(startedAt, ...)
}
```

**Что станет** — две стратегии: сначала `/users/me` (быстрее, одно поле), при отсутствии
полей — второй запрос на `/users/me/usage/monthly`:

```ts
interface ApifyMonthlyUsageResponse {
  data?: {
    monthlyServiceUsage?: {
      totalUsageCreditsUsdAfterVolumeDiscount?: number
    }
    // запасное название поля, разные версии API:
    totalUsageCreditsUsdAfterVolumeDiscount?: number
  }
}

const json = await $fetch<ApifyMeResponse>(`${APIFY_API_URL}/users/me`, {
  query: { token },
  timeout: REQUEST_TIMEOUT_MS,
})

const limit = json.data?.plan?.maxMonthlyUsageUsd
let used = json.data?.usage?.monthlyUsageUsd

// Fallback на отдельный endpoint /users/me/usage/monthly если usage отсутствует
let usageEndpoint: "users-me" | "usage-monthly" = "users-me"
if (typeof used !== "number") {
  console.warn(
    `[balance/apify] /users/me не вернул usage.monthlyUsageUsd, пробуем /users/me/usage/monthly. raw:`,
    JSON.stringify(json).slice(0, 500),
  )
  try {
    const monthly = await $fetch<ApifyMonthlyUsageResponse>(
      `${APIFY_API_URL}/users/me/usage/monthly`,
      { query: { token }, timeout: REQUEST_TIMEOUT_MS },
    )
    used = monthly.data?.monthlyServiceUsage?.totalUsageCreditsUsdAfterVolumeDiscount
      ?? monthly.data?.totalUsageCreditsUsdAfterVolumeDiscount
    usageEndpoint = "usage-monthly"
  } catch (monthlyErr) {
    console.warn(
      `[balance/apify] /users/me/usage/monthly тоже упал:`,
      monthlyErr instanceof Error ? monthlyErr.message : String(monthlyErr),
    )
  }
}

if (typeof limit !== "number" || typeof used !== "number") {
  return this.fallbackToManual(
    startedAt,
    `Apify API не вернул limit (${typeof limit}) или used (${typeof used}) ни в /users/me, ни в /users/me/usage/monthly`,
  )
}

// metadata.usageEndpoint — чтобы видеть какой endpoint реально сработал
```

В возврат добавить `metadata.usageEndpoint`.

**Edge cases:**
1. `limit` может отсутствовать на enterprise-планах без явного monthly cap.
   Если `limit` undefined но `used` есть — fallback (как сейчас); пользователь увидит
   причину в notes и сможет ввести лимит вручную.
2. Двойной запрос только при отсутствии `usage.monthlyUsageUsd` в `/users/me` — обычный
   путь остаётся однозапросным.
3. Если Apify возвращает поле с другим именем (например, `totalUsageCreditsUsd`
   без суффикса `AfterVolumeDiscount`) — увидим в console.warn raw и поправим точечно.

**DoD:**
- На реальном APIFY_TOKEN: `services[].balance.source === "api"`, `metadata.usageEndpoint` есть.
- При искусственной поломке поля `usage` (mock): второй endpoint срабатывает, source=api.
- При сломанном токене: fallback, raw залогирован.
- typecheck чистый.

---

### Задача B-4 — Raw-лог при неожиданной структуре ответа

**Файл 1:** `server/utils/balance/providers/nodemaven-api-provider.ts`, строки 66-71

**Что было:**
```ts
if (typeof remainingGb !== "number" || typeof limitGb !== "number") {
  return this.fallbackToManual(
    startedAt,
    "NodeMaven API не вернул traffic.remaining_gb / traffic.limit_gb",
  )
}
```

**Что станет:**
```ts
if (typeof remainingGb !== "number" || typeof limitGb !== "number") {
  // Raw для диагностики - первые 800 символов, чтобы не залить logs
  console.warn(
    `[balance/nodemaven] unexpected response structure (authMode=${authMode}). raw:`,
    JSON.stringify(json).slice(0, 800),
  )
  return this.fallbackToManual(
    startedAt,
    `NodeMaven API не вернул traffic.remaining_gb / traffic.limit_gb (authMode=${authMode})`,
  )
}
```

**Файл 2:** `server/utils/balance/providers/apify-api-provider.ts` — `console.warn` уже
добавлен в B-3 (в строке fallback на `/users/me/usage/monthly`). Дополнительно для
итогового fallback (когда оба endpoint'а не сработали) — добавить raw первого ответа:

```ts
if (typeof limit !== "number" || typeof used !== "number") {
  console.warn(
    `[balance/apify] final fallback. /users/me raw:`,
    JSON.stringify(json).slice(0, 800),
  )
  return this.fallbackToManual(...)
}
```

**Edge cases:**
1. Raw может содержать чувствительные данные (username, plan id). Plan id не PII, username
   уже логируется в `metadata`. Email или token в `/users/me` Apify/NodeMaven не возвращают.
   500-800 символов достаточно для диагностики структуры без полного дампа.
2. `JSON.stringify` упадёт на циклических ссылках — но `$fetch` возвращает уже парсенный
   JSON без циклов. Защита не нужна.
3. Логи попадут в stdout pod'а Saturn — доступны через `kubectl logs` / Saturn logs panel.

**DoD:**
- Намеренно сломав поле (например, переименовав в mock'е) видим warn в логе.
- Логи **не** содержат значение `apiKey` / `token` (визуальная проверка).
- typecheck чистый.

---

## Раздел 3. Frontend задачи

Порядок выполнения: **F-5 → F-1 → F-2 → F-3 → F-4 → F-6**. F-5 первый, чтобы все
последующие правки шли уже в новом компоненте.

### Задача F-5 — Извлечь модалку в `app/components/admin/BalanceEditModal.vue`

**Эталон:** `app/components/account/AccountCreateModal.vue` (см. источник).

**Создать файл:** `app/components/admin/BalanceEditModal.vue`

**Props:**
```ts
defineProps<{
  row: AdminServiceBalanceRow | null  // null когда модалка закрыта
}>()
```

**Emits:**
```ts
defineEmits<{
  close: []
  saved: []  // парент делает refresh
}>()
```

**Expose:**
```ts
defineExpose({ open: (row: AdminServiceBalanceRow) => void, close: () => void })
```

Внутри: `dialogRef = ref<HTMLDialogElement>()`, `open(row)` сохраняет row + префилит
поля + вызывает `dialogRef.value?.showModal()`. `close()` вызывает `dialogRef.value?.close()`
и `emit("close")`.

**Структура шаблона** (~120 строк):
```vue
<dialog ref="dialogRef" class="modal">
  <div class="modal-box max-w-lg">
    <h3 class="font-bold text-lg mb-1">Обновить баланс: {{ currentRow?.label }}</h3>
    <p class="text-xs text-base-content/60 mb-2">
      <!-- F-3: кликабельный hint -->
    </p>

    <!-- source alerts (existing): api / estimate / fallback / manual (F-4) -->
    <!-- F-2: hint для quota-сервисов (nodemaven) -->

    <fieldset class="fieldset mb-3">
      <legend class="fieldset-legend">Сумма</legend>
      <input ... />
      <!-- F-1 hint: «Подтянуто из API, проверьте» если source=api -->
    </fieldset>

    <fieldset class="fieldset mb-3">
      <legend class="fieldset-legend">Валюта</legend>
      <select class="select select-sm w-full" v-model="editCurrency">
        <option v-for="c in BALANCE_CURRENCIES" :key="c" :value="c">{{ c }}</option>
      </select>
    </fieldset>

    <fieldset class="fieldset mb-3">
      <legend class="fieldset-legend">Заметки (необязательно)</legend>
      <textarea ... />
    </fieldset>

    <div v-if="error" class="alert alert-error mb-3">...</div>

    <div class="modal-action">
      <button class="btn btn-sm btn-ghost" @click="close">Отмена</button>
      <button class="btn btn-sm btn-primary" @click="save">
        <span v-if="saving" class="loading loading-spinner loading-xs" />
        Сохранить
      </button>
    </div>
  </div>
  <form method="dialog" class="modal-backdrop">
    <button @click="close">close</button>
  </form>
</dialog>
```

**Префилл с автоподстановкой (требование п.4):**
```ts
function open(row: AdminServiceBalanceRow) {
  currentRow.value = row
  // Автоподстановка: текущее значение из row (manual или api fetched)
  editAmount.value = row.balance?.balance?.amount?.toString() ?? ""
  editCurrency.value = row.balance?.balance?.currency ?? row.defaultCurrency
  editNotes.value = row.balance?.notes ?? ""
  error.value = null
  dialogRef.value?.showModal()
}
```

Если `row.balance?.source === "api"` — в шаблоне над input «Сумма» показать
`<p class="text-xs text-base-content/60 mt-1">Подтянуто из API, проверьте перед сохранением.</p>`.

**Изменения в `balances.vue` после извлечения:**
```vue
<script setup lang="ts">
// удалить editing, editAmount, editCurrency, editNotes, saving, error, openEdit, closeEdit, save
const modalRef = ref<InstanceType<typeof BalanceEditModal>>()
function onSaved() { refresh() }
</script>

<template>
  ...
  <button class="btn btn-xs btn-ghost" @click="modalRef?.open(row)">
    <Icon name="mingcute:edit-line" />
    Изменить
  </button>
  ...
  <BalanceEditModal ref="modalRef" @saved="onSaved" />
</template>
```

`balances.vue` сократится с 327 строк до ~220.

**Edge cases:**
1. Открытие из таблицы — клик передаёт `row` напрямую в `modalRef.open(row)`. Не нужен
   reactive `editing` в странице.
2. `row` reactive — если фоновый `refresh()` обновит данные пока модалка открыта,
   `currentRow` останется снимком. Это **намеренно** — пользователь не должен видеть
   перепрыгивание значения посреди ввода.
3. `defineExpose` нужен — `ref` к компоненту используется для императивного `open(row)`.
4. Импорт типа: `import type { AdminServiceBalanceRow } from "~/composables/useAdminBalances"`.

**DoD:**
- `BalanceEditModal.vue` существует, ≤220 строк, импортируется в `balances.vue`.
- `balances.vue` ≤230 строк.
- Кнопка «Изменить» открывает модалку через `showModal()` (нативный backdrop).
- typecheck чистый.

---

### Задача F-1 — Валюта = `<select>` + константа `BALANCE_CURRENCIES`

**Файл 1:** `app/composables/useAdminBalances.ts` — добавить экспорт:

```ts
// Список валют для select в модалке. Расширяется добавлением кода ISO 4217.
// USD первый — текущий дефолт для всех 6 сервисов.
export const BALANCE_CURRENCIES = ["USD", "EUR", "RUB"] as const
export type BalanceCurrency = typeof BALANCE_CURRENCIES[number]
```

**Файл 2:** `app/components/admin/BalanceEditModal.vue` — в `<script setup>`:
```ts
import { BALANCE_CURRENCIES } from "~/composables/useAdminBalances"
```

В шаблоне — заменить input на select (см. F-5 псевдокод). Defensive: если
`row.balance?.balance?.currency` отсутствует в `BALANCE_CURRENCIES` (например, legacy
запись с "GBP") — добавить её в options динамически:

```ts
const currencyOptions = computed<readonly string[]>(() => {
  const cur = currentRow.value?.balance?.balance?.currency
  if (cur && !BALANCE_CURRENCIES.includes(cur as BalanceCurrency)) {
    return [...BALANCE_CURRENCIES, cur]
  }
  return BALANCE_CURRENCIES
})
```

**Edge cases:**
1. Если backend начнёт принимать только enum — поломается на legacy записях.
   Сейчас backend (PUT `/api/admin/balances/[service]`) валидирует `currency` как
   опциональный string. Менять backend **не нужно** — select только UX-ограничение.
2. NodeMaven valor `metadata.plan` — не валюта, не путать. Селект всегда показывает
   валюту (USD по умолчанию).

**DoD:**
- В модалке вместо input текстового — select из трёх валют.
- Default = `row.defaultCurrency` (USD для всех 6 сервисов).
- Сохранение работает, currency приходит в PUT-payload.

---

### Задача F-2 — Подсказка для quota-сервисов (NodeMaven)

**Файл:** `app/components/admin/BalanceEditModal.vue`

В шаблоне — над input «Сумма» условный блок:

```vue
<div
  v-if="currentRow?.key === 'nodemaven'"
  role="alert"
  class="alert alert-info alert-soft text-xs mb-3"
>
  <Icon name="mingcute:information-line" />
  <span>
    NodeMaven — quota-сервис (трафик в GB). Введите <b>стоимость подписки в USD</b>
    для контроля общих расходов. Объём трафика обновляется автоматически из API и
    отображается в колонке «Текущий баланс».
  </span>
</div>
```

Подобный блок можно добавить позже для других quota-сервисов, если они появятся
(сейчас только NodeMaven в KNOWN_SERVICES имеет `quota`).

**Edge cases:**
1. Если NodeMaven попал в fallback (нет API ключа) — он покажется как обычный manual.
   Подсказка остаётся релевантной, оператор всё равно вводит цену подписки.
2. Hardcoded `key === 'nodemaven'` — компромисс ради простоты. Если добавится
   ещё quota-сервис — рефакторим в `KNOWN_SERVICES[].isQuota: boolean` (но это не
   часть текущего трека).

**DoD:**
- При открытии модалки для NodeMaven видна подсказка alert-info-soft.
- Для остальных 5 сервисов подсказка не показывается.

---

### Задача F-3 — Кликабельный dashboardHint

**Файл:** `app/components/admin/BalanceEditModal.vue`

**Что было** (после F-5 переезда из balances.vue:257-258):
```vue
<p v-if="currentRow?.dashboardHint" class="text-xs text-base-content/60 mb-2">
  Где взять: {{ currentRow.dashboardHint }}
</p>
```

**Что станет:**
```vue
<p v-if="currentRow?.dashboardHint" class="text-xs text-base-content/60 mb-2">
  Где взять:
  <a
    v-if="currentRow.dashboardHint.startsWith('https://')"
    :href="currentRow.dashboardHint"
    target="_blank"
    rel="noopener noreferrer"
    class="link link-primary"
  >
    {{ currentRow.dashboardHint }}
    <Icon name="mingcute:external-link-line" class="inline align-text-bottom" />
  </a>
  <span v-else>{{ currentRow.dashboardHint }}</span>
</p>
```

**Edge cases:**
1. Indigo и Mubert имеют hint в виде plain text (`"Indigo dashboard → Subscription"`).
   Они остаются как `<span>`. Условие `startsWith('https://')` это разделяет.
2. `target="_blank"` + `rel="noopener noreferrer"` — стандарт безопасности, чтобы
   открытая страница не получила доступ к `window.opener`.
3. Иконка mingcute external-link — уже используется в проекте (см. Glob `external-link`).

**DoD:**
- Для fal.ai/anthropic/apify/nodemaven — `<a>` с реальным URL, открывается в новой вкладке.
- Для indigo/mubert — обычный `<span>`.

---

### Задача F-4 — Алерт для source=manual

**Файл:** `app/components/admin/BalanceEditModal.vue`

В шаблоне после существующих alert'ов (api/estimate/fallback) добавить:

```vue
<div
  v-else-if="currentRow?.balance?.source === 'manual' || !currentRow?.balance?.source"
  class="alert alert-ghost text-xs mb-3"
>
  <Icon name="mingcute:edit-line" />
  <span>
    Ручной ввод. У сервиса нет публичного billing API — введите остаток с dashboard и
    обновляйте после каждого пополнения. Пороги low/critical настроены в
    <code>server/utils/balance/config.ts</code>.
  </span>
</div>
```

Логика alert chain в модалке (для копирования в F-5):
```vue
<div v-if="src === 'api'" class="alert alert-info text-xs mb-3">...</div>
<div v-else-if="src === 'estimate'" class="alert alert-warning text-xs mb-3">...</div>
<div v-else-if="src === 'fallback'" class="alert alert-error text-xs mb-3">
  API недоступен — показано последнее manual значение.
  <!-- ВАЖНО: показать причину fallback из notes -->
  <span v-if="fallbackReason" class="block mt-1 opacity-70">Причина: {{ fallbackReason }}</span>
</div>
<div v-else class="alert alert-ghost text-xs mb-3">...</div>  <!-- manual / undefined -->
```

Где `fallbackReason` — computed:
```ts
const fallbackReason = computed(() => {
  const notes = currentRow.value?.balance?.notes
  if (!notes) return null
  // Парсим "[fallback: ...]" из notes (формат providers)
  const m = notes.match(/\[fallback:\s*([^\]]+)\]/)
  return m ? m[1].trim() : null
})
```

**Edge cases (требование п.2 от пользователя):**
1. Причина fallback **должна** быть видна оператору, а не маскироваться. Парсим
   `[fallback: ...]` из `notes` (формат, который пишут providers — см.
   nodemaven-api-provider.ts:119, apify-api-provider.ts:108).
2. Если notes пустой — показываем только generic-сообщение без подробностей.
3. `source === undefined` (legacy запись без source) трактуем как manual.

**DoD:**
- Для manual-сервисов (Indigo, Mubert) виден ghost-alert.
- Для fallback (NodeMaven при отсутствии ключа) — alert-error + видна причина из notes.

---

### Задача F-6 — Бейдж «Авто недоступно» для MANUAL/ESTIMATE сервисов

**Файл 1:** `app/composables/useAdminBalances.ts` — helper:

```ts
/**
 * Сервисы у которых публичный billing API НЕ существует — авто-фетч невозможен по
 * дизайну, не по поломке. Используется для бейджа «Авто недоступно» в /admin/balances.
 */
export const AUTO_UNAVAILABLE_SERVICES = new Set(["indigo", "mubert"])

/**
 * true если у сервиса нет публичного billing API (manual/estimate by design).
 * Anthropic — отдельный случай: estimate работает (baseline - cost), это не «недоступно».
 */
export function isAutoUnavailable(serviceKey: string): boolean {
  return AUTO_UNAVAILABLE_SERVICES.has(serviceKey)
}
```

**Файл 2:** `app/pages/admin/balances.vue` — в колонке «Источник» (строки 217-222
до F-5 рефактора):

```vue
<td>
  <!-- Бейдж "Авто недоступно" для сервисов без billing API -->
  <div
    v-if="isAutoUnavailable(row.key)"
    class="badge badge-soft badge-neutral"
    title="У сервиса нет публичного billing API — обновляйте вручную"
  >
    <Icon name="mingcute:lock-line" class="text-xs" />
    Авто недоступно
  </div>
  <!-- Существующий source-бейдж -->
  <div
    v-else-if="sourceMeta(row.balance?.source)"
    class="badge badge-soft"
    :class="sourceMeta(row.balance?.source)!.badge"
  >
    {{ sourceMeta(row.balance?.source)!.icon }} {{ sourceMeta(row.balance?.source)!.label }}
  </div>
  <span v-else class="text-xs text-base-content/40">—</span>
</td>
```

**Edge cases (требование п.1 от пользователя — не маскировать):**
1. Бейдж заменяет «Manual» только для Indigo и Mubert. Это честный сигнал «здесь auto
   физически невозможен», а не «здесь auto сломался».
2. Для Anthropic остаётся бейдж «🧮 Estimate» (estimate работает корректно, это не
   маскировка). Не путать с «Авто недоступно».
3. Для fal.ai/apify/nodemaven при fallback — остаётся бейдж «⚠️ Fallback» (что
   значит «auto сейчас не работает, починим»). Это тоже не маскировка.

**Альтернатива (если оператор путается):** добавить второй бейдж рядом для Anthropic
типа «Без auto-fetch (estimate-only)» — но это уже отражено иконкой 🧮 + label Estimate
в текущем SOURCE_META. Не плодим.

**DoD:**
- В таблице у Indigo/Mubert вместо «📝 Manual» виден «🔒 Авто недоступно».
- У Anthropic — «🧮 Estimate».
- У fal.ai/apify/nodemaven при работе API — «🤖 API»; при поломке — «⚠️ Fallback».

---

## Раздел 4. Тестовый план для tester'а (Playwright MCP)

Окружение: **prod Saturn** `zavodcamp-mvf9nn.saturn.ac` (см. правило в памяти —
UI-проверки на проде, не локально).

Viewport: **1280×800** (десктоп админки).

### Сценарий 1. Backend auto-fetch верификация

1. Login через стандартный UI flow.
2. Перейти на `/admin/balances`.
3. **Screenshot 1:** таблица в начальном состоянии (после login кеш мог быть холодным).
4. Кликнуть «Обновить» (кнопка `btn-sm btn-ghost` рядом с заголовком).
5. Подождать `pending=false` (исчезновение spinner).
6. **Screenshot 2:** таблица после refresh.
7. **Проверки:**
   - fal.ai: бейдж «🤖 API» в колонке «Источник», amount > 0, currency = USD.
   - apify: бейдж «🤖 API», amount = (max - used) USD, > 0.
   - anthropic: бейдж «🧮 Estimate» (не «Авто недоступно»).
   - indigo: бейдж «🔒 Авто недоступно» (F-6).
   - mubert: бейдж «🔒 Авто недоступно» (F-6).
   - nodemaven: бейдж «🤖 API» если `NODEMAVEN_API_KEY` установлен на Saturn,
     иначе «⚠️ Fallback» (B-1 внешний блокер — упомянуть в отчёте).

### Сценарий 2. Модалка через реальный клик

1. На `/admin/balances` кликнуть «Изменить» в строке fal.ai.
2. **Screenshot 3:** модалка открыта.
3. **Проверки:**
   - Заголовок: «Обновить баланс: fal.ai».
   - Подсказка «Где взять:» содержит **кликабельную ссылку** `https://fal.ai/dashboard`
     с иконкой external-link (F-3).
   - Alert-info: «Автоматически фетчится из API...» (source=api).
   - Над input «Сумма» текст «Подтянуто из API, проверьте перед сохранением» (F-5 префилл).
   - Поле «Сумма» содержит реальное значение от API (не пусто, не плейсхолдер).
   - Поле «Валюта» — **`<select>`** (не input text) с опциями USD/EUR/RUB (F-1).
     По умолчанию выбрано USD.
   - Поле «Заметки» — textarea, пусто или с предыдущим значением.
   - Кнопки: «Отмена» (btn-sm btn-ghost), «Сохранить» (btn-sm btn-primary).
4. Закрыть модалку (Escape или клик на backdrop).

### Сценарий 3. Модалка для quota-сервиса (NodeMaven)

1. Кликнуть «Изменить» в строке nodemaven.
2. **Screenshot 4:** модалка nodemaven.
3. **Проверки:**
   - Видна **подсказка alert-info-soft** про quota-сервис (F-2): «NodeMaven — quota-сервис...».
   - Если nodemaven в fallback: видна причина fallback из notes (F-4) — «Причина: ...».
   - Источник «Где взять»: ссылка `https://nodemaven.com → Account → Plan` — НЕ
     кликабельная (не начинается с https) или кликабельная (если кто-то поправит hint).
     По текущему `config.ts:60` строка `"https://nodemaven.com → Account → Plan"` —
     начинается с https, **будет кликабельная**.

### Сценарий 4. Модалка для manual-сервиса (Indigo)

1. Кликнуть «Изменить» в строке indigo.
2. **Screenshot 5:** модалка indigo.
3. **Проверки:**
   - **Alert ghost** (F-4): «Ручной ввод. У сервиса нет публичного billing API...».
   - Подсказка «Где взять: Indigo dashboard → Subscription» — **plain text** (не ссылка,
     не начинается с https).
   - Бейдж в таблице (за модалкой) — «🔒 Авто недоступно».

### Сценарий 5. Сохранение и refresh

1. Открыть «Изменить» для любого manual-сервиса (Indigo).
2. Ввести Сумму = `42.50`, Валюта = USD.
3. Кликнуть «Сохранить».
4. **Проверки:**
   - Loading-spinner на кнопке во время saving.
   - Модалка закрывается.
   - Таблица обновляется (новое значение `42.50 USD` в Indigo).
   - Источник остаётся «🔒 Авто недоступно» (бейдж F-6 не зависит от source — он
     зависит от service key).

### Acceptance criteria для tester'а

Все 5 скриншотов сохранить в `tests/visual/balances-2026-05-25/` (см. правило про
`screens/`, но для visual-audit используем `tests/visual/`). Verdict:
- **CLEAN** если все проверки прошли.
- **PASS WITH NOTES** если NodeMaven в fallback (внешний блокер B-1 — не наша поломка).
- **NEEDS REWORK** если: бейдж F-6 не виден / select валюты отсутствует / dashboardHint
  не кликабельный / модалка открывается без `showModal()` (без backdrop overlay).

---

## Раздел 5. Внешние блокеры

Повторяю из ресёрча, чтобы зафиксировать в плане:

### E1. NODEMAVEN_API_KEY отсутствует на Saturn

**Факт:** В `.env` Saturn нет строки `NODEMAVEN_API_KEY`. В `.env.example:72`
закомментировано.

**Действие пользователя:** получить ключ из NodeMaven Dashboard → Profile → API key,
добавить в Saturn env vars.

**Влияние на implementer'а:** **нулевое**. После B-2 провайдер готов работать с
правильным форматом заголовка как только ключ появится. До тех пор NodeMaven
останется в fallback — это нормально и видно в UI как «⚠️ Fallback» (не «Авто
недоступно», потому что AUTO потенциально возможен).

### E2. MUBERT_KEY = placeholder

**Факт:** `.env:16` содержит `MUBERT_KEY=your-mubert-api-key`.

**Действие пользователя:** установить реальный ключ — но **не для balance** (Mubert
всегда ManualBalanceProvider, ключ для генерации музыки в pipeline).

**Влияние на implementer'а:** **нулевое**. Mubert получит бейдж «🔒 Авто недоступно»
(F-6) независимо от MUBERT_KEY.

### E3. Anthropic — нет публичного billing API

Это **архитектурное ограничение Anthropic**, не блокер. Estimate-подход корректен,
ничего менять не нужно.

---

## Раздел 6. Чек-лист готовности перед коммитом

### Коммит 1 (Backend)

- [ ] `pnpm run typecheck` — 0 ошибок.
- [ ] `pnpm run test:api` — 33/33 PASS (или текущий baseline без регрессий).
- [ ] Запуск `pnpm dev` локально с фейковым `APIFY_TOKEN=test_invalid` →
  видим warn `[balance/apify] /users/me не вернул ...` в console.
- [ ] Запуск с фейковым `NODEMAVEN_API_KEY=test_invalid` → видим попытку x-api-key
  → 401/403 → попытку Bearer → fallback с warn в console.
- [ ] В возврате `/api/admin/balances` для apify видно `metadata.usageEndpoint`,
  для nodemaven видно `metadata.authMode` (при успешном auto).
- [ ] Логи **не** содержат значение `apiKey` / `token` (визуальная проверка).
- [ ] Никаких изменений в Prisma-схеме, никаких новых миграций.

### Коммит 2 (Frontend)

- [ ] `pnpm run typecheck` — 0 ошибок.
- [ ] `app/components/admin/BalanceEditModal.vue` создан, ≤220 строк.
- [ ] `app/pages/admin/balances.vue` ≤230 строк (сейчас 327).
- [ ] Модалка использует `<dialog ref="dialogRef">` + `dialogRef.value?.showModal()`
  (как `AccountCreateModal.vue`), а не `<dialog :open="...">`.
- [ ] `defineExpose({ open, close })` присутствует.
- [ ] Все fieldset/legend сохранены (паттерн из e3c01fe).
- [ ] DaisyUI v5 классы: `btn btn-sm btn-primary`, `select select-sm`, `input input-sm`,
  `textarea textarea-sm`, `alert alert-soft`, `badge badge-soft`. **Никаких**
  v4-классов: `input-bordered`, `textarea-bordered`, `select-bordered`,
  `file-input-bordered` (в v5 они no-op, см. предыдущий аудит 5a3fc1e).
- [ ] Валюта = `<select>` с константой `BALANCE_CURRENCIES` из composable.
- [ ] DashboardHint кликабельный для https-URL (fal.ai, anthropic, apify, nodemaven),
  plain для остальных (indigo, mubert).
- [ ] Alert для manual (ghost), для fallback видна причина из notes.
- [ ] Бейдж «🔒 Авто недоступно» только для indigo/mubert в колонке «Источник».
- [ ] Anthropic остался с бейджем «🧮 Estimate» (не «Авто недоступно»).
- [ ] Префилл при открытии: текущее значение row + при source=api подпись
  «Подтянуто из API, проверьте».
- [ ] Visual-audit от tester'а — verdict CLEAN или PASS WITH NOTES.

### Общие требования (оба коммита)

- [ ] Коммит-сообщение по `.claude/skills/commit/SKILL.md`: подробное описание
  что и зачем, без emoji.
- [ ] Никаких миграций Prisma.
- [ ] Никаких изменений в `KNOWN_SERVICES` (config.ts) — оставляем как есть.
- [ ] Никаких изменений в `enrich-variables.ts`, `formatter.ts`, `burn-rate.ts`.
- [ ] Не трогать Anthropic provider (по дизайну он работает корректно).

---

## Связи с памятью

- [[feedback_modal_pattern]] — эталон модалки = `AccountCreateModal.vue`, скопирован.
- [[feedback_test_on_prod]] — UI-проверки на Saturn prod.
- [[project_storage_gcs_migration]] — не релевантно (balances работают только с БД).
- [[balance_complete]] — предыдущий план (2026-05-15), результат которого мы дорабатываем.
- [[balance_v2_plan]] — burn-rate (AiAuditLog cost ledger), не трогаем в этом треке.
