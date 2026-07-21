/**
 * Anthropic balance — расчётно через AiAuditLog.costUsd.
 *
 * Алгоритм:
 * 1. Берём baseline из ServiceBalanceEntry (operator вводит при top-up).
 * 2. Из AiAuditLog суммируем costUsd с createdAt >= baseline.enteredAt.
 * 3. remaining = baseline.amount - accumulated.
 *
 * Если baseline не задан → status='unknown' + подсказка про /balance set.
 *
 * Не зовёт никакого HTTP API — чисто прайс-таблица × tokens, который мы уже логируем.
 */

import type { BalanceProvider, ServiceBalance } from "../types"
import type { ServiceConfig } from "../config"

export class AnthropicEstimateBalanceProvider implements BalanceProvider {
  readonly service: string
  private readonly cfg: ServiceConfig

  constructor(cfg: ServiceConfig) {
    this.service = cfg.key
    this.cfg = cfg
  }

  async fetchBalance(): Promise<ServiceBalance> {
    const startedAt = Date.now()

    try {
      const baseline = await prisma.serviceBalanceEntry.findUnique({
        where: { service: this.service },
      })

      if (!baseline) {
        return {
          service: this.service,
          status: "unknown",
          source: "estimate",
          checkedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt,
          error: "Baseline не задан. Введите при следующем top-up: /balance set anthropic <amount>",
        }
      }

      const baseAmount = Number(baseline.amount)
      // balance_v2: фильтруем по denormalized service-тегу, а не по model LIKE.
      // Backward compat: миграция backfill'нула service='anthropic' для всех старых
      // записей с model LIKE 'claude%', поэтому исторические данные не потеряны.
      const spentAgg = await prisma.aiAuditLog.aggregate({
        where: {
          service: "anthropic",
          createdAt: { gte: baseline.enteredAt },
          costUsd: { not: null },
        },
        _sum: { costUsd: true },
      })

      const spent = Number(spentAgg._sum.costUsd ?? 0)
      const remaining = Math.max(0, baseAmount - spent)
      const days = Math.max(
        1,
        Math.floor((Date.now() - baseline.enteredAt.getTime()) / 86_400_000),
      )

      const status =
        remaining <= this.cfg.criticalThreshold
          ? "critical"
          : remaining <= this.cfg.lowThreshold
            ? "low"
            : "ok"

      return {
        service: this.service,
        status,
        source: "estimate",
        balance: { currency: baseline.currency, amount: remaining },
        lowThreshold: this.cfg.lowThreshold,
        criticalThreshold: this.cfg.criticalThreshold,
        checkedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        enteredAt: baseline.enteredAt.toISOString(),
        enteredByUserId: baseline.enteredBy,
        notes: [
          baseline.notes,
          `Оценка: $${baseAmount.toFixed(2)} - $${spent.toFixed(2)} за ${days} дн.`,
        ].filter(Boolean).join(" "),
        metadata: {
          baselineAmount: baseAmount,
          spentSinceBaseline: spent,
          daysSinceBaseline: days,
          burnRatePerDay: spent / days,
        },
      }
    } catch (err) {
      return {
        service: this.service,
        status: "error",
        source: "estimate",
        checkedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }
}
