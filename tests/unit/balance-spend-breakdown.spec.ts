/**
 * Расход за сутки по типам операций.
 *
 * Проверяем:
 *   1. Списания раскладываются по группам операций по stepKey
 *   2. «Рендер» остаётся строкой с нулём, «Прочее» появляется только когда есть
 *   3. Списания старше окна не считаются
 *   4. Стоимость ролика делится на завершённые за окно ролики, иначе null
 *
 * setup.ts делает TRUNCATE после каждого теста, изоляция гарантирована.
 */

import { describe, it, expect } from "vitest"
import { prisma } from "../../server/utils/prisma"
import { computeSpendBreakdown } from "../../server/utils/balance/spend-breakdown"
import { createTestVideoWithScenario } from "../api/_helpers/video-factory"

const HOUR_MS = 3_600_000

async function ledgerRow(stepKey: string | null, costUsd: number, ageHours = 0) {
  return prisma.aiAuditLog.create({
    data: {
      action: "external_api_call",
      model: "test-model",
      service: "fal.ai",
      stepKey,
      costUsd,
      status: "applied",
      createdAt: new Date(Date.now() - ageHours * HOUR_MS),
    },
  })
}

function amountOf(groups: Array<{ key: string; amountUsd: number }>, key: string) {
  return groups.find(g => g.key === key)?.amountUsd
}

describe("computeSpendBreakdown", () => {
  it("раскладывает списания по группам операций", async () => {
    await ledgerRow("clip_generation", 4)
    await ledgerRow("image_generation", 1.5)
    await ledgerRow("lip_sync_generation", 2)
    await ledgerRow("voiceover_generation", 0.75)
    await ledgerRow("prompt_generation", 0.25)

    const result = await computeSpendBreakdown(24)

    expect(amountOf(result.groups, "video")).toBeCloseTo(7.5, 6)
    expect(amountOf(result.groups, "audio")).toBeCloseTo(0.75, 6)
    expect(amountOf(result.groups, "text")).toBeCloseTo(0.25, 6)
    expect(result.totalUsd).toBeCloseTo(8.5, 6)
  })

  it("рендер остаётся строкой с нулём, прочее не появляется без причины", async () => {
    await ledgerRow("clip_generation", 1)

    const result = await computeSpendBreakdown(24)

    expect(amountOf(result.groups, "render")).toBe(0)
    expect(result.groups.some(g => g.key === "other")).toBe(false)
  })

  it("списание без известного шага уходит в «Прочее»", async () => {
    await ledgerRow(null, 3)

    const result = await computeSpendBreakdown(24)

    expect(amountOf(result.groups, "other")).toBeCloseTo(3, 6)
    expect(result.totalUsd).toBeCloseTo(3, 6)
  })

  it("не считает списания старше окна", async () => {
    await ledgerRow("clip_generation", 5, 40)
    await ledgerRow("clip_generation", 2, 1)

    const result = await computeSpendBreakdown(24)

    expect(result.totalUsd).toBeCloseTo(2, 6)
  })

  it("стоимость ролика — null, пока за окно ни один не завершился", async () => {
    await ledgerRow("clip_generation", 5)

    const result = await computeSpendBreakdown(24)

    expect(result.videoCount).toBe(0)
    expect(result.perVideoUsd).toBeNull()
  })

  it("делит расход на завершённые за окно ролики", async () => {
    await ledgerRow("clip_generation", 6)

    const bundle = await createTestVideoWithScenario({ status: "completed" })
    await prisma.video.update({
      where: { id: bundle.video.id },
      data: { finishedAt: new Date() },
    })
    // Завершённый вчера в сутки не попадает
    const old = await createTestVideoWithScenario({ status: "completed" })
    await prisma.video.update({
      where: { id: old.video.id },
      data: { finishedAt: new Date(Date.now() - 40 * HOUR_MS) },
    })

    const result = await computeSpendBreakdown(24)

    expect(result.videoCount).toBe(1)
    expect(result.perVideoUsd).toBeCloseTo(6, 6)
  })
})
