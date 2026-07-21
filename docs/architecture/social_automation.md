# Social Automation Architecture

> Архитектура автоматизированного постинга в соцсети через ZavodCamp + антидетект-окружение Indigo + прокси-инфраструктура. Итерация 1 — foundation (схема, шифрование, прокси, UI). Итерация 2 — Indigo. Итерация 3 — automation runner. Итерация 4 — posting flows.

---

## Scope (итерация 1)

### Что делаем
- Расширяем модель `SocialAccount` полями для логин/пароль/2FA/recovery данных.
- Добавляем модели `Proxy` и `ProxyHealthCheck` — первичная инфраструктура прокси.
- Добавляем модель `SecretAccessLog` — журнал расшифровки секретов.
- Расширяем `server/utils/crypto.ts` (alias-функции `encryptSecret/decryptSecret` + новый файл `secret-access.ts` с `readSecret()` и `sanitizeForLog()`).
- Реализуем `proxy-checker.ts` — health check прокси через TCP connect + HTTP probe + leak detection.
- Создаём 9 API endpoints (`/api/proxies/*` CRUD + reveal + check + history; `/api/accounts/[id]/credentials.*`).
- Создаём страницу `/proxies` + 5 компонентов (`ProxyCard`, `ProxyAddModal`, `ProxyHealthBadge`, `ProxyCheckHistoryModal`, `ProxyRevealCredentialsModal`).
- Расширяем страницу `/accounts` — колонки proxy + credentials, табы Indigo&Proxy + Credentials в edit-модале.
- Добавляем 5-й `setInterval` в `server/plugins/scheduler.ts` — auto health checks (раз в 4 часа).
- Добавляем smoke test `scripts/test-proxy-checker.ts` для ручной проверки прокси.

### Что НЕ делаем (итерация 1)
- Indigo API client / IndigoProfile модель (итерация 2).
- Automation runner service (итерация 3).
- Реальный TikTok/YouTube посты через антидетект (итерация 4).
- Pipeline node integration с автоматизированным постингом (итерация 5).

---

## Итерация 2 — Indigo API client + Profile management (Track B, 2026-04-30)

### Что сделано

- Prisma модель `IndigoProfile` (миграция `20260430122234_indigo_profile`):
  индексируемые поля + opaque `config: Json` snapshot для устойчивости к расширению
  схемы Indigo. Связи: `socialAccountId` 1:1, `proxyId` n:1, `IndigoSyncStatus` enum.
- `server/utils/indigo/` — модульный client:
  - `client.ts` (302 lines) — IndigoClient: authenticate / list / create / update / delete / start / stop.
    Mock-mode через `isIndigoMockMode()`. Pre-session proxy assert в `startProfile`.
  - `rate-limiter.ts` — token bucket 80 RPM (защита от subscription throttle).
  - `token-manager.ts` — кэш токена в `PipelineCredential[name='indigo:auth_token']`,
    refresh за 5 минут до истечения, 401-retry через `withIndigoToken()`.
  - `credentials.ts` — workspace email/password в `PipelineCredential[name='indigo:workspace']`.
  - `sync.ts` — двусторонняя синхронизация (списка из Indigo → upsert по `indigoId`).
  - `dto.ts` — IndigoProfile → DTO (без секретов).
- 14 API endpoints:
  - `/api/indigo/profiles` GET/POST, `/api/indigo/profiles/[id]` GET/PUT/DELETE,
  - `/api/indigo/profiles/[id]/start` (assertProxy + Indigo start), `/stop`,
  - `/api/indigo/profiles/[id]/link-account`, `/unlink-account`,
  - `/api/indigo/sync`,
  - `/api/indigo/credentials` PUT/DELETE, `/credentials/status`, `/credentials/test`.
- UI:
  - `/indigo` — страница со списком профилей, фильтрами, кнопками Sync / Создать / Credentials.
  - `/admin/integrations` — карточка Indigo workspace (Test connection + Settings).
  - 6 компонентов: `IndigoProfileCard`, `IndigoProfileEditModal`, `IndigoProfileLinkModal`,
    `IndigoSyncStatusBadge`, `IndigoSessionStatusBadge`, `IndigoCredentialsModal`.
  - Tab "Indigo" в `AccountEditModal` (`AccountIndigoTab.vue`) — привязать существующий
    или создать новый профиль для аккаунта.
- `scripts/test-indigo-mock.ts` — smoke-тест client'а против `mock:indigo` сервера
  (auth, list, create, delete, rate limiter, auth_invalid scenario).

### Архитектурные решения

1. **Single base URL** — public docs указывают `https://launcher.indigobrowser.com:45001`
   как общую базу для cloud-management и launcher endpoints. Mock-mode подменяет
   на `INDIGO_MOCK_URL` (default `http://localhost:35001`).

2. **MD5(password) при authenticate** — соответствует public docs Indigo. Mock-сервер
   не валидирует hash (любой формат проходит), но client всё равно хеширует —
   когда придёт реальная подписка, не нужен migration.

3. **`config: Json` opaque snapshot** — full Indigo profile shape (fingerprint/parameters)
   хранится как JSON без денормализации. При расширении Indigo schema (например
   новый параметр fingerprint) — нет migration. Денормализованы только индексируемые
   поля: name / platformType / os / userAgent / language / timezone.

4. **PipelineCredential как secret-store** — переиспользована существующая модель
   с `userId=0` для system-level credentials (workspace email/password + auth token).

5. **assertProxyHealthyBeforeSession обязателен в startProfile** — гарантия,
   что Indigo НЕ запустится без здорового прокси (защита от leak'а IP сервера).

6. **withIndigoToken wrapper** — на 401 от Indigo чистит cached token + 1 retry.
   Защищает от ситуации, когда токен протух раньше предполагаемых 24h.

### Ограничения

- Полный shape от real Indigo может оказаться богаче mock'а (особенно
  fingerprint/parameters). После получения подписки возможен один раунд
  prisma migrate dev для денормализации часто используемых полей.
- Token TTL 24h — допущение. Если real Indigo использует короче — withIndigoToken
  поймает 401 и сделает retry (без падения для пользователя).
- Bulk-создание (`times` параметр в Indigo) пока не реализовано — UI создаёт
  по одному профилю.

---

## Threat model

| ID | Угроза | Mitigation (этой итерации) |
|----|--------|----------------------------|
| **T1** | Утечка пароля из БД через дамп | AES-256-GCM шифрование, ENCRYPTION_KEY вне БД, никогда не возвращать password в plain в API |
| **T2** | Утечка пароля через логи (Pino, console, Telegram alerts) | `sanitizeForLog()` обёртка для всех мест, где может попасть password в строку |
| **T3** | Прокси умер → IP сервера утёк через автоматику → бан аккаунта | `proxy-checker.ts` с leak-detection (compares detectedIp == serverIp), `assertProxyHealthyBeforeSession()` блокирует запуск |
| **T4** | Один прокси на несколько аккаунтов → masked-banning при бане одного | Schema-level: `Proxy.socialAccounts SocialAccount[]` (one-to-many), UI warning при попытке привязать второй |
| **T5** | Operator случайно показал пароль другому через скриншот | Audit-log на `reveal`, причина обязательна, в UI eye-toggle делает API call (никогда не рендерим plain в DOM) |
| **T6** | ENCRYPTION_KEY скомпрометирован | Rotation procedure (см. ниже), 32-байтный ключ только в env, не в коде |
| **T7** | Прокси-провайдер вернул левые credentials → реальный IP сервера утекает | Leak detection в `checkProxy()`: получаем external IP сервера через ipify, сравниваем с detectedIp от probe service через прокси |
| **T8** | Health check probe service (ipinfo.io) забанил наш сервер | Список из 3 probe services с fallback, sleep 5s между checks в scheduler |

---

## Data model (ASCII схема)

```
┌──────────────────────┐         ┌──────────────────────┐
│   SocialAccount      │  proxyId│       Proxy          │
│ + loginEmail*        ├────────►│ + label              │
│ + loginPassword*     │         │ + provider           │
│ + recoveryEmail*     │         │ + type (enum)        │
│ + recoveryPhone*     │         │ + host*              │
│ + twoFASecret*       │         │ + port               │
│ + notes              │         │ + username*          │
│ + birthDate          │         │ + password*          │
│ + registrationSource │         │ + rotationUrl*       │
│ + warmupStatus       │         │ + status (enum)      │
│ + lastWarmupAt       │         │ + lastCheckedAt      │
│ + totalPostsPub.     │         │ + lastCheckResult    │
│ + indigoProfileId    │         │ + consecutiveFails   │
│ ...                  │         │ + monthlyTrafficGB   │
└──────────────────────┘         │ + expiresAt          │
                                  │ + createdById        │
                                  │ + notes              │
                                  └──────────┬───────────┘
                                             │ proxyId
                                             ▼
                                  ┌──────────────────────┐
                                  │  ProxyHealthCheck    │
                                  │ + checkedAt          │
                                  │ + triggeredBy        │
                                  │ + tcpConnectOk       │
                                  │ + httpProbeOk        │
                                  │ + detectedIp         │
                                  │ + detectedCountry    │
                                  │ + detectedCity       │
                                  │ + latencyMs          │
                                  │ + isLeaking          │
                                  │ + errorMessage       │
                                  │ + rawProbeData       │
                                  └──────────────────────┘

┌──────────────────────┐
│ SecretAccessLog      │
│ + userId             │
│ + entityType         │   "SocialAccount.password" |
│ + entityId           │   "Proxy.password" |
│ + action             │   "SocialAccount.twoFASecret"
│ + clientIp           │
│ + userAgent          │   "view" | "use_in_session" | "export"
│ + reason             │
│ + createdAt          │
└──────────────────────┘

* = encrypted (AES-256-GCM)
```

### Уже существующие сущности (без изменений)
- `App`, `AccountGroup`, `AccountGroupMember`, `Upload`, `AccountStyleProfile`, `ZavodUser` — не трогаем.
- `SocialAccount.lastPostedAt` — уже есть, повторно не добавляется.

---

## Encryption contract

### Текущее (server/utils/crypto.ts)
- `encrypt(text): string` → `iv:authTag:ciphertext` (hex), AES-256-GCM, IV 16, tag 16, ключ 32 байта из `runtimeConfig.encryptionKey`.
- `decrypt(encrypted): string`.

### Расширения (этой итерации)
- `encryptSecret(plain): string` — alias для `encrypt`, семантический контракт «это секрет, не token».
- `decryptSecret(cipher): string` — alias для `decrypt`, использовать только внутри `readSecret()`.
- `readSecret(ciphertext, meta, ctx): Promise<string|null>` — обёртка с audit-log в `SecretAccessLog` ДО расшифровки.
- `sanitizeForLog(value): unknown` — рекурсивный sanitizer, маскирует ключи `password|pwd|pass|secret|token|key|apiKey|twoFASecret|rotationUrl` → `[REDACTED]`, plus regex для `host:port:user:pass` строк.

### Setup и backup ENCRYPTION_KEY

**Генерация ключа** (32 байта, hex):

```bash
openssl rand -hex 32
```

Результат — 64 hex-символа. Сохранить в `.env` как `ENCRYPTION_KEY=<64 hex>`.

**Правила хранения**:
- Production и dev окружения — **разные** ключи. Никогда не использовать прод-ключ локально.
- Хранить prod-ключ в password manager (1Password, Bitwarden, корпоративный vault) с пометкой "ZavodCamp ENCRYPTION_KEY: PRODUCTION — DO NOT LOSE".
- Резервная копия ключа — у двух независимых maintainer'ов, в зашифрованном виде.
- Ротация — раз в год через `scripts/rotate-encryption-key.ts` (см. ниже).

**Что произойдёт при потере ключа**:
- Все шифрованные поля становятся **невосстановимы**: `SocialAccount.loginEmail/loginPassword/recoveryEmail/recoveryPhone/twoFASecret/accessToken/refreshToken`, все поля `Proxy.host/username/password/rotationUrl`.
- Аккаунты придётся вводить заново вручную, прокси — перевыпускать у провайдера.
- Метаданные (notes, birthDate, registrationSource, warmupStatus) НЕ шифруются и сохранятся.
- Это инцидент с потерей данных уровня "high" — описано в `docs/COMPLIANCE.md`.

**Если ключ сейчас не задан в .env**:
- При первом запросе на расшифровку получаешь HTTP 500 с сообщением `ENCRYPTION_KEY не настроен в .env. Сгенерировать новый ключ: openssl rand -hex 32`.
- При неверной длине (не 64 hex-символа) — HTTP 500 с тем же hint'ом.

### Кто имеет доступ к расшифровке
- **Через `readSecret()`:** оператор через UI reveal-эндпоинты, runner-сессии (итерация 3, через `use_in_session`).
- **Прямой `decryptSecret()`:** только `proxy-checker.ts` для health checks (без audit, т.к. checks частые и не идут в UI оператору). На audit для proxy-runtime будет в итерации 3, когда прокси используется в реальной сессии.

### Rotation procedure (T6 mitigation)
1. Сгенерировать новый 32-байтный hex ключ (`openssl rand -hex 32`).
2. В отдельной сессии с обоими ключами (`OLD_ENCRYPTION_KEY` + `ENCRYPTION_KEY`) запустить миграционный скрипт `scripts/rotate-encryption-key.ts` (создаётся при необходимости): читает все шифрованные поля, расшифровывает старым ключом, шифрует новым.
3. Перезапустить сервис с новым ключом.
4. Удалить `OLD_ENCRYPTION_KEY` из env.
5. (В этой итерации скрипт ротации НЕ создаётся — будет в итерации 2 при появлении production deployment.)

---

## API contract (новые endpoints)

| Method | Path | Permission | Body / Response |
|--------|------|------------|-----------------|
| POST | `/api/proxies` | canCreate, social-upload | `{label, provider?, type, host, port, username?, password?, rotationUrl?, expectedCountry?, expectedCity?, monthlyTrafficGB?, expiresAt?, notes?}` → `{id, label, type, status, ...} (no secrets)` |
| GET | `/api/proxies` | canRead, social-upload | `?status=&type=&search=` → `[{id, label, type, status, hostMasked, expectedCountry, lastCheckedAt, _count: {socialAccounts}}]` |
| GET | `/api/proxies/[id]` | canRead, social-upload | `{id, label, ..., hostMasked, lastCheckResult, consecutiveFailures}` |
| PUT | `/api/proxies/[id]` | canWrite, social-upload | partial body → updated row |
| DELETE | `/api/proxies/[id]` | canDelete, social-upload | если `_count.socialAccounts > 0` → 409 |
| POST | `/api/proxies/[id]/check` | canWrite, social-upload | → `ProxyCheckResult` |
| GET | `/api/proxies/[id]/checks` | canRead, social-upload | last 50 → `ProxyHealthCheck[]` |
| POST | `/api/proxies/[id]/reveal` | canRead, social-upload | `{reason}` → `{host, port, username, password}` (audit-logged) |
| PUT | `/api/accounts/[id]/credentials` | canWrite, social-upload | `{loginEmail?, loginPassword?, recoveryEmail?, recoveryPhone?, twoFASecret?, notes?}` → 204 |
| POST | `/api/accounts/[id]/credentials/reveal` | canRead, social-upload | `{field, reason}` → `{value}` (audit-logged, single field per call) |
| PUT | `/api/accounts/[id]/proxy` | canWrite, social-upload | `{proxyId\|null}` → 204 |

### Маскировка `hostMasked`
- IPv4 `45.83.123.45` → `45.83.X.X` (две первые октеты).
- Hostname `proxy.iproyal.com` → `proxy.***.com` (subdomain видим, домен маскируем).
- Никогда не возвращать `host` в plain без явного `/reveal`.

---

## Compliance position (выжимка)

См. `docs/COMPLIANCE.md` для полной формулировки. Краткая выжимка:

- ZavodCamp — инструмент маркетинговой автоматизации в собственных коммерческих интересах оператора.
- Не делаем: spam, взломанные аккаунты, атаки на конкурентов, скам.
- Юридическая ответственность за ToS платформ — на операторе.
- Все секреты шифруются AES-256-GCM, расшифровка журналируется в `SecretAccessLog`.

---

## Файлы итерации

```
prisma/
  schema.prisma                                     [+ Proxy, ProxyHealthCheck, SecretAccessLog, +поля SocialAccount]
  migrations/{ts}_social_automation_foundation/
    migration.sql                                   [миграция]

server/
  utils/
    crypto.ts                                       [+ encryptSecret/decryptSecret aliases]
    secret-access.ts                                [новый: readSecret, sanitizeForLog]
    proxy/
      proxy-checker.ts                              [новый: checkProxy, runProxyHealthCheck, assertProxyHealthyBeforeSession]
      mask.ts                                       [новый: maskHost для API responses]
  api/
    proxies/
      index.get.ts, index.post.ts
      [id].get.ts, [id].put.ts, [id].delete.ts
      [id]/check.post.ts
      [id]/checks.get.ts
      [id]/reveal.post.ts
    accounts/
      [id]/credentials.put.ts
      [id]/credentials/reveal.post.ts
      [id]/proxy.put.ts
  plugins/
    scheduler.ts                                    [+ 5-й setInterval для proxy health]

shared/
  types/
    proxy.ts                                        [новый: Proxy, ProxyType, ProxyStatus, ProxyHealthCheck, ProxyCheckResult]
    social-account-credentials.ts                   [новый: тип credentials формы]

app/
  pages/
    proxies/index.vue                               [новая страница]
    accounts/index.vue                              [+ колонки proxy/credentials]
  components/
    proxy/
      ProxyCard.vue
      ProxyAddModal.vue
      ProxyHealthBadge.vue
      ProxyCheckHistoryModal.vue
      ProxyRevealCredentialsModal.vue
    account/
      AccountCredentialsForm.vue                    [новый]
      AccountProxyPicker.vue                        [новый]
      AccountEditModal.vue                          [новый: вкладки Credentials / Indigo&Proxy]
  composables/
    useProxies.ts
    useProxyActions.ts
    useAccountCredentials.ts
  stores/
    proxyFilters.ts

scripts/
  test-proxy-checker.ts                             [smoke test]

docs/
  COMPLIANCE.md                                     [новый]
  architecture/
    social_automation.md                            [этот файл]

package.json                                        [+ https-proxy-agent, socks-proxy-agent]
```

---

## Rollback plan

См. итерационный план. Главное:
- Миграция reversible через `prisma migrate resolve --rolled-back social_automation_foundation`.
- Env-flag `PROXY_HEALTH_CHECK_ENABLED=false` отключает scheduled checks.
- Существующие `SocialAccount` продолжают работать (новые поля nullable).

---

## Mock Development

Mock-инфраструктура позволяет запускать pipeline end-to-end без реальных внешних API
(Anthropic, fal.ai, Telegram, Indigo, прокси-серверов). Это нужно для:
- разработки UX без расхода токенов и кредитов;
- smoke-тестов в CI без секретов;
- демо-окружения, где нужен предсказуемый результат.

### Включение

В `.env`:

```bash
PROXY_MOCK_MODE=true
INDIGO_MOCK_MODE=true
ANTHROPIC_MOCK_MODE=true
FAL_MOCK_MODE=true
TELEGRAM_MOCK_MODE=true
```

Каждый флаг независим — можно включать только нужные интеграции. `ENABLE_PAID_APIS`
в mock-режимах не нужен: mock-обработчики обходят `requirePaidApisEnabled`.

### Standalone mock-серверы

Используются:
- **прокси**: для прямых HTTP-запросов к IP-info (если код тестируется напрямую);
- **Indigo**: для будущей итерации 3 (Indigo Browser API).

```bash
npm run mock:proxy    # http://localhost:18888
npm run mock:indigo   # http://localhost:35001
npm run mock:all      # оба параллельно (через shell &)
```

### Сценарии Proxy mock

`PROXY_MOCK_MODE=true` работает в двух режимах:

1. **Через `checkProxy()`** — самый частый путь. `host` прокси определяет сценарий:
   `mock-happy_path`, `mock-happy_ru`, `mock-slow`, `mock-timeout`, `mock-auth_failed`,
   `mock-leak`, `mock-private_ip`, `mock-conn_refused`. Никаких сетевых запросов.

2. **Через standalone HTTP-сервер** (`localhost:18888`) — для прямых fetch'ей к
   ipinfo.io / api.ipify.org. Сценарий передаётся через query
   `?scenario=happy_path` или header `X-Mock-Scenario`.

### Сценарии Indigo mock

`localhost:35001`. Сценарий через `?scenario=` или `X-Mock-Scenario`:
- `happy_path` — всё работает (default)
- `auth_invalid` — `/user/signin` отдаёт 401
- `profile_locked` — `/profile/start` отдаёт 409
- `proxy_dead` — `/profile/start` отдаёт 503

### Anthropic fixtures

`ANTHROPIC_MOCK_MODE=true` направляет `callAnthropicAgent` / `callAnthropicAgentCached`
на JSON-фикстуры в `server/__fixtures__/agents/{agentName}-happy.json`.

Готовые fixtures (итерация 1 mock-инфраструктуры):
- `story-architect-happy.json`
- `scene-planner-happy.json`
- `subtitle-director-happy.json`
- `prompt-pattern-extractor-happy.json`
- `trend-analyzer-happy.json`
- `idea-analyzer-happy.json`
- `visual-style-happy.json`

Для добавления нового агента в mock-режим:
1. Добавь `agentName: 'my-agent'` в опции `callAnthropicAgent({ ... })`.
2. Создай `server/__fixtures__/agents/my-agent-happy.json` со структурой,
   валидной для validate-функции этого агента.

Если агент в mock-режиме вызван без `agentName`, или fixture не найдена — будет
выброшена понятная ошибка с подсказкой что добавить.

### fal.ai mock

`FAL_MOCK_MODE=true` заменяет `falSubmit / falPollUntilDone / falGetResult /
falUploadFile / falProbeAccess` на синтетические ответы. URL'ы в результатах
используют схему `mock://` — `downloadFile` распознаёт её и генерит placeholder
через ffmpeg:
- `mock://video/...` → 3-секундное чёрное H.264 1080×1920 + silent AAC.
- `mock://audio/...` → 1-секундный silent MP3.
- `mock://image/...` → 1024×1024 чёрный PNG.
- `mock://transcript/...` → JSON со структурой Whisper.

Placeholder'ы кешируются в `storage/uploads/_mock_cache/` — повторные вызовы
копируют без ffmpeg.

### Telegram mock

`TELEGRAM_MOCK_MODE=true` отключает HTTP-запросы к `api.telegram.org`.
`sendMessage` / `editMessage` / `getBotInfo` логируют payload в stdout
(префикс `[telegram-mock]`) и возвращают синтетический `message_id`.
Все `TelegramDelivery`-записи в БД создаются как обычно — пайплайн обработки
алертов работает end-to-end.

### Smoke-тест полного mock-режима

```bash
PROXY_MOCK_MODE=true \
ANTHROPIC_MOCK_MODE=true \
FAL_MOCK_MODE=true \
TELEGRAM_MOCK_MODE=true \
npm run dev
```

1. Открой `/proxies`.
2. Добавь прокси с label/host `mock-happy_path` (любой порт, любые credentials).
3. Нажми "Проверить" → получишь синтетический healthy результат с IP `188.166.55.42`.
4. Попробуй `mock-leak` → leak detection сработает.

---

## Content Uniqueness Pipeline (Track F)

ffmpeg-сервис уникализации видео перед постингом. Создаёт per-platform варианты
с детерминистическими параметрами, кешированными по `paramsHash`. Реализован
в `server/utils/video-uniqifier/` (params.ts + ffmpeg.ts + service.ts).

### Что меняется
- **File hash** — гарантированно отличается от оригинала за счёт re-encode и
  изменений в видео-/аудио-потоке.
- **Base metadata** — стираем оригинальные теги через `-map_metadata -1` и
  записываем новые `title`/`comment` со случайным seed.
- **Визуальные параметры** — лёгкие сдвиги яркости/контраста/насыщенности
  (-0.06..+0.06 / 0.95..1.06 / 0.92..1.08), crop 0-6 px с каждой стороны,
  audio tempo 0.97..1.03 без pitch-shift.
- **CRF** — рандомизирован в диапазоне 20..24 для разной степени сжатия.

### Чего НЕ делает
- **Не обходит perceptual hashing** TikTok/Meta/YouTube. Эти платформы
  используют content-based fingerprinting (DNN-based), а не file-hash. Малые
  пиксельные сдвиги не ломают такой fingerprint.
- **Не гарантирует** прохождение модерации, обхода shadow-ban или сегмента
  duplicate-content. Это техническое снижение «грубой» защиты, не
  стратегический инструмент.

### Когда использовать
- Только как часть workflow с творческими изменениями (новый хук,
  CTA, монтаж, голос). Сам по себе uniqify не решает проблему дубликатов.
- Хорошо подходит для A/B-тестирования: 2 варианта одного видео для разных
  аккаунтов с одинаковым креативом.

### Хранилище и пути
- Файлы вариантов: `storage/uploads/unique-variants/<videoId>/<platform>_<paramsHash>.mp4`.
- Публичный URL: `/api/files/unique-variants/<videoId>/<platform>_<paramsHash>.mp4`.
- Кеш через unique-constraint `(videoId, platform, paramsHash)` — повторный
  вызов с теми же params возвращает существующую запись без работы ffmpeg.

### Smoke test
`bun run test:uniqifier` — проверяет hash differs from source, tiktok != youtube,
duration drift ±5%, детерминированность paramsHash при одинаковом seed.

---

## Версия

- **1.0** (2026-04-29) — итерация 1 foundation.
- **1.1** (2026-04-30) — добавлена mock-инфраструктура (трек C).
