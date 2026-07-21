/**
 * balance_v2 cost-ledger: integration-style тесты против test-БД.
 *
 * Проверяем:
 *   1. logStepCost пишет запись в AiAuditLog с правильными полями
 *   2. Идемпотентность: повторный вызов (videoId, stepKey, service) — skip без дубля.
 *      После reshape убран часовой timeWindow → проверяем что даже без любого окна
 *      повторная запись отклоняется.
 *   3. costUsd <= 0 → skip без записи
 *   4. service=null (и mapStepKeyToService вернул null) → skip без записи
 *
 * setup.ts делает TRUNCATE после каждого теста, изоляция гарантирована.
 */

import { describe, it, expect, beforeEach } from "vitest"
import { prisma } from "../../server/utils/prisma"
import { logStepCost } from "../../server/utils/balance/cost-ledger"

async function countLedgerRows(videoId: number, stepKey: string, service: string) {
  return prisma.aiAuditLog.count({
    where: { videoId, stepKey, service },
  })
}

describe("logStepCost", () => {
  beforeEach(async () => {
    // Стартуем с пустого ledger. setup.ts уже truncate'нул в afterEach предыдущего теста,
    // но добавим явный assert для документации намерения.
    const n = await prisma.aiAuditLog.count()
    expect(n).toBe(0)
  })

  it("пишет запись с корректными полями в AiAuditLog", async () => {
    await logStepCost(1, "image_generation", "fal.ai", 0.5, 123, "fal-ai/flux/schnell")

    const rows = await prisma.aiAuditLog.findMany({
      where: { videoId: 123 },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].service).toBe("fal.ai")
    expect(rows[0].stepKey).toBe("image_generation")
    expect(rows[0].action).toBe("external_api_call")
    expect(rows[0].model).toBe("fal-ai/flux/schnell")
    expect(Number(rows[0].costUsd)).toBeCloseTo(0.5, 6)
    expect(rows[0].videoId).toBe(123)
    expect(rows[0].userId).toBeNull()
    expect(rows[0].prompt).toBeNull()
  })

  it("idempotency: повторный вызов на тот же (videoId, stepKey, service) — skip без дубля", async () => {
    await logStepCost(1, "image_generation", "fal.ai", 0.5, 200, "fal-ai/flux/schnell")
    await logStepCost(1, "image_generation", "fal.ai", 0.75, 200, "fal-ai/flux/schnell")

    // Только одна запись, первая остаётся канонической.
    expect(await countLedgerRows(200, "image_generation", "fal.ai")).toBe(1)

    const rows = await prisma.aiAuditLog.findMany({
      where: { videoId: 200 },
    })
    expect(rows).toHaveLength(1)
    expect(Number(rows[0].costUsd)).toBeCloseTo(0.5, 6) // первая запись не перетёрта
  })

  it("idempotency: разные stepKey на одном видео — две записи", async () => {
    await logStepCost(1, "image_generation", "fal.ai", 0.3, 300, "fal-ai/flux/schnell")
    await logStepCost(2, "clip_generation", "fal.ai", 0.4, 300, "fal-ai/luma")

    const rows = await prisma.aiAuditLog.findMany({
      where: { videoId: 300 },
      orderBy: { stepKey: "asc" },
    })
    expect(rows).toHaveLength(2)
    expect(rows[0].stepKey).toBe("clip_generation")
    expect(rows[1].stepKey).toBe("image_generation")
  })

  it("idempotency: lip_sync_generation и voiceover_generation на одном fal.ai-видео — две записи (НЕ путать с double-counting)", async () => {
    // Это критичный сценарий для lip-sync runner: оба шага идут через fal.ai,
    // но stepKey разные, поэтому idempotency check разводит пары.
    await logStepCost(1, "lip_sync_generation", "fal.ai", 0.2, 400, "fal-ai/sync-lipsync")
    await logStepCost(2, "voiceover_generation", "fal.ai", 0.1, 400, "fal-ai/kokoro/american-english")

    const rows = await prisma.aiAuditLog.findMany({
      where: { videoId: 400 },
      orderBy: { stepKey: "asc" },
    })
    expect(rows).toHaveLength(2)
    const totalCost = rows.reduce((sum, r) => sum + Number(r.costUsd ?? 0), 0)
    expect(totalCost).toBeCloseTo(0.3, 6)
  })

  it("costUsd = 0 → skip без записи", async () => {
    await logStepCost(1, "image_generation", "fal.ai", 0, 500, "fal-ai/flux/schnell")
    expect(await prisma.aiAuditLog.count({ where: { videoId: 500 } })).toBe(0)
  })

  it("costUsd < 0 → skip без записи", async () => {
    await logStepCost(1, "image_generation", "fal.ai", -0.5, 501, "fal-ai/flux/schnell")
    expect(await prisma.aiAuditLog.count({ where: { videoId: 501 } })).toBe(0)
  })

  it("service=null и mapStepKeyToService возвращает null → skip без записи", async () => {
    // stepKey 'assembly' → null в маппинге (локальный ffmpeg).
    await logStepCost(1, "assembly", null, 0.5, 600, null)
    expect(await prisma.aiAuditLog.count({ where: { videoId: 600 } })).toBe(0)

    // Неизвестный stepKey тоже → null.
    await logStepCost(1, "random_unknown_step", null, 0.5, 600, null)
    expect(await prisma.aiAuditLog.count({ where: { videoId: 600 } })).toBe(0)
  })

  it("auto-resolve через mapStepKeyToService: service не передан, но stepKey известен", async () => {
    // service=undefined → falls back to mapStepKeyToService('image_generation') = 'fal.ai'
    await logStepCost(1, "image_generation", undefined, 0.42, 700, "fal-ai/flux/schnell")

    const rows = await prisma.aiAuditLog.findMany({ where: { videoId: 700 } })
    expect(rows).toHaveLength(1)
    expect(rows[0].service).toBe("fal.ai")
  })
})
