/**
 * POST /api/trendwatcher/discover
 * Разведка аккаунтов ниши по ключевому слову.
 *
 * Возвращает самые крупные открытые профили с их аудиторией — из них
 * собирается список ключевых слов для профиля парсинга. Сам профиль не
 * создаётся: выбор, за кем следить, остаётся за оператором.
 */

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canRunAgent"],
    moduleSlug: "trendwatcher",
  })

  const body = await readBody<{ keyword?: string; limit?: number }>(event)

  const keyword = typeof body?.keyword === "string" ? body.keyword.trim() : ""
  if (!keyword) {
    throw createError({
      statusCode: 400,
      message: "Поле 'keyword' обязательно",
    })
  }

  const limit = typeof body?.limit === "number" && body.limit > 0 ? body.limit : 20

  const accounts = await discoverNicheAccounts(keyword, limit)

  return {
    data: {
      keyword,
      accounts,
      // Готовый список для поля keywords профиля парсинга.
      keywords: accounts.map((a) => a.keyword),
    },
  }
})
