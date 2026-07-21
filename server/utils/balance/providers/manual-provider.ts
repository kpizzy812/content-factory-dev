/**
 * Универсальный provider который читает balance из ServiceBalanceEntry.
 * Одна инстанция на сервис — конкретный сервис передаётся через config.
 *
 * Manual entry — единственный источник balance в v1.
 * Real-API providers могут заменить этот класс в будущих треках.
 */

import type { BalanceProvider, ServiceBalance } from "../types"
import type { ServiceConfig } from "../config"

export class ManualBalanceProvider implements BalanceProvider {
  readonly service: string
  private readonly cfg: ServiceConfig

  constructor(cfg: ServiceConfig) {
    this.service = cfg.key
    this.cfg = cfg
  }

  async fetchBalance(): Promise<ServiceBalance> {
    const startedAt = Date.now()

    try {
      const entry = await prisma.serviceBalanceEntry.findUnique({
        where: { service: this.service },
      })

      if (!entry) {
        return {
          service: this.service,
          status: "unknown",
          source: "manual",
          checkedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt,
          error: "Balance не введён. Откройте /admin/balances или используйте /balance set в Telegram.",
        }
      }

      const amount = Number(entry.amount)
      const status =
        amount <= this.cfg.criticalThreshold
          ? "critical"
          : amount <= this.cfg.lowThreshold
            ? "low"
            : "ok"

      return {
        service: this.service,
        status,
        source: "manual",
        balance: { currency: entry.currency, amount },
        lowThreshold: this.cfg.lowThreshold,
        criticalThreshold: this.cfg.criticalThreshold,
        checkedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        enteredAt: entry.enteredAt.toISOString(),
        enteredByUserId: entry.enteredBy,
        notes: entry.notes,
      }
    } catch (err) {
      return {
        service: this.service,
        status: "error",
        source: "manual",
        checkedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }
}
