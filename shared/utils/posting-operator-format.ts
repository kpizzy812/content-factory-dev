/**
 * Operator-facing форматтер ошибок YouTube posting FSM (PR5A).
 *
 * ЧИСТАЯ функция — без БД, side-effects, Nuxt/Prisma runtime. Шарится сервером
 * (Telegram-тексты, structured-логи FSM_OPERATOR_ACTION) и клиентом (UI badge,
 * диагностическая панель). Единственный источник человекочитаемых формулировок
 * «что случилось и что делать оператору» — чтобы Telegram, логи и UI не
 * расходились в смыслах.
 *
 * ВАЖНО: форматтер НЕ принимает runtime-решений (retry/backoff/throttle — это
 * retry-policy.ts/fsm-retry.ts). Поля retryable/requiresHuman/severity —
 * описательные характеристики КЛАССА ошибки, согласованные с
 * CLASS_RETRY_POLICY.disposition (см. тест posting-operator-format.spec.ts):
 * retryable === (disposition !== "terminal").
 *
 * @see docs/architecture/youtube-posting-fsm.md (Operator action table)
 * @see server/utils/posting/phase-policy.ts (CLASS_RETRY_POLICY)
 */

import type {
  YouTubePostingErrorClass,
  YouTubePostingPhase,
  YouTubePostingProgress,
  YouTubePostingStateData,
} from "../types/youtube-posting-fsm"

/**
 * Класс ошибки для оператора = 11 логических классов FSM + proxy_dead (leak/
 * мёртвый прокси, вне FSM-вокабуляра, но оператору важен) + unknown (fallback).
 */
export type OperatorErrorClass =
  | YouTubePostingErrorClass
  | "proxy_dead"
  | "unknown"

/** Все классы для итерации (тесты «маппинг каждого класса»). */
export const OPERATOR_ERROR_CLASSES: readonly OperatorErrorClass[] = [
  "browser_connect_failed",
  "browser_state_error",
  "network_error",
  "auth_required",
  "login_required",
  "selector_not_found",
  "upload_failed",
  "browser_lost",
  "indigo_unstable",
  "duplicate_risk",
  "requires_human",
  "proxy_dead",
  "unknown",
] as const

/** Уровень тревожности для UI-бейджа / приоритизации в логах. */
export type OperatorSeverity = "info" | "warning" | "error" | "critical"

export interface OperatorFailureView {
  /** Короткий заголовок (UI badge / Telegram title). */
  title: string
  /** Одно предложение «что случилось» на языке оператора. */
  shortMessage: string
  /** Технические детали (фаза/прогресс/draft) — для диагностики, безопасно показывать. */
  technicalDetails: string
  /** Конкретное действие оператора. */
  operatorAction: string
  severity: OperatorSeverity
  /** Класс способен авто-retry (disposition !== terminal). НЕ значит «retry прямо сейчас». */
  retryable: boolean
  /** Нужно ручное вмешательство (исправить аккаунт/прокси/верстку, либо проверить канал). */
  requiresHuman: boolean
}

/** Статическая часть view на класс ошибки (без runtime-контекста). */
interface OperatorClassMeta {
  title: string
  shortMessage: string
  baseTechnical: string
  operatorAction: string
  severity: OperatorSeverity
  retryable: boolean
  requiresHuman: boolean
}

/**
 * Таблица смыслов. Формулировки выверены под operator runbook:
 *   - indigo_unstable: «ждать/стабилизировать Indigo», БЕЗ упоминания cookies/селекторов;
 *   - auth_required/login_required: «обновить cookie snapshot / проверить login»;
 *   - duplicate_risk: «слепой re-upload запрещён, проверить вручную»;
 *   - proxy_dead: «не публиковать, починить прокси».
 */
const OPERATOR_META: Record<OperatorErrorClass, OperatorClassMeta> = {
  indigo_unstable: {
    title: "Indigo нестабилен",
    shortMessage: "Indigo не отдал стабильный CDP/browser window — job ждёт хорошее окно.",
    baseTechnical: "dead-port: Indigo выдал порт, но CDP/DevTools endpoint не открылся.",
    operatorAction:
      "Дождаться авто-retry — job сам ловит стабильное окно Indigo (до 7× за 90 мин). Если окно исчерпано — поднять профиль вручную через /indigo/[id] и повторить.",
    severity: "warning",
    retryable: true,
    requiresHuman: false,
  },
  browser_lost: {
    title: "Браузер потерян",
    shortMessage: "Indigo потерял browser/page во время фазы — будет retry, если безопасно.",
    baseTechnical: "detached Frame / Target closed / Session closed / Execution context destroyed.",
    operatorAction:
      "Дождаться авто-retry с cooldown (до 5× за 90 мин). Перед ручным retry поднять профиль через /indigo/[id].",
    severity: "warning",
    retryable: true,
    requiresHuman: false,
  },
  duplicate_risk: {
    title: "Риск дубля",
    shortMessage: "Файл мог уже уйти в YouTube — слепой повторный upload запрещён.",
    baseTechnical: "browser потерян после attach файла — на канале возможен orphaned draft.",
    operatorAction:
      "Не делать слепой повторный upload. Job сам пройдёт resume_check (возобновление по draftVideoId, иначе блок). Если заблокирован — проверить Studio drafts/канал вручную и удалить дубль.",
    severity: "critical",
    retryable: true,
    requiresHuman: true,
  },
  network_error: {
    title: "Сетевая ошибка",
    shortMessage: "Таймаут / латентность прокси / сетевой сбой во время фазы.",
    baseTechnical: "ECONN* / timeout / navigation timeout / proxy latency.",
    operatorAction:
      "Дождаться авто-retry по generic backoff. Если повторяется — проверить здоровье прокси аккаунта.",
    severity: "warning",
    retryable: true,
    requiresHuman: false,
  },
  browser_state_error: {
    title: "Грязное состояние браузера",
    shortMessage: "Профиль/стор браузера в некорректном состоянии (пустой store при валидном snapshot).",
    baseTechnical: "store пуст при valid snapshot / targets>15 / newPage Target closed — грязный профиль.",
    operatorAction:
      "Дождаться авто-retry — новая сессия обычно живёт дольше. Если повторяется — перезапустить Indigo-профиль.",
    severity: "warning",
    retryable: true,
    requiresHuman: false,
  },
  browser_connect_failed: {
    title: "Нет подключения к браузеру",
    shortMessage: "puppeteer.connect к CDP стабильно падает / automation выключен в Indigo.",
    baseTechnical: "ECONNREFUSED на CDP-порт / automation off (НЕ dead-port — у того отдельный класс indigo_unstable).",
    operatorAction:
      "Проверить, что в Indigo-профиле включён automation/CDP и профиль запускается. Затем ручной retry. Авто-retry не предусмотрен.",
    severity: "error",
    retryable: false,
    requiresHuman: true,
  },
  auth_required: {
    title: "Требуется вход в Google",
    shortMessage: "Google/YouTube перенаправил на вход — сессия аккаунта протухла.",
    baseTechnical: "redirect на accounts.google.com после navigate.",
    operatorAction:
      "Обновить cookie snapshot: зайти в аккаунт в Indigo X desktop, проверить login, сохранить cookies. Авто-retry не поможет.",
    severity: "error",
    retryable: false,
    requiresHuman: true,
  },
  login_required: {
    title: "Нет валидной сессии",
    shortMessage: "Snapshot отсутствует/протух или в store нет auth-cookies.",
    baseTechnical: "no_snapshot / all_expired / decrypt_failed / store без auth-cookie.",
    operatorAction:
      "Сделать свежий login в Indigo X desktop и обновить cookie snapshot аккаунта, затем повторить.",
    severity: "error",
    retryable: false,
    requiresHuman: true,
  },
  selector_not_found: {
    title: "Селектор YouTube не найден",
    shortMessage: "DOM-элемент не найден всеми fallback-селекторами — YouTube сменил вёрстку.",
    baseTechnical: "waitForSelector не нашёл элемент фазы (кроме open_upload_dialog, где это network_error).",
    operatorAction:
      "Эскалировать разработке: обновить селекторы poster'а под новую вёрстку YouTube. Авто-retry не поможет.",
    severity: "error",
    retryable: false,
    requiresHuman: true,
  },
  upload_failed: {
    title: "Загрузка не удалась",
    shortMessage: "setInputFiles / processing / нет share URL — сбой на стороне платформы.",
    baseTechnical: "upload-фаза не приняла файл / не показала details / не вернула URL.",
    operatorAction:
      "Дождаться авто-retry. Если повторяется — проверить файл видео и состояние канала.",
    severity: "warning",
    retryable: true,
    requiresHuman: false,
  },
  requires_human: {
    title: "Нужно ручное вмешательство",
    shortMessage: "Автоматизация остановлена, чтобы не сделать небезопасное действие.",
    baseTechnical: "captcha / verify it's you / phone challenge / 2FA, либо исчерпаны окна всех transient-классов.",
    operatorAction:
      "Проверить аккаунт в Indigo X desktop: пройти challenge/verify, при необходимости restore login. Затем ручной retry.",
    severity: "critical",
    retryable: false,
    requiresHuman: true,
  },
  proxy_dead: {
    title: "Прокси мёртв / утечка IP",
    shortMessage: "Прокси недоступен или браузер ходит с реального IP — публикация = гарантированный бан.",
    baseTechnical: "assertProxyHealthyBeforeSession 503 / browser_leak_check обнаружил серверный IP.",
    operatorAction:
      "НЕ публиковать. Починить/заменить прокси аккаунта, убедиться в отсутствии leak, затем ручной retry. Авто-retry отключён намеренно (риск бана).",
    severity: "critical",
    retryable: false,
    requiresHuman: true,
  },
  unknown: {
    title: "Неизвестная ошибка",
    shortMessage: "Ошибка не распознана классификатором.",
    baseTechnical: "fingerprint не сматчился ни с одним классом.",
    operatorAction:
      "Посмотреть lastError и логи фазы (STATE_FAIL), при необходимости эскалировать разработке.",
    severity: "error",
    retryable: false,
    requiresHuman: true,
  },
}

/** Нормализация произвольной строки класса/категории в OperatorErrorClass. */
export function toOperatorErrorClass(raw: string | null | undefined): OperatorErrorClass {
  if (raw && raw in OPERATOR_META) return raw as OperatorErrorClass
  return "unknown"
}

/** Собрать technicalDetails из базового описания класса + runtime-контекста. */
function composeTechnical(
  base: string,
  phase: YouTubePostingPhase | string | null | undefined,
  progress: YouTubePostingProgress | null | undefined,
  finalReason: string | null | undefined,
  stateData: Partial<YouTubePostingStateData> | null | undefined,
  errorClass: OperatorErrorClass,
): string {
  const parts = [base]
  if (phase) parts.push(`Фаза: ${phase}.`)
  if (progress) parts.push(`Прогресс: ${progress}.`)
  if (stateData?.draftVideoId) parts.push(`draftVideoId: ${stateData.draftVideoId}.`)
  if (stateData?.lastCompletedPhase) parts.push(`Последняя успешная фаза: ${stateData.lastCompletedPhase}.`)
  if (finalReason && finalReason !== errorClass) parts.push(`finalReason: ${finalReason}.`)
  return parts.join(" ")
}

/**
 * Главный форматтер. Возвращает operator-facing view для класса ошибки + контекста.
 * Поля severity/retryable/requiresHuman зависят ТОЛЬКО от errorClass (стабильно,
 * тестируемо); phase/progress/finalReason/stateData обогащают только technicalDetails.
 *
 * @param errorClass логический класс (или произвольная строка — нормализуется в unknown)
 */
export function formatPostingFailureForOperator(
  errorClass: OperatorErrorClass | string | null | undefined,
  phase?: YouTubePostingPhase | string | null,
  progress?: YouTubePostingProgress | null,
  finalReason?: string | null,
  stateData?: Partial<YouTubePostingStateData> | null,
): OperatorFailureView {
  const cls = toOperatorErrorClass(typeof errorClass === "string" ? errorClass : null)
  const meta = OPERATOR_META[cls]
  return {
    title: meta.title,
    shortMessage: meta.shortMessage,
    technicalDetails: composeTechnical(meta.baseTechnical, phase, progress, finalReason, stateData, cls),
    operatorAction: meta.operatorAction,
    severity: meta.severity,
    retryable: meta.retryable,
    requiresHuman: meta.requiresHuman,
  }
}
