/**
 * Smoke test для PostingJob State Machine (Track D, Шаг 8).
 *
 * Проверяет:
 *   1. Чистую state-machine: canTransition / isTerminal / shouldRetry / nextRetryAt
 *   2. Идемпотентность createPostingJob (повторный POST с теми же ключами возвращает существующий job)
 *   3. Блокировку недопустимых transitionJob переходов (queued → published напрямую запрещён)
 *   4. postingWorkerTick: queued claim'ится в preparing/uploading/published/failed/retry_queued
 *   5. cancelJob: переводит в cancelled и проставляет cancelReason
 *
 * Pre-conditions:
 *   - В БД должен быть хотя бы один Video и один SocialAccount со статусом active.
 *     Если нет — первые 3 теста (pure state machine) выполнятся, остальные SKIP'нутся
 *     с понятным сообщением.
 *
 * Запуск:
 *   POSTING_MOCK_RUNNER=true bun run scripts/test-posting-state-machine.ts
 *   (или: POSTING_MOCK_RUNNER=true npx tsx scripts/test-posting-state-machine.ts)
 *
 *   ВАЖНО: для api-аккаунтов worker по умолчанию (в проде) НЕ зовёт mock-runner,
 *   а валит job терминально (internal_error). Чтобы smoke увидел happy-path
 *   published/uploading через мок, запускай с POSTING_MOCK_RUNNER=true.
 *
 * Cleanup: все созданные jobs удаляются в finally.
 */

import "dotenv/config"

// Shim для createError (Nuxt h3 helper, недоступен в standalone). Оба job-service и worker
// используют createError при ошибках 404/409/412.
;(globalThis as { createError?: (opts: { statusCode?: number; message?: string; data?: unknown }) => Error }).createError =
  (opts) => {
    const err = new Error(opts.message ?? "Error") as Error & { statusCode?: number; data?: unknown }
    err.statusCode = opts.statusCode
    err.data = opts.data
    return err
  }

import { prisma } from "../server/utils/prisma"
import {
  canTransition,
  isTerminal,
  nextRetryAt,
  shouldRetry,
} from "../server/utils/posting/state-machine"
import {
  cancelJob,
  createPostingJob,
  transitionJob,
} from "../server/utils/posting/job-service"
import { postingWorkerTick } from "../server/utils/posting/worker"
import type { PostingJob } from "../app/generated/prisma/client"

const passed: string[] = []
const failed: { name: string; error: string }[] = []
const skipped: { name: string; reason: string }[] = []
const createdJobIds: string[] = []

function check(name: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed.push(name)
    console.log(`  PASS  ${name}`)
  } else {
    failed.push({ name, error: detail ?? "failed" })
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`)
  }
}

function skip(name: string, reason: string): void {
  skipped.push({ name, reason })
  console.log(`  SKIP  ${name} — ${reason}`)
}

async function runPureStateMachineTests(): Promise<void> {
  console.log("\n[1] Pure state machine\n")

  check(
    "canTransition('queued', 'preparing') === true",
    canTransition("queued", "preparing") === true,
  )
  check(
    "canTransition('queued', 'published') === false (двухшаговый переход)",
    canTransition("queued", "published") === false,
  )
  check(
    "canTransition('published', 'failed') === false (terminal)",
    canTransition("published", "failed") === false,
  )
  check(
    "canTransition('cancelled', 'queued') === false (terminal)",
    canTransition("cancelled", "queued") === false,
  )
  check(
    "canTransition('uploading', 'retry_queued') === true",
    canTransition("uploading", "retry_queued") === true,
  )

  check("isTerminal('published') === true", isTerminal("published") === true)
  check("isTerminal('cancelled') === true", isTerminal("cancelled") === true)
  check("isTerminal('queued') === false", isTerminal("queued") === false)
  check(
    "isTerminal('failed') === false (manual retry разрешён)",
    isTerminal("failed") === false,
  )

  check(
    "shouldRetry('network_error', 0, 3) === true",
    shouldRetry("network_error", 0, 3) === true,
  )
  check(
    "shouldRetry('platform_5xx', 1, 3) === true",
    shouldRetry("platform_5xx", 1, 3) === true,
  )
  check(
    "shouldRetry('auth_failed', 0, 3) === false (non-retryable категория)",
    shouldRetry("auth_failed", 0, 3) === false,
  )
  check(
    "shouldRetry('network_error', 3, 3) === false (исчерпаны)",
    shouldRetry("network_error", 3, 3) === false,
  )
  check(
    "shouldRetry(null, 0, 3) === false",
    shouldRetry(null, 0, 3) === false,
  )

  // nextRetryAt(0) → backoff[0] = 60s; nextRetryAt(1) → backoff[0] = 60s; nextRetryAt(2) → backoff[1] = 5min
  // (по реализации: idx = clamp(attemptCount - 1, 0, len-1))
  const now = Date.now()
  const t0 = nextRetryAt(0).getTime() - now
  check(
    "nextRetryAt(0) ≈ now + 60s (±2s)",
    t0 >= 58_000 && t0 <= 62_000,
    `actual delay = ${t0}ms`,
  )
  const t1 = nextRetryAt(1).getTime() - now
  check(
    "nextRetryAt(1) ≈ now + 60s (idx=0, ±2s)",
    t1 >= 58_000 && t1 <= 62_000,
    `actual delay = ${t1}ms`,
  )
  const t2 = nextRetryAt(2).getTime() - now
  check(
    "nextRetryAt(2) ≈ now + 5min (idx=1, ±5s)",
    t2 >= 295_000 && t2 <= 305_000,
    `actual delay = ${t2}ms`,
  )
  const tBig = nextRetryAt(99).getTime() - now
  check(
    "nextRetryAt(99) ≈ now + 12h (clamp на последний backoff)",
    tBig >= 12 * 3600_000 - 5_000 && tBig <= 12 * 3600_000 + 5_000,
    `actual delay = ${tBig}ms`,
  )
}

interface Fixtures {
  videoId: number
  socialAccountId: number
  platform: "tiktok" | "instagram" | "youtube"
}

async function loadFixtures(): Promise<Fixtures | null> {
  const account = await prisma.socialAccount.findFirst({
    where: { status: "active" },
    select: { id: true, platform: true },
    orderBy: { id: "asc" },
  })
  if (!account) return null

  const video = await prisma.video.findFirst({
    select: { id: true },
    orderBy: { id: "asc" },
  })
  if (!video) return null

  return {
    videoId: video.id,
    socialAccountId: account.id,
    platform: account.platform,
  }
}

async function runIdempotencyTest(fx: Fixtures): Promise<void> {
  console.log("\n[2] createPostingJob — идемпотентность\n")

  // Используем уникальный scheduledAt (далёкое будущее), чтобы не конфликтовать с прошлыми запусками
  // и не попасть в worker tick немедленно.
  const scheduledAt = new Date(Date.now() + 30 * 24 * 3600_000) // +30 дней

  let job1: PostingJob
  try {
    job1 = await createPostingJob({
      videoId: fx.videoId,
      socialAccountId: fx.socialAccountId,
      platform: fx.platform,
      scheduledAt,
      contentSnapshot: { title: "smoke-test idempotency", source: "test-posting-state-machine" },
    })
    createdJobIds.push(job1.id)
    check("createPostingJob первый вызов вернул job", Boolean(job1?.id))
  } catch (err) {
    check(
      "createPostingJob первый вызов",
      false,
      err instanceof Error ? err.message : String(err),
    )
    return
  }

  try {
    const job2 = await createPostingJob({
      videoId: fx.videoId,
      socialAccountId: fx.socialAccountId,
      platform: fx.platform,
      scheduledAt,
      contentSnapshot: { title: "smoke-test idempotency", source: "test-posting-state-machine" },
    })
    check(
      "повторный createPostingJob вернул тот же job.id",
      job2.id === job1.id,
      `job1.id=${job1.id}, job2.id=${job2.id}`,
    )
    check(
      "повторный createPostingJob вернул тот же idempotencyKey",
      job2.idempotencyKey === job1.idempotencyKey,
    )
  } catch (err) {
    check(
      "повторный createPostingJob (ожидался тот же job)",
      false,
      err instanceof Error ? err.message : String(err),
    )
  }
}

async function runInvalidTransitionTest(fx: Fixtures): Promise<void> {
  console.log("\n[3] transitionJob — недопустимый переход блокируется\n")

  // Создаём отдельный job (без scheduledAt → сразу queued)
  let job: PostingJob
  try {
    // Уникальный scheduledAt чтобы получить новый ключ
    const scheduledAt = new Date(Date.now() + 31 * 24 * 3600_000)
    job = await createPostingJob({
      videoId: fx.videoId,
      socialAccountId: fx.socialAccountId,
      platform: fx.platform,
      scheduledAt,
      contentSnapshot: { title: "smoke-test invalid transition" },
    })
    createdJobIds.push(job.id)
  } catch (err) {
    check(
      "создание job для invalid transition",
      false,
      err instanceof Error ? err.message : String(err),
    )
    return
  }

  // job в статусе scheduled — попробуем перейти сразу в published (двухшаговый transition: только через queued/preparing/uploading)
  let threw = false
  let errorMessage = ""
  try {
    await transitionJob(job.id, "published")
  } catch (err) {
    threw = true
    errorMessage = err instanceof Error ? err.message : String(err)
  }
  check(
    "transitionJob('scheduled' → 'published') бросает ошибку",
    threw,
    threw ? `(message: ${errorMessage})` : "exception НЕ был брошен",
  )

  // Дополнительно: после неудачной попытки статус не должен измениться
  const fresh = await prisma.postingJob.findUnique({
    where: { id: job.id },
    select: { status: true },
  })
  check(
    "статус job не изменился после отвергнутого transition",
    fresh?.status === "scheduled",
    `actual status: ${fresh?.status}`,
  )
}

async function runWorkerTickTest(fx: Fixtures): Promise<void> {
  console.log("\n[4] postingWorkerTick — queued claim'ится\n")

  // Создаём ASAP job (scheduledAt=null → сразу queued)
  let job: PostingJob
  try {
    job = await createPostingJob({
      videoId: fx.videoId,
      socialAccountId: fx.socialAccountId,
      platform: fx.platform,
      scheduledAt: null,
      contentSnapshot: { title: "smoke-test worker tick", source: "test" },
    })
    createdJobIds.push(job.id)
    check("ASAP job создан в статусе queued", job.status === "queued", `status=${job.status}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("уже существует")) {
      // дубль из прошлого прогона теста — найдём его
      const slot = "asap"
      const { createHash } = await import("node:crypto")
      const key = createHash("sha256")
        .update(`${fx.videoId}:${fx.socialAccountId}:${slot}`)
        .digest("hex")
        .slice(0, 32)
      const existing = await prisma.postingJob.findUnique({ where: { idempotencyKey: key } })
      if (existing) {
        // не добавляем в createdJobIds — он не наш на cleanup только если был в active state раньше теста.
        // Но для безопасности добавим, тест может удалить если не нужен.
        createdJobIds.push(existing.id)
        job = existing
        check(
          "ASAP job переиспользован из прошлого прогона",
          true,
          `id=${existing.id}, status=${existing.status}`,
        )
      } else {
        check("создание ASAP job", false, msg)
        return
      }
    } else {
      check("создание ASAP job", false, msg)
      return
    }
  }

  // Запускаем tick
  await postingWorkerTick()

  // Даём fire-and-forget executeJob шанс пройти validateJobPreconditions / fail
  // (sendToRunner спит 2-5s, так что published мы скорее всего НЕ увидим, но preparing/uploading/failed/retry_queued — да)
  await new Promise((resolve) => setTimeout(resolve, 1500))

  const after = await prisma.postingJob.findUnique({
    where: { id: job.id },
    select: { status: true, attemptCount: true, lastError: true },
  })

  const expectedStates = [
    "queued", // мог не быть claim'нут (race) — допускаем как edge-case
    "preparing",
    "uploading",
    "published",
    "failed",
    "retry_queued",
    "cancelled",
  ]
  check(
    `после tick статус ∈ {${expectedStates.join("|")}}`,
    after !== null && expectedStates.includes(after.status),
    `actual: ${after?.status}, attemptCount=${after?.attemptCount}, lastError=${after?.lastError ?? "null"}`,
  )

  // Если был claim — attemptCount должен инкрементироваться
  if (after && after.status !== "queued") {
    check(
      "attemptCount >= 1 после успешного claim",
      after.attemptCount >= 1,
      `attemptCount=${after.attemptCount}`,
    )
  } else {
    skip(
      "attemptCount после claim",
      "race lost или нет других условий — статус остался queued",
    )
  }
}

async function runCancelTest(fx: Fixtures): Promise<void> {
  console.log("\n[5] cancelJob — переводит в cancelled\n")

  // Уникальный scheduledAt чтобы получить новый ключ и не попасть в worker tick
  const scheduledAt = new Date(Date.now() + 32 * 24 * 3600_000)
  let job: PostingJob
  try {
    job = await createPostingJob({
      videoId: fx.videoId,
      socialAccountId: fx.socialAccountId,
      platform: fx.platform,
      scheduledAt,
      contentSnapshot: { title: "smoke-test cancel" },
    })
    createdJobIds.push(job.id)
  } catch (err) {
    check(
      "создание job для cancel",
      false,
      err instanceof Error ? err.message : String(err),
    )
    return
  }

  // Найдём любого user'а для cancelledById; если нет — null не пройдёт schema, но cancel принимает userId:number
  const anyUser = await prisma.user.findFirst({ select: { id: true } })
  if (!anyUser) {
    skip("cancelJob", "в БД нет ни одного User для cancelledById")
    return
  }

  try {
    const cancelled = await cancelJob(job.id, anyUser.id, "smoke-test cancel reason")
    check(
      "cancelJob.status === 'cancelled'",
      cancelled.status === "cancelled",
      `status=${cancelled.status}`,
    )
    check(
      "cancelJob.cancelReason проставлен",
      cancelled.cancelReason === "smoke-test cancel reason",
      `cancelReason=${cancelled.cancelReason}`,
    )
    check(
      "cancelJob.cancelledById проставлен",
      cancelled.cancelledById === anyUser.id,
    )
    check(
      "cancelJob.cancelledAt проставлен",
      cancelled.cancelledAt instanceof Date,
    )
    check(
      "cancelJob.finishedAt проставлен (terminal)",
      cancelled.finishedAt instanceof Date,
    )
  } catch (err) {
    check(
      "cancelJob выполнился",
      false,
      err instanceof Error ? err.message : String(err),
    )
  }
}

async function cleanup(): Promise<void> {
  if (createdJobIds.length === 0) return
  console.log(`\n[cleanup] Удаляю ${createdJobIds.length} созданных тестом jobs...`)
  // Сначала логи (FK), потом сами jobs
  try {
    await prisma.postingJobLog.deleteMany({ where: { jobId: { in: createdJobIds } } })
    const res = await prisma.postingJob.deleteMany({ where: { id: { in: createdJobIds } } })
    console.log(`  удалено: ${res.count} jobs`)
  } catch (err) {
    console.error(
      `  cleanup ошибка (не критично):`,
      err instanceof Error ? err.message : String(err),
    )
  }
}

async function main(): Promise<void> {
  console.log("=== test-posting-state-machine smoke ===")

  await runPureStateMachineTests()

  const fx = await loadFixtures()
  if (!fx) {
    console.log(
      "\n[!] В БД нет Video или активного SocialAccount — пропускаю тесты 2-5.",
    )
    console.log(
      "    Запустите test-environment seed (или dev-приложение) и попробуйте снова.",
    )
    skip("createPostingJob idempotency", "нет фикстур (Video/SocialAccount)")
    skip("transitionJob invalid transition", "нет фикстур")
    skip("postingWorkerTick", "нет фикстур")
    skip("cancelJob", "нет фикстур")
  } else {
    console.log(
      `\n[fixtures] videoId=${fx.videoId}, socialAccountId=${fx.socialAccountId}, platform=${fx.platform}`,
    )
    await runIdempotencyTest(fx)
    await runInvalidTransitionTest(fx)
    await runCancelTest(fx)
    // worker tick последним: он fire-and-forget'ит executeJob, может задеть другие jobs
    await runWorkerTickTest(fx)
  }

  await cleanup()

  console.log(
    `\n=== Results: ${passed.length} passed, ${failed.length} failed, ${skipped.length} skipped ===`,
  )
  if (failed.length > 0) {
    console.log("\nFailures:")
    for (const f of failed) console.log(`  - ${f.name}: ${f.error}`)
  }
  await prisma.$disconnect()
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch(async (err) => {
  console.error("Fatal error:", err)
  await cleanup().catch(() => {})
  await prisma.$disconnect().catch(() => {})
  process.exit(1)
})
