/**
 * GET /api/admin/balances
 * Возвращает текущие балансы всех известных сервисов с metadata для admin таблицы.
 */

import { fetchAllBalances } from "~~/server/utils/balance/aggregator"
import { KNOWN_SERVICES } from "~~/server/utils/balance/config"

export default defineEventHandler(async (event) => {
  await requirePermission(event, "canAdmin")

  const balances = await fetchAllBalances({ skipCache: true })

  return {
    data: {
      services: KNOWN_SERVICES.map((cfg) => {
        const b = balances.find(x => x.service === cfg.key)
        return {
          key: cfg.key,
          label: cfg.label,
          defaultCurrency: cfg.defaultCurrency,
          lowThreshold: cfg.lowThreshold,
          criticalThreshold: cfg.criticalThreshold,
          dashboardHint: cfg.dashboardHint,
          balance: b ?? null,
        }
      }),
    },
  }
})
