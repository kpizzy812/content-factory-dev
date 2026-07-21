/**
 * Smoke test для warmup planner.
 *
 * Запуск: bun run scripts/test-warmup-planner.ts
 *
 * 8 проверок (без БД):
 * 1. Determinism: дважды с одним seed → JSON.stringify equal.
 * 2. Determinism cross-day: разные даты → разные планы.
 * 3. Age classification: 4 фейковых аккаунта → bucket new/warming/mature/warming.
 * 4. Action distribution для new: только view и scroll.
 * 5. Action distribution для mature: присутствуют все 7 типов в выборке.
 * 6. Duration tolerance: totalDurationSec в пределах target ± 15% + maxActionDuration.
 * 7. Comment language: ru → RU pool, en → EN pool.
 * 8. Empty keyword pool fallback: planner работает с пустым pool через fallback.
 */

import { classifyAccountAge } from "../server/utils/warmup/age-classifier"
import {
  ACTION_DISTRIBUTIONS,
  BUCKET_TARGET_DURATION,
  MAX_SINGLE_ACTION_DURATION_SEC,
} from "../server/utils/warmup/distributions"
import {
  generateWarmupPlan,
  type GenerateWarmupPlanInput,
} from "../server/utils/warmup/planner"
import type { WarmupAction, WarmupPlatform } from "../shared/types/warmup"

let passed = 0
let failed = 0
const failures: string[] = []

function check(name: string, ok: boolean, details?: string) {
  if (ok) {
    passed++
    console.log(`  PASS: ${name}`)
  } else {
    failed++
    const msg = details ? `${name} — ${details}` : name
    failures.push(msg)
    console.log(`  FAIL: ${msg}`)
  }
}

const baseInput = (overrides: Partial<GenerateWarmupPlanInput> = {}): GenerateWarmupPlanInput => ({
  socialAccountId: 42,
  platform: "tiktok",
  ageBucket: "mature",
  scheduledAt: new Date("2026-05-04T10:00:00.000Z"),
  keywordPool: ["fyp", "viral", "music", "comedy", "dance"],
  commentLanguage: "en",
  ...overrides,
})

console.log("\n=== Test 1: Determinism (same seed → same plan) ===")
{
  const planA = generateWarmupPlan(baseInput())
  const planB = generateWarmupPlan(baseInput())
  // Сравниваем без meta.generatedAt (он различается между вызовами)
  const a = { ...planA, meta: { ...planA.meta, generatedAt: "" } }
  const b = { ...planB, meta: { ...planB.meta, generatedAt: "" } }
  check(
    "Идентичные seed → идентичные actions+meta",
    JSON.stringify(a) === JSON.stringify(b),
  )
}

console.log("\n=== Test 2: Determinism cross-day (different dates → different plans) ===")
{
  const planA = generateWarmupPlan(
    baseInput({ scheduledAt: new Date("2026-05-04T10:00:00.000Z") }),
  )
  const planB = generateWarmupPlan(
    baseInput({ scheduledAt: new Date("2026-05-05T10:00:00.000Z") }),
  )
  check(
    "Разные даты → разные seed",
    planA.meta.seed !== planB.meta.seed,
    `seedA=${planA.meta.seed} seedB=${planB.meta.seed}`,
  )
  check(
    "Разные даты → разный набор actions",
    JSON.stringify(planA.actions) !== JSON.stringify(planB.actions),
  )
}

console.log("\n=== Test 3: Age classification ===")
{
  const now = new Date("2026-05-04T00:00:00.000Z")
  const day = 24 * 60 * 60 * 1000
  const accNew = classifyAccountAge({
    createdAt: new Date(now.getTime() - 3 * day),
    totalPostsPublished: 0,
    now,
  })
  const accWarming = classifyAccountAge({
    createdAt: new Date(now.getTime() - 14 * day),
    totalPostsPublished: 5,
    now,
  })
  const accMature = classifyAccountAge({
    createdAt: new Date(now.getTime() - 60 * day),
    totalPostsPublished: 50,
    now,
  })
  const accWarming2 = classifyAccountAge({
    createdAt: new Date(now.getTime() - 60 * day),
    totalPostsPublished: 5,
    now,
  })
  check("3д/0 posts → new", accNew === "new", `got=${accNew}`)
  check("14д/5 posts → warming", accWarming === "warming", `got=${accWarming}`)
  check("60д/50 posts → mature", accMature === "mature", `got=${accMature}`)
  check("60д/5 posts → warming", accWarming2 === "warming", `got=${accWarming2}`)
}

console.log("\n=== Test 4: Action distribution для new (только view/scroll) ===")
{
  const plan = generateWarmupPlan(baseInput({ ageBucket: "new" }))
  const allowed = new Set<WarmupAction["kind"]>(["view", "scroll"])
  const violations = plan.actions.filter((a) => !allowed.has(a.kind))
  check(
    `new bucket — все actions только view/scroll (n=${plan.actions.length})`,
    violations.length === 0,
    violations.length > 0 ? `violations=${violations.map((v) => v.kind).join(",")}` : undefined,
  )
}

console.log("\n=== Test 5: Action distribution для mature (присутствуют все 7 типов) ===")
{
  // В одном плане может не быть всех 7. Делаем 100 планов с разными seed.
  const seen = new Set<WarmupAction["kind"]>()
  for (let i = 0; i < 100; i++) {
    const plan = generateWarmupPlan(
      baseInput({
        ageBucket: "mature",
        socialAccountId: 1000 + i,
      }),
    )
    for (const a of plan.actions) seen.add(a.kind)
    if (seen.size === 7) break
  }
  const expected: WarmupAction["kind"][] = [
    "view",
    "scroll",
    "like",
    "follow",
    "comment",
    "share",
    "save",
  ]
  const missing = expected.filter((k) => !seen.has(k))
  check(
    `mature bucket — все 7 типов появились в выборке из 100 планов`,
    missing.length === 0,
    missing.length > 0 ? `missing=${missing.join(",")}` : undefined,
  )
}

console.log("\n=== Test 6: Duration tolerance ===")
{
  const platforms: WarmupPlatform[] = ["tiktok", "instagram", "youtube"]
  const buckets: Array<"new" | "warming" | "mature"> = ["new", "warming", "mature"]
  for (const p of platforms) {
    for (const b of buckets) {
      const plan = generateWarmupPlan(baseInput({ platform: p, ageBucket: b }))
      const target = BUCKET_TARGET_DURATION[b]
      const upperBound = Math.round(target * 1.15) + MAX_SINGLE_ACTION_DURATION_SEC
      const lowerBound = Math.round(target * 0.85) - MAX_SINGLE_ACTION_DURATION_SEC
      const inRange =
        plan.meta.totalDurationSec >= Math.max(lowerBound, 0)
        && plan.meta.totalDurationSec <= upperBound
      check(
        `${p}_${b}: totalDurationSec=${plan.meta.totalDurationSec} in [${lowerBound}..${upperBound}]`,
        inRange,
      )
    }
  }
}

console.log("\n=== Test 7: Comment language ===")
{
  // Берём mature плана с разными language, ищем хотя бы один comment
  const ruPlan = generateWarmupPlan(
    baseInput({
      ageBucket: "mature",
      commentLanguage: "ru",
      socialAccountId: 7777,
    }),
  )
  const enPlan = generateWarmupPlan(
    baseInput({
      ageBucket: "mature",
      commentLanguage: "en",
      socialAccountId: 7777,
    }),
  )
  const ruComments = ruPlan.actions.filter((a) => a.kind === "comment")
  const enComments = enPlan.actions.filter((a) => a.kind === "comment")

  // Hardcoded pools (должны совпадать с server/utils/warmup/comment-pool.ts)
  const RU_POOL = ["нравится 🔥", "полезно", "спасибо!", "класс!", "круто", "топ ✨"]
  const EN_POOL = ["love this", "nice 🔥", "thanks!", "great", "amazing", "🔥🔥🔥"]

  const ruOk = ruComments.length === 0
    || ruComments.every((a) => a.kind === "comment" && RU_POOL.includes(a.text))
  const enOk = enComments.length === 0
    || enComments.every((a) => a.kind === "comment" && EN_POOL.includes(a.text))

  check(
    `commentLanguage=ru → comment.text из RU pool (n=${ruComments.length})`,
    ruOk,
  )
  check(
    `commentLanguage=en → comment.text из EN pool (n=${enComments.length})`,
    enOk,
  )
}

console.log("\n=== Test 8: Empty keyword pool fallback ===")
{
  // Передаём пустой pool. Planner НЕ должен упасть; должен использовать fallback "fyp" в pickKeyword.
  let crashed = false
  let plan: ReturnType<typeof generateWarmupPlan> | null = null
  try {
    plan = generateWarmupPlan(baseInput({ keywordPool: [] }))
  } catch {
    crashed = true
  }
  check("Planner работает с пустым keywordPool (не падает)", !crashed && plan !== null)
  if (plan) {
    const viewActions = plan.actions.filter((a) => a.kind === "view")
    const allFyp = viewActions.every((a) => a.kind === "view" && a.keyword === "fyp")
    check(
      `Все view-actions используют fallback keyword='fyp' (n=${viewActions.length})`,
      allFyp,
    )
  }
}

console.log("\n=== Sample plan для tiktok_mature ===")
{
  const sample = generateWarmupPlan(baseInput({ ageBucket: "mature" }))
  console.log("meta:", JSON.stringify(sample.meta, null, 2))
  console.log(`actions[0..5]:`)
  for (const a of sample.actions.slice(0, 5)) {
    console.log("  ", JSON.stringify(a))
  }
  console.log(`... (всего ${sample.actions.length} actions)`)
}

console.log("\n=== Distribution sanity (сумма весов > 0 везде) ===")
{
  for (const [key, dist] of Object.entries(ACTION_DISTRIBUTIONS)) {
    const sum = dist.reduce((acc, w) => acc + w.weight, 0)
    check(`${key}: sum(weights)=${sum.toFixed(2)} > 0`, sum > 0)
  }
}

console.log(`\n=== Result: ${passed} passed / ${failed} failed ===`)
if (failed === 0) {
  console.log("All warmup planner tests passed")
  process.exit(0)
} else {
  console.log("Failures:")
  for (const f of failures) console.log("  -", f)
  process.exit(1)
}
