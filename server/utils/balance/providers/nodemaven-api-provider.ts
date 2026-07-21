/**
 * NodeMaven balance через публичный dashboard API.
 *
 * Endpoint: GET https://dashboard.nodemaven.com/api/v2/users/me
 * Auth (dual-mode): сначала `x-api-key: <NODEMAVEN_API_KEY>` (формат NodeMaven Help Center),
 * при 401/403 — fallback на `Authorization: Bearer <NODEMAVEN_API_KEY>` (legacy формат).
 *
 * Ожидаемая структура (точные поля могут отличаться, делаем defensive parsing):
 * {
 *   "traffic": { "remaining_gb": number, "limit_gb": number } | {...},
 *   "subscription": { "plan": string, "expires_at": ISO } | {...}
 * }
 *
 * При первом сбое формата падаем в manual fallback с сохранением raw в notes
 * (плюс console.warn с первыми 800 символами raw для диагностики).
 * Если NODEMAVEN_API_KEY не настроен — fallback без HTTP-запроса.
 */

import type { BalanceProvider, ServiceBalance } from "../types"
import type { ServiceConfig } from "../config"
import { ManualBalanceProvider } from "./manual-provider"

const NODEMAVEN_API_URL = "https://dashboard.nodemaven.com/api/v2"
const REQUEST_TIMEOUT_MS = 5000

type NodeMavenAuthMode = "x-api-key" | "bearer"

interface NodeMavenMeResponse {
  traffic?: {
    remaining_gb?: number
    limit_gb?: number
    used_gb?: number
  }
  subscription?: {
    plan?: string
    expires_at?: string
  }
  // Тип сырой, NodeMaven может менять поля
  [key: string]: unknown
}

/**
 * Делает запрос к /users/me с предпочтительной авторизацией `x-api-key`. При получении
 * 401/403 (протокольный auth-fail на этом формате) — повторяет с `Authorization: Bearer`.
 * Сетевые ошибки, таймауты и любые другие статусы пробрасываются наружу.
 */
async function requestNodeMavenMe(apiKey: string): Promise<{
  json: NodeMavenMeResponse
  authMode: NodeMavenAuthMode
}> {
  try {
    const json = await $fetch<NodeMavenMeResponse>(`${NODEMAVEN_API_URL}/users/me`, {
      headers: { "x-api-key": apiKey },
      timeout: REQUEST_TIMEOUT_MS,
    })
    return { json, authMode: "x-api-key" }
  } catch (err) {
    const status = (err as { statusCode?: number; status?: number })?.statusCode
      ?? (err as { status?: number })?.status
    if (status !== 401 && status !== 403) throw err

    // 401/403 на x-api-key → пробуем Bearer как fallback (legacy формат)
    const json = await $fetch<NodeMavenMeResponse>(`${NODEMAVEN_API_URL}/users/me`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: REQUEST_TIMEOUT_MS,
    })
    return { json, authMode: "bearer" }
  }
}

export class NodeMavenApiBalanceProvider implements BalanceProvider {
  readonly service: string
  private readonly cfg: ServiceConfig

  constructor(cfg: ServiceConfig) {
    this.service = cfg.key
    this.cfg = cfg
  }

  async fetchBalance(): Promise<ServiceBalance> {
    const startedAt = Date.now()
    const apiKey = process.env.NODEMAVEN_API_KEY

    if (!apiKey) {
      return this.fallbackToManual(startedAt, "NODEMAVEN_API_KEY не настроен", null)
    }

    let authMode: NodeMavenAuthMode | null = null
    try {
      const result = await requestNodeMavenMe(apiKey)
      const json = result.json
      authMode = result.authMode

      const remainingGb = json.traffic?.remaining_gb
      const limitGb = json.traffic?.limit_gb
      const plan = json.subscription?.plan
      const expiresAtRaw = json.subscription?.expires_at

      if (typeof remainingGb !== "number" || typeof limitGb !== "number") {
        // B-4: raw-лог для диагностики на Saturn (без apiKey — только тело ответа)
        console.warn(
          `[balance:provider] unexpected response shape`,
          {
            service: this.service,
            authMode,
            body: JSON.stringify(json).slice(0, 800),
          },
        )
        return this.fallbackToManual(
          startedAt,
          `NodeMaven API не вернул traffic.remaining_gb / traffic.limit_gb (authMode=${authMode})`,
          authMode,
        )
      }

      // status считается по % оставшегося трафика, не по абсолютному значению
      const percentRemaining = limitGb > 0 ? (remainingGb / limitGb) * 100 : 0
      const status =
        percentRemaining <= 5
          ? "critical"
          : percentRemaining <= 20
            ? "low"
            : "ok"

      const expiresAt = expiresAtRaw ? new Date(expiresAtRaw) : null
      const daysRemaining =
        expiresAt && !Number.isNaN(expiresAt.getTime())
          ? Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 86_400_000))
          : null

      return {
        service: this.service,
        status,
        source: "api",
        quota: { used: limitGb - remainingGb, limit: limitGb, unit: "GB" },
        expiry:
          expiresAt && daysRemaining !== null
            ? { daysRemaining, expiresAt: expiresAt.toISOString() }
            : undefined,
        checkedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        enteredAt: new Date().toISOString(),
        metadata: {
          plan: plan ?? "unknown",
          remainingGb,
          limitGb,
          expiresAt: expiresAt?.toISOString() ?? null,
          authMode,
        },
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return this.fallbackToManual(startedAt, `NodeMaven API: ${message}`, authMode)
    }
  }

  private async fallbackToManual(
    startedAt: number,
    reason: string,
    authMode: NodeMavenAuthMode | null,
  ): Promise<ServiceBalance> {
    const manual = await new ManualBalanceProvider(this.cfg).fetchBalance()
    return {
      ...manual,
      source: "fallback",
      durationMs: Date.now() - startedAt,
      notes: [manual.notes, `[fallback: ${reason}]`].filter(Boolean).join(" "),
      metadata: {
        ...(manual.metadata ?? {}),
        authMode,
      },
    }
  }
}
