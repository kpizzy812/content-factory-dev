/**
 * Helpers для тестового bypass авторизации.
 *
 * createTestUser   — создаёт ZavodUser с дефолтным admin-набором прав.
 * createTestApp    — добавляет UserAppAssignment к юзеру (для тестов гранулярного
 *                    appAccess через новую модель).
 * authHeaders(id)  — генерирует заголовки для test-bypass'а в getAuthContext.
 *
 * Bypass работает только если:
 *   - NODE_ENV !== "production"
 *   - process.env.TEST_AUTH_BYPASS === "1"
 *   - в запросе есть x-test-auth-token === TEST_AUTH_TOKEN
 *   - в запросе есть валидный x-test-user-id, найденный в БД и активный.
 */
import { prisma } from "../../server/utils/prisma"

export interface CreateTestUserOverrides {
  email?: string
  externalId?: number
  rolePreset?: "admin" | "producer" | "operator" | "analyst" | "observer"
  canRead?: boolean
  canWrite?: boolean
  canCreate?: boolean
  canDelete?: boolean
  canApprove?: boolean
  canRunAgent?: boolean
  canApplyChanges?: boolean
  canAdmin?: boolean
  moduleAccess?: string[]
  isActive?: boolean
  // Назначения приложений: список для создания UserAppAssignment записей.
  appAssignments?: Array<{
    appId: number
    appName?: string
    accessLevel?: string
    accounts?: string
    geos?: string
    permissions?: string
  }>
}

const ALL_MODULES = [
  "trendwatcher",
  "script-generator",
  "video-generator",
  "social-upload",
  "analytics",
  "pipeline",
]

export async function createTestUser(overrides: CreateTestUserOverrides = {}) {
  const seed = Math.floor(Math.random() * 1_000_000_000)
  const user = await prisma.zavodUser.create({
    data: {
      externalId: overrides.externalId ?? seed,
      email: overrides.email ?? `test-${seed}-${Date.now()}@example.test`,
      rolePreset: overrides.rolePreset ?? "admin",
      canRead: overrides.canRead ?? true,
      canWrite: overrides.canWrite ?? true,
      canCreate: overrides.canCreate ?? true,
      canDelete: overrides.canDelete ?? true,
      canApprove: overrides.canApprove ?? true,
      canRunAgent: overrides.canRunAgent ?? true,
      canApplyChanges: overrides.canApplyChanges ?? true,
      canAdmin: overrides.canAdmin ?? true,
      moduleAccess: overrides.moduleAccess ?? ALL_MODULES,
      isActive: overrides.isActive ?? true,
    },
  })

  if (overrides.appAssignments && overrides.appAssignments.length > 0) {
    await prisma.userAppAssignment.createMany({
      data: overrides.appAssignments.map((a) => ({
        userId: user.id,
        appId: a.appId,
        appName: a.appName ?? `app-${a.appId}`,
        accessLevel: a.accessLevel ?? "full",
        accounts: a.accounts ?? "all",
        geos: a.geos ?? "all",
        permissions: a.permissions ?? "full",
      })),
      skipDuplicates: true,
    })
  }

  return user
}

export function authHeaders(userId: number): Record<string, string> {
  const token = process.env.TEST_AUTH_TOKEN
  if (!token) {
    throw new Error(
      "[tests/helpers/auth] TEST_AUTH_TOKEN не задан в окружении. Проверь .env.test."
    )
  }
  return {
    "x-test-auth-token": token,
    "x-test-user-id": String(userId),
  }
}
