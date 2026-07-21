# Indigo YouTube автопостинг — лог отладки E2E (2026-05-26 … 2026-05-28)

Документ фиксирует сквозную отладку одного posting-job до автоматической публикации
видео на YouTube через залогиненный desktop Indigo-профиль внутри ZavodCamp, без
смены архитектуры. Сохранена хронология блокеров, root cause каждого, ссылки на
commit'ы и итоговое состояние pipeline.

---

## 1. Цель и ограничения

**Цель:** довести существующий posting-job до автоматической публикации одного
YouTube-видео через browser automation (Indigo CDP + puppeteer-core), управляемую
ZavodCamp worker'ом.

**Архитектурное ограничение (фиксированное):**
`1 account → 1 proxy → 1 desktop Indigo profile → browser automation через ZavodCamp`.

**Запреты (явные, на весь процесс):**
- Не предлагать YouTube Data API, OAuth, Playwright вне Indigo, manual upload или иные Plan B.
- Не делать speculative-патчи: каждый commit ссылается на конкретный diagnostic artifact.
- Один root cause → один commit → один E2E retry → отчёт (FACTS / VERDICT / NEXT ACTION).
- Не менять cookies / proxy / account mapping без явного указания.
- Не удалять diagnostics. Не патчить код, если проблему можно сначала доказать через diagnose.

---

## 2. Фазы posting pipeline

Worker (`server/utils/posting/worker.ts`, Nitro-плагин `scheduler.ts`, tick 30s) →
`runBrowserPosting` (`poster-runner.ts`) → `youtube-poster.ts`:

1. **session_start** — `startBrowserSession` → Indigo `/profile/start` (automation_type=puppeteer) → `waitForDevtoolsEndpoint` → `puppeteer.connect` → `newPage`.
2. **restore_cookies** — `restoreCookiesFromSnapshot` (CDP `Network.setCookie` из БД snapshot).
3. **login_check** — `waitForCloudCookies` (auth cookies в Chromium store).
4. **navigate_upload** — `navigateToStudio` (goto studio.youtube.com) + `openUploadDialog` (Create/upload form).
5. **file_upload** — поиск `input[type=file]` + `uploadFile` + processing.
6. **details / audience / visibility / publish** — заполнение формы и публикация.

---

## 3. Хронология блокеров и фиксов

Фазы валились последовательно — каждый фикс открывал следующий блокер. Порядок по
мере продвижения вглубь pipeline.

### Phase 2 — connect_browser (session_start)
- **Симптом:** `newPage failed: Connection closed`; затем (через storage trace)
  `browser.pages()` → `Network.enable timed out` (120s protocolTimeout) → cascade
  `browser_disconnected` → Chromium die.
- **Root cause:** `browser.pages()` через `target.page()` триггерит auto-attach CDP
  session + `Network.enable` на existing default page; Indigo Chromium не отвечает.
- **Фиксы:**
  - `10a0439` — `waitForDevtoolsEndpoint`: poll `/json/version` 15×2s до 200 OK + webSocketDebuggerUrl, потом `puppeteer.connect({browserWSEndpoint})`.
  - `cf0fe67` — убрать `browser.pages()` reuse, сразу `browser.newPage()` (5×3s retry).
  - Verified: `new_page_attempt_1` OK 18ms (clean profile).

### Diagnostic инфраструктура (storage trace)
- `18fcdde`, `e641df6` — `writeCdpTrace` пишет JSON в GCS под
  `zavodcamp/posting-errors/<jobId>-<phase>-<event>-<ts>.json`. Видно через
  `/api/posting/diagnostics/list?jobId=`. Покрыты события **до**
  `waitForDevtoolsEndpoint` (раньше fail был невидим): `wait_devtools_begin`,
  `devtools_probe_attempt_N`, `devtools_probe_final_fail`, `start_browser_session-*`.

### Profile state pollution (diagnose matrix)
- **Найдено через `e641df6`** (расширенный `diagnose-automation`): профиль cmplmhc2b
  имел corrupted cloud state — **19 targets** (5 вкладок studio.youtube.com + Cookie
  Editor extension). `browser.newPage()` падал `Target.createTarget: Target closed`
  137ms. Чистый профиль: targets≤3, newPage OK 18ms, `puppeteerCdpFullCycle=true`.
- **Вывод:** нужен чистый профиль, не corrupted.

### login_check — Sign-In вместо Studio (cookies)
- **Симптом:** screenshot 30275 bytes "Sign in to continue to YouTube" на всех
  этапах после navigate. login_check formally passed (cookies applied), но Studio
  редиректит на accounts.google.com.
- **Root cause:** snapshot содержал только youtube.com cookies; studio.youtube.com
  auth-flow требует **google.com domain** cookies (SID/HSID/APISID/SAPISID/__Secure-*PSID).
- **Фикс (инфраструктура, не код):** `20f7d21` — admin endpoint
  `/cookies/transfer` для selective merge google cookies из другого профиля.
  `8058fc8` — UI кнопка "Очистить cookies" + `DELETE /cookies/clear`.
- **Дополнение:** cookies должны быть **свежими** (<6h) — Google ротирует session
  tokens (`__Secure-*PSIDTS`), stale snapshot → Sign-In.

### auth-smoke gate
- `112385b` → `e69e2ff` — admin endpoint `/auth-smoke` (async: POST 202 + requestId,
  polling через `/auth-smoke-result`). Прогоняет start → CDP → cookies inject → goto
  studio → verdict `studio_reachable`. Single-shot проверка ДО 7-минутного pipeline.
  **Verified PASS** на clean профиле (studio.youtube.com, "YouTube Creator Studio").

### navigate_upload — Navigation timeout 120s (ГЛАВНЫЙ root cause)
- **Симптом:** `Navigation timeout of 120000 ms exceeded` стабильно, даже после
  «фикса» на `domcontentloaded`.
- **Root cause (критический):** обёртка `BrowserSession.goto` (`cdp-adapter.ts`)
  маппила любой `waitUntil != "networkidle"` → **`"load"`**. Тип `GotoOptions.waitUntil`
  вообще не имел `"domcontentloaded"`. Commit `10fc581` фактически не работал — Studio
  всё это время ждала full `load` event, который не наступает на тяжёлом Polymer SPA
  через mobile proxy.
- **Фикс:** `6fe5c74` — обёртка реально поддерживает `domcontentloaded` (cdp +
  webdriver адаптеры + тип) + **resilient navigateToStudio**: goto 45s → soft-probe
  (url/title/readyState через evaluate 3s race) → classify (studio / auth_required /
  detached / unknown) → partial-ok если DOM=Studio при goto-timeout, retry через
  about:blank.
- `f0e2516` — auth-gate: redirect на accounts.google.com → throw `login_required`
  сразу (не ждать 120s в file_upload).

### openUploadDialog — Runtime.callFunctionOn timed out
- **Симптом:** `Не удалось открыть upload dialog: Runtime.callFunctionOn timed out`.
- **Root cause:** `channelInfo` extraction через `document.documentElement.outerHTML`
  (мегабайты для Studio Polymer) — тяжёлый eval **без timeout** → висел на CDP
  protocolTimeout 120s. Плюс `deepClickButton` рекурсивный `querySelectorAll("*")` по
  всему документу × 5 selectors, loop 180s.
- **Фикс:** `ed6ebe5` — `evalRace<T>(session, fn, timeoutMs)` helper (Promise.race,
  не виснет дольше timeout); channelId только lightweight (ytcfg/canonical); deepClickButton
  упрощён (light DOM fast-path → BFS только по ytcp-*/tp-yt-* хостам, per-eval 8s,
  loop 10s); порядок: dismiss overlays → channelId → **direct upload URL** → fallback
  Create → last-resort ?d=ud. Step checkpoints на каждом шаге.

### YouTube Studio Welcome modal
- **Найдено (cycle 4):** на первый успешный вход Studio показывает modal
  "Welcome to YouTube Studio" + Continue поверх UI, перехватывает file input.
- **Фикс:** `6e4116e` — `dismissYouTubeStudioOverlays` (deep shadow traversal,
  закрывает Welcome modal / Got it / Dismiss / Skip / Ask Studio tooltip), вызывается
  в 4 точках (после studio_loaded_ok, перед Create, после fallback goto, перед file input).

### login_check — Chromium store ПУСТОЙ (browser dead)
- **Симптом:** `Cloud cookies для youtube не появились за 90142ms. Chromium store
  ПУСТОЙ`. Сообщение «Indigo cloud sync не подтягивает» вводило в заблуждение.
- **Root cause (через diagnostic timeline):** `browser_disconnected` через **~0.3s**
  после `session_start_success`. restore работал с мёртвым browser: createCDPSession
  5× fail → fallback page.setCookie "Requesting main frame too early" → **applied=0/41**.
  Store пустой = browser dead, не cloud sync.
- **Фикс:** `9a4fb01` — retry restore внутри login_check + классификация:
  - valid snapshot (applied/failed>0) но store пустой → **retryable `network_error`**;
  - `no_snapshot`/`all_expired`/`decrypt_failed` → terminal `login_required`;
  - store has cookies без auth → terminal `login_required`.
  Diagnostic через appendJobLog (applied, failed, storeCount, hasSAPISID/...).

### Orphaned preparing (worker lifecycle)
- **Симптом:** job застрял в `preparing` ~20 мин, никто не обрабатывает.
- **Root cause:** worker claim'ит job (queued→preparing) + fire-and-forget executeJob;
  рестарт Nitro (deploy) убивает in-flight промис → job навсегда в preparing (worker
  берёт только queued, manual retry — только из failed).
- **Фикс:** `77984be` — stuck-preparing recovery в начале `postingWorkerTick`:
  preparing с `startedAt` старше 10 мин → failed (для повторного retry).

### session_start — Indigo не отдаёт CDP-порт (browser_connect_failed)
- **Симптом:** `Indigo не отдал рабочий CDP-порт (после 8 internal attempts / 54s)`;
  недетерминированно (в good window — доходило до uploading, в bad — 8× fail).
- **Root cause:** Indigo Chromium недетерминированно умирает вскоре после connect
  (mobile proxy + agent instability). "good window" / "bad window" чередуются.
- **Фиксы:**
  - `cb9d483` — internal start retry в `startBrowserSession`: до 8 attempts / 12 мин,
    dead CDP port → stopProfile + 20s cooldown → retry (не поднимая PostingJob.attemptCount, без TG-спама).
  - `c16c82f` — **dead-port `browser_connect_failed` → retryable с backoff** (узко,
    только fingerprint "DevTools endpoint not ready"/"Unable to connect"/"не отдал
    рабочий CDP-порт"): retry_queued backoff 5→10→15 мин, max 7 retries / окно 90 мин,
    потом final fail (`finalReason: indigo_unstable`, enum не меняли). TG: "custom" 1
    раз + critical на final. **Verified:** job самовосстанавливается (retry 1/7 5мин,
    retry 2/7 10мин), без ручного вмешательства.

### Build marker (доказательство версии worker)
- `1f7e9a5` — `runBrowserPosting` первой строкой пишет в job log
  `runner_build_marker: <строка>` + `processStartedAt` + `processUptimeSec`. Доказывает
  какая версия runner реально выполняется (deploy ≠ рестарт Nitro-процесса — worker
  подхватывает новый код только после явного рестарта процесса).

---

## 4. Коммиты (хронологически)

| sha | Что |
|---|---|
| `cf0fe67` | skip browser.pages() reuse — direct newPage |
| `e641df6` | diagnose-automation matrix CDP cycle + storage trace до waitForDevtoolsEndpoint |
| `20f7d21` | admin cross-profile cookie transfer endpoint |
| `8058fc8` | UI кнопка "Очистить cookies" + DELETE /cookies/clear |
| `112385b` → `e69e2ff` | auth-smoke endpoint (async 202 + polling) |
| `6e4116e` | dismissYouTubeStudioOverlays (deep shadow traversal) |
| `10fc581` | navigateToStudio waitUntil load → domcontentloaded (не работал из-за обёртки) |
| `f0e2516` | navigateToStudio auth-gate → login_required при accounts.google.com |
| `cb9d483` | startBrowserSession internal start retry (Indigo CDP flakiness) |
| `1f7e9a5` | runner build marker в job log |
| `6fe5c74` | **ROOT CAUSE**: обёртка goto игнорировала domcontentloaded + resilient navigation |
| `ed6ebe5` | openUploadDialog resilient (evalRace + step checkpoints + ранний fallback) |
| `77984be` | worker stuck-preparing recovery |
| `9a4fb01` | login_check retry restore + классификация empty-store как retryable |
| `c16c82f` | dead-port browser_connect_failed → retryable с backoff (final resilience) |

---

## 5. Diagnostic-инструменты (созданы в процессе)

- `POST /api/admin/indigo/profiles/[id]/diagnose-automation` — матрица puppeteer/selenium:
  startProfile / /json/version / /json/list / puppeteer.connect / version / targets / newPage.
- `POST /api/admin/indigo/profiles/[id]/auth-smoke` + `GET .../auth-smoke-result?requestId=`
  — async single-shot проверка что cookies дают доступ к studio.youtube.com.
- `POST /api/admin/indigo/profiles/[id]/cookies/transfer` — selective merge cookies между профилями.
- `GET /api/indigo/profiles/[id]/cookies/snapshot-info` — состояние snapshot (count, platform, decrypt, expired).
- `DELETE /api/indigo/profiles/[id]/cookies/clear` + UI кнопка.
- storage trace `zavodcamp/posting-errors/<jobId>-...` + `/api/posting/diagnostics/list`.
- build marker в `/api/posting-jobs/[id]/logs` (доказательство активной версии worker).

---

## 6. Итоговое состояние pipeline

**Все кодовые блокеры устранены и самовосстанавливаются:**
- session_start: internal retry + dead-port retryable backoff;
- restore_cookies / login_check: retry + классификация transient как retryable;
- navigate_upload: реальный domcontentloaded + resilient soft-probe + auth-gate;
- openUploadDialog: evalRace timeouts + ранний fallback (не виснет на 120s);
- file_upload: dismiss Welcome overlay перед поиском input;
- worker lifecycle: stuck-preparing recovery.

**Доказано прохождение в стабильном Indigo-окне:** pipeline доходил до фазы
`uploading` (10:54 и 11:23 UTC 2026-05-28 на профиле "HTTP dekstop YT test").

---

## 7. Открытый блокер (вне кода)

**Indigo Chromium instability на mobile proxy.** Indigo `/profile/start` возвращает
валидный порт, но Chromium remote-debugging endpoint поднимается недетерминированно
("good window" / "bad window"). В bad window browser умирает через ~0.3s после
connect (8 internal session attempts fail). Это platform/proxy уровень, не код
ZavodCamp.

**Митигация в коде:** dead-port retryable backoff — job сам ждёт good window до 90 мин,
ловит стабильную сессию автоматически, без ручного retry. При исчерпании окна — честный
final fail `indigo_unstable`.

**Условия успешной публикации (все обязательны):**
1. Чистый Indigo profile (targets ≤ 3, без corrupted stored tabs/extensions).
2. Свежий cookie snapshot (<6h) с google.com domain auth cookies.
3. Стабильный proxy (предпочтительно residential, не mobile под нагрузкой Studio SPA).
4. Indigo core загружен (не `downloading_core` / `LOCK_PROFILE_ERROR`).
5. Indigo agent в "good window" (отдаёт живую CDP-сессию).
6. YouTube Welcome onboarding modal закрыт (автоматически в коде).

---

## 8. Как воспроизвести / проверить

1. **Проверить версию worker:** Retry job → `/api/posting-jobs/[id]/logs` → найти
   `runner_build_marker`. Если старый/processStartedAt старый — нужен рестарт
   Nitro-процесса (deploy ≠ рестарт).
2. **Pre-flight auth:** `POST /auth-smoke` → polling → `verdict.ok=true` (studio_reachable)
   перед запуском posting.
3. **Запуск:** Retry posting-job (из failed) или создать новый (scheduledAt=now обходит
   идемпотентность по video+account+scheduledAt).
4. **Мониторинг:** статус job + `/logs` (build marker, login_check diagnostic,
   browser_connect_failed_retryable). При Indigo bad window job сам уйдёт в retry_queued
   с backoff — ждать good window.
