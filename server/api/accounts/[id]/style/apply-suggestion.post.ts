/**
 * POST /api/accounts/:id/style/apply-suggestion
 * Применяет выбранные AI-рекомендации к style profile.
 * Человек выбирает какие именно рекомендации принять.
 */
import type {
  AccountStyleProfileData,
  StyleRecommendation,
} from '~~/shared/types/account-style'
import { defaultAccountStyleProfileData } from '~~/shared/types/account-style'
import { computeStyleStatus } from '~~/server/utils/account-style-context'

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canWrite'], moduleSlug: 'social-upload' })

  const id = Number(getRouterParam(event, 'id'))
  if (!id || id <= 0) {
    throw createError({ statusCode: 400, message: 'Некорректный ID аккаунта' })
  }

  const body = await readBody<{
    recommendations: StyleRecommendation[]
    revisionId?: number
  }>(event)

  if (!Array.isArray(body.recommendations) || body.recommendations.length === 0) {
    throw createError({ statusCode: 400, message: 'Нужно указать хотя бы одну рекомендацию' })
  }

  const account = await prisma.socialAccount.findUnique({
    where: { id },
    select: { id: true },
  })
  if (!account) {
    throw createError({ statusCode: 404, message: 'Аккаунт не найден' })
  }

  // Загружаем профиль
  const existing = await prisma.accountStyleProfile.findUnique({
    where: { socialAccountId: id },
  })

  const currentData = existing
    ? (existing.data as unknown as AccountStyleProfileData)
    : structuredClone(defaultAccountStyleProfileData)

  // Применяем рекомендации
  const updatedData = structuredClone(currentData)
  const changedSections: string[] = []

  for (const rec of body.recommendations) {
    const section = rec.section as keyof AccountStyleProfileData
    if (!(section in updatedData)) continue

    const sectionData = updatedData[section]
    if (typeof sectionData === 'object' && !Array.isArray(sectionData) && sectionData !== null) {
      const obj = sectionData as unknown as Record<string, unknown>
      if (rec.field in obj) {
        obj[rec.field] = rec.suggestedValue
        if (!changedSections.includes(section)) changedSections.push(section)
      }
    }
    else if (section === 'experimentationDegree' || section === 'consistencyStrictness') {
      (updatedData as unknown as Record<string, unknown>)[section] = rec.suggestedValue
      if (!changedSections.includes(section)) changedSections.push(section)
    }
  }

  const newStatus = computeStyleStatus(updatedData)
  const newVersion = existing ? existing.version + 1 : 1

  // Upsert профиль
  const profile = await prisma.accountStyleProfile.upsert({
    where: { socialAccountId: id },
    create: {
      socialAccountId: id,
      version: newVersion,
      data: updatedData as never,
      status: newStatus,
    },
    update: {
      version: newVersion,
      data: updatedData as never,
      status: newStatus,
      updatedAt: new Date(),
    },
  })

  // Создаём revision
  await prisma.accountStyleRevision.create({
    data: {
      profileId: profile.id,
      version: newVersion,
      changeType: 'ai_suggestion',
      changeSummary: `Применены AI-рекомендации: ${changedSections.join(', ')}`,
      changedSections,
      previousData: extractSections(currentData, changedSections) as never,
      newData: extractSections(updatedData, changedSections) as never,
      accepted: true,
      appliedById: null,
    },
  })

  // Если есть revisionId оригинального suggestion — помечаем accepted
  if (body.revisionId) {
    await prisma.accountStyleRevision.update({
      where: { id: body.revisionId },
      data: { accepted: true },
    }).catch(() => {})
  }

  return {
    data: {
      id: profile.id,
      version: profile.version,
      status: newStatus,
      data: updatedData,
      appliedCount: changedSections.length,
    },
  }
})

function extractSections(
  data: AccountStyleProfileData,
  sections: string[],
): Partial<AccountStyleProfileData> {
  const result: Record<string, unknown> = {}
  for (const s of sections) {
    if (s in data) result[s] = (data as unknown as Record<string, unknown>)[s]
  }
  return result as Partial<AccountStyleProfileData>
}
