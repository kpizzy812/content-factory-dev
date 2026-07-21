/**
 * PUT /api/admin/balances/[service]
 * Обновить вручную введённый balance для сервиса (admin only).
 *
 * Принимает: amount, currency?, notes?, metadata?
 * Сервис должен быть в KNOWN_SERVICES — иначе 400.
 */

import { invalidateBalanceCache } from "~~/server/utils/balance/aggregator"
import { isKnownService } from "~~/server/utils/balance/config"
import { z } from "zod"

const BodySchema = z.object({
  amount: z.number().min(0).max(1_000_000),
  currency: z.string().min(2).max(8).optional(),
  notes: z.string().max(500).nullish(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export default defineEventHandler(async (event) => {
  await requirePermission(event, "canAdmin")

  const service = getRouterParam(event, "service")
  if (!service || !isKnownService(service)) {
    throw createError({
      statusCode: 400,
      statusMessage: `Неизвестный сервис: ${service}. Доступные: fal.ai, anthropic, apify, indigo, nodemaven, mubert`,
    })
  }

  const body = await readBody(event)
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: `Некорректные данные: ${parsed.error.issues.map(i => i.message).join(", ")}`,
    })
  }

  const session = await getUserSession(event)
  const userId = (session?.user as { id?: number } | undefined)?.id ?? null

  const entry = await prisma.serviceBalanceEntry.upsert({
    where: { service },
    create: {
      service,
      amount: parsed.data.amount,
      currency: parsed.data.currency ?? "USD",
      metadata: (parsed.data.metadata as never) ?? undefined,
      notes: parsed.data.notes ?? null,
      enteredBy: userId,
    },
    update: {
      amount: parsed.data.amount,
      currency: parsed.data.currency ?? undefined,
      metadata: (parsed.data.metadata as never) ?? undefined,
      notes: parsed.data.notes ?? null,
      enteredBy: userId,
    },
  })

  invalidateBalanceCache()

  return {
    data: {
      id: entry.id,
      service: entry.service,
      amount: Number(entry.amount),
      currency: entry.currency,
      notes: entry.notes,
      enteredAt: entry.enteredAt.toISOString(),
      enteredBy: entry.enteredBy,
    },
  }
})
