import type { Proxy, ProxyHealthCheck } from "../../../app/generated/prisma/client"
import { decryptSecret } from "../crypto"
import { maskHost } from "../secret-access"
import { summarizeAlertHistory } from "./alert-dedup"
import type {
  ProxyDto,
  ProxyHealthCheckDto,
  ProxyCheckTrigger,
  ProxyAlertSummary,
} from "../../../shared/types/proxy"

/**
 * Превращает Proxy row + кол-во привязанных аккаунтов в безопасный DTO для API.
 * Маскирует host, не возвращает шифрованные creds.
 */
export function toProxyDto(proxy: Proxy, attachedAccountsCount: number): ProxyDto {
  return {
    id: proxy.id,
    label: proxy.label,
    provider: proxy.provider,
    type: proxy.type,
    protocol: proxy.protocol,
    hostMasked: maskHost(decryptSecret(proxy.host)),
    port: proxy.port,
    hasCredentials: !!proxy.username && !!proxy.password,
    hasRotationUrl: !!proxy.rotationUrl,
    expectedCountry: proxy.expectedCountry,
    expectedCity: proxy.expectedCity,
    ipv4Only: proxy.ipv4Only,
    status: proxy.status,
    lastCheckedAt: proxy.lastCheckedAt?.toISOString() ?? null,
    consecutiveFailures: proxy.consecutiveFailures,
    monthlyTrafficGB: proxy.monthlyTrafficGB,
    expiresAt: proxy.expiresAt?.toISOString() ?? null,
    notes: proxy.notes,
    attachedAccountsCount,
    alertSummary: summarizeAlertHistory(proxy.alertHistory) as ProxyAlertSummary[],
    createdAt: proxy.createdAt.toISOString(),
    updatedAt: proxy.updatedAt.toISOString(),
  }
}

export function toProxyHealthCheckDto(row: ProxyHealthCheck): ProxyHealthCheckDto {
  return {
    id: row.id,
    proxyId: row.proxyId,
    checkedAt: row.checkedAt.toISOString(),
    triggeredBy: row.triggeredBy as ProxyCheckTrigger,
    tcpConnectOk: row.tcpConnectOk,
    httpProbeOk: row.httpProbeOk,
    detectedIp: row.detectedIp,
    detectedCountry: row.detectedCountry,
    detectedCity: row.detectedCity,
    latencyMs: row.latencyMs,
    isLeaking: row.isLeaking,
    errorCategory: row.errorCategory,
    errorMessage: row.errorMessage,
  }
}
