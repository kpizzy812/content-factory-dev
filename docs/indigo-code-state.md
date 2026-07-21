# Состояние кода Indigo в ZavodCamp

> Снимок состояния на 2026-05-16. Описывает всё, что связано с интеграцией **Indigo X Browser**: UI, серверные утилиты, API, БД, mock-сервер, вкладки и точки входа. Цифры — около 3 894 строк в относящихся к Indigo файлах (без `app/generated/prisma/**`).

---

## 1. Точки входа в UI

### 1.1 Страница `/indigo`
Файл: `app/pages/indigo/index.vue` (226 строк).
- Защита доступа: `definePageMeta` → `middleware: "module-access"` + `moduleSlug: "social-upload"`.
- Header: счётчики (всего / синхронизировано / проблемы), кнопки `Credentials` (открывает `IndigoCredentialsModal`), `Sync с Indigo` (POST `/api/indigo/sync` через `useIndigoActions().syncFromRemote()`), `Создать профиль` (open `IndigoProfileEditModal`).
- После Sync — `alert` с резюме `{ imported, updated, conflicted, errors, total }`, авто-скрытие через 10 с.
- Фильтры: поиск (debounce 300 мс через `watch`), select `syncStatus` (все 6 значений из `INDIGO_SYNC_STATUSES`), кнопка Сбросить.
- Список: `SharedEmptyState` или grid карточек `IndigoProfileCard`.
- Подключённые модалки (через `defineExpose({ open })`): `IndigoProfileEditModal`, `IndigoProfileLinkModal`, `IndigoCredentialsModal`.

### 1.2 Страница `/admin/integrations`
Файл: `app/pages/admin/integrations/index.vue` (143 строки), `middleware: ["admin-access"]`.
- Карточка «Indigo X Browser» с описанием, URL `https://launcher.indigobrowser.com:45001`, badge статуса (`Не настроено` / `Подключено` / `Ошибка подключения` / `Не проверено`).
- Если configured — показывает email + дату последнего теста.
- Кнопки: `Test connection`, `Настроить / Изменить` (открывает `IndigoCredentialsModal`), ссылка `К профилям` → `/indigo`.
- Mock-режим визуально маркируется badge `mock` после успешного теста.

### 1.3 Навигация
Файл: `app/layouts/default.vue:49` — пункт `/indigo` с лейблом `Indigo`, иконкой `mingcute:safari-line`, видимостью по `canAccessModule('social-upload')`.

### 1.4 Вкладка «Indigo» в карточке аккаунта
Файл: `app/components/account/AccountEditModal.vue`. Модалка имеет 4 таба, тип `"credentials" | "proxy" | "indigo" | "warmup"`.
- Таб с `Icon mingcute:fingerprint-line`, активируется через `activeTab === 'indigo'`.
- Рендерит `<AccountIndigoTab :account-id @updated />`.

Компонент `app/components/account/AccountIndigoTab.vue` (202 строки):
- Info-alert: «один аккаунт — один профиль (1:1)».
- `useFetch('/api/indigo/profiles', { query: { socialAccountId } })` → берёт первый матч.
- Состояния:
  - **Привязан** — карточка профиля (`indigoId` mono, platformType + os, прокси, всего сессий, `IndigoSyncStatusBadge`), кнопки `Открыть в Indigo` (`NuxtLink to=/indigo`) и `Отвязать` (через `useIndigoActions().unlinkAccount`).
  - **Не привязан** — две кнопки: `Создать новый Indigo-профиль` (открывает `IndigoProfileEditModal`) или `Привязать существующий` (select из всех `useFetch('/api/indigo/profiles')` где `!socialAccountId` + `linkAccount`).
- Известная проблема (из `track_b_complete.md` §5): два независимых `useFetch` к `/api/indigo/profiles` (для фильтра по аккаунту и для свободных профилей).

---

## 2. UI-компоненты Indigo

Все живут в `app/components/indigo/` и `app/components/account/AccountIndigoTab.vue`.

| Файл | Назначение |
|------|------------|
| `IndigoProfileCard.vue` (286 строк) | Карточка профиля в grid `/indigo`. Header (имя + indigoId mono), badges sync/session, badges platform/os/timezone, владелец `socialAccount` + кнопка отвязки, прокси-инфо, время последней сессии, теги, ошибка sync, alert «WebDriver слушает на порту N» после Start. Footer: `Start` (disabled если нет `indigoId`) / `Stop` (по `sessionState`), `Привязать`, `Редактировать`, `Удалить` с confirm-dialog. |
| `IndigoProfileEditModal.vue` (280 строк) | Универсальная модалка Create/Edit. Поля: name, platformType (select из `INDIGO_PLATFORM_TYPES`), os, screenResolution, language, timezone, userAgent, proxy (select из `useFetch('/api/proxies')`), tags (string CSV → массив, max 30), notes, checkbox `pushToIndigo` (только при create). На submit: `createProfile` или `updateProfile` через `useIndigoActions`. |
| `IndigoProfileLinkModal.vue` (93 строки) | Привязать профиль к `SocialAccount`. Select из `useFetch('/api/accounts')`, `linkAccount(profileId, socialAccountId)`. |
| `IndigoCredentialsModal.vue` (207 строк) | Управление workspace email/password. Статус (configured + lastTestedAt + lastTestStatus), форма email+password, action-buttons: Удалить (с `confirm`), Test connection (зовёт `recordCredentialTest`), Сохранить (валидация: `@` + ≥4 символа). После сохранения — `invalidateIndigoToken`. |
| `IndigoSyncStatusBadge.vue` (58 строк) | Badge со словарём `IndigoSyncStatus → {label, badgeClass, icon}` (synced/local_only/remote_only/conflict/deleted_remote/error). |
| `IndigoSessionStatusBadge.vue` (46 строк) | Badge `IndigoSessionState` (running/starting/idle). При `running` показывает `:port`. |

Стек разметки: tailwind 4 + daisyUI 5 (`card`, `modal`, `tabs tabs-box`, `badge`, `btn`, `fieldset/legend`, `alert alert-soft`).

---

## 3. Композиблы и stores

### `app/composables/useIndigoProfiles.ts` (11 строк)
Реактивный `useFetch<{ data: IndigoProfileDto[] }>('/api/indigo/profiles', { query: filters.query })`. Завязан на `useIndigoFiltersStore`.

### `app/composables/useIndigoActions.ts` (252 строки)
Pinia-агностичная фабрика. Реактивные `isBusy`, `error`. Методы (все через `$fetch`):
- Профили: `createProfile`, `updateProfile`, `deleteProfile`, `startProfile(id, automation=false)`, `stopProfile`, `linkAccount(id, socialAccountId)`, `unlinkAccount`, `syncFromRemote`.
- Credentials: `fetchCredentialsStatus`, `saveCredentials`, `deleteCredentials`, `testCredentials`.
- `extractError` нормализует ошибку: `err.data?.message` → `err.message` → «Неизвестная ошибка».

### `app/stores/indigoFilters.ts` (18 строк)
Pinia store `indigoFilters`. State: `syncStatus: IndigoSyncStatus | ""`, `search: string`. Computed `query` исключает пустые значения, `reset()` сбрасывает.

---

## 4. Server API (`server/api/indigo/**`, 14 endpoint-файлов + 1 admin)

Все endpoint'ы требуют `requireScopedAccess(event, { permissions, moduleSlug: "social-upload" })`. RBAC-bypass только для модуля/приложения, флаги проверяются независимо.

### 4.1 Профили (`server/api/indigo/profiles/`)

| Метод | Path | Файл | Permission | Логика |
|-------|------|------|------------|--------|
| GET | `/api/indigo/profiles` | `index.get.ts` (57 строк) | `canRead` | Фильтры из query: `syncStatus` (валидируется по `INDIGO_SYNC_STATUSES`), `proxyId`, `socialAccountId`, `search` (по `name`, `tags has`, `notes`). `prisma.indigoProfile.findMany` с `include: { socialAccount: { include: { app } }, proxy: select }`. Маппится через `toIndigoProfileDto`. |
| POST | `/api/indigo/profiles` | `index.post.ts` (124 строки) | `canCreate` | Валидация name (≤120) и `platformType`. Проверяет proxy/socialAccount существуют и 1:1 не нарушен. Если `pushToIndigo!==false` — `withIndigoToken → client.createProfile`. При успехе `syncStatus='synced'` + `indigoId`. При ошибке — НЕ падает, сохраняет local с `syncStatus='error'` + `lastSyncError`. |
| GET | `/api/indigo/profiles/:id` | `[id].get.ts` (31 строка) | `canRead` | Details. 404 если не найден. |
| PUT | `/api/indigo/profiles/:id` | `[id].put.ts` (107 строк) | `canWrite` | Партиальный update. Проверка 1:1 при смене `socialAccountId`. Если `existing.syncStatus==='synced'` и `body.name` менялся → push в Indigo `client.updateProfile`. Best-effort: при ошибке `syncStatus='error'` + `lastSyncError`. |
| DELETE | `/api/indigo/profiles/:id` | `[id].delete.ts` (39 строк) | `canDelete` | Если `indigoId` есть → `client.deleteProfile` (best-effort). Локальная запись удаляется всегда. В ответе `remoteWarning` если remote-delete упал. |
| POST | `/api/indigo/profiles/:id/start` | `start.post.ts` (43 строки) | `canRunAgent` | Делегирует в `client.startProfile({ indigoProfileId, token, automation })`. Внутри клиента — pre-flight `assertProxyHealthyBeforeSession` (КРИТИЧНО: защита от leak'а IP). Body: `{ automation?: boolean }`. Возвращает `{ port, profileId, indigoId }`. |
| POST | `/api/indigo/profiles/:id/stop` | `stop.post.ts` (24 строки) | `canRunAgent` | `client.stopProfile`. Безопасно вызывать даже если сессии нет. |
| POST | `/api/indigo/profiles/:id/link-account` | `link-account.post.ts` (65 строк) | `canWrite` | Body `{ socialAccountId }`. Проверка 1:1. Параллельно обновляет `SocialAccount.indigoProfileId` (denormalized backward-compat). |
| POST | `/api/indigo/profiles/:id/unlink-account` | `unlink-account.post.ts` (45 строк) | `canWrite` | Снимает `socialAccountId` и `SocialAccount.indigoProfileId`. 409 если уже не привязан. |
| POST | `/api/indigo/sync` | `sync.post.ts` (16 строк) | `canRunAgent` | Делегирует в `syncIndigoProfilesFromRemote(user.id)`. |

### 4.2 Credentials (`server/api/indigo/credentials/`)

| Метод | Path | Файл | Permission | Логика |
|-------|------|------|------------|--------|
| GET | `/api/indigo/credentials/status` | `status.get.ts` (16 строк) | `canAdmin` | `getIndigoCredentialsStatus()` → `{ configured, email, lastTestedAt, lastTestStatus }`. |
| PUT | `/api/indigo/credentials` | `index.put.ts` (39 строк) | `canAdmin` | Валидация email (`@`) и password (≥4). `saveIndigoCredentials` (AES-256-GCM) + `invalidateIndigoToken` (старый workspace → старый токен невалиден). |
| DELETE | `/api/indigo/credentials` | `index.delete.ts` (18 строк) | `canAdmin` | Soft-revoke через `revokedAt`. `invalidateIndigoToken`. |
| POST | `/api/indigo/credentials/test` | `test.post.ts` (48 строк) | `canAdmin` | `client.authenticate(creds)` без выдачи токена клиенту. Возвращает `{ success, baseUrl, mock, tokenExpiresAt }` или `{ success: false, error }`. `recordCredentialTest('success' | 'failed')`. |

### 4.3 Admin emergency

| Метод | Path | Файл | Permission | Логика |
|-------|------|------|------------|--------|
| POST | `/api/admin/indigo/profiles/:id/force-stop` | `force-stop.post.ts` (79 строк) | `canAdmin` | Аварийный stop. `stopIndigoSession`. Даже при ошибке Indigo — сбрасывает `lastSessionPort=null` + `lastSessionEndedAt=now` (разблокирует deep-check). Idempotent. Console.warn с диагностикой. |

---

## 5. Серверные утилиты (`server/utils/indigo/`)

| Файл | LOC | Назначение |
|------|-----|------------|
| `client.ts` | 303 | **IndigoClient singleton** через `getIndigoClient()`. Single base URL (`https://launcher.indigobrowser.com:45001`) / mock через `isIndigoMockMode()` → `getIndigoMockUrl()`. `REQUEST_TIMEOUT_MS=30_000`, `TOKEN_TTL_MS=24h`, `DEFAULT_RATE_LIMIT_RPM=80`. Методы: `authenticate(creds)` (MD5(password) hash, `POST /user/signin`), `listProfiles`, `createProfile`, `updateProfile` (PATCH), `deleteProfile`, `startProfile` (КРИТИЧНО: pre-flight `assertProxyHealthyBeforeSession(profile.proxyId)` ДО hit'a в Indigo + инкремент `totalSessions`, запись `lastSessionPort/StartedAt`), `stopProfile` (записывает `lastSessionEndedAt`, обнуляет `lastSessionPort`). `rawFetch` нормализует ошибки в `createError({ statusCode, message })`. `authedFetch` рейт-лимитит и подставляет `Authorization: Bearer <token>`. |
| `token-manager.ts` | 126 | Singleton system-токен (`PipelineCredential[name='indigo:auth_token', userId=0]`, `type='bearer_token'`). `getIndigoToken()` возвращает cached если `expiresAt > now + 5min`, иначе re-auth через `client.authenticate(loadIndigoCredentials())`. `invalidateIndigoToken()` soft-revoke. `withIndigoToken(fn)` — wrapper: при 401 от Indigo автоматически инвалидирует и retry один раз. Если creds отсутствуют — `throw 503` с подсказкой про `/admin/integrations`. |
| `credentials.ts` | 106 | Workspace email/password в `PipelineCredential[name='indigo:workspace', userId=0, type='custom']`. `encryptedData = JSON.stringify({email, password})` под AES-256-GCM. `metadata.email` для UI без расшифровки. `lastTestedAt` + `lastTestStatus` в записи. API: `loadIndigoCredentials`, `hasIndigoCredentials`, `getIndigoCredentialsStatus`, `saveIndigoCredentials`, `deleteIndigoCredentials` (soft `revokedAt`), `recordCredentialTest`. |
| `sync.ts` | 126 | `syncIndigoProfilesFromRemote(createdById)`. Алгоритм: `listProfiles` → для каждого remote upsert по `indigoId`. Conflict-detection: если `existing.name !== remote.name` и `syncStatus !== 'local_only'` и `lastSyncedAt !== null` → `syncStatus='conflict'` (local имя НЕ перезаписывается). Локальные с indigoId, которых нет в remote → `syncStatus='deleted_remote'`. `mapPlatformType(remote)` по подстроке `os_type` → `desktop|mobile_android|mobile_ios`. Возвращает `IndigoSyncResult`. |
| `session.ts` | 109 | Helpers для CDP-подключения через `puppeteer-core`. `startIndigoSessionForCdp(indigoProfileId)` зовёт `client.startProfile({ automation: true })`, возвращает `{ port, profileId, indigoId }`. `stopIndigoSession`. `connectToProfileViaCdp(port, { timeoutMs=15000 })` — `puppeteer.connect({ browserURL: http://127.0.0.1:<port>, defaultViewport: null })` через `Promise.race` с таймаутом. Используется в `server/utils/proxy/deep-check.ts` (deep-proxy-check) и в будущем posting runner. |
| `rate-limiter.ts` | 63 | Token-bucket rate limiter. `IndigoRateLimiter({ maxRpm: 80 })`. Bucket = `maxTokens`, refill 1 token/`(60_000/maxRpm)` ms. `acquire()` ждёт через `setTimeout` пока tokens<1. `snapshot()` для тестов. Один экземпляр на server-process через `IndigoClient`. |
| `dto.ts` | 74 | `toIndigoProfileDto(row)`. НЕ выдаёт `config` (Json snapshot) и `cookiesSnapshot` (encrypted), вместо них — `hasCookiesSnapshot: !!row.cookiesSnapshot`. Denormalized links: `socialAccount: { id, displayName, platform, appName }`, `proxy: { id, label, status, type }`. `computeSessionState`: `lastSessionPort` присутствует → `'running'`, иначе `'idle'`. (Сейчас `'starting'` не выставляется — резерв на async-стартеры). |
| `types.ts` | 94 | TS-типы под shape Indigo API: `IndigoAuthResponse`, `IndigoRemoteProfile` (с `[key: string]: unknown`), `IndigoListProfilesResponse`, `IndigoCreateProfileResponse`, `IndigoStartProfileResponse` (`{ value: number }`), `IndigoStopProfileResponse`, `IndigoDeleteProfileResponse`, `IndigoCreateProfileBody`, `IndigoTokenCacheEntry`, `IndigoCredentials`. |

---

## 6. Shared types

Файл `shared/types/indigo.ts` (124 строки) — общие типы для server+client:
- `IndigoSyncStatus` — union 6 значений + `INDIGO_SYNC_STATUSES` const.
- `IndigoPlatformType` — `desktop | mobile_android | mobile_ios` + `INDIGO_PLATFORM_TYPES` const.
- `IndigoSessionState` — `idle | running | starting`.
- `IndigoProfileDto` — публичный shape (без `config`, без `cookiesSnapshot`), включает denormalized `socialAccount`/`proxy`/`sessionState`.
- `IndigoProfileCreateInput` / `IndigoProfileUpdateInput` (последний = `Partial<Omit<Create, 'pushToIndigo'>>`).
- `IndigoStartProfileResponse` — `{ port, profileId, indigoId }`.
- `IndigoSyncResult` — `{ imported, updated, conflicted, errors, total }`.
- `IndigoCredentialsStatus` — `{ configured, email, lastTestedAt, lastTestStatus }`.
- `IndigoCredentialsInput` — `{ email, password }`.

---

## 7. Prisma модель и миграция

`prisma/schema.prisma` строки 841–897. `app/generated/prisma/models/IndigoProfile.ts` авто-генерируется (≈1700+ строк типов для Prisma).

```prisma
enum IndigoSyncStatus { synced local_only remote_only conflict deleted_remote error }

model IndigoProfile {
  id                   String  @id @default(cuid())
  indigoId             String? @unique          // null для local_only
  indigoFolderId       String?
  socialAccountId      Int?    @unique          // 1:1 с SocialAccount
  socialAccount        SocialAccount? @relation(...)  onDelete: SetNull
  proxyId              String?
  proxy                Proxy?  @relation(...)         onDelete: SetNull
  name                 String
  platformType         String  @default("desktop")
  os, userAgent, screenResolution, language, timezone  String?
  config               Json?                    // opaque snapshot fingerprint/parameters
  syncStatus           IndigoSyncStatus @default(local_only)
  lastSyncedAt         DateTime?
  lastSyncError        String?
  totalSessions        Int     @default(0)
  lastSessionStartedAt DateTime?
  lastSessionEndedAt   DateTime?
  lastSessionPort      Int?
  cookiesSnapshot      String?                  // encrypted, опционально
  cookiesUpdatedAt     DateTime?
  notes                String?
  tags                 String[] @default([])
  createdById          Int?
  createdAt, updatedAt DateTime
  @@index([syncStatus]) @@index([socialAccountId]) @@index([proxyId])
}
```

Связь со стороны `SocialAccount`:
```prisma
model SocialAccount {
  indigoProfileId  String?                  // denormalized (back-compat)
  indigoProfile    IndigoProfile?
}
```

Связь со стороны `Proxy`:
```prisma
model Proxy {
  indigoProfiles  IndigoProfile[]
}
```

Миграция: `prisma/migrations/20260430122234_indigo_profile/migration.sql` (57 строк) — создаёт enum, таблицу, 3 индекса, 2 FK на `SocialAccount` и `Proxy` (обе `ON DELETE SET NULL`).

---

## 8. Mock-инфраструктура

### `server/__mocks__/indigo-server.ts` (171 строка)
Самостоятельный `node:http` сервер на порту `MOCK_INDIGO_PORT` (default 35001). Запуск: `bun run mock:indigo` (`package.json:12`).

Эндпоинты:
- `POST /user/signin` → `{ data: { token: 'mock-token-<ts>' } }` или 401 при `scenario=auth_invalid`.
- `GET /api/v2/profile/list` → `{ value: [...] }` (in-memory `Map<id, MockProfile>`).
- `POST /api/v2/profile/create` → создаёт `mock-profile-<rand>`.
- `POST|GET /api/v2/profile/start?id=` → `{ value: port }` (portCounter с 9300) или 409 (`profile_locked`) / 503 (`proxy_dead`).
- `POST|GET /api/v2/profile/stop?id=` → `{ status: 'stopped' }`.
- `DELETE /api/v2/profile/:id` → `{ status: 'deleted' }`.

Сценарии задаются через query `?scenario=` или header `X-Mock-Scenario`: `happy_path`, `profile_locked`, `proxy_dead`, `auth_invalid`.

### Активация mock-режима
`server/utils/mock/mode.ts`:
- `isIndigoMockMode()` — `process.env.INDIGO_MOCK_MODE === 'true'`.
- `getIndigoMockUrl()` — `process.env.INDIGO_MOCK_URL || 'http://localhost:35001'`.

Env-флаги в `.env.example:159-161`.

### Smoke-скрипты
- `scripts/test-indigo-mock.ts` (5894 байт) — smoke test клиента против mock-сервера.
- `scripts/test-mock-mode.ts` (3278 байт) — проверка mock-режима в целом.

---

## 9. Зависимые подсистемы

### 9.1 Deep proxy check
`server/utils/proxy/deep-check.ts` — использует `startIndigoSessionForCdp` / `stopIndigoSession` для запуска браузера через прокси. Перед стартом проверяет `lastSessionPort`/`lastSessionStartedAt` (detect active session) — если активно, бросает 409 с подсказкой про `/api/admin/indigo/profiles/:id/force-stop`.

### 9.2 Pre-session proxy guard
`server/utils/proxy/proxy-checker.ts` экспортирует `assertProxyHealthyBeforeSession(proxyId)`. Вызывается **внутри `IndigoClient.startProfile`** ДО любого hit'а в Indigo. Бросает 503 при leak/dead — главная защита от утечки IP.

### 9.3 Posting / warmup
- `server/utils/posting/runner-mock.ts` — в комментариях помечен как future runner с Indigo+Playwright (итерация 4).
- `app/utils/guides.ts:145` — упоминание Indigo-профиля в критериях полноты аккаунта (1 из 8).
- `server/api/admin/accounts-health.get.ts:83-95` — `hasIndigoProfile = Boolean(acc.indigoProfileId)` даёт +12.5 к score аккаунта.

### 9.4 Balance / providers
- `server/utils/balance/config.ts:47-53` — провайдер `indigo` (label `Indigo Browser`, lowThreshold $10, manual).
- `server/utils/balance/provider-registry.ts:26` — `"indigo": ManualBalanceProvider` (нет публичного API для balance).

### 9.5 Admin → integrations
Карточка Indigo на `/admin/integrations` — единственная UI-точка ввода workspace credentials. Из `/indigo` модалка тоже доступна через кнопку «Credentials».

---

## 10. Архитектурные инварианты

1. **Pre-session proxy assert.** `startProfile` ВСЕГДА вызывает `assertProxyHealthyBeforeSession(profile.proxyId)` до Indigo API. Защита от IP-leak.
2. **Best-effort sync.** При создании/обновлении профиля: ошибка от Indigo → НЕ откатывает локальную запись, ставит `syncStatus='error'` + `lastSyncError`. Оператор разбирается из UI.
3. **1:1 SocialAccount ↔ IndigoProfile.** Гарантировано `@unique` на `socialAccountId` и явной проверкой в create/update/link.
4. **Single base URL.** Public docs: cloud-management и launcher живут на одном `launcher.indigobrowser.com:45001`. Разделение зарезервировано в параметрах, но не используется.
5. **MD5(password) при signin.** Соответствует public docs Indigo. Mock не валидирует, поэтому игнорирует.
6. **Token TTL 24h, refresh за 5 мин.** `getIndigoToken()` возвращает cached, при близком истечении делает re-auth. `withIndigoToken(fn)` оборачивает 401-retry.
7. **System credentials.** Workspace creds и token хранятся в `PipelineCredential` с `userId=0` (system-level), AES-256-GCM. Через UI ввод только из `/admin/integrations` (требует `canAdmin`).
8. **`config: Json` opaque snapshot.** Полная Indigo-схема (fingerprint/parameters/storage/flags) хранится сырой, не денормализована. Стабильно к расширению API.
9. **Conflict-detection в sync.** Если remote name отличается от local + не `local_only` + `lastSyncedAt != null` → `syncStatus='conflict'`, локальное имя НЕ перезаписывается.
10. **Rate-limit 80 RPM.** Глобально для процесса через `IndigoRateLimiter` в `IndigoClient`.
11. **RBAC.** `canRead`/`canWrite`/`canCreate`/`canDelete`/`canRunAgent`/`canAdmin` проверяются независимо. Admin-bypass работает только для модулей (`moduleSlug: "social-upload"`), но НЕ для permission-флагов.

---

## 11. Тесты

- `tests/e2e/account-setup.spec.ts` — проверяет наличие таба `Indigo` в AccountEditModal.
- `tests/e2e/proxy-lifecycle.spec.ts` — упоминает Indigo в контексте deep-check.
- `tests/visual/README.md` — визуальный кейс `accounts_edit_indigo_tab`.

Юнит-тесты на server/utils/indigo/* отдельной папкой не найдены (см. ниже секция «Дыры»).

---

## 12. Карта файлов (полная)

### Frontend
```
app/pages/indigo/index.vue
app/pages/admin/integrations/index.vue                    (карточка Indigo)
app/components/indigo/
  IndigoProfileCard.vue
  IndigoProfileEditModal.vue
  IndigoProfileLinkModal.vue
  IndigoCredentialsModal.vue
  IndigoSyncStatusBadge.vue
  IndigoSessionStatusBadge.vue
app/components/account/
  AccountIndigoTab.vue                                    (таб в AccountEditModal)
  AccountEditModal.vue                                    (тут таб 'indigo')
app/composables/
  useIndigoProfiles.ts
  useIndigoActions.ts
app/stores/indigoFilters.ts
app/layouts/default.vue                                   (пункт навигации /indigo)
shared/types/indigo.ts
```

### Backend
```
server/api/indigo/
  profiles/index.get.ts
  profiles/index.post.ts
  profiles/[id].get.ts
  profiles/[id].put.ts
  profiles/[id].delete.ts
  profiles/[id]/start.post.ts
  profiles/[id]/stop.post.ts
  profiles/[id]/link-account.post.ts
  profiles/[id]/unlink-account.post.ts
  sync.post.ts
  credentials/status.get.ts
  credentials/index.put.ts
  credentials/index.delete.ts
  credentials/test.post.ts
server/api/admin/indigo/profiles/[id]/force-stop.post.ts
server/utils/indigo/
  client.ts
  token-manager.ts
  credentials.ts
  sync.ts
  session.ts
  rate-limiter.ts
  dto.ts
  types.ts
server/__mocks__/indigo-server.ts
server/utils/mock/mode.ts                                 (isIndigoMockMode/getIndigoMockUrl)
server/utils/balance/config.ts                            (indigo как balance provider)
server/utils/balance/provider-registry.ts
server/utils/proxy/deep-check.ts                          (использует startIndigoSessionForCdp)
server/utils/posting/runner-mock.ts                       (placeholder под future runner)
```

### БД
```
prisma/schema.prisma                                      (model IndigoProfile + enum + связи)
prisma/migrations/20260430122234_indigo_profile/migration.sql
app/generated/prisma/models/IndigoProfile.ts              (авто-генерация Prisma)
```

### Скрипты / mock
```
scripts/test-indigo-mock.ts
scripts/test-mock-mode.ts
package.json                                              (scripts mock:indigo, mock:all)
.env.example                                              (INDIGO_MOCK_MODE / INDIGO_MOCK_URL)
```

### Тесты
```
tests/e2e/account-setup.spec.ts                           (наличие таба Indigo)
tests/e2e/proxy-lifecycle.spec.ts                         (deep-check + Indigo)
tests/visual/README.md                                    (accounts_edit_indigo_tab)
```

---

## 13. Известные «дыры» и наблюдения

1. **Дубль `useFetch('/api/indigo/profiles')` в `AccountIndigoTab`** — один раз с фильтром по `socialAccountId`, второй раз без, чтобы показать свободные. Можно объединить в один fetch + клиентский фильтр (`track_b_complete.md` §5).
2. **`IndigoSessionState='starting'` не выставляется** — `computeSessionState` в `dto.ts` смотрит только на `lastSessionPort`. Async-стартеры (long-running start) пока не используются.
3. **Юнит-тесты для `server/utils/indigo/*` не найдены.** Покрытие через mock-сервер и smoke-скрипт `scripts/test-indigo-mock.ts`, без формальных vitest/jest наборов.
4. **Browser instance не отдаётся в API.** `puppeteer.connect` в `session.ts` возвращает `Browser`, но используется только внутри deep-check. Posting runner (итерация 4) ещё placeholder.
5. **Cookie-снапшоты.** Поле `cookiesSnapshot` (encrypted) в схеме есть, но нет CRUD-эндпоинтов. Зарезервировано под будущую персистентность login-state.

---

## 14. Цепочка вызовов «нажал Start в карточке профиля»

```
IndigoProfileCard.vue → handleStart()
  └─ useIndigoActions().startProfile(profile.id, automation=false)
       └─ $fetch POST /api/indigo/profiles/:id/start { automation }
            └─ requireScopedAccess('canRunAgent', 'social-upload')
            └─ client.startProfile({ indigoProfileId, token: withIndigoToken, automation })
                 ├─ prisma.indigoProfile.findUniqueOrThrow + include proxy
                 ├─ check profile.indigoId (409 если local_only)
                 ├─ assertProxyHealthyBeforeSession(profile.proxyId)   ← КРИТИЧНО
                 ├─ getIndigoToken() (cached or re-auth via /user/signin)
                 ├─ rateLimiter.acquire()
                 ├─ POST /api/v2/profile/start?id=<indigoId>&automation=true
                 ├─ prisma.indigoProfile.update { totalSessions++, lastSessionPort, lastSessionStartedAt }
                 └─ return { port, profileId, indigoId }
            └─ 401 retry → invalidateIndigoToken + re-auth + retry once
       └─ возврат IndigoStartProfileResponse в карточку
  └─ lastStartedPort.value = res.port (показ alert "WebDriver слушает на порту N")
  └─ emit('updated') → перерисовка sessionState='running'
```

---

## 15. Связь с автомемори агентов

- `.claude/agent-memory/architect/track_b_complete.md` — итог итерации 2 (этот код): IndigoClient + UI, 14 API endpoints, 6 UI компонентов, миграция, mock.
- `.claude/agent-memory/architect/MEMORY.md` — индекс с записью «Track B: Indigo client + UI».
- `.claude/agent-memory/architect/indigo_deep_proxy_check_preflight.md` — связь Indigo сессий и deep-proxy-check.
- `docs/architecture/social_automation.md` — общая архитектура с разделом «Итерация 2 — Indigo».
- `PROJECT_AUDIT.md` — упоминания на строках 944, 2118, 2413.
