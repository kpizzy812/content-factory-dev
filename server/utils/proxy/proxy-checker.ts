import { decryptSecret } from "../crypto"
import { prisma } from "../prisma"
import type {
  ProxyCheckResult,
  ProxyCheckTrigger,
  ProxyStatus,
} from "../../../shared/types/proxy"
import { checkProxy } from "./probe"

export { checkProxy } from "./probe"
export type { ProxyCheckResult } from "../../../shared/types/proxy"

const STALE_CHECK_THRESHOLD_MS = 60 * 60 * 1000

function computeProxyStatus(result: ProxyCheckResult, prevFails: number): ProxyStatus {
  if (result.httpProbeOk && !result.isLeaking) return "healthy"
  const fails = prevFails + 1
  if (fails >= 3) return "dead"
  return "degraded"
}

/**
 * Запускает проверку прокси, сохраняет результат в ProxyHealthCheck,
 * обновляет Proxy.status / lastCheckedAt / consecutiveFailures.
 *
 * Используется ручной кнопкой /check, scheduler'ом и pre_session ассертом.
 */
export async function runProxyHealthCheck(
  proxyId: string,
  triggeredBy: ProxyCheckTrigger
): Promise<ProxyCheckResult> {
  const proxy = await prisma.proxy.findUniqueOrThrow({ where: { id: proxyId } })

  const result = await checkProxy({
    protocol: proxy.protocol,
    host: decryptSecret(proxy.host),
    port: proxy.port,
    username: proxy.username ? decryptSecret(proxy.username) : undefined,
    password: proxy.password ? decryptSecret(proxy.password) : undefined,
  })

  await prisma.proxyHealthCheck.create({
    data: {
      proxyId,
      triggeredBy,
      tcpConnectOk: result.tcpConnectOk,
      httpProbeOk: result.httpProbeOk,
      detectedIp: result.detectedIp ?? null,
      detectedCountry: result.detectedCountry ?? null,
      detectedCity: result.detectedCity ?? null,
      latencyMs: result.latencyMs ?? null,
      isLeaking: result.isLeaking ?? null,
      errorCategory: result.errorCategory ?? null,
      errorMessage: result.errorMessage ?? null,
      rawProbeData: (result.rawProbeData ?? null) as never,
    },
  })

  const consecutiveFailures = result.httpProbeOk && !result.isLeaking
    ? 0
    : proxy.consecutiveFailures + 1
  const newStatus = computeProxyStatus(result, proxy.consecutiveFailures)

  await prisma.proxy.update({
    where: { id: proxyId },
    data: {
      status: newStatus,
      lastCheckedAt: new Date(),
      lastCheckResult: result as never,
      consecutiveFailures,
    },
  })

  return result
}

/**
 * Обязательный assert ПЕРЕД любой автоматической сессией использующей прокси
 * (Indigo browser session в итерации 3, OAuth refresh в итерации 4).
 *
 * - Если последняя проверка > 1 час назад или status != healthy → re-check.
 * - Если re-check провалился → throw 503 с пояснением что делать.
 */
export async function assertProxyHealthyBeforeSession(proxyId: string): Promise<void> {
  const proxy = await prisma.proxy.findUniqueOrThrow({ where: { id: proxyId } })

  const stale =
    !proxy.lastCheckedAt ||
    proxy.lastCheckedAt < new Date(Date.now() - STALE_CHECK_THRESHOLD_MS)

  if (stale || proxy.status !== "healthy") {
    const result = await runProxyHealthCheck(proxyId, "pre_session")
    if (!result.httpProbeOk || result.isLeaking) {
      const reason = result.isLeaking
        ? "IP сервера утекает! Indigo НЕ должен запускаться."
        : "Замените прокси перед запуском."
      throw createError({
        statusCode: 503,
        message: `Прокси ${proxy.label} не работает: ${result.errorMessage ?? "неизвестная ошибка"}. ${reason}`,
        data: { proxyId, errorCategory: result.errorCategory },
      })
    }
  }
}
