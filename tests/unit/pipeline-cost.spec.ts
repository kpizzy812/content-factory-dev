/**
 * Стоимость шага и запуска конвейера.
 *
 * Проверяем:
 *   1. readStepCost снимает служебные ключи output и режет мусор
 *   2. заведомо бесплатные типы блоков дают честный ноль, а не «неизвестно»
 *   3. sumAmounts различает «сумма ноль» и «сумму никто не посчитал»
 *   4. recalcRunCost складывает шаги в агрегат запуска и идемпотентен
 *
 * setup.ts делает TRUNCATE после каждого теста, изоляция гарантирована.
 */

import { describe, it, expect } from "vitest"
import { prisma } from "../../server/utils/prisma"
import {
  COST_ACTUAL_KEY,
  COST_ESTIMATE_KEY,
  readStepCost,
  recalcRunCost,
  sumAmounts,
} from "../../server/utils/pipeline-cost"

async function createRun() {
  const pipeline = await prisma.pipeline.create({
    data: { userId: 1, name: "Стоимость запуска" },
  })
  const run = await prisma.workflowRun.create({
    data: { pipelineId: pipeline.id, status: "running" },
  })
  return run
}

async function addStep(
  runId: number,
  nodeId: string,
  costActual: number | null,
  costEstimate: number | null = null,
) {
  return prisma.workflowStep.create({
    data: {
      runId,
      nodeId,
      nodeName: nodeId,
      nodeType: "video",
      status: "success",
      costActual,
      costEstimate,
    },
  })
}

describe("readStepCost", () => {
  it("снимает служебные ключи output", () => {
    const cost = readStepCost("video", {
      videos: [],
      [COST_ACTUAL_KEY]: 1.25,
      [COST_ESTIMATE_KEY]: 1.5,
    })
    expect(cost).toEqual({ actual: 1.25, estimate: 1.5 })
  })

  it("возвращает null, когда сумму никто не положил", () => {
    expect(readStepCost("video", { videos: [] })).toEqual({ actual: null, estimate: null })
    expect(readStepCost("video", null)).toEqual({ actual: null, estimate: null })
    expect(readStepCost("video", [1, 2])).toEqual({ actual: null, estimate: null })
  })

  it("отбрасывает отрицательные значения и не-числа", () => {
    expect(readStepCost("video", { [COST_ACTUAL_KEY]: -1 }).actual).toBeNull()
    expect(readStepCost("video", { [COST_ACTUAL_KEY]: "дорого" }).actual).toBeNull()
    expect(readStepCost("video", { [COST_ACTUAL_KEY]: Number.NaN }).actual).toBeNull()
  })

  it("бесплатным типам блоков ставит ноль, а не прочерк", () => {
    expect(readStepCost("filter", {}).actual).toBe(0)
    expect(readStepCost("if_switch", {}).actual).toBe(0)
    expect(readStepCost("notification", { sent: true }).actual).toBe(0)
    // Ходят наружу — сколько это стоит, знает только автор конвейера
    expect(readStepCost("http_request", {}).actual).toBeNull()
    expect(readStepCost("code", {}).actual).toBeNull()
  })

  it("явная сумма исполнителя главнее таблицы бесплатных", () => {
    expect(readStepCost("filter", { [COST_ACTUAL_KEY]: 0.4 }).actual).toBe(0.4)
  })
})

describe("sumAmounts", () => {
  it("складывает известные суммы", () => {
    expect(sumAmounts([{ c: 1 }, { c: 2.5 }], "c")).toBe(3.5)
  })

  it("null, когда ни у одного элемента суммы нет", () => {
    expect(sumAmounts([{ c: null }, {}], "c")).toBeNull()
    expect(sumAmounts([], "c")).toBeNull()
    expect(sumAmounts(undefined, "c")).toBeNull()
  })

  it("ноль — это сумма, а не отсутствие суммы", () => {
    expect(sumAmounts([{ c: 0 }], "c")).toBe(0)
  })
})

describe("recalcRunCost", () => {
  it("складывает шаги в агрегат запуска", async () => {
    const run = await createRun()
    await addStep(run.id, "a", 1.5, 2)
    await addStep(run.id, "b", 0.25, 0.5)
    await addStep(run.id, "c", null)

    const cost = await recalcRunCost(run.id)
    expect(cost.actual).toBeCloseTo(1.75, 6)
    expect(cost.estimate).toBeCloseTo(2.5, 6)

    const stored = await prisma.workflowRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(stored.costActual).toBeCloseTo(1.75, 6)
    expect(stored.costEstimate).toBeCloseTo(2.5, 6)
  })

  it("null, пока ни у одного шага суммы нет", async () => {
    const run = await createRun()
    await addStep(run.id, "a", null)

    const cost = await recalcRunCost(run.id)
    expect(cost.actual).toBeNull()

    const stored = await prisma.workflowRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(stored.costActual).toBeNull()
  })

  it("идемпотентен и сходится после удаления шагов", async () => {
    const run = await createRun()
    await addStep(run.id, "a", 1)
    const dropped = await addStep(run.id, "b", 3)

    await recalcRunCost(run.id)
    await recalcRunCost(run.id)
    let stored = await prisma.workflowRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(stored.costActual).toBeCloseTo(4, 6)

    // retry-step удаляет шаги — агрегат обязан сойтись с оставшимися
    await prisma.workflowStep.delete({ where: { id: dropped.id } })
    await recalcRunCost(run.id)
    stored = await prisma.workflowRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(stored.costActual).toBeCloseTo(1, 6)
  })
})
