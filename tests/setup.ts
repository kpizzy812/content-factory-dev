/**
 * Vitest setup-файл. Подключается через vitest.config.ts → setupFiles.
 *
 * Что делает:
 *   1. Загружает переменные из .env.test (dotenv).
 *   2. Safety guards — БЛОКИРУЕТ прогон, если DATABASE_URL не выглядит как
 *      test-БД (порт 5436 + имя содержит "tests"), либо если NODE_ENV=production.
 *   3. beforeAll — sanity ping на БД.
 *   4. afterEach — TRUNCATE всех таблиц public (кроме _prisma_migrations).
 *
 * Миграции применяются один раз глобально в tests/global-setup.ts.
 */
import dotenv from "dotenv"
import { afterEach, beforeAll } from "vitest"

dotenv.config({ path: ".env.test" })

// PR5B: код-дефолт FSM теперь ON для YouTube. В тестах фиксируем дефолт OFF, чтобы
// тесты, не проверяющие сам flip, оставались на legacy детерминированно. Тесты ON
// явно ставят YOUTUBE_POSTING_FSM_ENABLED="true" (override), а posting-fsm-config.spec
// удаляет обе переменные для герметичной проверки code_default.
process.env.YOUTUBE_POSTING_FSM_DEFAULT = "false"

// ── Safety guards ──────────────────────────────────────────────────────────
function assertSafeTestEnv(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("[tests] BLOCKED: NODE_ENV=production — тесты не должны запускаться в production-окружении")
  }

  const raw = process.env.DATABASE_URL
  if (!raw) {
    throw new Error("[tests] BLOCKED: DATABASE_URL не задан. Проверь .env.test")
  }

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`[tests] BLOCKED: DATABASE_URL не парсится как URL: ${raw}`)
  }

  const port = url.port
  const dbName = url.pathname.replace(/^\//, "")
  const isTestPort = port === "5436"
  const hasTestsInName = dbName.toLowerCase().includes("tests")

  if (!isTestPort || !hasTestsInName) {
    throw new Error(
      `[tests] BLOCKED: DATABASE_URL не выглядит как test DB ` +
      `(port=${port || "<empty>"}, db=${dbName || "<empty>"}). ` +
      `Ожидалось port=5436 и подстрока "tests" в имени БД. ` +
      `Это защита от случайного запуска тестов на prod/dev-БД.`
    )
  }
}

assertSafeTestEnv()

// Импорт Prisma ПОСЛЕ guards: иначе клиент успеет открыть пул на неправильную БД.
const { prisma } = await import("../server/utils/prisma")

beforeAll(async () => {
  // Sanity-ping. Миграции уже применены global-setup'ом.
  await prisma.$queryRaw`SELECT 1`
})

afterEach(async () => {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename != '_prisma_migrations'
  `
  if (tables.length === 0) return

  const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ")
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`)
})
