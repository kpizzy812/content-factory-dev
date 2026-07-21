/**
 * GET /api/accounts/:id/credentials-meta
 * Возвращает не-секретные мета-поля аккаунта для UI редактирования
 * (форма пред-загрузки birthDate / registrationSource / warmupStatus / notes / т.п.).
 *
 * НИКОГДА не возвращает шифрованные поля (loginEmail/loginPassword/recoveryEmail/
 * recoveryPhone/twoFASecret/accessToken/refreshToken) — для них используется
 * /credentials/reveal.post с audit-log в SecretAccessLog.
 */
export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canRead"],
    moduleSlug: "social-upload",
  })

  const id = Number(getRouterParam(event, "id"))
  if (!id || Number.isNaN(id) || id <= 0) {
    throw createError({ statusCode: 400, message: "Неверный ID аккаунта" })
  }

  const account = await prisma.socialAccount.findUnique({
    where: { id },
    select: {
      id: true,
      birthDate: true,
      registrationSource: true,
      warmupStatus: true,
      lastWarmupAt: true,
      totalPostsPublished: true,
      lastPostedAt: true,
      notes: true,
      deviceProfileId: true,
      postingMethod: true,
      // Computed flags (не возвращаем содержимое)
      loginEmail: true,
      loginPassword: true,
      recoveryEmail: true,
      recoveryPhone: true,
      twoFASecret: true,
    },
  })
  if (!account) {
    throw createError({ statusCode: 404, message: "Аккаунт не найден" })
  }

  return {
    data: {
      id: account.id,
      birthDate: account.birthDate?.toISOString() ?? null,
      registrationSource: account.registrationSource,
      warmupStatus: account.warmupStatus,
      postingMethod: account.postingMethod,
      lastWarmupAt: account.lastWarmupAt?.toISOString() ?? null,
      totalPostsPublished: account.totalPostsPublished,
      lastPostedAt: account.lastPostedAt?.toISOString() ?? null,
      notes: account.notes,
      hasLoginEmail: Boolean(account.loginEmail),
      hasLoginPassword: Boolean(account.loginPassword),
      hasRecoveryEmail: Boolean(account.recoveryEmail),
      hasRecoveryPhone: Boolean(account.recoveryPhone),
      hasTwoFASecret: Boolean(account.twoFASecret),
      hasLoginCredentials: Boolean(account.loginEmail && account.loginPassword),
      hasDeviceProfile: Boolean(account.deviceProfileId),
    },
  }
})
