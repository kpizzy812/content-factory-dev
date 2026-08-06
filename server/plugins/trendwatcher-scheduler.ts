/**
 * Nitro-плагин: планировщик запусков Trendwatcher по расписанию.
 * Проверяет профили с активным расписанием каждые 60 секунд.
 * Также выполняет watchdog: помечает зависшие запуски как failed.
 */

const CHECK_INTERVAL_MS = 60_000
const RUN_TIMEOUT_MS = 10 * 60 * 1000 // 10 минут — макс. время жизни запуска

export default defineNitroPlugin((nitro) => {
  // Гейт scheduler'ов (тестовая инфраструктура). См. .env.test.
  if (process.env.SCHEDULERS_ENABLED === "false") return

  const timer = trackedInterval('trendwatcher', 'Расписания парсинга трендов', CHECK_INTERVAL_MS, async () => {
    try {
      await checkScheduledProfiles()
      await watchdogStuckRuns()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Неизвестная ошибка"
      await logAgent("trendwatcher-scheduler", "error", `Scheduler error: ${msg}`).catch(() => {})
    }
  })

  nitro.hooks.hook("close", () => {
    clearInterval(timer)
  })
})

/**
 * Проверяет профили с активным расписанием и запускает те, у которых наступило время.
 */
async function checkScheduledProfiles(): Promise<void> {
  const now = new Date()

  const dueProfiles = await prisma.trendwatcherProfile.findMany({
    where: {
      scheduleEnabled: true,
      enabled: true,
      scheduleCron: { not: null },
      scheduleNextRunAt: { lte: now },
    },
    take: 10,
  })

  const invalidStatuses = ["actor_not_found", "token_missing", "profile_invalid", "actor_input_invalid"]

  for (const profile of dueProfiles) {
    // Не запускаем, если уже есть активный запуск
    if (hasActiveRun(profile.id)) continue
    if (profile.keywords.length === 0) continue

    // Не запускаем профиль с известной невалидной конфигурацией
    if (profile.validationStatus && invalidStatuses.includes(profile.validationStatus)) {
      await logAgent("trendwatcher-scheduler", "warn", `Пропущен профиль "${profile.name}" (#${profile.id}): конфигурация невалидна (${profile.validationStatus}: ${profile.validationSummary ?? "нет деталей"})`)

      // Сдвигаем scheduleNextRunAt, чтобы не спамить каждые 60 секунд
      const nextRunAt = profile.scheduleCron
        ? getNextRunTime(profile.scheduleCron, now)
        : null
      await prisma.trendwatcherProfile.update({
        where: { id: profile.id },
        data: { scheduleNextRunAt: nextRunAt },
      }).catch(() => {})
      continue
    }

    try {
      const run = await prisma.trendwatcherRun.create({
        data: {
          profileId: profile.id,
          status: "pending",
          triggerType: "scheduled",
          initiatedBy: "scheduler",
          sourceType: profile.actorId,
        },
      })

      // Fire-and-forget
      executeTrendwatcherRun({ runId: run.id, profileId: profile.id }).catch(() => {})

      // Вычисляем следующий запуск
      const nextRunAt = profile.scheduleCron
        ? getNextRunTime(profile.scheduleCron, now)
        : null

      await prisma.trendwatcherProfile.update({
        where: { id: profile.id },
        data: {
          scheduleLastRunAt: now,
          scheduleNextRunAt: nextRunAt,
        },
      })

      await logAgent("trendwatcher-scheduler", "info", `Запланированный запуск профиля "${profile.name}" (#${profile.id})`, {
        profileId: profile.id,
        runId: run.id,
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Ошибка"
      await logAgent("trendwatcher-scheduler", "error", `Ошибка запуска по расписанию #${profile.id}: ${msg}`).catch(() => {})
    }
  }
}

/**
 * Watchdog: помечает зависшие запуски как failed.
 */
async function watchdogStuckRuns(): Promise<void> {
  const threshold = new Date(Date.now() - RUN_TIMEOUT_MS)

  const stuckRuns = await prisma.trendwatcherRun.findMany({
    where: {
      status: { in: ["pending", "starting", "running", "importing"] },
      startedAt: { lt: threshold },
    },
    select: { id: true, profileId: true },
  })

  for (const run of stuckRuns) {
    await prisma.trendwatcherRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        failureReason: "Таймаут: запуск превысил допустимое время выполнения (10 мин)",
        errorCategory: "watchdog_failed",
        errorStep: "running",
        errorSummary: "Watchdog: запуск завис и был принудительно остановлен (>10 мин)",
        canRetry: true,
        needsProfileFix: false,
        completedAt: new Date(),
      },
    })

    await prisma.trendwatcherRunLog.create({
      data: {
        runId: run.id,
        level: "error",
        message: "Watchdog: запуск помечен как failed из-за таймаута",
        step: "watchdog",
      },
    })

    await logAgent("trendwatcher-scheduler", "warn", `Watchdog: запуск #${run.id} помечен как failed (таймаут)`)
  }
}
