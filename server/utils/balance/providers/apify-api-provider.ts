/**
 * Apify balance через публичный API `/v2/users/me`.
 *
 * Response (упрощённо):
 * {
 *   "data": {
 *     "plan": { "id": "FREE" | "PERSONAL" | "TEAM" | ..., "maxMonthlyUsageUsd": 49 },
 *     "usage": { "monthlyUsageUsd": 12.50 }
 *   }
 * }
 *
 * Считаем remaining = maxMonthlyUsageUsd - monthlyUsageUsd. Plan FREE имеет
 * maxMonthlyUsageUsd = 5 (free credits) — те же thresholds работают.
 *
 * Fallback на ManualBalanceProvider при отсутствии токена или ошибке API.
 */

import type { BalanceProvider, ServiceBalance } from "../types"
import type { ServiceConfig } from "../config"
import { ManualBalanceProvider } from "./manual-provider"

const APIFY_API_URL = "https://api.apify.com/v2"
const REQUEST_TIMEOUT_MS = 5000

type ApifyUsageEndpoint = "users/me" | "users/me/usage/monthly"

interface ApifyMeResponse {
  data?: {
    plan?: {
      id?: string
      maxMonthlyUsageUsd?: number
    }
    usage?: {
      monthlyUsageUsd?: number
    }
    username?: string
  }
}

interface ApifyMonthlyUsageResponse {
  data?: {
    monthlyServiceUsage?: {
      totalUsageCreditsUsdAfterVolumeDiscount?: number
    }
    // Запасные варианты названия поля для разных версий API
    totalUsageCreditsUsdAfterVolumeDiscount?: number
  }
}

export class ApifyApiBalanceProvider implements BalanceProvider {
  readonly service: string
  private readonly cfg: ServiceConfig

  constructor(cfg: ServiceConfig) {
    this.service = cfg.key
    this.cfg = cfg
  }

  async fetchBalance(): Promise<ServiceBalance> {
    const startedAt = Date.now()
    const token = process.env.APIFY_TOKEN

    if (!token) {
      return this.fallbackToManual(startedAt, "APIFY_TOKEN не настроен", null)
    }

    let usageEndpoint: ApifyUsageEndpoint = "users/me"
    try {
      const json = await $fetch<ApifyMeResponse>(`${APIFY_API_URL}/users/me`, {
        query: { token },
        timeout: REQUEST_TIMEOUT_MS,
      })

      const limit = json.data?.plan?.maxMonthlyUsageUsd
      let used = json.data?.usage?.monthlyUsageUsd

      // B-3: если /users/me не вернул usage.monthlyUsageUsd — пробуем /users/me/usage/monthly
      if (typeof used !== "number") {
        // B-4: raw-лог первой попытки для диагностики
        console.warn(
          `[balance:provider] unexpected response shape`,
          {
            service: this.service,
            endpoint: "users/me",
            reason: "missing usage.monthlyUsageUsd",
            body: JSON.stringify(json).slice(0, 500),
          },
        )
        try {
          const monthly = await $fetch<ApifyMonthlyUsageResponse>(
            `${APIFY_API_URL}/users/me/usage/monthly`,
            { query: { token }, timeout: REQUEST_TIMEOUT_MS },
          )
          used = monthly.data?.monthlyServiceUsage?.totalUsageCreditsUsdAfterVolumeDiscount
            ?? monthly.data?.totalUsageCreditsUsdAfterVolumeDiscount
          usageEndpoint = "users/me/usage/monthly"

          // Если и второй endpoint вернул неожиданную структуру — отдельный warn
          if (typeof used !== "number") {
            console.warn(
              `[balance:provider] unexpected response shape`,
              {
                service: this.service,
                endpoint: "users/me/usage/monthly",
                reason: "missing totalUsageCreditsUsdAfterVolumeDiscount",
                body: JSON.stringify(monthly).slice(0, 500),
              },
            )
          }
        } catch (monthlyErr) {
          const monthlyMsg = monthlyErr instanceof Error ? monthlyErr.message : String(monthlyErr)
          console.warn(
            `[balance:provider] apify monthly usage endpoint failed`,
            {
              service: this.service,
              endpoint: "users/me/usage/monthly",
              error: monthlyMsg,
            },
          )
        }
      }

      if (typeof limit !== "number" || typeof used !== "number") {
        return this.fallbackToManual(
          startedAt,
          `apify usage fields missing (limit=${typeof limit}, used=${typeof used}, endpoint=${usageEndpoint})`,
          usageEndpoint,
        )
      }

      const remaining = Math.max(0, limit - used)
      const status =
        remaining <= this.cfg.criticalThreshold
          ? "critical"
          : remaining <= this.cfg.lowThreshold
            ? "low"
            : "ok"

      return {
        service: this.service,
        status,
        source: "api",
        balance: { currency: "USD", amount: remaining },
        lowThreshold: this.cfg.lowThreshold,
        criticalThreshold: this.cfg.criticalThreshold,
        checkedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        enteredAt: new Date().toISOString(),
        metadata: {
          plan: json.data?.plan?.id ?? "unknown",
          monthlyUsageUsd: used,
          monthlyLimitUsd: limit,
          username: json.data?.username,
          usageEndpoint,
        },
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return this.fallbackToManual(startedAt, `Apify API: ${message}`, usageEndpoint)
    }
  }

  private async fallbackToManual(
    startedAt: number,
    reason: string,
    usageEndpoint: ApifyUsageEndpoint | null,
  ): Promise<ServiceBalance> {
    const manual = await new ManualBalanceProvider(this.cfg).fetchBalance()
    return {
      ...manual,
      source: "fallback",
      durationMs: Date.now() - startedAt,
      notes: [manual.notes, `[fallback: ${reason}]`].filter(Boolean).join(" "),
      metadata: {
        ...(manual.metadata ?? {}),
        usageEndpoint,
      },
    }
  }
}
