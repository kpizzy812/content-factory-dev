/**
 * Read-only проверка нарушителей идеологии 1:1:1 для browser_automation-аккаунтов.
 *
 * Запуск: bun run scripts/check-1to1-violations.ts
 *   (или npx tsx scripts/check-1to1-violations.ts — оба используют DATABASE_URL из окружения)
 *
 * Это ПРЕДОХРАНИТЕЛЬ перед накатом миграции с partial UNIQUE INDEX:
 *   CREATE UNIQUE INDEX ... WHERE postingMethod='browser_automation'
 * упадёт, если в таблице уже есть дубли. Скрипт ничего НЕ меняет (только SELECT).
 *
 * Находит:
 *   (а) proxyId, который используют ≥2 аккаунта с postingMethod='browser_automation';
 *   (б) indigoProfileId, который используют ≥2 browser_automation-аккаунта.
 *
 * api-аккаунты НЕ учитываются — для них шеринг прокси легитимен (см. ТЗ / план PR4).
 */

import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../app/generated/prisma/client"

const pool = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter: pool })

interface AccountRow {
  id: number
  displayName: string
  platform: string
  proxyId: string | null
  indigoProfileId: string | null
}

function maskDbUrl(url: string | undefined): string {
  if (!url) return "(DATABASE_URL не задан)"
  try {
    // postgresql://user:pass@host:port/db?... → скрываем креды
    return url.replace(/:\/\/[^@]*@/, "://***@")
  } catch {
    return "(не удалось распарсить)"
  }
}

function groupViolations(
  rows: AccountRow[],
  key: "proxyId" | "indigoProfileId",
): Map<string, AccountRow[]> {
  const byKey = new Map<string, AccountRow[]>()
  for (const r of rows) {
    const v = r[key]
    if (!v) continue
    const list = byKey.get(v) ?? []
    list.push(r)
    byKey.set(v, list)
  }
  // оставляем только те, где ≥2 аккаунта
  const violations = new Map<string, AccountRow[]>()
  for (const [k, list] of byKey) {
    if (list.length >= 2) violations.set(k, list)
  }
  return violations
}

async function main(): Promise<void> {
  console.log("=== Проверка нарушителей 1:1:1 (browser_automation) ===")
  console.log(`БД: ${maskDbUrl(process.env.DATABASE_URL)}`)
  console.log(`NODE_ENV: ${process.env.NODE_ENV ?? "(не задан)"}`)
  console.log("")

  const rows = (await prisma.socialAccount.findMany({
    where: { postingMethod: "browser_automation" },
    select: {
      id: true,
      displayName: true,
      platform: true,
      proxyId: true,
      indigoProfileId: true,
    },
    orderBy: { id: "asc" },
  })) as AccountRow[]

  console.log(`Всего browser_automation-аккаунтов: ${rows.length}`)
  const withProxy = rows.filter((r) => r.proxyId).length
  const withIndigo = rows.filter((r) => r.indigoProfileId).length
  console.log(`  из них с proxyId: ${withProxy}`)
  console.log(`  из них с indigoProfileId: ${withIndigo}`)
  console.log("")

  const proxyViolations = groupViolations(rows, "proxyId")
  const indigoViolations = groupViolations(rows, "indigoProfileId")

  let hasViolations = false

  console.log("--- (а) Прокси, используемый ≥2 browser_automation-аккаунтами ---")
  if (proxyViolations.size === 0) {
    console.log("  Нарушителей нет. ✓")
  } else {
    hasViolations = true
    for (const [proxyId, list] of proxyViolations) {
      console.log(`  proxyId=${proxyId} → ${list.length} аккаунтов:`)
      for (const a of list) {
        console.log(`      #${a.id} "${a.displayName}" (${a.platform})`)
      }
    }
  }
  console.log("")

  console.log("--- (б) Indigo-профиль, используемый ≥2 browser_automation-аккаунтами ---")
  if (indigoViolations.size === 0) {
    console.log("  Нарушителей нет. ✓")
  } else {
    hasViolations = true
    for (const [indigoProfileId, list] of indigoViolations) {
      console.log(`  indigoProfileId=${indigoProfileId} → ${list.length} аккаунтов:`)
      for (const a of list) {
        console.log(`      #${a.id} "${a.displayName}" (${a.platform})`)
      }
    }
  }
  console.log("")

  if (hasViolations) {
    console.log(
      "ИТОГ: НАЙДЕНЫ НАРУШИТЕЛИ. Перед накатом миграции (partial UNIQUE INDEX)",
    )
    console.log("      требуется ручная разводка дублей оператором. Накат СЕЙЧАС упадёт.")
    process.exitCode = 1
  } else {
    console.log("ИТОГ: нарушителей нет. Миграцию можно накатывать безопасно.")
  }

  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error("Ошибка проверки:", err)
  await prisma.$disconnect()
  process.exit(2)
})
