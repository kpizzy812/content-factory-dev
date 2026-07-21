/**
 * Vitest globalSetup. Запускается ОДИН раз перед всем прогоном (не перед каждым suite).
 * Применяет prisma migrate deploy к test-БД.
 *
 * ВАЖНО: используется prisma migrate deploy (НЕ prisma db push) — это
 * единственный безопасный способ применить миграции без потери данных.
 */
import { execSync } from "node:child_process"
import dotenv from "dotenv"

export default async function globalSetup(): Promise<void> {
  dotenv.config({ path: ".env.test" })

  // Дублируем safety check (на случай прямого вызова tests/global-setup.ts).
  const raw = process.env.DATABASE_URL ?? ""
  if (!raw.includes(":5436/") || !raw.toLowerCase().includes("tests")) {
    throw new Error(
      `[global-setup] BLOCKED: DATABASE_URL не выглядит как test DB: ${raw}`
    )
  }

  // eslint-disable-next-line no-console
  console.log("[global-setup] Применяем миграции к test-БД…")
  execSync("bunx prisma migrate deploy", {
    stdio: "inherit",
    env: process.env as NodeJS.ProcessEnv,
  })
  // eslint-disable-next-line no-console
  console.log("[global-setup] Миграции применены.")
}
