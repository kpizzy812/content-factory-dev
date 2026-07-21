# Отчёт тестировщика — Трек «Балансы»
**Дата:** 2026-05-25  
**Тестировщик:** агент Tester (claude-sonnet-4-6)

---

## A. Что проверено

### 1. Статический анализ кода

#### `app/components/admin/BalanceEditModal.vue` (222 строки)

**Структура модалки — соответствует эталону AccountCreateModal.vue:**
- `const dialogRef = ref<HTMLDialogElement>()` — присутствует, тип корректен
- `dialogRef.value?.showModal()` в `open()` — присутствует
- `dialogRef.value?.close()` в `close()` — присутствует
- `defineExpose({ open, close })` — присутствует на строке 40
- `<dialog ref="dialogRef" class="modal" @close="emit('close')">` — структура совпадает с эталоном
- `<form method="dialog" class="modal-backdrop"><button @click="close">close</button></form>` — backdrop совпадает с эталоном
- `modal-box`, `modal-action` — оба присутствуют

**DaisyUI v5 классы:**
- Запрещённых классов (`input-bordered`, `select-bordered`, `textarea-bordered`, `alert-ghost`) нет
- `input input-sm`, `select select-sm`, `textarea textarea-sm` — корректны для v5
- `fieldset` + `fieldset-legend` — корректный паттерн v5
- `alert alert-soft`, `alert alert-info alert-soft`, `alert alert-warning alert-soft`, `alert alert-error alert-soft` — корректны
- `btn btn-sm btn-ghost`, `btn btn-sm btn-primary` — корректны

**select валюты:**
- `BALANCE_CURRENCIES` импортируется из composable строка 3
- `v-for="c in currencyOptions"` — используется computed с defensive fallback для legacy валют
- `BALANCE_CURRENCIES = ["USD", "EUR", "RUB"] as const` в composable подтверждено

**Условные alerts (F-2/F-3/F-4):**
- `v-if="src === 'api'"` (F-3 info-alert) — корректен
- `v-else-if="src === 'estimate'"` (F-4 warning-alert) — корректен
- `v-else-if="src === 'fallback'"` (F-4 error-alert с причиной) — корректен
- `v-else` (дефолт: ручной ввод, alert-soft без цвета) — корректен, покрывает `src === 'manual'` и `src === undefined`
- `v-if="isQuotaService"` (F-2 NodeMaven quota-hint) — корректен, ключ `"nodemaven"` совпадает с config.ts

**rel="noopener noreferrer":**
- Строки 108-109: `target="_blank" rel="noopener noreferrer"` — присутствует
- `isHttpsHint` computed защищает от ссылки на plain-text подсказку (Indigo/Mubert)

**dashboardHint NodeMaven:**
- `config.ts` строка 61: `dashboardHint: "https://dashboard.nodemaven.com/profile/api"` — чистый URL без текстовой обёртки

**Найдена и исправлена TS-ошибка:**
- Строка 50 (до исправления): `m[1].trim()` — TS2532 «Object is possibly undefined»
- Исправлено на: `m?.[1]?.trim() ?? null` — строго корректно для RegExpMatchArray

---

#### `app/pages/admin/balances.vue` (229 строк)

**Декомпозиция:**
- `<BalanceEditModal ref="modalRef" @saved="onSaved" />` вынесена на строке 227 — модалка не инлайнится в страницу
- Страница содержит только таблицу, breadcrumbs, header, loading/empty states — ни одного fieldset/form

**SOURCE_META бейджи:**
```
api:      badge-soft badge-success
manual:   badge-soft badge-ghost
estimate: badge-soft badge-warning
fallback: badge-soft badge-error
```
Все 4 source имеют `badge-soft` префикс — соответствует требованиям критика.

**Бейдж AUTO_UNAVAILABLE:**
- Строки 183-189: `class="badge badge-sm badge-soft badge-neutral"` — присутствует `badge-soft`
- `isAutoUnavailable(row.key)` — функция из composable, возвращает `true` для `indigo` и `mubert`
- Условие `v-if="isAutoUnavailable(row.key)"` идёт первым, `v-else-if` для source — корректная приоритизация

**RBAC:**
- `middleware: ["admin-access"]` в `definePageMeta` строка 6 — присутствует

**Форматирование:**
- `formatAmount` корректно обрабатывает `balance`, `quota`, `expiry` и `—` fallback
- `burnRateColorClass` корректно защищается от отсутствия данных

---

#### `app/composables/useAdminBalances.ts`

- `BALANCE_CURRENCIES`, `BalanceCurrency`, `AUTO_UNAVAILABLE_SERVICES`, `isAutoUnavailable` — все экспортированы
- `AdminServiceBalanceRow` содержит `dashboardHint?: string` — используется в модалке
- `updateServiceBalance` — PUT на `/api/admin/balances/${service}` с body `{amount, currency?, notes?}` — корректен

---

#### `server/utils/balance/providers/nodemaven-api-provider.ts` (B-2 dual-auth)

- `requestNodeMavenMe`: сначала `x-api-key`, при 401/403 — retry с `Authorization: Bearer`
- Обе ветки проверяют `status !== 401 && status !== 403` перед повторным throw — логика корректна
- `fallbackToManual` пишет причину в notes через `[fallback: ...]` — парсится в модалке через `fallbackReason`
- `console.warn` только для диагностики unexpected shape — не `console.log`, допустимо в серверном коде
- Нет секретов в коде — `process.env.NODEMAVEN_API_KEY`

---

#### `server/utils/balance/providers/apify-api-provider.ts` (B-3 fallback endpoint)

- Основной путь: `GET /users/me` с `query: { token }`
- B-3 fallback: если `usage.monthlyUsageUsd` отсутствует → retry на `/users/me/usage/monthly`
- Оба endpoint'а имеют `timeout: REQUEST_TIMEOUT_MS (5000)`
- `console.warn` при неожиданной структуре — допустимо
- Нет секретов в коде — `process.env.APIFY_TOKEN`

---

#### `server/utils/balance/config.ts`

- NodeMaven `dashboardHint`: `"https://dashboard.nodemaven.com/profile/api"` — чистый URL (B-2 исправление применено)
- Indigo и Mubert: `dashboardHint` — plain text `"... dashboard → Subscription"` — `isHttpsHint` в модалке корректно не создаст ссылку для них

---

### 2. TypeCheck

Команда: `npx nuxi typecheck`

**Новые ошибки в файлах трека до исправления:**
- `app/components/admin/BalanceEditModal.vue(50,14): error TS2532` — исправлено

**После исправления:** ноль ошибок в файлах трека. Pre-existing ошибки (~20+ штук) в `video-frame-analyzer-agent.ts`, `cycle-orchestrator.ts`, `idea-pipeline.ts`, `pipeline-credentials.ts`, `video-content-analyzer.ts` и других — существовали до трека балансов, не связаны.

---

### 3. Тесты

Команда: `npx vitest run tests/unit/balance-*.spec.ts tests/api/admin-balances.spec.ts`

```
tests/unit/balance-fal-provider.spec.ts      6 тестов  — PASS
tests/unit/balance-cost-ledger.spec.ts       8 тестов  — PASS
tests/unit/balance-burn-rate.spec.ts         6 тестов  — PASS
tests/unit/balance-cost-attribution.spec.ts  9 тестов  — PASS
tests/api/admin-balances.spec.ts             7 тестов  — PASS (результат из вывода)
─────────────────────────────────────────────────────
Итого:  5 файлов, 36 тестов — ALL PASS
```

Регрессий нет.

---

### 4. Сборка

Команда: `bun run build`

**Результат:** `✨ Build complete!` — 39.7 MB (9.27 MB gzip). Без ошибок.

---

### 5. Debug-мусор и запрещённые классы

Проверены все 6 файлов трека на:
- `console.log` — не найдено (только `console.warn` в серверных провайдерах — допустимо)
- `debugger` — не найдено
- `TODO`, `FIXME` — не найдено
- `input-bordered`, `select-bordered`, `textarea-bordered`, `alert-ghost` — не найдено

---

## B. Что НЕ проверено

1. **Playwright / E2E UI** — не запущен. Причина: MarketingCamp занял порт 3001, конфликт с dev-сервером ZavodCamp. Saturn prod требует логин, deploy ещё не сделан.

2. **Runtime auto-fetch** — не подтверждён. Проверить что fal.ai/Apify действительно возвращают `source: "api"` можно только на Saturn с валидными `FAL_KEY` / `APIFY_TOKEN` в `.env`.

3. **Dual-auth NodeMaven (B-2) в runtime** — не проверен: нет доступа к реальному `NODEMAVEN_API_KEY` и sandbox-среде с контролем ответов NodeMaven API.

4. **Apify fallback endpoint (B-3) в runtime** — не проверен: требует среду где `/users/me` намеренно не возвращает `usage.monthlyUsageUsd`.

---

## C. Соответствие плану

| Задача | Описание | Статус |
|--------|----------|--------|
| B-2 | NodeMaven dual-auth: `x-api-key` → fallback на `Authorization: Bearer` при 401/403 | Реализовано, статический анализ PASS |
| B-3 | Apify fallback endpoint `/users/me/usage/monthly` если `/users/me` не вернул `usage` | Реализовано, статический анализ PASS |
| B-4 | `console.warn` с raw-body (до 500-800 символов) при unexpected response shape в обоих провайдерах | Реализовано |
| F-1 | `BalanceEditModal.vue` как отдельный компонент (не inline в странице) | Реализовано, 222 строки |
| F-2 | Подсказка для quota-сервисов (NodeMaven) в модалке — `isQuotaService` computed + alert-info | Реализовано |
| F-3 | Source alert: `api` → alert-info «Автоматически фетчится» | Реализовано |
| F-4 | Source alert: `estimate` → alert-warning, `fallback` → alert-error с причиной | Реализовано |
| F-5 | `BALANCE_CURRENCIES` в select валюты + defensive fallback для legacy валют | Реализовано |
| F-6 | Бейдж «Авто недоступно» (badge-soft badge-neutral) для Indigo/Mubert вместо source-бейджа | Реализовано |
| — | `badge-soft` на всех 4 SOURCE_META source-бейджах | Реализовано (критик, применено) |
| — | `dashboardHint` NodeMaven = чистый URL без текстовой обёртки | Реализовано (config.ts строка 61) |
| — | `rel="noopener noreferrer"` на `target="_blank"` ссылке в модалке | Реализовано |

---

## D. Вердикт

**ГОТОВО К КОММИТУ**

Все задачи плана реализованы. Статический анализ пройден. TypeCheck — 0 новых ошибок в файлах трека (одна TS2532 найдена и исправлена тестировщиком). 36/36 тестов PASS. Сборка чистая.

Единственное ограничение: runtime-верификация auto-fetch и dual-auth NodeMaven остаётся за пользователем на Saturn после deploy (см. раздел E).

---

## E. Чек-лист для пользователя на Saturn после deploy

Выполнить вручную после `deploy` в браузере под учёткой с `canAdmin=true`:

1. Открыть `/admin/balances` — страница загружается без 500/403
2. **Indigo** и **Mubert** в колонке «Источник» показывают бейдж с иконкой замка и текстом «Авто недоступно» (badge-soft badge-neutral, не source-бейдж)
3. **Anthropic** показывает бейдж «🧮 Estimate» (badge-soft badge-warning)
4. **fal.ai** после нажатия кнопки «Обновить» показывает «🤖 Auto» (badge-soft badge-success) с реальным числовым значением в колонке «Текущий баланс»
5. **Apify** аналогично — «🤖 Auto» с реальным остатком
6. **NodeMaven без ключа** (`NODEMAVEN_API_KEY` не установлен в `.env`): показывает «⚠️ Fallback» (badge-soft badge-error)
7. Клик «Изменить» на любой строке — модалка открывается с заголовком «Обновить баланс: [Название]», полями fieldset+legend: Сумма / Валюта / Заметки
8. Select «Валюта» содержит USD, EUR, RUB (в таком порядке)
9. Клик «Изменить» на **Indigo** или **Mubert** — в модалке виден серый alert «Введено вручную: автосбор для этого сервиса недоступен...»
10. Клик «Изменить» на **NodeMaven** — в модалке виден синий alert «NodeMaven — quota-сервис (трафик в GB)...» + ссылка-hint «Где взять: https://dashboard.nodemaven.com/profile/api»
11. Ссылка `https://dashboard.nodemaven.com/profile/api` кликабельна, открывается в новой вкладке (rel=noopener noreferrer)
12. Ввести в поле Сумма отрицательное число или текст → кнопка «Сохранить» показывает ошибку «Введите корректную сумму ≥ 0» без запроса к API
13. Нажать вне модалки (backdrop) — модалка закрывается
