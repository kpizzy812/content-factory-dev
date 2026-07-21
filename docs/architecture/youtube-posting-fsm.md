# YouTube Posting — Phase-level FSM

Формализация устойчивого конвейера browser-automation постинга в YouTube через
Indigo CDP + puppeteer-core. Документ описывает целевую state-machine и поэтапный
план внедрения **поверх существующих функций**, без переписывания pipeline.

> Архитектура фиксирована: 1 account → 1 proxy → 1 desktop Indigo profile →
> browser automation. Без YouTube Data API / OAuth / manual upload / Playwright
> вне Indigo.

## Два слоя FSM

| Слой | Где | Алфавит | Статус |
|------|-----|---------|--------|
| **Job-FSM** (оркестрация) | `server/utils/posting/state-machine.ts`, persist в `PostingJob.status` | scheduled→queued→preparing→uploading→published/failed/retry_queued/cancelled | стабильный, не меняется |
| **Phase-FSM** (browser automation) | формализуется здесь; выполняется пока job в статусе `uploading` | 16 фаз (session_start…cleanup) | внедряется PR1→PR5 |

Phase-FSM живёт **внутри** статуса `uploading`. Его терминальный успех → job
`published`; терминальный провал → `failed`; retryable-провал → `retry_queued`.

## Фазы (16)

| # | Phase | Purpose | Success | Существующая функция |
|---|-------|---------|---------|----------------------|
| 1 | `session_start` | Старт Indigo profile, CDP-порт | валидный port | `startBrowserSession` |
| 2 | `connect_browser` | puppeteer.connect (direct newPage) | Browser+page | `connectToProfileViaCdp` |
| 3 | `restore_cookies` | Инжект cookies из БД-snapshot | fail-soft | `restoreCookiesFromSnapshot` |
| 4 | `browser_leak_check` | Проверка proxy (не реальный IP) | нет утечки | `assertNoLeakInBrowser` |
| 5 | `login_check` | Дождаться auth-cookies | ≥1 auth cookie | `waitForCloudCookies` + retry restore ×2 |
| 6 | `navigate_upload` | Открыть Studio | probe==studio | `navigateToStudio` (soft-probe) |
| 7 | `open_upload_dialog` | Открыть upload dialog | file input | `openUploadDialog` (evalRace 8s) |
| 8 | `file_upload` | Прикрепить файл | upload принят | `uploadVideoFile` |
| 9 | `upload_processing` | Дождаться details | форма видна | processing-loop (≤15 мин) |
| 10 | `fill_details` | Title+description | поля заполнены | `fillDetails` + `setAlteredContent` |
| 11 | `set_audience` | Made-for-kids | radio выбран | `setMadeForKids` |
| 12 | `set_visibility` | Public/Unlisted/Private | radio выбран | `advanceToVisibilityStep`+`setVisibility` |
| 13 | `publish` | Клик Publish | клик прошёл | `submitPublish` |
| 14 | `verify_published` | URL/ID | `/watch?v=`\|`/shorts/` | `extractPostUrl` |
| 15 | `save_snapshot` | Сохранить cookies | best-effort | `saveCookiesSnapshot` |
| 16 | `cleanup` | Закрыть session+stop+tmp | освобождено | finally в poster-runner |

Каноническая декларация: `server/utils/posting/phase-policy.ts:PHASE_POLICIES`
(purpose / success / retryable / terminal / recovery / diagnostics на фазу).

## Error taxonomy (11 классов)

Логический вокабуляр FSM. 5 классов уже есть в prisma enum `PostingErrorCategory`,
6 (browser_state_error, auth_required, browser_lost, indigo_unstable,
duplicate_risk, requires_human) **пока не заводятся в enum** — хранятся в
`stateData`, в persisted `errorCategory` пишется legacy-маппинг
(`mapErrorClassToPersisted`). Promotion в enum — поздний PR.

| Класс | Disposition | Persist (legacy) | Fingerprint |
|-------|-------------|------------------|-------------|
| `browser_connect_failed` | terminal | browser_connect_failed | ECONNREFUSED, automation off |
| `browser_state_error` | retryable | network_error | valid snapshot + store пуст; грязный профиль |
| `network_error` | retryable | network_error | timeout / ECONN* / proxy latency |
| `auth_required` | terminal | login_required | redirect accounts.google.com |
| `login_required` | terminal | login_required | no_snapshot / all_expired / store без auth |
| `selector_not_found` | terminal | selector_not_found | DOM не найден (кроме open_upload_dialog) |
| `upload_failed` | retryable | upload_failed | setInputFiles / processing / share-url |
| `browser_lost` | retryable (5×/90м) | network_error | detached Frame / Target closed |
| `indigo_unstable` | retryable (7×/90м) | browser_connect_failed | DevTools endpoint not ready |
| `duplicate_risk` | guarded | network_error | browser_lost после attach |
| `requires_human` | terminal | account_locked | captcha / verify / phone / окно исчерпано |

Классификатор: `server/utils/posting/error-taxonomy.ts:classifyPostingError`
(по message + phase + progress + login-context). Арбитраж зеркалит worker.ts
(dead-port раньше browser_lost). `proxy_dead` (leak) — вне FSM-вокабуляра,
выставляется явно как `PostingPhaseError(category="proxy_dead")` (existing path).

Retry-числа (backoff/maxAttempts/window) перенесены **числом-в-число** из
текущего `worker.ts` / `state-machine.ts`:
- indigo_unstable: 5→10→10→15 мин, до 7× за 90 мин
- browser_lost: 5→7→7→10 мин, до 5× за 90 мин
- generic (network/upload/browser_state): 1м→5м→30м→2ч→12ч, по `PostingJob.maxAttempts`

## Duplicate-upload guard (progress)

`stateData.progress` (монотонный substatus) определяет безопасность retry:

| Progress | Action (`getProgressRetryPolicy`) |
|----------|-----------------------------------|
| `file_not_attached` | `retry_safe` |
| `file_attached_unconfirmed` / `upload_started` / `processing_seen` | `dedup_check` |
| `publish_clicked` / `publish_confirmed` | `verify_no_republish` |

Сильнейший ключ дедупа — `stateData.draftVideoId` (захват ID черновика, как
только Studio его присвоил). Реализация guard'а — PR4.

## Persistence

`PostingJob.stateData Json?` (PR1, аддитивно, nullable). Форма —
`shared/types/youtube-posting-fsm.ts:YouTubePostingStateData`:
`{ fsmVersion, buildMarker, currentPhase, progress, draftVideoId, phaseAttempts,
classWindows, lastTransitionAt }`. `null` / отсутствие `fsmVersion` = job НЕ
управляется FSM (legacy-путь) — backward-compat для worker.ts.

`classWindows` заменяет подсчёт маркеров через `PostingJobLog.message contains
MARKER` — атомарно, переживает рестарт. `lastTransitionAt` — heartbeat для
stuck-detection (PR4: recovery orphaned `uploading` после рестарта Nitro).

## PR Roadmap

| PR | Scope | Поведение прода |
|----|-------|-----------------|
| **PR1** | Persistence (`stateData`) + pure декларации (phase-policy, error-taxonomy, типы) + тесты + этот документ | **0 изменений (no-op)** |
| **PR2A** | `YOUTUBE_POSTING_FSM_ENABLED` (default OFF) + observability-обёртки (fsm-observer): STATE_ENTER/EXIT/FAIL + `stateData` поверх линейного runner'а. БЕЗ изменения порядка/retry/recovery | флаг OFF → 0 изменений; флаг ON → только доп. логи/stateData. **Прод-validated 2026-05-29** (job cmpprv5a5: fsm_mode + STATE_ENTER + stateData, дрейфа нет) |
| **PR2B** | `PhaseRunner` (`posting-fsm.ts:runYouTubeStudioPhases`) драйвит порядок Studio-фаз под флагом ON (замена линейного `postToYouTube`); legacy при OFF без изменений | флаг OFF → legacy; ON → FSM-driven Studio-фазы |
| **PR3** | Policy-driven retry: параллельный путь `worker.handleFailure` (флаг ON + stateData.fsmVersion) через `retry-policy.ts`+`fsm-retry.ts`+`classWindows` вместо regex+log-marker counting; legacy-ветка нетронута | флаг OFF / не-FSM job → legacy без изменений; ON+FSM → policy-driven (то же поведение) |
| PR4 | Duplicate guard (`progress`/`draftVideoId`) + recovery orphaned `uploading` | флаг ON → dedup |
| **PR5A** | Production hardening наблюдаемости: operator-форматтер + structured FSM-логи + Telegram-троттлинг наблюдаемый + FSM-диагностика в API + runbook. **НЕ меняет** upload/retry/backoff/duplicate-guard/cookies/proxy | флаг ON → те же runtime-решения, богаче логи/API/Telegram-текст. **Прод-validated 2026-05-29** (job cmppv2p59: fsm.operatorClass=indigo_unstable, windowExpiresAt, nextRetryAt) |
| **PR5B** | Controlled default enablement: резолвер `resolveYoutubeFsmMode` (code default **ON для YouTube**), platform-gate (non-YouTube всегда OFF), `YOUTUBE_POSTING_FSM_DEFAULT`, startup-лог, `/api/posting-jobs/fsm-mode`, emergency rollback по env. Legacy/worker fallback НЕ удалены | env unset → ON(youtube)/OFF(прочие); `YOUTUBE_POSTING_FSM_ENABLED=false` → мгновенный rollback к legacy без деплоя |

### PR2A — статус: observability-only, runtime behavior без изменений

- `YOUTUBE_POSTING_FSM_ENABLED` default OFF. `createPhaseObserver` при OFF возвращает frozen NOOP — 0 запросов к БД, 0 логов.
- Обёрнуты 8 фаз: `session_start`, `restore_cookies`, `login_check` (poster-runner); `navigate_upload`, `open_upload_dialog`, `file_upload`, `upload_processing` (youtube-poster); `cleanup` (finally, log-only — не клобберит указатели фаз).
- `failPhase` (central в poster-runner catch по `err.phase`) только логирует STATE_FAIL и пишет `stateData.currentPhase` — НЕ влияет на retry (это worker.ts, не тронут).
- НЕ тронуты: `worker.ts:handleFailure`, retry/backoff, `openUploadDialog`/cookies/`session_start` retry логика.
- Все методы observer best-effort (никогда не throws) — observability не может повлиять на постинг.

### PR2B — статус: PhaseRunner driving Studio-фазы (под флагом)

- `server/utils/posting/posting-fsm.ts:runYouTubeStudioPhases` итерирует декларативный список Studio-шагов (в порядке `YOUTUBE_POSTING_PHASE_ORDER`) и вызывает экспортированные функции `youtube-poster.ts` (navigateToStudio…extractPostUrl). Под флагом ON `poster-runner` вызывает его вместо `postToYouTube`.
- Build marker: `phase-runner-fsm-2026-05-29`. Лог `fsm_mode: phase_runner` (при OFF — ничего).
- **Драйвит 9 Studio-фаз**: navigate_upload, open_upload_dialog, file_upload, upload_processing, fill_details, set_audience, set_visibility, publish, verify_published. STATE_ENTER/EXIT + progress на каждой.
- **Composite**: `upload_processing` свёрнут в шаг `file_upload` — `uploadVideoFile` одна функция (Select files/pierce attach), внутри эмитит границу file_upload → upload_processing; не делим, чтобы не трогать недавно переработанную attach-логику.
- **Lifecycle-фазы вне runner** (по scope): session_start, connect_browser(folded), browser_leak_check(Node-side proxy), restore_cookies, login_check, save_snapshot, cleanup — остаются за `poster-runner` с PR2A-инструментацией. cleanup гарантирован в `finally`.
- **STATE_FAIL централизован**: пишет `poster-runner` outer-catch через `failPhase(mapPostingPhaseToFsmPhase(err.phase))` — единый источник для legacy и FSM путей, без дублей. Runner лишь пробрасывает ошибку → `worker.handleFailure` решает retry (НЕ тронут).
- progress: file_not_attached → file_attached_unconfirmed (attach) → processing_seen (details) → publish_clicked → publish_confirmed.
- `stateData` дополнен `lastErrorClass` + `lastErrorPhase` (пишет failPhase).
- НЕ тронуто: retry/backoff, `worker.handleFailure`, Telegram, cookies/proxy/account mapping, duplicate guard. Flag OFF = legacy `postToYouTube` без изменений.

## PR1 — статус: no-op at runtime

PR1 добавляет **только фундамент**. Гарантии отсутствия изменений поведения:

- `stateData` — nullable колонка, **никто не пишет** в неё в PR1.
- `phase-policy.ts` / `error-taxonomy.ts` / `youtube-posting-fsm.ts` — pure, **нигде не импортируются** в runtime (только в тестах).
- `worker.ts`, `poster-runner.ts`, `youtube-poster.ts`, `state-machine.ts`, `error-classifier.ts` — **не тронуты**.
- Флаг `YOUTUBE_POSTING_FSM_ENABLED` в PR1 ещё **не вводится** (появится в PR2).
- Миграция — additive single column, без destructive операций и без новых enum-значений.

### Файлы PR1
- `shared/types/youtube-posting-fsm.ts` — типы (phases, progress, error classes, StateData)
- `server/utils/posting/phase-policy.ts` — PHASE_POLICIES + CLASS_RETRY_POLICY + helpers
- `server/utils/posting/error-taxonomy.ts` — `classifyPostingError` + `mapErrorClassToPersisted`
- `prisma/schema.prisma` — `PostingJob.stateData Json?`
- `prisma/migrations/20260528120000_add_posting_job_state_data/migration.sql`
- `tests/unit/posting-phase-policy.spec.ts`, `tests/unit/posting-error-taxonomy.spec.ts`

---

# PR5A — Production hardening (operator runbook)

PR5A делает FSM **понятной оператору** и **наблюдаемой по уведомлениям**, НЕ меняя
ни одного runtime-решения: upload-логика, retry/backoff (PR3), duplicate-guard
(PR4), cookies/proxy/Indigo `session_start` — нетронуты. Добавлены только:
человекочитаемый форматтер, structured-логи, безопасная FSM-диагностика в API,
обогащение текста Telegram-критикала и этот runbook.

## FSM production mode

- Включается env-флагом `YOUTUBE_POSTING_FSM_ENABLED=true` (default OFF). При OFF —
  legacy `postToYouTube` + legacy `worker.handleFailure`, 0 изменений.
- При ON: PhaseRunner драйвит Studio-фазы, observer пишет `stateData` +
  STATE_ENTER/EXIT/FAIL, `worker.handleFailure` → `fsmHandleFailure` (policy-retry
  через `classWindows`).
- Источник истины кода — `RUNNER_BUILD_MARKER` (пишется в `stateData.buildMarker`
  и в STATE_ENTER-логи).

## Error taxonomy (оператору)

`ErrorClass | Meaning | Retry? | Human action | Safe to retry? | Risk`

| ErrorClass | Что значит | Retry? | Действие человека | Безопасно retry? | Риск |
|------------|------------|--------|-------------------|------------------|------|
| `indigo_unstable` | Indigo не отдал стабильный CDP/window (dead-port) | Авто, 7×/90м (deadline) | Ждать; если окно исчерпано — поднять профиль `/indigo/[id]` и manual retry | Да (upload не начат) | Низкий |
| `browser_lost` | браузер/target умер во время фазы (ДО attach) | Авто, 5×/90м (rolling) | Ждать; перед manual retry поднять профиль | Да (до attach) | Низкий |
| `duplicate_risk` | браузер умер **ПОСЛЕ** attach файла | Авто через `resume_check` (5×/90м) | Не делать слепой re-upload; проверить Studio drafts/канал | Только по `draftVideoId`, иначе блок | **Высокий (дубль)** |
| `network_error` | timeout / латентность прокси / сеть | Авто, generic backoff по `maxAttempts` | Проверить прокси если повторяется | Да | Низкий |
| `browser_state_error` | грязный профиль / пустой store при valid snapshot | Авто, generic | Перезапустить профиль если повторяется | Да | Низкий |
| `browser_connect_failed` | CDP connect стабильно падает / automation off | **Нет** | Включить automation/CDP в Indigo-профиле | После фикса профиля | Средний |
| `auth_required` | redirect на accounts.google.com | **Нет** | Обновить cookie snapshot, login в Indigo X desktop | После re-login | Средний |
| `login_required` | snapshot нет/протух / store без auth-cookies | **Нет** | Свежий login + cookie refresh | После re-login | Средний |
| `selector_not_found` | DOM не найден — YouTube сменил вёрстку | **Нет** | Эскалация разработке (обновить селекторы poster) | После фикса кода | Средний |
| `upload_failed` | setInputFiles / processing / нет share URL | Авто, generic | Проверить файл/канал если повторяется | Да (dedup на upload-фазах) | Низкий-средний |
| `requires_human` | captcha / verify / phone / 2FA, либо окно исчерпано | **Нет** | Пройти challenge в Indigo X, restore login | После ручной разблокировки | **Высокий** |
| `proxy_dead` | прокси мёртв / leak реального IP | **Нет (намеренно)** | Починить/заменить прокси, проверить отсутствие leak | После фикса прокси | **Критический (бан)** |
| `unknown` | fingerprint не сматчился | **Нет** | Смотреть `lastError` + STATE_FAIL, эскалация | Осторожно | Неизвестный |

Источник смыслов и формулировок — `shared/utils/posting-operator-format.ts`
(`formatPostingFailureForOperator`). `retryable === (disposition !== terminal)`
согласован с `CLASS_RETRY_POLICY` (unit-тест).

## Telegram notification policy

| Ситуация | Status | Telegram | Дедуп |
|----------|--------|----------|-------|
| Retryable transient (`indigo_unstable`/`browser_lost`/`duplicate_risk`) | `retry_queued` | `custom` — **один раз на класс/окно** | по `classWindows[class].alertedAt`; повтор в окне → лог `FSM_NOTIFICATION_THROTTLED`, без TG |
| Generic transient (`network_error`/`upload_failed`) retry | `retry_queued` | **нет** (минимум шума) | — |
| Final exhausted (окно/лимит класса исчерпан) | `failed` | `critical_error` — один раз, с операторским действием в тексте | — |
| Terminal (`auth_required`/`login_required`/`selector_not_found`/`requires_human`/`duplicate_blocked`) | `failed` | `critical_error` — один раз | — |

Правило: **retryable transient НЕ спамит Telegram**, critical — только на
final/terminal. Источник истины троттлинга — `stateData.classWindows[class].alertedAt`
(переживает рестарт Nitro, не зависит от текста логов).

## Operator action table

Конкретное действие по классу — поле `operatorAction` форматтера, отдаётся в
API (`fsm.operatorAction` / `fsm.operator`) и в логах `FSM_OPERATOR_ACTION`:

- `indigo_unstable` → ждать авто-retry; окно исчерпано — поднять профиль `/indigo/[id]`.
- `browser_lost` → ждать cooldown; поднять профиль перед manual retry.
- `duplicate_risk` → НЕ слепой re-upload; resume идёт по `draftVideoId`; иначе проверить канал вручную.
- `network_error`/`upload_failed`/`browser_state_error` → ждать; при повторе проверить прокси/файл/профиль.
- `auth_required`/`login_required` → обновить cookie snapshot, login в Indigo X desktop.
- `browser_connect_failed` → включить automation/CDP в профиле.
- `selector_not_found` → эскалация разработке.
- `requires_human` → пройти challenge/verify в Indigo X.
- `proxy_dead` → НЕ публиковать, починить прокси.

## How to inspect stateData

1. **API**: `GET /api/posting-jobs/[id]` → поле `fsm` (`FsmDiagnosticsSummary`):
   `fsmVersion`, `currentPhase`, `lastCompletedPhase`, `progress`, `lastErrorClass`,
   `lastErrorPhase`, `finalReason`, `draftVideoId`/`draftVideoIdPresent`,
   `duplicateRiskAcknowledged`, `classWindows[]` (с `windowExpiresAt`),
   `nextRetryAt`, `operatorClass`, `operatorAction`, `operator{…}`.
   Секретов (cookies/proxy/tokens) в `fsm` НЕТ.
2. **Логи** (`PostingJobLog`, `GET /api/posting-jobs/[id]/logs`): `STATE_ENTER/EXIT/FAIL`,
   `STATE_PROGRESS`, `DRAFT_ID_CAPTURED`, `FSM_POLICY_DECISION`, `STATE_RECOVER`,
   `FSM_NOTIFICATION_THROTTLED`, `FSM_FINAL_REASON`, `FSM_OPERATOR_ACTION`,
   `RESUME_CHECK_DECISION`, `DUPLICATE_RISK_BLOCKED`, `STUCK_UPLOADING_RECOVERED`,
   `STUCK_UPLOADING_REQUIRES_HUMAN`. Каждый FSM-лог несёт structured `data`
   (jobId/phase/currentPhase/progress/lastCompletedPhase/errorClass/retryCount/
   retryAt/windowStartAt/windowExpiresAt/finalReason/operatorAction/draftVideoId/
   draftUrl/duplicateRiskAcknowledged).

## How to decide whether to retry

1. Открыть `fsm.operator`: `retryable` + `requiresHuman`.
2. `requiresHuman=true` → **сначала действие** (см. operator action table), потом manual retry.
3. `operatorClass=duplicate_risk` и `draftVideoIdPresent=false` → **НЕ** слепой retry
   (риск дубля): проверить канал/Studio drafts вручную.
4. `operatorClass=proxy_dead` → НЕ retry до фикса прокси (публикация = бан).
5. transient (`indigo_unstable`/`browser_lost`/`network_error`) с `nextRetryAt` в
   будущем → ничего не делать, job сам повторит.

## Что значат ключевые классы

- **`duplicate_risk`** — файл мог уже уйти в YouTube (браузер умер после attach).
  Слепой re-upload даст дубль. Надёжный resume — ТОЛЬКО по `draftVideoId`; без него
  job блокируется (`duplicate_blocked`), требуется ручная проверка.
- **`indigo_unstable`** — Indigo выдал порт, но CDP/DevTools не открылся (dead-port).
  Job ждёт стабильное окно (авто-retry). Cookies/селекторы тут НИ ПРИ ЧЁМ.
- **`auth_required`** — Google/YouTube попросил вход (сессия протухла). Нужен свежий
  cookie snapshot / проверка login в Indigo X desktop. Авто-retry не поможет.
- **`requires_human`** — автоматизация остановлена, чтобы не сделать небезопасное
  действие (captcha/verify/phone/2FA или исчерпаны все окна retry).

## Known infrastructure limitation

Главный блокер production-постинга — **нестабильность Indigo/CDP/proxy**, НЕ код FSM:
- `session_start` dead-port (Indigo agent не отдаёт рабочий CDP-порт) и cloud-lock —
  инфраструктурные, классифицируются как `indigo_unstable` (авто-retry на good-window).
- mobile/residential proxy latency → `network_error`.
- Реальный attach/resume E2E на Studio не наблюдался из-за pre-existing dead-port —
  PR4 guard валидирован unit-тестами и prod-smoke, не живым attach.

FSM делает эти сбои **наблюдаемыми и безопасными** (не спамит, не дублирует,
не публикует вслепую), но не устраняет инфраструктурную нестабильность.

### Файлы PR5A
- `shared/utils/posting-operator-format.ts` — `formatPostingFailureForOperator` + `OperatorFailureView` (pure, shared)
- `server/utils/posting/operator-diagnostics.ts` — `buildFsmDiagnostics` (API) / `buildFsmLogData` (логи) / `decisionToOperatorClass`
- `server/utils/posting/fsm-retry.ts` — +FSM_POLICY_DECISION / FSM_NOTIFICATION_THROTTLED / FSM_FINAL_REASON / FSM_OPERATOR_ACTION + operatorAction в critical-тексте (decision НЕ тронут)
- `server/utils/posting/posting-fsm.ts` — +`RESUME_CHECK_DECISION` лог (control-flow НЕ тронут)
- `server/api/posting-jobs/[id].get.ts` — +поле `fsm` (`FsmDiagnosticsSummary`)
- `shared/types/posting-job.ts` — `FsmDiagnosticsSummary` + `FsmDiagnosticsClassWindow`
- `tests/unit/posting-operator-format.spec.ts`, `tests/unit/posting-operator-diagnostics.spec.ts`, расширен `tests/unit/posting-fsm-retry.spec.ts`

---

# PR5B — Controlled default enablement

Безопасный перевод FSM в режим «включён по умолчанию» для YouTube, БЕЗ удаления
legacy и БЕЗ дрейфа для non-YouTube. Весь резолв — в одном чистом месте
(`server/utils/posting/fsm-config.ts:resolveYoutubeFsmMode`).

## Precedence резолва (сверху вниз)

| # | Условие | Результат | source |
|---|---------|-----------|--------|
| 1 | `platform !== "youtube"` | **OFF** (FSM — только YouTube browser automation) | `non_youtube` |
| 2 | `YOUTUBE_POSTING_FSM_ENABLED` = `"true"`/`"false"` | override оператора (вкл/**rollback**) | `env_enabled` |
| 3 | `YOUTUBE_POSTING_FSM_DEFAULT` = `"true"`/`"false"` (если ENABLED не задан) | дефолт деплоя | `env_default` |
| 4 | иначе | `YOUTUBE_FSM_CODE_DEFAULT` (**= true**, flip PR5B) | `code_default` |

## Default decision

- **Код-дефолт ON только для YouTube** (`YOUTUBE_FSM_CODE_DEFAULT = true`). При
  отсутствии обеих env-переменных YouTube-постинг идёт через FSM.
- **Non-YouTube (tiktok/instagram) — всегда OFF** (platform-gate, шаг 1). Observer
  для них NOOP → нет `stateData` → `worker.handleFailure` идёт legacy-веткой. Zero
  drift для не-YouTube гарантирован независимо от env.

## Emergency rollback (без деплоя)

Выставить `YOUTUBE_POSTING_FSM_ENABLED=false` — резолвер вернёт OFF (источник
`env_enabled`), весь YouTube-постинг немедленно вернётся на legacy `postToYouTube` +
legacy `worker.handleFailure`. Передеплой не нужен (читается из `process.env` на
каждый job). Альтернатива на уровне кода — сменить `YOUTUBE_FSM_CODE_DEFAULT` на `false`.

## Видимость активного режима

- **Startup-лог** (`server/plugins/posting-fsm-startup.ts`): при старте Nitro печатает
  `[posting_fsm_default] effective(youtube)=ON|OFF source=… env.YOUTUBE_POSTING_FSM_ENABLED=… env.YOUTUBE_POSTING_FSM_DEFAULT=… codeDefault=true`.
- **Endpoint** `GET /api/posting-jobs/fsm-mode` (RBAC canRead social-upload): отдаёт
  `{ enabled, source, env{ENABLED,DEFAULT}, codeDefault, youtubeOnly, rollbackHint }`.

## Что НЕ тронуто (по ТЗ)

- Legacy `postToYouTube` / `dispatchPoster` (TikTok/Instagram) — на месте.
- Legacy-ветка `worker.handleFailure` + worker fallback — на месте.
- Legacy unit-тесты — не удалены, обновлён лишь триггер OFF (теперь явный
  `YOUTUBE_POSTING_FSM_ENABLED=false`, т.к. дефолт стал ON); `tests/setup.ts`
  пинит `YOUTUBE_POSTING_FSM_DEFAULT=false` для детерминизма прочих тестов.
- Retry/backoff (PR3), duplicate-guard (PR4), upload logic, cookies/proxy/Indigo
  session_start — без изменений.

### Файлы PR5B
- `server/utils/posting/fsm-config.ts` — `resolveYoutubeFsmMode` + `YOUTUBE_FSM_CODE_DEFAULT`
- `server/utils/posting/fsm-observer.ts` — `isYoutubePostingFsmEnabled(platform?)` через резолвер; `createPhaseObserver` platform-gate
- `server/automation/poster-runner.ts` — `createPhaseObserver({ platform })`
- `server/utils/posting/worker.ts` — `isYoutubePostingFsmEnabled(job.platform)`
- `server/plugins/posting-fsm-startup.ts` — startup-лог режима
- `server/api/posting-jobs/fsm-mode.get.ts` — endpoint видимости
- `tests/unit/posting-fsm-config.spec.ts` (новый), обновлены `posting-fsm-observer.spec.ts` + `tests/setup.ts`
