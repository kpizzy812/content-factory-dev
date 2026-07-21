import type { H3Event } from "h3"
import type { ZavodUser, UserAppAssignment } from "../../app/generated/prisma/client"

type Permission =
  | "canRead"
  | "canWrite"
  | "canCreate"
  | "canDelete"
  | "canApprove"
  | "canRunAgent"
  | "canApplyChanges"
  | "canAdmin"

interface ScopedAccessOptions {
  permissions?: Permission[]
  moduleSlug?: string
  appId?: number
  // Опциональная проверка доступа к конкретному Google Ads / соцсеть аккаунту в рамках
  // appId. Если account не назначен в UserAppAssignment.accounts ("all" или CSV), 403.
  accountName?: string
}

export type AuthUser = ZavodUser & { appAssignments: UserAppAssignment[] }

/**
 * Загружает ZavodUser с appAssignments из БД по сессии.
 * Кэширует результат в event.context._zavodUser для повторных вызовов.
 */
export async function getAuthContext(event: H3Event): Promise<AuthUser> {
  if (event.context._zavodUser) {
    return event.context._zavodUser as AuthUser
  }

  // Test-only bypass. Двойной гейт: NODE_ENV !== production И флаг TEST_AUTH_BYPASS=1.
  // Дополнительная проверка — секретный токен в заголовке x-test-auth-token,
  // совпадающий с TEST_AUTH_TOKEN. Без обоих условий bypass игнорируется,
  // и поток идёт в обычный requireUserSession ниже.
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.TEST_AUTH_BYPASS === "1"
  ) {
    const headerToken = getHeader(event, "x-test-auth-token")
    if (headerToken && headerToken === process.env.TEST_AUTH_TOKEN) {
      const userIdRaw = getHeader(event, "x-test-user-id")
      const userId = userIdRaw ? Number(userIdRaw) : NaN
      if (Number.isFinite(userId) && userId > 0) {
        const u = await prisma.zavodUser.findUnique({
          where: { id: userId },
          include: { appAssignments: true },
        })
        if (u && u.isActive) {
          event.context._zavodUser = u
          return u
        }
      }
    }
  }

  const session = await requireUserSession(event)
  const userId = session.user?.id

  if (!userId) {
    throw createError({
      statusCode: 401,
      message: "Сессия не содержит идентификатор пользователя",
    })
  }

  const user = await prisma.zavodUser.findUnique({
    where: { id: userId },
    include: { appAssignments: true },
  })

  if (!user) {
    throw createError({
      statusCode: 401,
      message: "Пользователь не найден в системе",
    })
  }

  if (!user.isActive) {
    throw createError({
      statusCode: 403,
      message: "Аккаунт деактивирован",
    })
  }

  event.context._zavodUser = user
  return user
}

/**
 * Проверяет наличие указанных boolean-прав у пользователя.
 *
 * ВАЖНО: admin bypass НЕТ. canAdmin не пропускает другие проверки автоматически —
 * каждый из 8 флагов (canRead/canWrite/.../canAdmin) проверяется независимо. Это
 * зеркалит философию MarketingCamp (server/utils/permissions.ts:requirePermission)
 * и позволяет создавать гибкие роли типа "админ-наблюдатель" с canAdmin=true но
 * canDelete=false. Если в MC роль настроена как полный админ — все 8 флагов придут
 * true и пользователь будет иметь полный доступ.
 *
 * Bypass через canAdmin есть только для модулей и приложений (см. ниже),
 * чтобы админ всегда видел все модули и приложения для управления ими.
 */
export async function requirePermission(
  event: H3Event,
  ...permissions: Permission[]
): Promise<AuthUser> {
  const user = await getAuthContext(event)

  for (const perm of permissions) {
    if (!user[perm]) {
      throw createError({
        statusCode: 403,
        message: `Недостаточно прав: требуется ${perm}`,
      })
    }
  }

  return user
}

/**
 * Проверяет доступ к модулю по слагу.
 * Администраторы (canAdmin) имеют доступ ко всем модулям — для управления ими.
 */
export async function requireModuleAccess(
  event: H3Event,
  moduleSlug: string,
): Promise<AuthUser> {
  const user = await getAuthContext(event)

  if (user.canAdmin) return user

  if (!user.moduleAccess.includes(moduleSlug)) {
    throw createError({
      statusCode: 403,
      message: `Нет доступа к модулю: ${moduleSlug}`,
    })
  }

  return user
}

export async function hasModuleAccess(
  event: H3Event,
  moduleSlug: string,
): Promise<boolean> {
  const user = await getAuthContext(event)
  if (user.canAdmin) return true
  return user.moduleAccess.includes(moduleSlug)
}

/**
 * Проверяет доступ к приложению по ID через UserAppAssignment.
 * accessLevel='none' блокирует доступ. Админы (canAdmin) имеют доступ ко всем
 * приложениям — для управления ими.
 */
export async function requireAppAccess(
  event: H3Event,
  appId: number,
): Promise<AuthUser> {
  const user = await getAuthContext(event)

  if (user.canAdmin) return user

  const assignment = user.appAssignments.find((a) => a.appId === appId)
  if (!assignment || assignment.accessLevel === "none") {
    throw createError({
      statusCode: 403,
      message: "Нет доступа к данному приложению",
    })
  }

  return user
}

export async function hasAppAccess(
  event: H3Event,
  appId: number,
): Promise<boolean> {
  const user = await getAuthContext(event)
  if (user.canAdmin) return true
  const assignment = user.appAssignments.find((a) => a.appId === appId)
  return !!assignment && assignment.accessLevel !== "none"
}

/**
 * Проверяет доступ к конкретному Google Ads / соцсеть аккаунту внутри приложения.
 * Парсит UserAppAssignment.accounts ("all" или CSV). Админы видят всё.
 */
export async function hasAccountAccess(
  event: H3Event,
  appId: number,
  accountName: string,
): Promise<boolean> {
  const user = await getAuthContext(event)
  if (user.canAdmin) return true

  const assignment = user.appAssignments.find((a) => a.appId === appId)
  if (!assignment || assignment.accessLevel === "none") return false

  const accountsField = assignment.accounts.trim()
  if (accountsField === "all" || accountsField === "") return true

  const allowed = accountsField.split(",").map((s) => s.trim()).filter(Boolean)
  return allowed.includes(accountName)
}

/**
 * Возвращает список доступных appId или null (все приложения).
 * null означает неограниченный доступ (canAdmin).
 */
export async function getAccessibleAppIds(
  event: H3Event,
): Promise<number[] | null> {
  const user = await getAuthContext(event)
  if (user.canAdmin) return null

  return user.appAssignments
    .filter((a) => a.accessLevel !== "none")
    .map((a) => a.appId)
}

/**
 * Комбинированный guard: проверяет права, модуль, приложение и (опционально)
 * конкретный account за один вызов.
 *
 * Семантика admin bypass такая же как в отдельных функциях: для permissions bypass
 * НЕТ (каждый флаг проверяется независимо), для modules / apps / accounts — ЕСТЬ.
 */
export async function requireScopedAccess(
  event: H3Event,
  opts: ScopedAccessOptions,
): Promise<AuthUser> {
  const user = await getAuthContext(event)

  if (opts.permissions) {
    for (const perm of opts.permissions) {
      if (!user[perm]) {
        throw createError({
          statusCode: 403,
          message: `Недостаточно прав: требуется ${perm}`,
        })
      }
    }
  }

  if (user.canAdmin) return user

  if (opts.moduleSlug && !user.moduleAccess.includes(opts.moduleSlug)) {
    throw createError({
      statusCode: 403,
      message: `Нет доступа к модулю: ${opts.moduleSlug}`,
    })
  }

  if (opts.appId !== undefined) {
    const assignment = user.appAssignments.find((a) => a.appId === opts.appId)
    if (!assignment || assignment.accessLevel === "none") {
      throw createError({
        statusCode: 403,
        message: "Нет доступа к данному приложению",
      })
    }

    if (opts.accountName) {
      const accountsField = assignment.accounts.trim()
      if (accountsField !== "all" && accountsField !== "") {
        const allowed = accountsField.split(",").map((s) => s.trim()).filter(Boolean)
        if (!allowed.includes(opts.accountName)) {
          throw createError({
            statusCode: 403,
            message: `Нет доступа к аккаунту: ${opts.accountName}`,
          })
        }
      }
    }
  }

  return user
}
