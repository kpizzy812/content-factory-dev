/**
 * DELETE /api/device-profiles/:id
 * Soft-delete: помечает запись syncStatus='archived'. List endpoint фильтрует
 * archived.
 *
 * R5a (Этап 2 миграции DuoPlus): best-effort remote-delete в провайдере (старый
 * client.deleteProfile + token-manager) удалён — он опирался на Indigo-слой,
 * выпиливаемый в R5b. Remote-delete под DuoPlus — Этап 3. Запись остаётся в БД
 * (audit / возможное восстановление); sync from remote — no-op до Этапа 3.
 */
export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ["canDelete"],
    moduleSlug: "social-upload",
  })

  const id = getRouterParam(event, "id")
  // Tenant isolation — без этого любой юзер с canDelete в social-upload мог бы
  // удалить чужой профиль. Admin bypass для canAdmin.
  await requireProfileOwnership(id, user)

  await prisma.deviceProfile.update({
    where: { id },
    data: {
      syncStatus: "archived",
      lastSyncedAt: new Date(),
      // lastSyncError используем как tombstone marker для audit/debug
      lastSyncError: `archived_by_user_${user.id}_at_${new Date().toISOString()}`,
    },
  })

  return { data: { deleted: true, remoteDeleted: false, remoteWarning: null } }
})
