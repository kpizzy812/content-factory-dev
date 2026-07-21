/**
 * Test-only cleanup для E2E. TRUNCATE всех таблиц public кроме _prisma_migrations.
 *
 * Гейт идентичный _test/login.post.ts. Дополнительно проверяем, что
 * DATABASE_URL — это test-БД (порт 5436, имя содержит "tests"), это защита
 * от случайного запуска против dev/prod.
 *
 * Используется из Playwright между тестами.
 */
export default defineEventHandler(async (event) => {
  if (process.env.NODE_ENV === "production") {
    throw createError({ statusCode: 404, message: "Not found" })
  }
  if (process.env.TEST_AUTH_BYPASS !== "1") {
    throw createError({ statusCode: 404, message: "Not found" })
  }
  const headerToken = getHeader(event, "x-test-auth-token")
  if (!headerToken || headerToken !== process.env.TEST_AUTH_TOKEN) {
    throw createError({ statusCode: 403, message: "Test bypass token mismatch" })
  }

  // Sanity на DATABASE_URL — обрубаем возможность чистить чужую БД.
  const raw = process.env.DATABASE_URL ?? ""
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw createError({ statusCode: 500, message: "DATABASE_URL невалиден" })
  }
  const dbName = url.pathname.replace(/^\//, "")
  if (url.port !== "5436" || !dbName.toLowerCase().includes("tests")) {
    throw createError({
      statusCode: 500,
      message: `BLOCKED: DATABASE_URL не выглядит как test DB (port=${url.port}, db=${dbName})`,
    })
  }

  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename != '_prisma_migrations'
  `
  if (tables.length === 0) {
    return { ok: true, truncated: 0 }
  }

  const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ")
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`)

  return { ok: true, truncated: tables.length }
})
