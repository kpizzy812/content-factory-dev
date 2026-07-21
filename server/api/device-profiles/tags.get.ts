/**
 * GET /api/device-profiles/tags
 * Возвращает distinct список тегов из всех IndigoProfile.tags.
 *
 * Дизайн: вместо отдельной таблицы `IndigoProfileTag` (как у Pipeline), используем
 * distinct unnest из IndigoProfile.tags (String[]). Это zero-migration решение,
 * минусы: нельзя создать тег "пустым" в пул без применения. Для нашего UX это
 * приемлемо — оператор почти всегда сразу применяет тег при создании.
 *
 * id = name (нет numeric id), фронт это нормально обрабатывает.
 */
export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canRead"],
    moduleSlug: "social-upload",
  })

  // Distinct unnest через raw query (Prisma не имеет нативной поддержки unnest)
  const rows = await prisma.$queryRaw<Array<{ name: string }>>`
    SELECT DISTINCT unnest(tags) AS name
    FROM "IndigoProfile"
    WHERE tags IS NOT NULL
    ORDER BY name ASC
  `

  return { data: rows.map((r) => ({ id: r.name, name: r.name })) }
})
