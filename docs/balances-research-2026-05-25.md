# Balance Layer Research — ZavodCamp 2026-05-25

Исследование текущего состояния balance-слоя на основе чтения реального кода.
Никаких предположений — только факты из файлов и публичной документации.

---

## Раздел A. Текущая архитектура

### A1. Prisma-модель ServiceBalanceEntry

**Файл:** `prisma/schema.prisma:2070`

```
model ServiceBalanceEntry {
  id        Int      @id @default(autoincrement())
  service   String   @unique          // fal.ai | anthropic | indigo | nodemaven | mubert
  amount    Decimal  @db.Decimal(10, 2)
  currency  String   @default("USD")
  metadata  Json?    // доп. данные: traffic_left_gb, days_remaining и т.п.
  enteredBy Int?     // userId
  enteredAt DateTime @default(now()) @updatedAt
  notes     String?

  @@index([service])
  @@index([enteredAt])
}
```

**Важно:** enum для source отсутствует в Prisma. Source — это TypeScript-тип `BalanceSource` из `server/utils/balance/types.ts:15`:
```
type BalanceSource = "api" | "manual" | "estimate" | "fallback"
```

`@@unique` на `service` → upsert по service-ключу, одна запись на сервис.
`enteredAt @updatedAt` — перезаписывается при каждом upsert.

**Связанная таблица:** `AiAuditLog` (расширена миграцией `20260522190000_balance_v2_cost_ledger`):
- Добавлены `service TEXT`, `videoId INTEGER`, `stepKey TEXT`
- Индексы `(service, createdAt)` и `videoId`
- Backfill: `UPDATE AiAuditLog SET service='anthropic' WHERE model LIKE 'claude%'`

### A2. Типы и интерфейсы

**Файл:** `server/utils/balance/types.ts`

```typescript
type BalanceStatus = "ok" | "low" | "critical" | "unknown" | "error"
type BalanceSource = "api" | "manual" | "estimate" | "fallback"

interface ServiceBalance {
  service: string
  status: BalanceStatus
  source?: BalanceSource
  balance?: { currency: string; amount: number }
  quota?: { used: number; limit: number; unit: string }
  expiry?: { daysRemaining: number; expiresAt: string }
  lowThreshold?: number
  criticalThreshold?: number
  checkedAt: string
  durationMs: number
  enteredAt?: string
  enteredByUserId?: number | null
  notes?: string | null
  metadata?: Record<string, unknown> & { burnRate?: BurnRate }
  error?: string
}
```

### A3. Конфигурация сервисов

**Файл:** `server/utils/balance/config.ts`

6 известных сервисов с порогами:
| service key | label | low | critical | defaultCurrency | dashboardHint |
|---|---|---|---|---|---|
| fal.ai | fal.ai | 5 | 1 | USD | https://fal.ai/dashboard |
| anthropic | Anthropic Claude | 10 | 2 | USD | https://console.anthropic.com/settings/billing |
| apify | Apify | 5 | 1 | USD | https://console.apify.com/billing |
| indigo | Indigo Browser | 10 | 0 | USD | Indigo dashboard → Subscription |
| nodemaven | NodeMaven Proxy | 5 | 1 | USD | https://nodemaven.com → Account → Plan |
| mubert | Mubert Music | 5 | 1 | USD | Mubert dashboard → Subscription |

### A4. Registry провайдеров

**Файл:** `server/utils/balance/provider-registry.ts`

| service | провайдер-класс | source при успехе |
|---|---|---|
| fal.ai | FalApiBalanceProvider | api (fallback → fallback) |
| anthropic | AnthropicEstimateBalanceProvider | estimate |
| apify | ApifyApiBalanceProvider | api (fallback → fallback) |
| nodemaven | NodeMavenApiBalanceProvider | api (fallback → fallback) |
| indigo | ManualBalanceProvider | manual |
| mubert | ManualBalanceProvider | manual |

### A5. Поток данных (полный)

```
GET /api/admin/balances
  └─ requirePermission(event, "canAdmin")                 // server/api/admin/balances/index.get.ts:10
  └─ fetchAllBalances({ skipCache: true })                // aggregator.ts:35
       ├─ getAllProviders()                               // 6 провайдеров параллельно
       ├─ Promise.all + withTimeout(5000ms)              // aggregator.ts:45
       ├─ computeBurnRate(service, baseline, 7days)      // burn-rate.ts: AiAuditLog за 7 дней
       └─ cache.set(TTL=5min)                            // globalThis.__balanceCache
  └─ KNOWN_SERVICES.map() + b = balances.find()         // index.get.ts:16
  └─ return { data: { services: [...] } }

PUT /api/admin/balances/[service]
  └─ requirePermission(event, "canAdmin")
  └─ isKnownService(service) — валидация по KNOWN_SERVICES
  └─ Zod: { amount: number 0..1M, currency?: string, notes?: string, metadata?: Record }
  └─ prisma.serviceBalanceEntry.upsert({ where: { service } })
  └─ invalidateBalanceCache()                            // очищает globalThis.__balanceCache
```

**Кеш:** in-memory `Map` на `globalThis`, TTL 5 минут, сбрасывается при PUT.
**Таймаут провайдера:** 5000ms — при превышении возвращает `{ status: "error", source: "fallback" }`.

---

## Раздел B. Таблица по 6 провайдерам

### B1. Детали по каждому провайдеру

---

**fal.ai**
- **Файл провайдера:** `server/utils/balance/providers/fal-api-provider.ts`
- **Endpoint провайдера:** `GET https://api.fal.ai/v1/account/billing?expand=credits`
- **Auth:** `Authorization: Key ${FAL_KEY}` — тот же ключ что для генерации
- **Env-ключ:** `FAL_KEY` (строка 60)
- **Статус на Saturn:** присутствует (`dd93bdfd-55ab-43de-...`)
- **Поля ответа:** `credits.current_balance` (number), `credits.currency` (string)
- **Fallback-условия:** `isFalMockMode()` | `!FAL_KEY` | ответ без `credits.current_balance` | любая HTTP-ошибка (catch)
- **Статус provider'а:** source=`api`. Реализован корректно.
- **Что чинить:** ничего — endpoint задокументирован, реализация правильная. При 403 в runtime: проверить scope ключа (должен быть platform key, не read-only). Нет известных дефектов.

---

**Anthropic**
- **Файл провайдера:** `server/utils/balance/providers/anthropic-estimate-provider.ts`
- **Endpoint провайдера:** не зовёт HTTP API
- **Алгоритм:** `ServiceBalanceEntry.amount` (baseline) - `SUM(AiAuditLog.costUsd WHERE service='anthropic' AND createdAt >= baseline.enteredAt)`
- **Env-ключ:** не нужен для estimate (использует Prisma)
- **Статус:** source=`estimate`
- **Публичный billing API Anthropic:** НЕТ для стандартного ключа. Существует `GET /v1/organizations/cost_report` и usage-report, но требует `sk-ant-admin...` (Admin API Key, отдельный от `ANTHROPIC_API_KEY`). Даже при наличии admin-ключа — возвращает spend-историю, не остаток баланса. AUTO невозможен.
- **Что чинить:** ничего архитектурного — estimate-подход правильный. Риск: если `AiAuditLog` не пишется (логирование сбоит), estimate занижается. Проверить callsites через `cost-ledger.ts`.

---

**Apify**
- **Файл провайдера:** `server/utils/balance/providers/apify-api-provider.ts`
- **Endpoint провайдера:** `GET https://api.apify.com/v2/users/me?token=<APIFY_TOKEN>`
- **Auth:** query param `token`
- **Env-ключ:** `APIFY_TOKEN` (строка 49)
- **Статус на Saturn:** присутствует (`apify_api_PQReAOW5JjtDjhM9Eqdz3ukRshDj4b1RnTeh`)
- **Поля ответа:** `data.plan.maxMonthlyUsageUsd`, `data.usage.monthlyUsageUsd`
- **Что возвращает:** `remaining = max - used` в USD
- **Fallback-условия:** `!APIFY_TOKEN` | отсутствие полей `plan.maxMonthlyUsageUsd` / `usage.monthlyUsageUsd` | HTTP-ошибка
- **Риск:** поле `data.usage.monthlyUsageUsd` не фигурирует в актуальной swagger-документации Apify (проверено 2026-05-22). Если Apify переименовали поле — provider упадёт в fallback через проверку `typeof used !== "number"`. Нужна runtime-верификация первого запроса.
- **Что чинить:** добавить логирование raw-ответа при fallback (сейчас только message ошибки). Рассмотреть альтернативное поле `GET /v2/users/me/usage/monthly → totalUsageCreditsUsdAfterVolumeDiscount`.

---

**Indigo**
- **Файл провайдера:** `server/utils/balance/provider-registry.ts:27` → `ManualBalanceProvider`
- **Endpoint провайдера:** нет
- **Публичный billing API:** НЕТ. Документация `faq.indigobrowser.com/api/` покрывает только profile CRUD и CDP automation. Subscription-based SaaS, цена фиксированная.
- **Env-ключ:** не требуется для ManualBalanceProvider
- **Статус на Saturn:** INDIGO_API_BASE / INDIGO_LAUNCHER_BASE — присутствуют в `.env.example` как закомментированные. В `.env` (Saturn) не найдены.
- **source:** `manual`
- **Что чинить:** ничего. Правильный выбор — ManualBalanceProvider. Для утилизации можно добавить счётчик браузерных сессий, но это не баланс.

---

**NodeMaven**
- **Файл провайдера:** `server/utils/balance/providers/nodemaven-api-provider.ts`
- **Endpoint провайдера:** `GET https://dashboard.nodemaven.com/api/v2/users/me`
- **Auth:** `Authorization: Bearer ${NODEMAVEN_API_KEY}`
- **Env-ключ:** `NODEMAVEN_API_KEY` (строка 49)
- **Статус на Saturn:** ОТСУТСТВУЕТ в `.env`. В `.env.example:72` закомментирован: `# NODEMAVEN_API_KEY=`
- **Поля ответа (defensive, неверифицированные):** `traffic.remaining_gb`, `traffic.limit_gb`, `subscription.plan`, `subscription.expires_at`
- **Swagger API:** `https://dashboard.nodemaven.com/documentation/v2/swagger/` — требует авторизации, не публично доступен
- **Auth формат:** подтверждён документацией (NodeMaven Help Center): `x-api-key <your-api-key>` — но провайдер использует `Authorization: Bearer`. Возможно расхождение формата заголовка.
- **Что чинить:** БЛОКЕР — `NODEMAVEN_API_KEY` отсутствует на Saturn. Провайдер немедленно падает в `fallbackToManual("NODEMAVEN_API_KEY не настроен")`. Кроме того: (1) верифицировать формат заголовка auth (`x-api-key` vs `Bearer`), (2) верифицировать поля ответа при первом успешном запросе.

---

**Mubert**
- **Файл провайдера:** `server/utils/balance/provider-registry.ts:28` → `ManualBalanceProvider`
- **Endpoint провайдера:** нет
- **Публичный billing/balance API:** НЕТ. Mubert API v3 (mubertmusicapiv3.docs.apiary.io) содержит только генеративные endpoints (generate track, stream). Нет `/account`, `/subscription`, `/quota`.
- **Env-ключ:** `MUBERT_KEY` присутствует в `.env.example:62`, значение на Saturn: `your-mubert-api-key` (placeholder — НЕ настроен).
- **Статус на Saturn:** MUBERT_KEY = placeholder `your-mubert-api-key` — ключ не настроен. При попытке генерации музыки через `server/utils/mubert.ts` — завершится ошибкой.
- **source:** `manual`
- **Что чинить:** MUBERT_KEY нужно установить для работы музыкального pipeline. Для balance — оставить ManualBalanceProvider.

---

### B2. Сводная таблица

| Сервис | Тип provider | Endpoint провайдера | Env-ключ | Ключ на Saturn | Что чинить |
|---|---|---|---|---|---|
| fal.ai | AUTO (api) | `https://api.fal.ai/v1/account/billing?expand=credits` | `FAL_KEY` | есть | ничего; при 403 — проверить scope ключа |
| anthropic | ESTIMATE | нет HTTP | `ANTHROPIC_API_KEY` (не нужен) | есть | ничего; PUBLIC billing API требует admin-key, не существует |
| apify | AUTO (api) | `https://api.apify.com/v2/users/me?token=...` | `APIFY_TOKEN` | есть | верифицировать поле `usage.monthlyUsageUsd` в runtime |
| indigo | MANUAL | нет | нет | н/д | нет billing API, правильно ManualBalanceProvider |
| nodemaven | AUTO (api) | `https://dashboard.nodemaven.com/api/v2/users/me` | `NODEMAVEN_API_KEY` | **ОТСУТСТВУЕТ** | добавить ключ; проверить auth-формат заголовка |
| mubert | MANUAL | нет | `MUBERT_KEY` | **placeholder** | нет billing API; MUBERT_KEY надо установить для генерации |

---

## Раздел C. Frontend модалка

### C1. Страница /admin/balances

**Файл:** `app/pages/admin/balances.vue` (327 строк)

**Архитектура:**
- Встроенная модалка (`<dialog :open="editing !== null">`), не выделенный компонент. Весь код inline в странице.
- Composable: `useAdminBalances()` → `useFetch("/api/admin/balances", key: "admin-balances")`
- Мутация: `updateServiceBalance(key, { amount, currency, notes })` → `$fetch("/api/admin/balances/${service}", method: "PUT")`

**Текущие поля модалки (строки 274-304):**

1. **Сумма** — `<input type="text" inputmode="decimal">` с `v-model="editAmount"`.
   Валидация: `Number(editAmount.replace(",", "."))` — принимает как точку, так и запятую.

2. **Валюта** — `<input type="text" v-model="editCurrency" maxlength="8">`.
   **Проблема:** свободный текст вместо select. Пользователь может ввести любую строку. Для 6 сервисов валюта фиксированная (fal.ai, anthropic, apify → USD; nodemaven → GB для трафика). Select с предустановленными вариантами был бы правильнее.

3. **Заметки** — `<textarea v-model="editNotes" maxlength="500">` — нормально.

**Контекстные алерты в модалке (строки 261-272):**
- `source === 'api'` → alert-info: "Автоматически фетчится. Manual — резерв при недоступности API."
- `source === 'estimate'` → alert-warning: "Baseline для расчёта расхода. Введите после top-up."
- `source === 'fallback'` → alert-error: "API недоступен — показано последнее manual значение. Проверьте .env."
- `source === 'manual'` или `undefined` → нет алерта.

**Таблица (строки 187-249):**
- Колонки: Сервис | Текущий баланс | Статус | Источник (badge) | Расход/день | Дней до 0 | Пороги | Обновлено | Заметки | [Изменить]
- Форматирование: `formatAmount` поддерживает balance (USD), quota (GB), expiry (дни)
- burn-rate: `formatBurnRate` → `$X.XX/д`, `formatDaysLeft` → `~N дн.` из `metadata.burnRate`
- Цветовая индикация: `burnRateColorClass` → `text-error` если < 2 дней, `text-warning` если < 7

**Открытие модалки:** кнопка "Изменить" (строка 239) вызывает `openEdit(row)`:
```typescript
editAmount.value = row.balance?.balance?.amount?.toString() ?? ""
editCurrency.value = row.balance?.balance?.currency ?? row.defaultCurrency
editNotes.value = row.balance?.notes ?? ""
```

**Проблема с NodeMaven:** для него `balance?.balance` = `undefined` (quota-сервис, возвращает `quota.remaining_gb`, а не `balance.amount`). При открытии модалки `editAmount` = `""`, `editCurrency` = defaultCurrency = "USD". Оператор должен вводить сумму в USD (цена подписки), а не GB. Это концептуальная несостыковка для quota-сервисов.

### C2. Composable

**Файл:** `app/composables/useAdminBalances.ts` (52 строки)

`AdminServiceBalanceRow` содержит всё необходимое: key, label, defaultCurrency, lowThreshold, criticalThreshold, dashboardHint + полный `ServiceBalance | null`.

---

## Раздел D. Карта работ для implementer'а

### D.1 Backend — провайдеры (приоритет: устранение блокеров)

**Задача B-1: Установить NODEMAVEN_API_KEY на Saturn**
- Файл: `.env` — добавить строку `NODEMAVEN_API_KEY=<реальный ключ>`
- Где брать ключ: https://nodemaven.com → Profile → API key
- Блокер для auto-fetch NodeMaven

**Задача B-2: Верифицировать auth-формат NodeMaven**
- Файл: `server/utils/balance/providers/nodemaven-api-provider.ts:57`
- Текущий код: `headers: { Authorization: \`Bearer ${apiKey}\` }`
- Документация NodeMaven Help Center указывает формат `x-api-key <key>`. Если Bearer не работает — изменить на `{ "x-api-key": apiKey }`.
- Верификация: запустить в dev с реальным ключом, посмотреть logs.

**Задача B-3: Верифицировать поля Apify в runtime**
- Файл: `server/utils/balance/providers/apify-api-provider.ts:60-68`
- Текущий код проверяет `data.plan.maxMonthlyUsageUsd` и `data.usage.monthlyUsageUsd`
- Риск: `usage.monthlyUsageUsd` может не существовать в актуальной API
- Если fallback срабатывает — переключиться на: `GET /v2/users/me/usage/monthly` → поле `totalUsageCreditsUsdAfterVolumeDiscount` (более стабильное)

**Задача B-4: Добавить raw-лог при fallback NodeMaven/Apify**
- Файлы: `nodemaven-api-provider.ts:108`, `apify-api-provider.ts:98`
- Текущий код: только `message` из Error. Добавить `console.warn('[provider] raw response:', JSON.stringify(json))` перед fallback при неожиданной структуре (условие `typeof x !== "number"`).

**Задача B-5: Установить MUBERT_KEY на Saturn**
- Файл: `.env` — текущее значение `your-mubert-api-key` — placeholder
- Без реального ключа музыкальный pipeline упадёт
- Не блокирует balance (Mubert → ManualBalanceProvider), но блокирует генерацию музыки

### D.2 Frontend — UX улучшения

**Задача F-1: Заменить input[text] для валюты на select**
- Файл: `app/pages/admin/balances.vue:285-292` (fieldset "Валюта")
- Текущий код: `<input type="text" v-model="editCurrency">`
- Что сделать: заменить на `<select class="select select-sm w-full">` с вариантами по `editing.defaultCurrency` + стандартные USD/EUR/RUB
- Для quota-сервисов (NodeMaven) показывать "Стоимость подписки (USD)" вместо "Валюта"

**Задача F-2: Улучшить модалку для quota-сервисов (NodeMaven)**
- Файл: `app/pages/admin/balances.vue:274-320`
- Проблема: NodeMaven возвращает quota (GB), но модалка предлагает ввести amount в USD
- Что сделать: добавить условие `editing.key === 'nodemaven'` → показывать подсказку "Введите стоимость подписки в USD (для контроля расходов), трафик обновится автоматически из API"

**Задача F-3: Добавить dashboardHint как кликабельную ссылку**
- Файл: `app/pages/admin/balances.vue:257-258`
- Текущий код: `<p>Где взять: {{ editing.dashboardHint }}</p>` — plain text
- Что сделать: если dashboardHint начинается с `https://` — рендерить как `<a target="_blank">`, иначе plain text

**Задача F-4: Добавить source badge в модалку при отсутствии alerta**
- Файл: `app/pages/admin/balances.vue:261-272`
- Для `source === 'manual'` нет алерта. Добавить `<div class="alert alert-ghost text-xs">` с пояснением "Введите значение вручную с dashboard сервиса."

**Задача F-5: Извлечь модалку в отдельный компонент (декомпозиция)**
- Файл: `app/pages/admin/balances.vue` — 327 строк, из которых 80 строк — модалка
- Создать `app/components/admin/BalanceEditModal.vue`
- Это снизит сложность страницы и упростит тестирование

---

## Раздел E. Внешние блокеры

### E1. NODEMAVEN_API_KEY — ОТСУТСТВУЕТ

**Факт:** В `.env` (Saturn) нет строки `NODEMAVEN_API_KEY`. В `.env.example:72` закомментирована: `# NODEMAVEN_API_KEY=`.

**Следствие:** `NodeMavenApiBalanceProvider.fetchBalance()` сразу возвращает `fallbackToManual("NODEMAVEN_API_KEY не настроен")`. Auto-fetch НИКОГДА не срабатывает.

**Действие:** получить ключ из NodeMaven Dashboard → Profile → API key, добавить в `.env`.

**Дополнительно:** проверить auth-заголовок (Bearer vs x-api-key) при первом тесте.

### E2. MUBERT_KEY — placeholder

**Факт:** `.env:16` содержит `MUBERT_KEY=your-mubert-api-key`.

**Следствие:** для balance — без влияния (ManualBalanceProvider не использует ключ). Для генерации музыки в pipeline — музыкальный шаг упадёт при обращении к Mubert API.

**Действие:** получить реальный ключ у Mubert (B2B/Enterprise), установить в `.env`.

### E3. Anthropic — нет PUBLIC billing REST API

**Факт:** Anthropic не предоставляет endpoint для запроса остатка баланса через стандартный `ANTHROPIC_API_KEY`. Существует Usage API (`GET /v1/organizations/cost_report`), требующий Admin API Key (`sk-ant-admin...`), который выдаётся отдельно для организаций. Даже при наличии admin-ключа он возвращает только spend-историю, не текущий остаток.

**Следствие:** для Anthropic единственно рабочий автоматический подход — `estimate` (baseline − AiAuditLog.costUsd). Это уже реализовано.

**Действие:** никаких. `AnthropicEstimateBalanceProvider` — правильная архитектура.

### E4. Indigo и Mubert — нет публичного billing API

**Факт:** Проверено через документацию:
- Indigo (`faq.indigobrowser.com/api/`) — только profile CRUD и CDP. Нет endpoints для subscription/billing.
- Mubert (`mubertmusicapiv3.docs.apiary.io`) — только генеративные endpoints. Нет `/account`, `/quota`, `/subscription`.

Оба сервиса — subscription-based с фиксированной ценой. Auto-fetch невозможен в принципе.

**Следствие:** ManualBalanceProvider для обоих — правильный и единственный вариант навсегда.

---

## Дополнительные факты

### Burn-rate

`server/utils/balance/burn-rate.ts` — агрегирует `AiAuditLog.costUsd` за последние 7 дней по `service`. Обогащает `ServiceBalance.metadata.burnRate`. Вызывается в `aggregator.ts` после fetch всех провайдеров. Defensive: при ошибке БД возвращает нули, не throw.

Для сервисов без `AiAuditLog` записей (indigo, nodemaven, apify) — `dailyAvgUsd = 0`. Колонки "Расход/день" и "Дней до 0" будут показывать `—`. Это нормально — они не логируются через cost-ledger.

### Enrich-variables

`server/utils/balance/enrich-variables.ts` — lazy hook для Telegram-шаблонов. Дёргает `fetchAllBalances()` (с cache) только если шаблон содержит `{{balance}}`, `{{balance_low_services}}`, `{{balance_total_usd}}`, `{{balance_burn_rate}}`. Без лишних запросов при отсутствии balance-переменных в шаблоне.

### Telegram /balance

`server/utils/balance/formatter.ts` — `formatBalancesForTelegram()`, `formatBalancesCompact()`, `formatLowServices()`, `formatBurnRates()`, `formatTotalUsd()`. Вся Telegram-интеграция собирает данные через тот же `fetchAllBalances()` с кешем.

### Apify account metrics

Отдельный от balance: `server/utils/apify-client.ts` использует `APIFY_TOKEN` для запуска actors (trendwatcher + account metrics). Это не balance-слой, но тот же ключ.

---

## Итог по приоритетам

**Блокеры (чинить до ввода в production):**
1. `NODEMAVEN_API_KEY` отсутствует — auto-fetch никогда не работает
2. `MUBERT_KEY` — placeholder — генерация музыки упадёт

**Требует runtime-верификации (проверить при первом запуске на prod):**
3. Apify: поле `data.usage.monthlyUsageUsd` — может исчезнуть из API

**Улучшения UX (не блокеры):**
4. Валюта в модалке — input text → select
5. Кликабельный dashboardHint
6. Извлечение BalanceEditModal в компонент
7. Подсказка для quota-сервисов (NodeMaven) в модалке
