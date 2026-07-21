/**
 * Типы результата Deep Proxy Check (Уровень C).
 *
 * Уровень A — TCP connect.
 * Уровень B — HTTP probe через Node http(s)-агенты (server/utils/proxy/probe.ts).
 * Уровень C (этот) — реальная проверка через Indigo browser + CDP. Запускает
 * profile с тем же прокси, что используется для posting, открывает ifconfig.me
 * через puppeteer-core и парсит JSON-ответ. Это ground truth — что увидит
 * сайт, когда posting будет идти через этот же browser.
 *
 * Используется в:
 *   - server/utils/proxy/deep-check.ts (логика)
 *   - server/api/accounts/[id]/deep-proxy-check.post.ts (endpoint)
 *   - app/components/account/AccountProxyPicker.vue (UI)
 */

export interface DeepProxyCheckStep {
  ok: boolean
  durationMs: number
  error?: string
}

export interface DeepProxyCheckPageLoadStep extends DeepProxyCheckStep {
  url: string
  httpStatus?: number | null
}

export interface DeepProxyCheckIpExtractionStep extends DeepProxyCheckStep {
  rawBody?: string
}

export interface DeepProxyCheckResult {
  accountId: number
  proxyId: string | null
  deviceProfileId: string | null
  startedAt: string
  durationMs: number

  steps: {
    profileStart: DeepProxyCheckStep
    cdpConnect: DeepProxyCheckStep
    pageLoad: DeepProxyCheckPageLoadStep
    ipExtraction: DeepProxyCheckIpExtractionStep
    profileStop: DeepProxyCheckStep
  }

  result: {
    detectedIp: string | null
    detectedCountry?: string
    detectedCity?: string
    expectedNotToBe: string | null
    isLeaking: boolean | null
    matchesProxyExpectation: boolean | null
  }

  verdict: {
    proxyConfiguredInIndigo: boolean
    proxyActuallyWorking: boolean
    recommendation: string
  }
}

/**
 * Summary row из ProxyDeepCheckLog для list-view (history).
 * Без fullResult — для drill-down есть отдельный GET /api/proxies/deep-check-logs/:logId.
 */
export interface DeepProxyCheckLogSummary {
  id: string
  proxyId: string
  socialAccountId: number | null
  deviceProfileId: string | null
  initiatedById: number | null
  triggeredFrom: string
  outcome: string
  startedAt: string
  finishedAt: string | null
  durationMs: number | null
  detectedIp: string | null
  detectedCountry: string | null
  detectedCity: string | null
  isLeaking: boolean | null
  matchesProxyExpectation: boolean | null
  proxyActuallyWorking: boolean
  recommendation: string | null
  createdAt: string
}

/**
 * Полный log row с fullResult — для модалки drill-down.
 */
export interface DeepProxyCheckLogDetail extends DeepProxyCheckLogSummary {
  fullResult: DeepProxyCheckResult | null
}

/**
 * Account-level deep-check status для UI компонентов (AccountReadinessTab/Badge).
 * Один последний лог + флаги "stale" (>7д) и "leaking".
 */
export interface AccountDeepCheckStatus {
  /** null если deep-check никогда не запускался для этого аккаунта. */
  last: DeepProxyCheckLogSummary | null
  /** true если last.createdAt > 7 дней назад. */
  stale: boolean
  /** true если в last обнаружен IP leak (явный blocker). */
  leaking: boolean
}
