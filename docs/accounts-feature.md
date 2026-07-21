# Система Аккаунтов (`/accounts`) — полная выгрузка

> Снимок состояния на 2026-05-21. Описывает страницу `/accounts`, связанные компоненты, API, БД, RBAC и интеграции (OAuth, Proxy, Indigo, Warmup, Style Profile).

---

## 1. Обзор

Модуль управляет социальными аккаунтами (TikTok / Instagram / YouTube) и их группами для последующей публикации видео из pipeline. Аккаунт — это центральная сущность, к которой привязываются:

- OAuth-токены платформы (зашифровано)
- логин/пароль/2FA-секрет для прогрева и оператора (зашифровано)
- прокси (1 прокси → N аккаунтов)
- Indigo-профиль браузера (для warmup/upload в anti-detect окружении)
- Style Profile (creative identity)
- Группа (для round-robin / fan-out при публикации)
- Метрики прогрева и публикаций (`totalPostsPublished`, `lastPostedAt`, `warmupStatus`, `lastWarmupAt`)

Модульный slug — **`social-upload`**. Доступ к странице защищён middleware `module-access` плюс серверным `requireScopedAccess({ moduleSlug: 'social-upload' })` на каждом endpoint.

---

## 2. Страница `/accounts`

**Файл:** `app/pages/accounts/index.vue`

### Page meta

```ts
definePageMeta({ layout: 'default', middleware: 'module-access', moduleSlug: 'social-upload' })
useHead({ title: 'Аккаунты' })
```

### Состав UI

| Блок | Описание |
|------|----------|
| Заголовок «Аккаунты соцсетей» | + селектор приложения (если приложений > 1) + кнопка `AccountConnectButton` (OAuth). |
| `SharedPageGuide` | Гайд из `app/utils/guides.ts → pageGuides.accounts` (шаги + tip про пачки). |
| Loading / Error | Спиннер либо `alert-error` с `error.message`. |
| Сетка аккаунтов | `grid` (1/2/3 колонки) → `AccountCard` для каждого. Если пусто — `SharedEmptyState` (иконка `group-line`). |
| Divider «Пачки аккаунтов» | Появляется только если есть группы. |
| Сетка групп | `AccountGroupCard`. |
| Modals | `AccountGroupEditModal`, `AccountEditModal`, диалог `AccountStyleProfileEditor`. |

### Фильтры и data-flow

```ts
selectedAppId: Ref<number | undefined>            // селектор приложения
accountFilters → { appId? }
groupFilters → { appId? }

useAccounts(accountFilters)        // composable → useFetch('/api/accounts')
useAccountGroups(groupFilters)     // composable → useFetch('/api/account-groups')
useFetch('/api/apps')              // для селектора приложений
```

### События со стороны карточек

- `disconnected` → `refreshAccounts()`
- `open-style` → диалог `AccountStyleProfileEditor` (`styleAccountId`, `styleAccountName`)
- `edit` → `AccountEditModal.open({ id, displayName, proxyId })`
- `groupEdit` / `groupDelete` / `groupSaved` → CRUD `account-groups`

---

## 3. Карта компонентов (`app/components/account/`)

| Файл | Назначение |
|------|-----------|
| `AccountCard.vue` | Карточка аккаунта: платформа (icon+label), статус (active/expired/revoked), `displayName`, style-status badge, статистика (`_count.uploads`, `_count.groups`), прокси (label + `ProxyHealthBadge`), флаг «Логин: задан/не задан», кнопки `Стиль` / `Редактировать` / `Отключить` (confirm modal). |
| `AccountConnectButton.vue` | Dropdown «Подключить аккаунт» → 3 платформы → `navigateTo('/api/social/connect/:platform?appId=...', external)` через `useAccountActions().connectAccount`. |
| `AccountEditModal.vue` | Modal с табами **Доступы / Прокси / Indigo / Прогрев**. Каждый таб рендерит соответствующий саб-компонент. |
| `AccountCredentialsForm.vue` | Форма зашифрованных полей (loginEmail, loginPassword, recoveryEmail, recoveryPhone, twoFASecret) + метаданные (notes, birthDate, registrationSource, warmupStatus). Каждое секретное поле: кнопка «глаз» открывает `AccountCredentialRevealModal` (требует reason ≥10 симв), кнопка «крестик» очищает. Использует `useAccountCredentials()`. Отправляет только dirty-поля. |
| `AccountCredentialRevealModal.vue` | Запрос причины + audit-логированная расшифровка одного поля через `POST /api/accounts/:id/credentials/reveal`. |
| `AccountProxyPicker.vue` | Выбор прокси + **Deep Proxy Check** (требует `canAdmin`, прокси и Indigo-профиль). Запускает реальный Indigo browser через `POST /api/accounts/:id/deep-proxy-check`, отображает IP/leak/recommendation + детали. Прогресс с тикером по 4 фазам. Force-stop зависшей Indigo-сессии. |
| `AccountIndigoTab.vue` | Привязка/создание/отвязка Indigo-профиля. Поддерживает мульти-аккаунт (informer «также привязан к» для non-primary профилей). «Свободный профиль» = `accounts.length === 0`. |
| `AccountWarmupTab.vue` | Генерация плана прогрева (preview + schedule), список последних 10 сессий, отмена/удаление сессий. |
| `AccountGroupCard.vue` | Карточка группы: имя, кол-во аккаунтов, до 5 миниатюр участников + «+N», кнопки `Изменить` / `Удалить`. |
| `AccountGroupEditModal.vue` | Создание/редактирование группы (`name`, чекбоксы по аккаунтам). `PUT /api/account-groups/:id`. |
| `AccountStyleStatusBadge.vue` | Badge `not_set` / `partial` / `complete`. |
| `AccountStyleProfileEditor.vue` | Полноценный редактор Style Profile с 7 табами (Тон / Визуал / Субтитры / Герой / Монтаж / CTA / История) + AI-рекомендации. |
| `AccountPicker.vue` | Двух-режимный пикер (account / group) для pipeline (`UploadConfig.vue`, `UploadCreateModal.vue`). Поиск, фильтр платформы, dispatchMode override, inline-warnings (platformMismatch, expired account, empty group). |

### Admin-компоненты (`app/components/admin/`)

| Файл | Назначение |
|------|-----------|
| `AccountsHealthSummary.vue` | 6 cards: Всего / Активных / Проблемных / Мёртвый прокси / Без warmup 7д+ / Без креденшелов. |
| `AccountsHealthByPlatform.vue` | Распределение по платформам. |
| `AccountsHealthTable.vue` | Таблица: аккаунт, платформа, статус, прокси (label+статус-badge), креды (lock+shield icons), прогрев (badge + relative), `AccountCompletenessBar`. Клик по строке → `AccountEditModal`. |
| `AccountCompletenessBar.vue` | Цветная progress bar полноты аккаунта. |

---

## 4. Composables

| Файл | Экспорт | Что делает |
|------|---------|------------|
| `app/composables/useAccounts.ts` | `useAccounts(filters)` | `useFetch('/api/accounts', { query: filters })`. |
| `app/composables/useAccountGroups.ts` | `useAccountGroups(filters)` | `useFetch('/api/account-groups', { query: filters })`. |
| `app/composables/useAccountActions.ts` | `useAccountActions()` | `connectAccount(platform, appId)` → external redirect на `/api/social/connect/:platform?appId=`. `disconnectAccount(id)` → `DELETE /api/accounts/:id`. |
| `app/composables/useAccountCredentials.ts` | `useAccountCredentials()` | `saveCredentials(id, body)` → `PUT /credentials`; `revealField(id, field, reason)` → `POST /credentials/reveal`; `setProxy(id, proxyId)` → `PUT /proxy`; `loadMeta(id)` → `GET /credentials-meta`. Возвращает `isBusy`, `error`. |
| `app/composables/useAccountsHealth.ts` | `useAccountsHealth()` | `useFetch('/api/admin/accounts-health')`. |

---

## 5. Backend API

### 5.1. Основные endpoints `/api/accounts`

| Метод | URL | Permission | Назначение |
|-------|-----|-----------|------------|
| `GET` | `/api/accounts` | `canRead` + `social-upload` | Список с фильтрами `appId`/`platform`/`status`. Возвращает compact shape для пикеров: `id`, `appId`, `platform`, `displayName`, `platformUserId`, `status`, `expiresAt`, `lastPostedAt`, `createdAt/updatedAt`, `proxyId`/`proxy` (id+label+status), `_count.uploads/groups`, `app.name`, `styleProfile.id/status/version`, computed `profileCompleteness` (0/50/100), `hasLoginCredentials`. **Никогда не возвращает шифротексты.** |
| `POST` | `/api/accounts` | `canCreate` | Ручная привязка (для OAuth callback или тестов). Тело: `appId`, `platform`, `displayName`, `accessToken`, `refreshToken?`, `expiresAt?`, `platformUserId?`. Токены шифруются через `encrypt()`. |
| `DELETE` | `/api/accounts/:id` | `canDelete` | Отвязать аккаунт. **Блокируется** если есть активные uploads в статусах `pending`/`uploading`/`scheduled` (HTTP 409). |
| `GET` | `/api/accounts/:id/credentials-meta` | `canRead` | Не-секретные мета-поля + флаги `hasLoginEmail`/`hasLoginPassword`/`hasRecoveryEmail`/`hasRecoveryPhone`/`hasTwoFASecret`/`hasIndigoProfile`. Используется формой credentials для preload. |
| `PUT` | `/api/accounts/:id/credentials` | `canWrite` | Обновление шифрованных login-полей и метаданных. Каждое поле шифруется через `encryptSecret()`. Поддерживает selective update (только переданные поля). Валидация `birthDate` (не в будущем), `registrationSource` (`self`/`purchased`/`transferred`), `warmupStatus` (`new`/`warming`/`ready`/`cold`). |
| `POST` | `/api/accounts/:id/credentials/reveal` | `canRead` | Расшифровка **одного** поля с обязательным `reason` (10..500 симв.). Audit-лог в `SecretAccessLog` через `readSecret()` + `buildSecretAccessContext()`. |
| `PUT` | `/api/accounts/:id/proxy` | `canWrite` | Привязка/отвязка прокси (`proxyId: string \| null`). |
| `GET` | `/api/accounts/:id/style` | `canRead` | Resolved style profile (с учётом group policy) + последние 20 ревизий. Через `getAccountStyleContext(id)`. |
| `PUT` | `/api/accounts/:id/style` | `canWrite` | Обновление/создание style profile. Создаёт `AccountStyleRevision` с diff. Пересчитывает `status` через `computeStyleStatus()`. |
| `POST` | `/api/accounts/:id/style/suggest` | `canRunAgent` + `requirePaidApisEnabled` | AI-рекомендации (Anthropic Claude). Контекст: метрики последних 10 успешных uploads + ScenarioFeedback + текущий профиль. Сохраняет `AccountStyleRevision` с `changeType: 'ai_suggestion'`, `accepted: false`. |
| `POST` | `/api/accounts/:id/style/apply-suggestion` | `canWrite` | Применить выбранные `recommendations[]` к профилю. |
| `POST` | `/api/accounts/:id/deep-proxy-check` | `canAdmin` | Уровень C проверки прокси: реальный запуск Indigo-сессии, IP-fetch через CDP с `ifconfig.me`. Возвращает `DeepProxyCheckResult` (steps, durations, verdict). Дорогая операция (30-90 сек / 1 Indigo session). |

### 5.2. Endpoints `/api/account-groups`

| Метод | URL | Permission | Назначение |
|-------|-----|-----------|------------|
| `GET` | `/api/account-groups` | `canRead` | Список с `appId`/`platform` фильтрами. Включает `members[].socialAccount`, computed `activeMembersCount`. |
| `POST` | `/api/account-groups` | `canCreate` | Создать группу. Тело: `appId`, `name`, `accountIds[]`, `dispatchMode` (default `round_robin`). |
| `PUT` | `/api/account-groups/:id` | `canWrite` | Обновить `name` / `dispatchMode` / состав (`accountIds[]` полная замена через delete+createMany). |
| `DELETE` | `/api/account-groups/:id` | `canDelete` | Удалить группу. Сами аккаунты не удаляются (CASCADE только на `AccountGroupMember`). |

### 5.3. OAuth flow `/api/social/*`

| Метод | URL | Назначение |
|-------|-----|-----------|
| `GET` | `/api/social/connect/:platform` | `canCreate` + `requireSocialPostingEnabled`. Генерирует CSRF state, сохраняет в httpOnly-cookie (10 мин), сохраняет `appId` в cookie. Редирект на `authUrl` платформы (с `client_id`/`client_key` для TikTok). |
| `GET` | `/api/social/callback/:platform` | OAuth callback. Проверяет state vs cookie, обменивает `code` на токены через `tokenUrl`. Получает `displayName`/`platformUserId` через API платформы (`youtube/v3/channels?mine=true`, `open.tiktokapis.com/v2/user/info/`). Шифрует токены, создаёт `SocialAccount`. Редирект на `/accounts?success=:platform` или `/accounts?error=...`. |

### 5.4. Admin endpoint

| Метод | URL | Назначение |
|-------|-----|-----------|
| `GET` | `/api/admin/accounts-health` | `canAdmin`. Возвращает агрегаты + per-account rows с computed `completenessPercent` (8 критериев × 12.5%). Никаких секретов, только boolean `hasLoginCredentials`/`has2FA`. |

---

## 6. БД схема (Prisma)

### 6.1. Модель `SocialAccount` (`prisma/schema.prisma:733`)

```prisma
model SocialAccount {
  id                  Int                  @id @default(autoincrement())
  appId               Int
  app                 App                  @relation(fields: [appId], references: [id])
  platform            Platform             // tiktok | instagram | youtube
  displayName         String
  platformUserId      String?
  accessToken         String               // AES-256-GCM ciphertext (iv:authTag:ct)
  refreshToken        String?              // AES-256-GCM ciphertext
  expiresAt           DateTime?
  status              AccountStatus        @default(active) // active | expired | revoked
  lastPostedAt        DateTime?            // для round-robin
  // --- Social Automation foundation ---
  loginEmail          String?              // зашифровано
  loginPassword       String?              // зашифровано
  recoveryEmail       String?              // зашифровано
  recoveryPhone       String?              // зашифровано
  twoFASecret         String?              // зашифровано
  notes               String?              // plain operator-notes
  birthDate           DateTime?
  registrationSource  RegistrationSource?  // self | purchased | transferred
  proxyId             String?
  proxy               Proxy?               @relation(fields: [proxyId], references: [id], onDelete: SetNull)
  indigoProfileId     String?              // denorm primary Indigo profile
  warmupStatus        WarmupStatus         @default(new) // new | warming | ready | cold
  lastWarmupAt        DateTime?
  totalPostsPublished Int                  @default(0)
  createdAt           DateTime             @default(now())
  updatedAt           DateTime             @updatedAt
  // relations
  uploads             Upload[]
  groups              AccountGroupMember[]
  styleProfile        AccountStyleProfile?
  indigoProfile       IndigoProfile?
  postingJobs         PostingJob[]
  warmupSessions      WarmupSession[]
  indigoProfileLinks  IndigoProfileAccount[]

  @@index([appId, status])
  @@index([appId, platform, status])
  @@index([proxyId])
  @@index([warmupStatus])
}
```

### 6.2. Связанные модели

```prisma
model AccountGroup {
  id           Int                  @id @default(autoincrement())
  appId        Int
  name         String
  styleMode    String               @default("independent") // independent | unified | base_with_overrides
  stylePolicy  Json?                // GroupStylePolicy
  dispatchMode String               @default("round_robin") // round_robin | all | first_active
  createdAt    DateTime             @default(now())
  updatedAt    DateTime             @updatedAt
  members      AccountGroupMember[]
  cycles       ProductionCycle[]
  uploads      Upload[]
  @@index([appId])
}

model AccountGroupMember {
  id              Int           @id @default(autoincrement())
  groupId         Int
  socialAccountId Int
  @@unique([groupId, socialAccountId])
}

model AccountStyleProfile {
  id              Int                    @id @default(autoincrement())
  socialAccountId Int                    @unique
  version         Int                    @default(1)
  data            Json                   // AccountStyleProfileData
  status          String                 @default("not_set") // not_set | partial | complete
  createdAt       DateTime               @default(now())
  updatedAt       DateTime               @updatedAt
  revisions       AccountStyleRevision[]
  @@index([status])
}

model AccountStyleRevision {
  id              Int                 @id @default(autoincrement())
  profileId       Int
  version         Int
  changeType      String              // manual | ai_suggestion | analytics_derived
  changeSummary   String
  changedSections String[]
  previousData    Json                // partial snapshot
  newData         Json                // partial snapshot
  accepted        Boolean             @default(false)
  appliedById     Int?
  createdAt       DateTime            @default(now())
  @@index([profileId, createdAt])
}
```

### 6.3. Enums

```prisma
enum Platform           { tiktok | instagram | youtube }
enum AccountStatus      { active | expired | revoked }
enum WarmupStatus       { new | warming | ready | cold }
enum RegistrationSource { self | purchased | transferred }
enum ProxyType          { mobile | residential | datacenter }
enum ProxyProtocol      { http | https | socks5 }
enum ProxyStatus        { unverified | healthy | degraded | dead | expired }
```

---

## 7. Безопасность секретов

### Шифрование

- **AES-256-GCM**, формат `iv:authTag:ciphertext`.
- Функция `encrypt()` / `encryptSecret()` шифрует на запись, `readSecret()` — расшифровывает на чтение.
- Шифруются: `accessToken`, `refreshToken`, `loginEmail`, `loginPassword`, `recoveryEmail`, `recoveryPhone`, `twoFASecret`.
- `notes` — НЕ шифруется (operator-facing план).

### Audit-log

- Каждая расшифровка через `POST /credentials/reveal` пишется в `SecretAccessLog` через `readSecret({ entityType: 'SocialAccount.<field>', entityId, action: 'view' }, ctx)`.
- `entityType` строится как `SocialAccount.loginEmail` / `.loginPassword` / `.recoveryEmail` / `.recoveryPhone` / `.twoFASecret`.
- Минимальная длина `reason` — 10 символов (защита от пустых причин). Максимум — 500.
- На клиенте: `AccountCredentialsForm.vue` — кнопка «глаз» открывает `AccountCredentialRevealModal` с обязательным полем причины.

### API-disclosure

- `GET /api/accounts` и `GET /api/admin/accounts-health` **никогда не возвращают шифротексты** — только boolean-флаги `hasLoginCredentials`, `has2FA`, `hasIndigoProfile`.
- `GET /api/accounts/:id/credentials-meta` тоже даёт только флаги. Шифротекст уходит наружу **только** через explicit reveal с reason+audit.

---

## 8. RBAC

| Endpoint | Permission | Module |
|----------|-----------|--------|
| `GET /api/accounts` | `canRead` | `social-upload` |
| `POST /api/accounts` | `canCreate` | `social-upload` |
| `DELETE /api/accounts/:id` | `canDelete` | `social-upload` |
| `GET /credentials-meta` | `canRead` | `social-upload` |
| `PUT /credentials` | `canWrite` | `social-upload` |
| `POST /credentials/reveal` | `canRead` | `social-upload` |
| `PUT /proxy` | `canWrite` | `social-upload` |
| `GET /style` | `canRead` | `social-upload` |
| `PUT /style` | `canWrite` | `social-upload` |
| `POST /style/suggest` | `canRunAgent` | `social-upload` |
| `POST /style/apply-suggestion` | `canWrite` | `social-upload` |
| `POST /deep-proxy-check` | `canAdmin` | — |
| `GET /api/account-groups` | `canRead` | `social-upload` |
| `POST /api/account-groups` | `canCreate` | `social-upload` |
| `PUT /api/account-groups/:id` | `canWrite` | `social-upload` |
| `DELETE /api/account-groups/:id` | `canDelete` | `social-upload` |
| `GET /api/social/connect/:platform` | `canCreate` | `social-upload` |
| `GET /api/admin/accounts-health` | `canAdmin` | — |

Routing-guard: `middleware: 'module-access'` + `moduleSlug: 'social-upload'` в `definePageMeta`.

Согласно философии RBAC проекта (CLAUDE.md):
- `canAdmin=true` НЕ даёт автоматически `canRunAgent` (для AI-suggest нужен явный флаг).
- Bypass для админа есть только в `requireModuleAccess()` и `requireAppAccess()`.
- `requirePermission()` без bypass'ов.

---

## 9. OAuth Flow

```
1. User → AccountConnectButton → /api/social/connect/:platform?appId=N
   ├─ requireScopedAccess(canCreate, social-upload)
   ├─ requireSocialPostingEnabled(platform)         // флаг окружения
   ├─ getOAuthConfig(platform).getClientId()        // .env
   ├─ randomUUID() → cookie oauth_state_:platform (10 мин)
   ├─ cookie oauth_appId_:platform = N
   └─ Redirect → authUrl (Google / TikTok / Instagram)

2. Provider → /api/social/callback/:platform?code=...&state=...
   ├─ requireUserSession
   ├─ state check vs cookie (CSRF)
   ├─ appId из cookie
   ├─ POST tokenUrl { code, redirect_uri, grant_type, client_id/client_key, client_secret }
   ├─ fetchPlatformUserInfo() — displayName + platformUserId
   ├─ encrypt(accessToken/refreshToken)
   ├─ prisma.socialAccount.create({ status: 'active' })
   └─ Redirect → /accounts?success=:platform
```

**Особенности платформ:**
- **TikTok**: `client_key` вместо `client_id`. UserInfo через `open.tiktokapis.com/v2/user/info/`.
- **YouTube**: стандартный Google OAuth. UserInfo через `googleapis.com/youtube/v3/channels?mine=true`.
- **Instagram**: для MVP — заглушка `displayName: 'Instagram аккаунт'`, `platformUserId: null`.

---

## 10. Связанные подсистемы

### 10.1. Прокси (`Proxy`, `/proxies`)
- 1:N связь: один прокси обслуживает несколько аккаунтов (`SocialAccount.proxyId`).
- При удалении прокси — `onDelete: SetNull`.
- Статусы: `unverified` / `healthy` / `degraded` / `dead` / `expired`.
- `ProxyHealthCheck` хранит историю проверок (TCP + HTTP + IP/country/leak).
- Привязка через `PUT /api/accounts/:id/proxy`.
- Deep-check уровня C: `POST /api/accounts/:id/deep-proxy-check` — реальный Indigo-браузер с ifconfig.me.

### 10.2. Indigo (`IndigoProfile`, `/indigo`)
- `IndigoProfile.socialAccountId` — denorm primary указатель.
- Multi-account через `IndigoProfileAccount[]` (один профиль может обслуживать несколько аккаунтов, один — primary).
- `syncStatus`: `synced` / `local_only` / `remote_only` / `conflict` / `deleted_remote` / `error` / `archived`.
- В таб «Indigo» (`AccountIndigoTab.vue`): создание нового профиля, привязка существующего «свободного» (`accounts.length === 0`), informer для non-primary связей.

### 10.3. Warmup (`WarmupSession`, `/api/warmup/*`)
- Детерминистический план активности (просмотры/скролл/лайки) на основе возраста аккаунта и количества публикаций.
- Один план на день (`dayKey`, `seed`, `ageBucket`).
- Таб «Прогрев» (`AccountWarmupTab.vue`): `previewPlan` → `schedulePlan(replace?)` → история последних 10 сессий. Отмена / удаление через `useWarmupActions()`.
- Поле `SocialAccount.lastWarmupAt` обновляется sync-job'ом.

### 10.4. Style Profile (`AccountStyleProfile`)
- 1:1 с `SocialAccount` (cascade delete).
- `data: Json` хранит `AccountStyleProfileData` (см. `shared/types/account-style.ts`):
  - `tone` (voice, persona, formality, emotionalRange, forbiddenPhrases)
  - `visual` (colorPalette, aesthetic, lighting, cameraStyle, allowedEffects, forbiddenVisuals)
  - `subtitles` (fontIntent, casing, primaryColor, outlineColor, entrance, defaultPosition)
  - `protagonist` (preferredType, visualStyle, recurringMarkers, restrictions)
  - `cta` (style, examples, forbidden)
  - `editing` (pacing, preferredDuration, transitionStyle, preferredSceneCount)
  - `preview` (thumbnailApproach, requiredElements, textStyle)
  - `experimentationDegree` 0..100
  - `consistencyStrictness` 0..100
  - `referenceSources[]`
- `status`: `not_set` (0%) / `partial` (50%) / `complete` (100%) — вычисляется `computeStyleStatus()`.
- `AccountStyleRevision` — история ревизий с типом `manual` / `ai_suggestion` / `analytics_derived`.
- **Group policy** через `AccountGroup.stylePolicy: Json` → `GroupStylePolicy { mode: independent | unified | base_with_overrides, baseStyle, overridableSections }`.

### 10.5. Pipeline (Upload)
- `Upload.socialAccountId` (REQUIRED) и `Upload.accountGroupId` (опционально, если выбрана группа).
- `Upload.dispatchMode` — снимок стратегии на момент создания (`round_robin` / `all` / `first_active`).
- При DELETE аккаунта — блокировка, если есть `Upload` в `pending`/`uploading`/`scheduled`.

---

## 11. Admin: `/admin/accounts-health`

**Файл:** `app/pages/admin/accounts-health.vue` (middleware `admin-access`).

### Что показывает

1. **`AccountsHealthSummary`** — 6 card'ов: Всего / Активных / Проблемных (`total - active`) / Мёртвый прокси / Без warmup 7д+ / Без креденшелов.
2. **`AccountsHealthByPlatform`** — распределение TikTok/YouTube/Instagram.
3. **`AccountsHealthTable`** — таблица аккаунтов, отсортированная по `completenessPercent` ASC (самые проблемные сверху).
4. Клик по строке → `AccountEditModal`.

### `completenessPercent` (0..100)

8 критериев × 12.5%:

| Критерий | Условие |
|----------|---------|
| `hasLoginCredentials` | `loginEmail` AND `loginPassword` присутствуют |
| `has2FA` | `twoFASecret` присутствует |
| `hasProxy` | `proxyId` не null |
| `isProxyHealthy` | `proxy.status === 'healthy'` |
| `hasIndigoProfile` | `indigoProfileId` не null |
| `isWarmupReady` | `warmupStatus === 'ready'` |
| `recentWarmup` | `lastWarmupAt >= 7 дней назад` |
| `isActive` | `status === 'active'` |

---

## 12. UX/UI guide

`app/utils/guides.ts`:

```ts
pageGuides.accounts = {
  title: 'Как работать с аккаунтами',
  steps: [
    'Подключите аккаунты соцсетей кнопкой "Подключить аккаунт"',
    'Каждый аккаунт привязывается к платформе (TikTok, Instagram, YouTube)',
    'Объединяйте аккаунты в пачки для массовой публикации',
    'Отключайте неактивные аккаунты, чтобы не засорять список',
  ],
  tips: ['Создайте пачки по тематике -- так проще управлять публикациями'],
}

pageGuides['accounts-health'] = {
  title: 'Зачем эта страница',
  steps: [
    'Сверху — общая сводка проблем по всем аккаунтам',
    'Под ней — распределение аккаунтов по платформам',
    'В таблице — все аккаунты, отсортированные от самых проблемных вверху...',
    'Кликни по строке — откроется редактирование аккаунта',
  ],
  tips: [
    'Полнота 100% = все 8 критериев выполнены: креденшелы, 2FA, прокси (живой), Indigo-профиль, активный warmupStatus=ready, недавний прогрев (≤7д), статус active',
    'Если прокси degraded или dead — аккаунт под угрозой бана. Замени или сними нагрузку',
  ],
}
```

---

## 13. Где аккаунты используются вне `/accounts`

| Локация | Что делает |
|---------|-----------|
| `app/pages/pipeline/index.vue` (`UploadConfig.vue`) | Выбор аккаунта/группы для upload через `AccountPicker`. |
| `app/components/upload/UploadCreateModal.vue` | Создание Upload — `AccountPicker` + dispatchMode override. |
| `app/pages/analytics/index.vue` + `AnalyticsFilters.vue` | Фильтр аналитики по аккаунту. |
| `app/components/admin/AppAccountsManager.vue` | Управление аккаунтами в контексте конкретного App в admin-разделе. |
| `app/pages/admin/accounts-health.vue` | Health dashboard (см. п. 11). |

---

## 14. Tree-вью файлов

```
app/
├── pages/
│   ├── accounts/index.vue              ← главная страница /accounts
│   └── admin/accounts-health.vue       ← admin dashboard
├── components/account/
│   ├── AccountCard.vue
│   ├── AccountConnectButton.vue
│   ├── AccountCredentialRevealModal.vue
│   ├── AccountCredentialsForm.vue
│   ├── AccountEditModal.vue
│   ├── AccountGroupCard.vue
│   ├── AccountGroupEditModal.vue
│   ├── AccountIndigoTab.vue
│   ├── AccountPicker.vue
│   ├── AccountProxyPicker.vue
│   ├── AccountStyleProfileEditor.vue
│   ├── AccountStyleStatusBadge.vue
│   └── AccountWarmupTab.vue
├── components/admin/
│   ├── AccountCompletenessBar.vue
│   ├── AccountsHealthByPlatform.vue
│   ├── AccountsHealthSummary.vue
│   ├── AccountsHealthTable.vue
│   └── AppAccountsManager.vue
├── composables/
│   ├── useAccounts.ts
│   ├── useAccountActions.ts
│   ├── useAccountCredentials.ts
│   ├── useAccountGroups.ts
│   └── useAccountsHealth.ts
└── middleware/module-access.ts

server/api/
├── accounts/
│   ├── index.get.ts            (GET    /api/accounts)
│   ├── index.post.ts           (POST   /api/accounts)
│   ├── [id].delete.ts          (DELETE /api/accounts/:id)
│   └── [id]/
│       ├── credentials-meta.get.ts
│       ├── credentials.put.ts
│       ├── credentials/reveal.post.ts
│       ├── proxy.put.ts
│       ├── deep-proxy-check.post.ts
│       └── style/
│           ├── index.get.ts
│           ├── index.put.ts
│           ├── suggest.post.ts
│           └── apply-suggestion.post.ts
├── account-groups/
│   ├── index.get.ts
│   ├── index.post.ts
│   ├── [id].put.ts
│   └── [id].delete.ts
├── social/
│   ├── connect/[platform].get.ts
│   └── callback/[platform].get.ts
└── admin/
    └── accounts-health.get.ts

shared/types/
├── account-style.ts
└── accounts-health.ts

prisma/schema.prisma           ← модели SocialAccount, AccountGroup, AccountGroupMember,
                                  AccountStyleProfile, AccountStyleRevision, Proxy, IndigoProfile
```

---

## 15. Ключевые инварианты

1. **Шифротекст никогда не покидает сервер без explicit reveal с audit-логом.**
2. **DELETE `/api/accounts/:id` блокируется при наличии активных uploads** (409 Conflict).
3. **OAuth state-cookie защищён httpOnly + 10-минутный TTL + проверка совпадения в callback.**
4. **`profileCompleteness` для UI пикеров** считается из `styleProfile.status` (0 / 50 / 100), а в `/accounts-health` — это 8 чек-боксов × 12.5%.
5. **Один прокси может обслуживать несколько аккаунтов** (1:N). Один Indigo-профиль с M.1 — тоже multi-account (через `IndigoProfileAccount`).
6. **При удалении прокси** — `onDelete: SetNull` на `SocialAccount.proxyId`; на `IndigoProfile.proxyId` — тоже SetNull.
7. **При удалении SocialAccount** — `onDelete: Cascade` на `AccountStyleProfile`, `IndigoProfileAccount`. На `IndigoProfile.socialAccountId` — SetNull (denorm указатель).
8. **Группа удаляется без удаления аккаунтов** — Cascade только на `AccountGroupMember`.
9. **OAuth callback на Instagram — заглушка** (MVP).
10. **Deep proxy check — admin-only** + дорогая операция (30-90 сек, 1 Indigo session).
