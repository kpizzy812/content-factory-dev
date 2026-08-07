/**
 * Nitro-плагин Scheduler.
 * setInterval-задачи: загрузка по расписанию, сбор метрик публикаций, снимки
 * подписчиков аккаунтов, watchdog циклов и разбора референсов, плюс воркеры
 * унаследованных зон.
 */

import type { AlertReason } from "../utils/proxy/alert-dedup"
import { collectFollowerSnapshots } from "../utils/metrics-collector"
import { refreshDriveFileMetadata } from "../utils/google-drive/sync"
import { runUploadSchedulerTick } from "../utils/upload-scheduler"
import { releaseStuckUploads } from "../utils/upload-stuck-watchdog"
import {
  isGoogleDriveSchedulerEnabled,
  isPostingWorkerEnabled,
  isProxyHealthCheckEnabled,
} from "../utils/legacy-scheduler"

export default defineNitroPlugin((nitro) => {
  // Глобальный гейт scheduler'ов. Используется тестовой инфраструктурой
  // (.env.test ставит SCHEDULERS_ENABLED=false), чтобы Nitro не плодил
  // фоновые writes в test DB.
  if (process.env.SCHEDULERS_ENABLED === "false") return

  // ENABLE_SOCIAL_POSTING читается внутри тика (utils/upload-scheduler), а не
  // здесь: включение флага должно подхватываться без рестарта процесса.
  // Воркеры унаследованных зон стартуют только внутри включённой зоны.
  const proxyHealthCheckEnabled = isProxyHealthCheckEnabled(process.env)
  const postingWorkerEnabled = isPostingWorkerEnabled(process.env)
  const googleDriveSchedulerEnabled = isGoogleDriveSchedulerEnabled(process.env)

  const uploadIntervalMs = Number(process.env.SCHEDULER_UPLOAD_INTERVAL_MS) || 300000
  const metricsIntervalMs = Number(process.env.SCHEDULER_METRICS_INTERVAL_MS) || 3600000
  // Снимки подписчиков — 6 часов по умолчанию.
  //
  // Почему не чаще: прирост подписчиков делится между роликами, вышедшими к
  // концу отрезка между снимками (social/follower-attribution.ts), и точность
  // привязки упирается не в частоту опроса, а в то, что площадки отдают.
  // YouTube округляет subscriberCount до трёх значащих цифр — у канала на
  // 12 300 подписчиков шаг счётчика сто человек, и почасовые замеры дали бы
  // двадцать четыре одинаковых числа в сутки вместо роста. Instagram отдаёт
  // точное followers_count, но при 200 вызовах в час на пользователя замер
  // профиля соревнуется за квоту со сбором метрик постов, который ходит на
  // КАЖДУЮ публикацию.
  // Почему не реже: четыре точки в сутки дают ролику опорный снимок в день
  // выхода — иначе первый же отрезок склеивает несколько роликов в один и
  // делит их прирост поровну, теряя разницу между ними.
  const followersIntervalMs = Number(process.env.SCHEDULER_FOLLOWERS_INTERVAL_MS) || 21600000
  const cycleCheckIntervalMs = Number(process.env.SCHEDULER_CYCLE_CHECK_INTERVAL_MS) || 21600000
  const cycleTimeoutMs = Number(process.env.SCHEDULER_CYCLE_TIMEOUT_MS) || 1800000
  const referenceWatchdogIntervalMs = Number(process.env.SCHEDULER_REFERENCE_WATCHDOG_INTERVAL_MS) || 300000
  const referenceWatchdogTimeoutMs = Number(process.env.SCHEDULER_REFERENCE_WATCHDOG_TIMEOUT_MS) || 600000
  const proxyHealthIntervalMs = Number(process.env.SCHEDULER_PROXY_HEALTH_INTERVAL_MS) || 14400000
  const proxyHealthStaleMs = Number(process.env.SCHEDULER_PROXY_HEALTH_STALE_MS) || 14400000
  const postingIntervalMs = Number(process.env.SCHEDULER_POSTING_INTERVAL_MS) || 30000
  const driveIntervalMs = Number(process.env.SCHEDULER_GOOGLE_DRIVE_INTERVAL_MS) || 1800000

  const timers: ReturnType<typeof setInterval>[] = []

  // 1. Upload scheduler (по умолчанию 5 мин).
  //    Плановые загрузки, разблокировка после включения ENABLE_SOCIAL_POSTING и
  //    автоповтор упавших — вся логика в utils/upload-scheduler.
  const uploadTimer = trackedInterval('upload', 'Публикации по расписанию', uploadIntervalMs, async () => {
    try {
      // Сначала возвращаем в очередь то, что зависло в pending/uploading после
      // смерти процесса: сам тик такие записи не видит, а ждать оператора
      // бессмысленно — кнопка «Повторить» для них в интерфейсе не показывается.
      const releasedStuck = await releaseStuckUploads()
      if (releasedStuck > 0) {
        await logAgent(
          "scheduler",
          "warn",
          `Upload watchdog: ${releasedStuck} зависших загрузок возвращены в очередь`,
        ).catch(() => {})
      }

      const stats = await runUploadSchedulerTick()
      // skipped входит в условие намеренно: тик, где все кандидаты отсеяны
      // (терминальная ошибка, исчерпан лимит, backoff), — это ровно тот случай,
      // когда автоповтор мёртв, и молчать о нём нельзя.
      const touched = stats.started + stats.blocked + stats.resumed + stats.retried
        + stats.rescheduled + stats.skipped
      if (touched === 0) return

      await logAgent(
        "scheduler",
        stats.blocked > 0 ? "warn" : "info",
        `Upload scheduler: запущено ${stats.started}, возобновлено после включения флага ${stats.resumed}, `
        + `автоповторов ${stats.retried}, пропущено упавших ${stats.skipped}, `
        + `возвращено в расписание ${stats.rescheduled}, `
        + `заблокировано (ENABLE_SOCIAL_POSTING=false) ${stats.blocked}`,
      )
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Неизвестная ошибка"
      await logAgent("scheduler", "error", `Upload scheduler: ${message}`).catch(() => {})
    }
  })
  timers.push(uploadTimer)

  // 2. Metrics collector (по умолчанию 1 час)
  const metricsTimer = trackedInterval('metrics', 'Сбор метрик публикаций', metricsIntervalMs, async () => {
    try {
      const publishedCount = await prisma.upload.count({
        where: { status: "published", platformPostId: { not: null } },
      })

      if (publishedCount === 0) return

      const result = await collectMetrics()
      await logAgent("scheduler", "info", `Метрики собраны: ${result.collected} постов`, {
        collected: result.collected,
        errors: result.errors.length,
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Неизвестная ошибка"
      await logAgent("scheduler", "error", `Metrics collector: ${message}`).catch(() => {})
    }
  })
  timers.push(metricsTimer)

  // 2b. Снимки подписчиков аккаунтов (по умолчанию 6 часов).
  //     Держим рядом со сбором метрик: та же природа (бесплатное чтение
  //     официального API), тот же глобальный гейт SCHEDULERS_ENABLED и такой же
  //     guard «нет данных — нет запросов». Без этой задачи прирост подписчиков
  //     в отчётах пуст: снимков для сравнения просто не появляется.
  const followersTimer = trackedInterval('account-followers', 'Снимки подписчиков аккаунтов', followersIntervalMs, async () => {
    try {
      // Guard перед сетью: на стенде без подключённых по OAuth аккаунтов
      // (и в mock-прогонах) задача не делает ни одного внешнего запроса.
      const measurableCount = await prisma.socialAccount.count({
        where: { status: { not: "revoked" }, accessToken: { not: null } },
      })
      if (measurableCount === 0) return

      const result = await collectFollowerSnapshots()
      if (result.collected === 0 && result.errors.length === 0) return

      await logAgent(
        "scheduler",
        result.errors.length > 0 ? "warn" : "info",
        `Снимки подписчиков: снято ${result.collected}, `
        + `не измеряется официальным API ${result.skipped.length}, ошибок ${result.errors.length}`,
        {
          collected: result.collected,
          skipped: result.skipped.length,
          errors: result.errors.length,
        },
      )
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Неизвестная ошибка"
      await logAgent("scheduler", "error", `Follower snapshots: ${message}`).catch(() => {})
    }
  })
  timers.push(followersTimer)

  // 3. Cycle watchdog (по умолчанию 6 часов)
  const cycleTimer = trackedInterval('cycle-watchdog', 'Watchdog циклов', cycleCheckIntervalMs, async () => {
    try {
      const threshold = new Date(Date.now() - cycleTimeoutMs)

      const stuckCycles = await prisma.productionCycle.findMany({
        where: {
          status: "running",
          mode: "legacy",
          startedAt: { lt: threshold },
        },
        select: { id: true },
      })

      for (const cycle of stuckCycles) {
        await prisma.productionCycle.update({
          where: { id: cycle.id },
          data: {
            status: "failed",
            errorMessage: "Цикл превысил допустимое время выполнения",
            completedAt: new Date(),
          },
        })
        await logAgent("scheduler", "warn", `Цикл #${cycle.id} отмечен как failed (таймаут)`, {
          cycleId: cycle.id,
        }, cycle.id)
      }

      if (stuckCycles.length > 0) {
        await logAgent("scheduler", "info", `Watchdog: ${stuckCycles.length} зависших циклов отмечены как failed`)
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Неизвестная ошибка"
      await logAgent("scheduler", "error", `Cycle watchdog: ${message}`).catch(() => {})
    }
  })
  timers.push(cycleTimer)

  // 4. Reference analysis watchdog (по умолчанию 5 мин, таймаут идеи 10 мин)
  const referenceWatchdogTimer = trackedInterval('reference-watchdog', 'Watchdog разбора референсов', referenceWatchdogIntervalMs, async () => {
    try {
      const threshold = new Date(Date.now() - referenceWatchdogTimeoutMs)

      const stuck = await prisma.idea.updateMany({
        where: {
          referenceStatus: "running",
          updatedAt: { lt: threshold },
        },
        data: {
          referenceStatus: "failed",
          errorMessage: "Анализ прерван (таймаут). Запустите повторно.",
          analysisProgress: null,
        },
      })

      if (stuck.count > 0) {
        await logAgent("scheduler", "warn", `Reference watchdog: ${stuck.count} зависших идей помечены как failed`)
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Неизвестная ошибка"
      await logAgent("scheduler", "error", `Reference watchdog: ${message}`).catch(() => {})
    }
  })
  timers.push(referenceWatchdogTimer)

  // 5. Proxy health checks (по умолчанию 4 часа). Отключается PROXY_HEALTH_CHECK_ENABLED=false.
  if (proxyHealthCheckEnabled) {
    const proxyHealthTimer = trackedInterval('proxy-health', 'Проверка прокси', proxyHealthIntervalMs, async () => {
      try {
        const threshold = new Date(Date.now() - proxyHealthStaleMs)

        const candidates = await prisma.proxy.findMany({
          where: {
            status: { not: "expired" },
            OR: [
              { lastCheckedAt: null },
              { lastCheckedAt: { lt: threshold } },
            ],
          },
          select: {
            id: true,
            label: true,
            consecutiveFailures: true,
            alertHistory: true,
          },
          take: 50,
        })

        if (candidates.length === 0) return

        let leakCount = 0
        let deadCount = 0
        let suppressedCount = 0

        for (const proxy of candidates) {
          try {
            const result = await runProxyHealthCheck(proxy.id, "scheduled")
            const reason: AlertReason | null = result.isLeaking
              ? "leak"
              : !result.httpProbeOk && proxy.consecutiveFailures + 1 >= 3
                ? "consecutive_failures_3"
                : null

            if (reason) {
              if (!shouldSendAlert(proxy.alertHistory, reason)) {
                suppressedCount += 1
                await logAgent(
                  "scheduler",
                  "info",
                  `Proxy ${proxy.label}: алёрт ${reason} подавлен (quiet period)`,
                ).catch(() => {})
              } else {
                if (reason === "leak") leakCount += 1
                else deadCount += 1

                const title =
                  reason === "leak"
                    ? `Прокси ${proxy.label} подозревается на утечку IP`
                    : `Прокси ${proxy.label} помечен dead (3+ провала подряд)`

                await sendTelegramAlert(
                  "critical_error",
                  title,
                  sanitizeForLog({
                    proxyId: proxy.id,
                    label: proxy.label,
                    errorCategory: result.errorCategory,
                    errorMessage: result.errorMessage,
                  }) as string,
                ).catch(() => {})

                await prisma.proxy
                  .update({
                    where: { id: proxy.id },
                    data: {
                      alertHistory: recordAlert(
                        proxy.alertHistory,
                        reason,
                      ) as never,
                    },
                  })
                  .catch(() => {})
              }
            }
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Неизвестная ошибка"
            await logAgent(
              "scheduler",
              "error",
              `Proxy health check ${proxy.label}: ${message}`,
            ).catch(() => {})
          }

          // Не DDoS'им probe service: 5с пауза между проверками
          await new Promise((resolve) => setTimeout(resolve, 5_000))
        }

        await logAgent(
          "scheduler",
          "info",
          `Proxy health: проверено ${candidates.length}, leak=${leakCount}, dead=${deadCount}, suppressed=${suppressedCount}`,
        )
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Неизвестная ошибка"
        await logAgent("scheduler", "error", `Proxy health scheduler: ${message}`).catch(() => {})
      }
    })
    timers.push(proxyHealthTimer)
  }

  // 6. Posting jobs worker (по умолчанию 30 сек). Отключается POSTING_WORKER_ENABLED=false.
  if (postingWorkerEnabled) {
    const postingTimer = trackedInterval('posting', 'Воркер публикаций', postingIntervalMs, () => {
      postingWorkerTick().catch(async (err: unknown) => {
        const message = err instanceof Error ? err.message : "Неизвестная ошибка"
        await logAgent("scheduler", "error", `Posting worker tick: ${message}`).catch(() => {})
      })
    })
    timers.push(postingTimer)
  }

  // 7. Google Drive sync (по умолчанию 30 мин). Отключается GOOGLE_DRIVE_SCHEDULER_ENABLED=false.
  if (googleDriveSchedulerEnabled) {
    const driveTimer = trackedInterval('drive-sync', 'Синхронизация Google Drive', driveIntervalMs, async () => {
      try {
        // Guard: если нет активных Drive credentials — никаких запросов.
        const driveCredentialsCount = await prisma.pipelineCredential.count({
          where: {
            revokedAt: null,
            metadata: { path: ["kind"], equals: "google_drive_service_account" },
          },
        })
        if (driveCredentialsCount === 0) return

        // Этап 1: refresh metadata + retry failed download.
        // Полный folder watch — Этап 2 (требует watched folders модели).
        const stale = await prisma.driveFile.findMany({
          where: {
            OR: [
              { syncStatus: "detected", lastSyncedAt: { lt: new Date(Date.now() - 30 * 60_000) } },
              { syncStatus: "failed", lastSyncedAt: { lt: new Date(Date.now() - 60 * 60_000) } },
            ],
          },
          take: 10,
          orderBy: { lastSyncedAt: "asc" },
        })
        let refreshed = 0
        for (const file of stale) {
          try {
            await refreshDriveFileMetadata(file.id)
            refreshed++
          } catch {
            // не падаем — просто пропускаем
          }
        }
        if (refreshed > 0) {
          await logAgent("scheduler", "info", `Drive scheduler: refreshed ${refreshed} files`).catch(() => {})
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Неизвестная ошибка"
        await logAgent("scheduler", "error", `Drive scheduler: ${message}`).catch(() => {})
      }
    })
    timers.push(driveTimer)
  }

  nitro.hooks.hook("close", () => {
    for (const timer of timers) {
      clearInterval(timer)
    }
  })
})
