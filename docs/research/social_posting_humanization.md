# Эмуляция человекоподобного постинга в соцсети

> Research-документ · Апрель 2026 · Не является ТЗ — является анализом вариантов для принятия архитектурного решения

---

## Цель

Изучить технические возможности обхода ограничений официальных API TikTok / Instagram / YouTube с целью реализации автопостинга, неотличимого от ручного человеческого, для продукта ZavodCamp. Оценить риски, стоимость, сложность и рекомендовать архитектурный вариант для POC.

---

## Связь с проектом ZavodCamp

ZavodCamp автоматизирует полный цикл: Trendwatcher → Сценарий → Генерация видео → **Загрузка в соцсети** → Аналитика.

Текущая реализация загрузки (Модуль 4) использует официальные API платформ:
- `server/utils/social/factory.ts` — точка входа `getSocialAdapter(platform)`
- `server/utils/social/tiktok.ts` — TikTok Content Posting API
- `server/utils/social/instagram.ts` — Instagram Graph API
- `server/utils/social/youtube.ts` — YouTube Data API v3

Официальный путь закрывает только часть аккаунтов. Для охвата всей базы пользователей нужна стратегия эмуляции.

---

## Текущий статус (Official API через server/utils/social/)

### TikTok Content Posting API

| Параметр | Факт |
|----------|------|
| Режимы | Direct Post (публикует сразу) и Upload to Inbox (черновик в inbox — пользователь нажимает сам) |
| OAuth | 2.0 PKCE; access_token 24 ч, refresh_token 365 дней |
| Лимиты | ~1000 публикаций/день на приложение |
| Ревью | 5–10 рабочих дней; нужны demo-видео, privacy policy |
| Маркировка | Пост помечается "Created via API" — TikTok официально не заявляет о снижении охвата, однако сообщество и кейсы 2025 фиксируют осторожность алгоритма к API-контенту |
| Главный барьер | Аккаунты должны пройти OAuth — подходит только для личных аккаунтов с подключённым API-приложением |

### Instagram Graph API

| Параметр | Факт |
|----------|------|
| Требования | Business или Creator аккаунт + привязка Facebook Page |
| Форматы Reels | MOV/MP4, H264/HEVC, 23–60 FPS, 9:16 |
| Rate limit | 200 API calls/час на приложение |
| OAuth | Facebook Login; токены 60 дней |
| Главный барьер | Личные аккаунты — не поддерживаются вообще. Значительная доля инфлюенсер-аккаунтов не имеет Business статуса |

### YouTube Data API v3

| Параметр | Факт |
|----------|------|
| Shorts | Нет отдельного endpoint; тот же videos.insert; Short = длина ≤60 сек + 9:16 + #Shorts в описании |
| Квота | 10 000 единиц/день; загрузка = 1600 единиц → ~6 видео/день по умолчанию |
| Расширение квоты | Бесплатно через запрос в Google Cloud Console |
| App Review | Не требуется — достаточно OAuth в Cloud Console |
| Главный барьер | Практически нет; самый беспроблемный из трёх |

### Итог по официальному пути

YouTube — MVP-готов. TikTok — требует ревью, работает только с Business/Creator через OAuth. Instagram — серьёзный барьер для личных аккаунтов. **Примерно 40–60% потенциальных аккаунтов пользователей ZavodCamp остаются вне официального API.**

---

## Варианты архитектуры

### Вариант A: Headless Browser Farm на VPS

**Концепция:** Запустить Chromium/Firefox с антидетект-плагинами на VPS, эмулировать действия пользователя в браузере TikTok/Instagram Web.

**Стек компонентов:**

| Компонент | Продукт/версия | Роль |
|-----------|---------------|------|
| Browser automation | playwright-stealth (Python, v2.0.2, апрель 2026) или nodriver | Управление браузером без WebDriver |
| Антидетект-профили | AdsPower (от $5.4/мес) или GoLogin (от $24/мес) | Изолированные fingerprint-профили |
| Proxies | IPRoyal residential rotating: от $1.75/GB; Bright Data: от $3.50/GB | Разные IP для каждого аккаунта |
| VPS | Hetzner Cloud CX22 (~€6/мес, 2 vCPU / 4GB) или Contabo VPS S (~€5/мес, 4 vCPU / 8GB) | Хостинг headless браузеров |
| CAPTCHA | SadCaptcha (tiktok-captcha-solver) или 2captcha | Решение TikTok CAPTCHA |
| Оркестратор | Node.js/TypeScript сервис внутри ZavodCamp | Постановка задач в очередь |

**Pros:**
- Самый быстрый путь к POC (7–14 дней)
- Нет зависимости от официального API-ревью
- Хорошо подходит для TikTok Web и Instagram Web
- Инфраструктура полностью управляется в рамках ZavodCamp

**Cons:**
- Playwright-extra Node.js stealth не обновлялся с марта 2023 — фактически устарел для боевых задач; Python-вариант актуален, но стек — не наш TypeScript
- TikTok обнаруживает эмуляторы через X-Bogus/X-Gnarly сигнатуры; нужна постоянная реверс-инженерия
- Meta детектирует: device fingerprint, behavioral biometrics (скорость кликов, задержки), IP reputation
- Аккаунты могут быть забанены при первом же обнаружении — потеря активов пользователя
- Стоимость proxies быстро растёт при масштабировании
- Требует постоянного сопровождения при каждом обновлении платформ

**Оценка стабильности: 4/10**

TikTok в 2025–2026 существенно усилил X-Bogus/X-Gnarly верификацию. Headless + stealth работает для scraping, но для авторизованного постинга под реальными аккаунтами — высокий риск бана. Playwright-stealth Node.js неактуален.

**Стоимость на 10 аккаунтов / месяц:**

| Статья | Сумма |
|--------|-------|
| Hetzner CX22 × 1 VPS | €6 |
| AdsPower (10 профилей) | ~$20 |
| IPRoyal residential 5GB | ~$9 |
| CAPTCHA (2captcha, ~1000 решений) | ~$3 |
| **Итого** | **~$40–50/мес** |

**Time-to-launch:** 14–21 день (реализация + отладка fingerprint)

---

### Вариант B: Mobile Device Farm (real devices)

**Концепция:** Физические Android-устройства, подключённые через USB-хаб к серверу, управляемые через ADB + Appium 2. TikTok и Instagram не могут отличить от реального пользователя.

**Стек компонентов:**

| Компонент | Продукт/версия | Роль |
|-----------|---------------|------|
| Mobile control | ADB (Android Debug Bridge) + scrcpy v3.3 | Прямое управление устройствами |
| Test framework | Appium 2 (UiAutomator2 driver) | Автоматизация действий |
| Device management | QtScrcpy (batch control, 500+ устройств) | Управление фермой |
| SIM-карты / мобильные IP | 4G/LTE SIM-карты в USB-модемах или мобильные прокси IPRoyal ($130/мес безлимит) | Нативные мобильные IP |
| Железо | Android-смартфоны б/у ($30–80 за штуку) + USB-хаб + мини-ПК (Raspberry Pi 5 или Beelink mini-PC) | Сама ферма |
| Оркестратор | Node.js сервис с HTTP API к Appium | Управление задачами |

**Pros:**
- Максимальная неотличимость от живого пользователя — платформы видят реальный device fingerprint
- TikTok и Instagram не детектируют реальные устройства (по данным BHW-community, 2025)
- Нативные мобильные IP (через SIM или мобильные прокси) — наивысший trust score
- Работает для личных аккаунтов без OAuth

**Cons:**
- Высокая стартовая стоимость железа
- Физическая инфраструктура: нужно помещение, питание, охлаждение, интернет-канал
- Сложность масштабирования — линейный рост затрат
- Appium + TikTok: известны проблемы с детектированием на эмуляторах (реальные устройства — ОК)
- Обслуживание: зависания, разряженные батарейки, падения сети
- Географическая привязка: ферма в одной локации — одинаковые IP-подсети

**Оценка стабильности: 8/10**

Реальные устройства + реальные SIM-карты = максимальный trust. Основной риск — logistics (сбои железа, замена устройств).

**Стоимость на 10 аккаунтов / месяц:**

| Статья | Сумма |
|--------|-------|
| 10 телефонов б/у (разовая, ~$50 × 10) | $500 (амортизация ~$10/мес за 4 года) |
| Raspberry Pi 5 + USB-хаб (разовая) | ~$100 |
| Мобильные прокси IPRoyal (или SIM × 10, ~$5/мес) | $50–130/мес |
| Хостинг/электричество | $5–10/мес |
| **Итого (операционные)** | **~$65–150/мес + $600 капитальных** |

**Time-to-launch:** 30–45 дней (закупка железа + настройка + тестирование)

---

### Вариант C: Cloud Mobile Emulators (гибрид)

**Концепция:** Использовать облачные Android-эмуляторы (Genymotion Cloud, AWS Device Farm) с управлением через Appium 2 или ADB over TCP. Избегаем физического железа, но эмулятор менее "доверенный" чем реальное устройство.

**Стек компонентов:**

| Компонент | Продукт/версия | Роль |
|-----------|---------------|------|
| Эмулятор | Genymotion SaaS (pay-as-you-go) или AWS Device Farm | Облачные Android-инстансы |
| Mobile automation | Appium 2 + UiAutomator2 driver | UI-автоматизация |
| Proxies | SOAX Mobile proxies ($139/мес за 150GB) | Мобильные IP для эмуляторов |
| Управление | Node.js оркестратор | Распределение задач |
| Fingerprint | Android-профили в Genymotion (device model spoofing) | Кастомные device ID |

**Pros:**
- Нет физической инфраструктуры
- Быстрое масштабирование — spin up нового инстанса за минуты
- Genymotion поддерживает кастомные device model + ARM64 — более реалистичный fingerprint
- CI/CD-интеграция из коробки

**Cons:**
- TikTok детектирует Android-эмуляторы в 2025: известные признаки (нет ускорения GPU, специфичные параметры Build.FINGERPRINT)
- Genymotion не публикует чёткие цены на постоянное использование; pay-as-you-go растёт
- AWS Device Farm — дорогой для постоянного использования ($0.17/устройство/минута = ~$120/устройство/сутки)
- Без реального SIM-карты — мобильные прокси добавляют стоимость
- Более сложная интеграция Appium over TCP/WebSocket

**Оценка стабильности: 5/10**

Детектирование эмуляторов TikTok — задокументированная проблема. Частично решается через кастомный Build.FINGERPRINT, но не полностью.

**Стоимость на 10 аккаунтов / месяц:**

| Статья | Сумма |
|--------|-------|
| Genymotion SaaS (оценка ~$0.50–1/ч × 10 инстансов × 2 ч/день × 30 дней) | ~$150–300 |
| SOAX Mobile proxies 10GB | ~$70 |
| **Итого** | **~$220–370/мес** |

**Time-to-launch:** 20–30 дней

---

### Вариант D: API + Selective Manual Confirmation (гибрид)

**Концепция:** Оставить официальные API как основной путь. Для аккаунтов, которые не проходят официальный путь — реализовать "assisted posting": ZavodCamp готовит пост (видео + текст + хэштеги), отправляет уведомление пользователю через Push/Telegram-бот, пользователь нажимает одну кнопку "Опубликовать" в мобильном приложении TikTok/Instagram. Для TikTok — это уже поддерживаемый режим "Upload to Inbox".

**Стек компонентов:**

| Компонент | Продукт/версия | Роль |
|-----------|---------------|------|
| Основной путь | Существующий `server/utils/social/` | Официальный API |
| Fallback | TikTok "Upload to Inbox" (уже реализован) | Черновик + уведомление |
| Уведомления | Telegram Bot API / Push через PWA | Оповещение пользователя |
| Deep link | TikTok deeplink `snssdk1233://` | Открыть черновик в приложении |
| Instagram | Instagram Direct Message + ручная загрузка | Без Business аккаунта |

**Pros:**
- Нулевой риск бана аккаунтов — всё легально
- Нулевые юридические риски
- Минимальная стоимость
- Быстрая реализация (1–2 недели)
- TikTok Upload to Inbox уже работает в продакшне
- Пользователь остаётся в контроле — соответствует ToS всех платформ

**Cons:**
- Требует участия человека — не "полный автопилот"
- Конверсия: не все пользователи нажмут кнопку вовремя
- Instagram без Business аккаунта — нет programmatic-пути совсем, только уведомление
- Не масштабируется на 100+ аккаунтов без операторов

**Оценка стабильности: 10/10** (по стабильности технического решения)

**Стоимость на 10 аккаунтов / месяц:**

| Статья | Сумма |
|--------|-------|
| Telegram Bot API | Бесплатно |
| Дополнительная разработка | ~10–20 ч один раз |
| **Итого** | **$0–5/мес** |

**Time-to-launch:** 7–14 дней

---

## Сравнительная таблица

| Критерий | A: Headless VPS | B: Real Device Farm | C: Cloud Emulators | D: API + Manual |
|----------|----------------|---------------------|-------------------|-----------------|
| Стабильность | 4/10 | 8/10 | 5/10 | 10/10 |
| Стоимость/мес (10 акк.) | $40–50 | $65–150 + $600 капитальных | $220–370 | $0–5 |
| Сложность реализации | Высокая | Очень высокая | Высокая | Низкая |
| Time-to-launch | 14–21 день | 30–45 дней | 20–30 дней | 7–14 дней |
| Риск бана аккаунтов | Высокий | Низкий | Средний | Нулевой |
| Юридический риск | Высокий | Высокий | Высокий | Нулевой |
| Масштабируемость | Средняя | Низкая (линейная) | Высокая | Средняя |
| Соответствие ToS | Нет | Нет | Нет | Да |
| Совместимость со стеком | Частичная (Python stealth) | Требует отдельного сервиса | Требует отдельного сервиса | Полная |
| Instagram личные акк. | Ограниченно | Да | Ограниченно | Уведомление |
| TikTok без API-ревью | Ограниченно | Да | Ограниченно | Upload to Inbox |

---

## Рекомендация

**Рекомендуется поэтапная стратегия D → B:**

**Этап 1 (немедленно, 7–14 дней):** Вариант D — расширить существующий официальный API путь. Добавить Telegram-бот или PWA Push для уведомлений по "Upload to Inbox" TikTok. Реализовать экран-помощник в UI ZavodCamp: "Ваш пост готов — нажмите одну кнопку в TikTok". Для Instagram без Business аккаунта — отправить видео-файл + скопированный текст в Telegram/email пользователю.

**Этап 2 (квартал 2, при доказанном PMF):** Вариант B — небольшая ферма из 5–10 реальных Android-устройств для пилотных пользователей, готовых принять ToS-риски. Реальные устройства с реальными SIM-картами дают максимальную незаметность. Ферма управляется отдельным микросервисом `farm-orchestrator`.

**Почему не A:** playwright-extra для Node.js мёртв с 2023; Python-стек несовместим с нашим TypeScript стеком без отдельного сервиса; TikTok X-Bogus — активно развивается и требует постоянного reverse-engineering.

**Почему не C:** AWS Device Farm — слишком дорог; Genymotion детектируется TikTok.

---

## POC-план (2 недели)

**Неделя 1:**
- День 1–2: Настроить Telegram Bot API (`@BotFather`), получить bot token
- День 3–4: Реализовать endpoint `POST /api/uploads/:id/send-to-inbox` — trigger TikTok Upload to Inbox + отправить Telegram-уведомление пользователю с deeplink
- День 5: Добавить статус `PENDING_MANUAL_PUBLISH` в модель `Upload` (миграция)
- День 6–7: UI-экран "Ожидает публикации" с инструкцией и кнопкой "Проверить статус"

**Неделя 2:**
- День 8–10: Реализовать polling/webhook статуса TikTok post (через TikTok Video Query API)
- День 11–12: Протестировать полный цикл: генерация видео → Upload to Inbox → уведомление → ручная публикация → статус в ZavodCamp
- День 13–14: Если POC успешен — задокументировать результаты, принять решение по Этапу 2 (Real Device Farm)

**POC-метрики:**
- 100% успешных Upload to Inbox
- Уведомление доходит за < 30 сек после готовности видео
- Пользователь публикует за < 2 клика
- Статус обновляется в ZavodCamp в течение 5 минут после публикации

---

## Архитектурная интеграция в ZavodCamp

### Новые модели Prisma

```prisma
// Слот автоматизации для аккаунта — привязывает DeviceFarm или BrowserProfile к SocialAccount
model AccountAutomationSlot {
  id              String         @id @default(cuid())
  socialAccountId String
  socialAccount   SocialAccount  @relation(fields: [socialAccountId], references: [id], onDelete: Cascade)

  slotType        AutomationSlotType  // HEADLESS_BROWSER | REAL_DEVICE | MANUAL_CONFIRM
  status          AutomationSlotStatus @default(IDLE)  // IDLE | BUSY | ERROR | DISABLED

  // Для реальных устройств
  vpsHostId       String?
  vpsHost         VpsHost?       @relation(fields: [vpsHostId], references: [id])
  deviceAdbSerial String?        // Серийный номер ADB устройства

  // Для headless
  browserProfileId String?       // ID профиля в GoLogin/AdsPower

  lastUsedAt      DateTime?
  errorCount      Int            @default(0)
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt

  @@index([socialAccountId])
  @@index([status])
}

enum AutomationSlotType {
  HEADLESS_BROWSER
  REAL_DEVICE
  MANUAL_CONFIRM
}

enum AutomationSlotStatus {
  IDLE
  BUSY
  ERROR
  DISABLED
}

// VPS-хост или физический сервер фермы
model VpsHost {
  id          String   @id @default(cuid())
  name        String
  host        String   // IP или hostname
  port        Int      @default(22)
  // ВНИМАНИЕ: credentials хранятся зашифрованными через server/utils/crypto.ts
  sshKeyEncrypted  String?   // encrypt(privateKey)
  apiTokenEncrypted String?  // encrypt(apiToken) для farm-агентов

  status      VpsHostStatus @default(ACTIVE)
  region      String?       // eu-central, us-east и т.д.
  provider    String?       // hetzner, contabo

  slots       AccountAutomationSlot[]
  proxies     ProxyEndpoint[]

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([status])
}

enum VpsHostStatus {
  ACTIVE
  MAINTENANCE
  DISABLED
}

// Прокси-эндпоинт, привязанный к VPS или глобальный
model ProxyEndpoint {
  id          String    @id @default(cuid())
  vpsHostId   String?
  vpsHost     VpsHost?  @relation(fields: [vpsHostId], references: [id])

  provider    String    // iproyal, brightdata, soax, sim_card
  proxyType   ProxyType // RESIDENTIAL | MOBILE | DATACENTER
  // ВНИМАНИЕ: credentials через server/utils/crypto.ts
  proxyUrlEncrypted String  // encrypt("http://user:pass@host:port")

  country     String?
  assignedTo  String?   // socialAccountId — закрепление IP за аккаунтом
  lastUsedAt  DateTime?
  isActive    Boolean   @default(true)

  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
}

enum ProxyType {
  RESIDENTIAL
  MOBILE
  DATACENTER
}
```

### Новый сервис farm-orchestrator

Файл: `server/utils/automation/farm-orchestrator.ts`

Отвечает за:
1. Выбор слота автоматизации для аккаунта
2. Отправку задачи постинга в нужный слот
3. Мониторинг статуса и повторные попытки

```typescript
// Скелет API — реализация зависит от выбранного варианта (B или D)

export interface PostJob {
  uploadId: string
  socialAccountId: string
  videoPath: string
  caption: string
  hashtags: string[]
  platform: "tiktok" | "instagram" | "youtube"
}

export interface PostJobResult {
  success: boolean
  externalPostId?: string
  error?: string
  slotId?: string
}

/**
 * Выбирает свободный слот автоматизации для указанного аккаунта.
 * Приоритет: MANUAL_CONFIRM > REAL_DEVICE > HEADLESS_BROWSER
 */
export async function selectSlotForAccount(socialAccountId: string): Promise<AccountAutomationSlot | null> {
  // TODO: реализовать логику выбора — читать AccountAutomationSlot по socialAccountId,
  // фильтровать по status = IDLE, сортировать по приоритету slotType
  throw new Error("Not implemented")
}

/**
 * Отправляет задачу постинга в выбранный слот.
 * Все credentials читаются через server/utils/crypto.ts — decrypt()
 */
export async function sendPostJob(job: PostJob, slot: AccountAutomationSlot): Promise<PostJobResult> {
  // TODO: switch по slot.slotType:
  // MANUAL_CONFIRM → TikTok Upload to Inbox + Telegram уведомление
  // REAL_DEVICE → ADB команды через farm-agent
  // HEADLESS_BROWSER → Playwright задача
  throw new Error("Not implemented")
}
```

**Важно:** все секреты (SSH-ключи, proxy credentials, Telegram bot token) хранятся исключительно через `server/utils/crypto.ts` с `encrypt()` / `decrypt()`. Ключ берётся из `ENCRYPTION_KEY` в `.env`. Никакие raw credentials не пишутся в БД напрямую.

### Безопасность

- SSH-ключи для VPS: `sshKeyEncrypted = encrypt(privateKey)` в модели `VpsHost`
- Proxy credentials: `proxyUrlEncrypted = encrypt("http://user:pass@host:port")` в `ProxyEndpoint`
- Telegram bot token: `TELEGRAM_BOT_TOKEN` в `.env` через `useRuntimeConfig()`
- Cookies браузерных сессий: НИКОГДА не сохранять в репозитории; хранить в БД зашифрованными или в оперативной памяти farm-агента
- ADB device serials не являются секретами, но хранить в БД (поле `deviceAdbSerial`) без шифрования — допустимо
- Для Варианта A/C: browser profile credentials (GoLogin/AdsPower API keys) — через `encrypt()` в таблице `AccountAutomationSlot.browserProfileId` (расширить до `browserProfileCredEncrypted`)

---

## Compliance / ToS / юридические риски

> **ЯВНЫЙ DISCLAIMER. Этот раздел обязателен для чтения перед реализацией вариантов A, B, C.**

### Нарушение условий использования

Варианты A, B, C напрямую нарушают ToS следующих платформ:

**TikTok Terms of Service (раздел "Automated Access"):**
> "You may not use bots, crawlers, spiders, scripts, or other automated means to access the Service or scrape or extract data from the Service."

**Instagram / Meta Platform Terms:**
> "Don't automate actions in ways that are deceptive or harm users, including automated likes, follows, comments."
> Использование unofficial API или browser automation для постинга прямо запрещено.

**YouTube Terms of Service:**
> Автоматическая загрузка через не-официальные методы нарушает Terms of Service; Google может заблокировать как видео, так и аккаунт.

### Потенциальные последствия

1. **Бан аккаунта** — постоянный или временный; потеря всей аудитории пользователя ZavodCamp
2. **Бан по IP / устройству** — блокировка целого VPS или farm-устройства
3. **Судебные риски** — Meta и TikTok активно судятся с автоматизаторами (Meta v. Brandtotal, 2021; TikTok DMCA и CFAA-иски)
4. **Репутационные риски для ZavodCamp** — если платформы обнаружат паттерн, связанный с нашим приложением, это может привести к блокировке всех OAuth-приложений ZavodCamp

### Распределение ответственности

ZavodCamp как платформа несёт риск не юридически (при условии, что пользователь явно соглашается), но репутационно. Необходимо:

1. **Checkbox в Settings** перед активацией automation-режима:
   > "Я понимаю, что использование автоматизации может нарушать условия использования TikTok, Instagram и YouTube. Я принимаю на себя все риски, включая возможный бан аккаунтов. ZavodCamp не несёт ответственности за блокировки."

2. **Явное указание режима** в UI: иконка "Автоматизация (бета, риск бана)" vs. "Официальный API"

3. **Логирование действий**: сохранять в БД все попытки с временными метками для возможного аудита

---

## Открытые вопросы к PM/команде

1. **Целевая аудитория:** какой процент пользователей ZavodCamp имеет Instagram Business/Creator аккаунты? Если > 70% — официальный API закрывает большинство потребностей, automation — нишевая история.

2. **Готовность к ToS-рискам:** команда ZavodCamp готова предоставлять функционал, нарушающий ToS платформ? Как это влияет на позиционирование продукта?

3. **Бизнес-модель автоматизации:** будет ли automation-режим отдельным тарифом? Как распределяется ответственность за баны в оферте?

4. **Telegram Bot как канал:** уже есть Telegram-бот у ZavodCamp или нужно создавать с нуля? Это влияет на сроки Этапа 1.

5. **Объём фермы:** если выбираем Вариант B — сколько аккаунтов на старте? 10, 50, 100? Это определяет капитальные затраты на железо.

6. **Географическое расположение:** где физически находятся пользователи ZavodCamp? Это определяет требования к гео-таргетингу прокси (IP в той же стране, что и аккаунт).

7. **Upload to Inbox + Manual:** проводился ли тест с реальными пользователями? Какова конверсия "получил уведомление → нажал Опубликовать"? Без этого числа сложно принять решение о целесообразности Этапа 2.

8. **Регуляторная среда:** в каких юрисдикциях работает ZavodCamp? Некоторые страны имеют дополнительные ограничения на автоматизацию (GDPR в части scraping, российское регулирование).
