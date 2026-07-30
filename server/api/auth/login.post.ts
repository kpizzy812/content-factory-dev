import { devExternalId, verifyDevAuth } from '../../utils/dev-auth'
import { authenticateLocalUser } from '../../utils/auth/local-login'
import { resolveAuthProvider } from '../../utils/auth/provider'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ email?: string; password?: string }>(event)

  if (!body?.email || !body?.password) {
    throw createError({
      statusCode: 400,
      message: "Email и пароль обязательны",
    })
  }

  const email = body.email.trim().toLowerCase()

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw createError({
      statusCode: 400,
      message: "Некорректный формат email",
    })
  }

  if (body.password.length < 8) {
    throw createError({
      statusCode: 400,
      message: "Пароль должен содержать минимум 8 символов",
    })
  }

  if (verifyDevAuth(email, body.password, process.env)) {
    const now = new Date()
    const devUser = await prisma.zavodUser.upsert({
      where: { email },
      create: {
        externalId: devExternalId(email), email, name: 'ContentFactory', surname: 'Dev', rolePreset: 'admin',
        canRead: true, canWrite: true, canCreate: true, canDelete: true, canApprove: true,
        canRunAgent: true, canApplyChanges: true, canAdmin: true,
        moduleAccess: ['trendwatcher', 'script-generator', 'video-generator', 'social-upload', 'analytics', 'pipeline'],
        isActive: true, lastLoginAt: now,
      },
      update: {
        rolePreset: 'admin', canRead: true, canWrite: true, canCreate: true, canDelete: true,
        canApprove: true, canRunAgent: true, canApplyChanges: true, canAdmin: true,
        isActive: true, lastLoginAt: now,
      },
    })
    const sessionUser = {
      id: devUser.id, externalId: devUser.externalId, email: devUser.email,
      name: devUser.name, surname: devUser.surname, rolePreset: devUser.rolePreset,
    }
    await setUserSession(event, { user: sessionUser })
    return { user: sessionUser }
  }

  // Основной путь: ContentFactory логинит сам. MarketingCamp ниже — только для
  // установок, где родительская платформа действительно есть.
  if (resolveAuthProvider(process.env) === 'local') {
    const localUser = await authenticateLocalUser(email, body.password)
    const sessionUser = {
      id: localUser.id, externalId: localUser.externalId, email: localUser.email,
      name: localUser.name, surname: localUser.surname, rolePreset: localUser.rolePreset,
    }
    await setUserSession(event, { user: sessionUser })
    return { user: sessionUser }
  }

  const result = await validateExternalUser(email, body.password)

  if (!result.valid) {
    throw createError({
      statusCode: 401,
      message: result.error || "Аккаунт не найден на родительской платформе",
    })
  }

  const mcUser = result.user

  // MarketingCamp — единственный источник истины для прав. Полный RBAC payload
  // (permissions блок + modules + apps) обязателен. Раньше fallback на mapMcRoleToPreset
  // ставил observer когда presetName был кастомный ("Полный доступ" вместо "admin"),
  // что приводило к 403 даже у админа. Теперь fail-fast чтобы конфигурация не текла молча.
  if (!mcUser.permissions) {
    throw createError({
      statusCode: 502,
      message: "MarketingCamp не вернул блок permissions — обновите версию родительской платформы",
    })
  }

  const rolePreset = derivePresetFromPermissions(
    mcUser.rolePresetName ?? null,
    mcUser.permissions,
  )

  // moduleAccess — пустой массив значит "ничего не назначено в MC". canAdmin даст bypass
  // на сервере для модулей и приложений (как в MC), не-админ увидит только то что назначено.
  const moduleAccess = Array.isArray(mcUser.modules) ? mcUser.modules : []
  const apps = Array.isArray(mcUser.apps) ? mcUser.apps : []

  const rbacPayload = {
    rolePreset,
    roleName: mcUser.roleName ?? null,
    rolePresetName: mcUser.rolePresetName ?? null,
    canRead: mcUser.permissions.canRead,
    canWrite: mcUser.permissions.canWrite,
    canCreate: mcUser.permissions.canCreate,
    canDelete: mcUser.permissions.canDelete,
    canApprove: mcUser.permissions.canApprove,
    canRunAgent: mcUser.permissions.canRunAgent,
    canApplyChanges: mcUser.permissions.canApplyChanges,
    canAdmin: mcUser.permissions.canAdmin,
    moduleAccess,
  }

  const zavodUser = await prisma.zavodUser.upsert({
    where: { externalId: mcUser.id },
    create: {
      externalId: mcUser.id,
      email: mcUser.email,
      name: mcUser.name,
      surname: mcUser.surname,
      ...rbacPayload,
      lastLoginAt: new Date(),
    },
    update: {
      email: mcUser.email,
      name: mcUser.name,
      surname: mcUser.surname,
      ...rbacPayload,
      lastLoginAt: new Date(),
    },
  })

  // Синхронизируем UserAppAssignment записи: удаляем все старые и создаём заново из
  // MC payload. Это гарантирует что отозванные в MC apps мгновенно пропадают в ZC при
  // следующем логине, и не остаётся "осиротевших" назначений.
  await prisma.$transaction([
    prisma.userAppAssignment.deleteMany({ where: { userId: zavodUser.id } }),
    ...(apps.length > 0
      ? [
          prisma.userAppAssignment.createMany({
            data: apps.map((a) => ({
              userId: zavodUser.id,
              appId: a.appId,
              appName: a.appName,
              accessLevel: a.accessLevel,
              accounts: a.accounts,
              geos: a.geos,
              permissions: a.permissions,
            })),
            skipDuplicates: true,
          }),
        ]
      : []),
  ])

  await setUserSession(event, {
    user: {
      id: zavodUser.id,
      externalId: zavodUser.externalId,
      email: zavodUser.email,
      name: zavodUser.name,
      surname: zavodUser.surname,
      rolePreset: zavodUser.rolePreset,
    },
  })

  return {
    user: {
      id: zavodUser.id,
      externalId: zavodUser.externalId,
      email: zavodUser.email,
      name: zavodUser.name,
      surname: zavodUser.surname,
      rolePreset: zavodUser.rolePreset,
    },
  }
})
