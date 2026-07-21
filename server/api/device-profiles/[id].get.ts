/**
 * GET /api/device-profiles/:id — детали профиля.
 */
import { toDeviceProfileDto } from "~~/server/utils/posting-provider/dto"

export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ["canRead"],
    moduleSlug: "social-upload",
  })

  const id = getRouterParam(event, "id")
  // Tenant isolation: 400 если id невалид, 404 если профиля нет, 403 если не владелец.
  // Admin (canAdmin=true) проходит bypass. Без этого любой юзер с canRead в social-upload
  // мог бы читать чужие профили.
  await requireProfileOwnership(id, user)

  const row = await prisma.deviceProfile.findUnique({
    where: { id: id as string },
    include: {
      socialAccount: { include: { app: { select: { id: true, name: true } } } },
      proxy: { select: { id: true, label: true, status: true, type: true, expectedCountry: true } },
      accounts: {
        include: { socialAccount: { include: { app: { select: { id: true, name: true } } } } },
        orderBy: [{ isPrimary: "desc" }, { addedAt: "asc" }],
      },
    },
  })

  if (!row) {
    throw createError({ statusCode: 404, message: "Indigo-профиль не найден" })
  }

  return { data: toDeviceProfileDto(row) }
})
