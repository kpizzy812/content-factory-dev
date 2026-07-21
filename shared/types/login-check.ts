/**
 * Контракт ответа POST /api/accounts/:id/check-login.
 *
 * Используется AccountLoginStatusBadge / AccountLoginCheckButton для отображения
 * результата проверки логина в Indigo browser profile.
 */
export interface LoginCheckResult {
  accountId: number
  platform: string
  /** ISO timestamp когда проверяли. */
  checkedAt: string
  /** true = залогинены, false = не залогинены, null = ошибка во время проверки. */
  loggedIn: boolean | null
  /** Если удалось вытащить из DOM. */
  username?: string
  /** Селектор который сработал — для дебага. */
  detectedSelector?: string
  /** Если loggedIn=null — сообщение об ошибке. */
  error?: string
  /** Длительность проверки в мс. */
  durationMs: number
  /** Транспорт который использовался: "cdp" (puppeteer) для desktop, "webdriver" (selenium) для mobile_*. */
  transport?: "cdp" | "webdriver"
  /**
   * Логический исход проверки (опционально — обратная совместимость, старые
   * клиенты читают только loggedIn):
   *   - "confirmed"  — реально залогинен (probe вернул loggedIn=true).
   *   - "logged_out" — реально НЕ залогинен (нет валидного snapshot / cookies
   *                    протухли / платформа показала не-вход). Это BLOCKER.
   *   - "transient"  — Indigo CDP отвалился при ВАЛИДНОМ snapshot (browser
   *                    disconnected во время restore). Это НЕ реально не
   *                    залогинен → гейт показывает warn и доверяет job-retry
   *                    воркера, а не блокирует создание задачи.
   *   - "error"      — прочая ошибка без валидного snapshot (не классифицирована).
   */
  outcome?: "confirmed" | "logged_out" | "transient" | "error"
  /** Сахар: true тогда и только тогда, когда outcome === "transient". */
  transient?: boolean
}
