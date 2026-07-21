/**
 * fal.ai balance через публичный billing API `/v1/account/billing?expand=credits`.
 *
 * Response (упрощённо):
 * {
 *   "username": "...",
 *   "credits": {
 *     "current_balance": 12.34,
 *     "currency": "USD"
 *   }
 * }
 *
 * Без `?expand=credits` сервер не возвращает блок credits.
 * Auth: `Authorization: Key ${FAL_KEY}` — тот же ключ, который используется
 * для генерации видео в server/utils/fal.ts.
 *
 * Fallback на ManualBalanceProvider:
 * - mock-mode (FAL_MOCK_MODE=true) — без HTTP-запроса
 * - нет FAL_KEY
 * - 401 / timeout / любая HTTP-ошибка
 * - отсутствует поле credits.current_balance в ответе
 *
 * Negative balance после overspend защищаем `Math.max(0, x)` (план §9 edge cases).
 *
 * Источник: https://fal.ai/docs/platform-apis/v1/account/billing
 */

import type { BalanceProvider, ServiceBalance } from "../types"
import type { ServiceConfig } from "../config"
import { ManualBalanceProvider } from "./manual-provider"
import { isFalMockMode } from "../../mock/mode"

const FAL_BILLING_URL = "https://api.fal.ai/v1/account/billing"
const REQUEST_TIMEOUT_MS = 5000

interface FalBillingResponse {
  username?: string
  credits?: {
    current_balance?: number
    currency?: string
  }
}

export class FalApiBalanceProvider implements BalanceProvider {
  readonly service: string
  private readonly cfg: ServiceConfig

  constructor(cfg: ServiceConfig) {
    this.service = cfg.key
    this.cfg = cfg
  }

  async fetchBalance(): Promise<ServiceBalance> {
    const startedAt = Date.now()

    if (isFalMockMode()) {
      return this.fallbackToManual(startedAt, "FAL_MOCK_MODE=true")
    }

    const key = process.env.FAL_KEY
    if (!key) {
      return this.fallbackToManual(startedAt, "FAL_KEY не настроен")
    }

    try {
      const json = await $fetch<FalBillingResponse>(FAL_BILLING_URL, {
        query: { expand: "credits" },
        headers: { Authorization: `Key ${key}` },
        timeout: REQUEST_TIMEOUT_MS,
      })

      const rawBalance = json.credits?.current_balance
      if (typeof rawBalance !== "number") {
        return this.fallbackToManual(
          startedAt,
          "Fal API не вернул поля credits.current_balance",
        )
      }

      const currency = json.credits?.currency ?? this.cfg.defaultCurrency
      const amount = Math.max(0, rawBalance)
      const status =
        amount <= this.cfg.criticalThreshold
          ? "critical"
          : amount <= this.cfg.lowThreshold
            ? "low"
            : "ok"

      return {
        service: this.service,
        status,
        source: "api",
        balance: { currency, amount },
        lowThreshold: this.cfg.lowThreshold,
        criticalThreshold: this.cfg.criticalThreshold,
        checkedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        enteredAt: new Date().toISOString(),
        metadata: {
          username: json.username,
          rawCurrentBalance: rawBalance,
        },
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return this.fallbackToManual(startedAt, `Fal API: ${message}`)
    }
  }

  private async fallbackToManual(startedAt: number, reason: string): Promise<ServiceBalance> {
    const manual = await new ManualBalanceProvider(this.cfg).fetchBalance()
    return {
      ...manual,
      source: "fallback",
      durationMs: Date.now() - startedAt,
      notes: [manual.notes, `[fallback: ${reason}]`].filter(Boolean).join(" "),
    }
  }
}
