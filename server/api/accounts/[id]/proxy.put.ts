/**
 * PUT /api/accounts/:id/proxy
 * Привязка/отвязка прокси для социального аккаунта.
 */
import { assertOneToOneForBrowserAutomation } from "~~/server/utils/accounts/one-to-one-guard"

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canWrite"],
    moduleSlug: "social-upload",
  })

  const id = Number(getRouterParam(event, "id"))
  if (!id || Number.isNaN(id) || id <= 0) {
    throw createError({ statusCode: 400, message: "Неверный ID аккаунта" })
  }

  const body = await readBody<{ proxyId?: string | null }>(event)
  if (!body || typeof body !== "object" || !("proxyId" in body)) {
    throw createError({ statusCode: 400, message: "Поле 'proxyId' обязательно (string|null)" })
  }

  const proxyId = body.proxyId
  if (proxyId !== null && (typeof proxyId !== "string" || !proxyId.trim())) {
    throw createError({
      statusCode: 400,
      message: "Поле 'proxyId' должно быть строкой или null",
    })
  }

  const account = await prisma.socialAccount.findUnique({
    where: { id },
    select: { id: true, postingMethod: true, deviceProfileId: true },
  })
  if (!account) {
    throw createError({ statusCode: 404, message: "Аккаунт не найден" })
  }

  if (proxyId) {
    const proxy = await prisma.proxy.findUnique({
      where: { id: proxyId },
      select: { id: true },
    })
    if (!proxy) {
      throw createError({ statusCode: 404, message: "Прокси не найден" })
    }

    // 1:1:1 (W4 полный): для browser_automation-аккаунта проверяем ОБА ресурса —
    // новый прокси И актуальный indigo-профиль аккаунта — чтобы смена прокси
    // ловила нарушение и по профилю. api-аккаунты не ограничены (легитимный шеринг).
    if (account.postingMethod === "browser_automation") {
      await assertOneToOneForBrowserAutomation(id, {
        proxyId,
        deviceProfileId: account.deviceProfileId,
      })
    }
  }

  const updated = await prisma.socialAccount.update({
    where: { id },
    data: { proxyId: proxyId ?? null },
    select: { id: true, proxyId: true },
  })

  return { data: updated }
})
