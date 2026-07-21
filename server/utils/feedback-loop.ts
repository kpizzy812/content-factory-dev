/**
 * Обратная связь: пропагация инсайтов из успешных постов
 * обратно в TrendwatcherProfile для улучшения парсинга.
 */

/**
 * Извлекает patterns и hooks из инсайтов успешного поста
 * и добавляет уникальные keywords в связанные TrendwatcherProfile.
 */
export async function propagateInsightsToProfiles(uploadId: number): Promise<void> {
  const upload = await prisma.upload.findUnique({
    where: { id: uploadId },
    include: {
      video: {
        include: {
          scenario: {
            include: {
              trend: {
                include: { insights: true },
              },
            },
          },
        },
      },
    },
  })

  if (!upload?.video?.scenario?.trend) return

  const trend = upload.video.scenario.trend
  if (!trend.appId || trend.insights.length === 0) return

  // Собираем ключевые слова из patterns и hooks
  const newKeywords: string[] = []
  for (const insight of trend.insights) {
    newKeywords.push(...insight.patterns)
    newKeywords.push(...insight.hooks)
  }

  const uniqueNew = [...new Set(
    newKeywords
      .map((k) => k.toLowerCase().trim())
      .filter((k) => k.length >= 3 && k.length <= 50),
  )]

  if (uniqueNew.length === 0) return

  // Находим активные профили для данного app
  const profiles = await prisma.trendwatcherProfile.findMany({
    where: { appId: trend.appId, enabled: true },
  })

  for (const profile of profiles) {
    const existingSet = new Set(profile.keywords.map((k) => k.toLowerCase()))
    const toAdd = uniqueNew.filter((k) => !existingSet.has(k))

    if (toAdd.length === 0) continue

    // Ограничиваем общее количество keywords
    const merged = [...profile.keywords, ...toAdd].slice(0, 100)

    await prisma.trendwatcherProfile.update({
      where: { id: profile.id },
      data: { keywords: merged },
    })
  }
}
