import type { ZavodTrendPayload } from "../../shared/types/trend"
import { validateTrendPayload, mapPayloadToTrend, mapPayloadInsight } from "../utils/trend-helpers"

const IMPORT_LIMIT = 100

export default defineEventHandler(async (event) => {
  requireZavodAuth(event)

  const body = await readBody<{ trends?: ZavodTrendPayload[]; items?: ZavodTrendPayload[] }>(event)

  // Принимаем оба формата: { trends: [...] } и { items: [...] } (MarketingCamp)
  const trends = body?.trends ?? body?.items

  if (!trends || !Array.isArray(trends)) {
    throw createError({
      statusCode: 400,
      message: "Body must contain a 'trends' or 'items' array",
    })
  }

  if (trends.length > IMPORT_LIMIT) {
    throw createError({
      statusCode: 400,
      message: `Maximum ${IMPORT_LIMIT} trends per request, received ${trends.length}`,
    })
  }

  let imported = 0
  let skipped = 0
  const errors: Array<{ index: number; externalId?: number; error: string }> = []

  for (let i = 0; i < trends.length; i++) {
    const payload = trends[i]

    const validationError = validateTrendPayload(payload)
    if (validationError) {
      skipped++
      errors.push({ index: i, externalId: payload?.id, error: validationError })
      continue
    }

    try {
      // Upsert App if appId/appName provided
      let appId: number | null = null
      if (payload.appId && payload.appName) {
        const app = await prisma.app.upsert({
          where: { externalId: payload.appId },
          create: {
            externalId: payload.appId,
            name: payload.appName,
          },
          update: {
            name: payload.appName,
          },
        })
        appId = app.id
      }

      const trendData = mapPayloadToTrend(payload)

      // Check if trend was soft-deleted — don't resurrect
      const existingTrend = payload.id
        ? await prisma.trend.findUnique({ where: { externalId: payload.id } })
        : null
      if (existingTrend?.isDeleted) {
        skipped++
        continue
      }

      // Upsert Trend by externalId
      const trend = await prisma.trend.upsert({
        where: { externalId: payload.id },
        create: {
          ...trendData,
          appId,
        },
        update: {
          ...trendData,
          appId,
        },
      })

      // Upsert TrendInsight if insights provided
      if (payload.insights && payload.insights.length > 0) {
        const insightData = mapPayloadInsight(payload.insights[0])
        await prisma.trendInsight.upsert({
          where: { trendId: trend.id },
          create: {
            trendId: trend.id,
            ...insightData,
          },
          update: insightData,
        })
      }

      imported++
    } catch (err) {
      skipped++
      const message = err instanceof Error ? err.message : "Unknown error"
      errors.push({ index: i, externalId: payload.id, error: message })
    }
  }

  return {
    data: { imported, skipped },
    error: errors.length > 0 ? errors : null,
    meta: { total: trends.length },
  }
})
