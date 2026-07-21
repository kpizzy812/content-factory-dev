/**
 * PUT /api/accounts/:id/style
 * Обновляет (или создаёт) style profile аккаунта.
 * Создаёт revision с diff.
 */
import type { AccountStyleProfileData } from '~~/shared/types/account-style'
import { defaultAccountStyleProfileData } from '~~/shared/types/account-style'
import { computeStyleStatus } from '~~/server/utils/account-style-context'

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canWrite'], moduleSlug: 'social-upload' })

  const id = Number(getRouterParam(event, 'id'))
  if (!id || id <= 0) {
    throw createError({ statusCode: 400, message: 'Некорректный ID аккаунта' })
  }

  const account = await prisma.socialAccount.findUnique({
    where: { id },
    select: { id: true },
  })
  if (!account) {
    throw createError({ statusCode: 404, message: 'Аккаунт не найден' })
  }

  const body = await readBody<{
    data: Partial<AccountStyleProfileData>
    changeSummary?: string
  }>(event)

  if (!body.data || typeof body.data !== 'object') {
    throw createError({ statusCode: 400, message: 'Поле data обязательно' })
  }

  // Загружаем текущий профиль
  const existing = await prisma.accountStyleProfile.findUnique({
    where: { socialAccountId: id },
  })

  const previousData = existing
    ? (existing.data as unknown as AccountStyleProfileData)
    : defaultAccountStyleProfileData

  // Мержим
  const mergedData = deepMergeStyle(previousData, body.data)
  const newStatus = computeStyleStatus(mergedData)
  const newVersion = existing ? existing.version + 1 : 1

  // Определяем какие секции изменились
  const changedSections = detectChangedSections(previousData, body.data)

  // Upsert профиль
  const profile = await prisma.accountStyleProfile.upsert({
    where: { socialAccountId: id },
    create: {
      socialAccountId: id,
      version: newVersion,
      data: mergedData as never,
      status: newStatus,
    },
    update: {
      version: newVersion,
      data: mergedData as never,
      status: newStatus,
      updatedAt: new Date(),
    },
  })

  // Создаём revision
  if (changedSections.length > 0) {
    await prisma.accountStyleRevision.create({
      data: {
        profileId: profile.id,
        version: newVersion,
        changeType: 'manual',
        changeSummary: body.changeSummary || `Обновлены секции: ${changedSections.join(', ')}`,
        changedSections,
        previousData: extractChangedData(previousData, changedSections) as never,
        newData: extractChangedData(mergedData, changedSections) as never,
        accepted: true,
        appliedById: null, // TODO: из сессии
      },
    })
  }

  return {
    data: {
      id: profile.id,
      socialAccountId: profile.socialAccountId,
      version: profile.version,
      status: profile.status,
      data: mergedData,
    },
  }
})

function deepMergeStyle(
  base: AccountStyleProfileData,
  partial: Partial<AccountStyleProfileData>,
): AccountStyleProfileData {
  const result = structuredClone(base)
  for (const key of Object.keys(partial) as Array<keyof AccountStyleProfileData>) {
    const val = partial[key]
    if (val === undefined || val === null) continue
    if (typeof val === 'object' && !Array.isArray(val)) {
      (result as unknown as Record<string, unknown>)[key] = {
        ...(base[key] as unknown as Record<string, unknown>),
        ...(val as unknown as Record<string, unknown>),
      }
    }
    else {
      (result as unknown as Record<string, unknown>)[key] = val
    }
  }
  return result
}

function detectChangedSections(
  prev: AccountStyleProfileData,
  update: Partial<AccountStyleProfileData>,
): string[] {
  const sections: string[] = []
  for (const key of Object.keys(update) as Array<keyof AccountStyleProfileData>) {
    if (update[key] !== undefined) {
      sections.push(key)
    }
  }
  return sections
}

function extractChangedData(
  data: AccountStyleProfileData,
  sections: string[],
): Partial<AccountStyleProfileData> {
  const result: Record<string, unknown> = {}
  for (const section of sections) {
    if (section in data) {
      result[section] = (data as unknown as Record<string, unknown>)[section]
    }
  }
  return result as Partial<AccountStyleProfileData>
}
