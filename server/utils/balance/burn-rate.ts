/**
 * balance_v2 burn-rate: расчёт среднего расхода в день по сервису.
 *
 * Aggregate `AiAuditLog.costUsd` за окно (default 7 дней) где service=X.
 * Если есть baseline — прогнозирует дату исчерпания (projectedZeroDate).
 *
 * Defensive: при ошибке БД возвращает нули, не throw.
 * Используется aggregator'ом для обогащения `ServiceBalance.metadata.burnRate`.
 */

export interface BurnRate {
  dailyAvgUsd: number
  windowDays: number
  projectedZeroDate?: string
}

const DAY_MS = 86_400_000

/**
 * Считает burn-rate по AiAuditLog за последние windowDays дней.
 *
 * @param service   — service tag (anthropic, fal.ai, mubert и т.д.)
 * @param baselineAmount — текущий остаток. Если > 0 и dailyAvg > 0, считаем projectedZeroDate.
 * @param windowDays — окно агрегации в днях, default 7
 */
export async function computeBurnRate(
  service: string,
  baselineAmount: number | null,
  windowDays = 7,
): Promise<BurnRate> {
  try {
    const since = new Date(Date.now() - windowDays * DAY_MS)
    const agg = await prisma.aiAuditLog.aggregate({
      where: {
        service,
        costUsd: { not: null },
        createdAt: { gte: since },
      },
      _sum: { costUsd: true },
    })

    const totalUsd = Number(agg._sum.costUsd ?? 0)
    const dailyAvgUsd = totalUsd > 0 ? totalUsd / windowDays : 0

    let projectedZeroDate: string | undefined
    if (baselineAmount && baselineAmount > 0 && dailyAvgUsd > 0) {
      const daysLeft = baselineAmount / dailyAvgUsd
      if (Number.isFinite(daysLeft)) {
        projectedZeroDate = new Date(Date.now() + daysLeft * DAY_MS).toISOString()
      }
    }

    return { dailyAvgUsd, windowDays, projectedZeroDate }
  } catch (err) {
    console.warn(
      `[burn-rate] computeBurnRate failed (${service}): ${err instanceof Error ? err.message : String(err)}`,
    )
    return { dailyAvgUsd: 0, windowDays }
  }
}
