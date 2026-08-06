/**
 * Плоский список запусков и нормы длительности шагов.
 *
 * Проверяем:
 *   1. parseRunListQuery отбрасывает мусор и понимает `status=a,b`
 *   2. Мета отдаёт разбивку по статусам, не зависящую от фильтра статуса
 *   3. Фильтр по дню отсекает соседние сутки
 *   4. Кто запустил — резолвится в пользователя
 *   5. Число блоков берётся из снимка графа запуска, а не текущего конвейера
 *   6. Нормы длительности считаются медианой и требуют минимума наблюдений
 *
 * setup.ts делает TRUNCATE после каждого теста, изоляция гарантирована.
 */

import { describe, it, expect } from "vitest"
import { prisma } from "../../server/utils/prisma"
import { listRuns, parseRunListQuery } from "../../server/utils/pipeline-run-list"
import { computeStepDurationNorms } from "../../server/utils/pipeline-step-norms"

const DAY_MS = 86_400_000

function ymd(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

async function createPipeline(name = "Конвейер") {
  return prisma.pipeline.create({
    data: {
      userId: 1,
      name,
      graphData: { nodes: [{ id: "a" }, { id: "b" }, { id: "c" }], edges: [] },
    },
  })
}

async function createRun(
  pipelineId: number,
  status: string,
  overrides: Record<string, unknown> = {},
) {
  return prisma.workflowRun.create({
    data: {
      pipelineId,
      status: status as never,
      graphSnapshot: { nodes: [{ id: "a" }, { id: "b" }], edges: [] } as never,
      ...overrides,
    },
  })
}

describe("parseRunListQuery", () => {
  it("понимает список статусов через запятую", () => {
    const q = parseRunListQuery({ status: "failed,cancelled" })
    expect(q.statuses).toEqual(["failed", "cancelled"])
  })

  it("отбрасывает неизвестные статусы и мусорный день", () => {
    const q = parseRunListQuery({ status: "failed,выдумка", day: "вчера" })
    expect(q.statuses).toEqual(["failed"])
    expect(q.day).toBeNull()
  })

  it("держит размер страницы в разумных границах", () => {
    expect(parseRunListQuery({ perPage: "999" }).perPage).toBe(50)
    expect(parseRunListQuery({ perPage: "0" }).perPage).toBe(20)
    expect(parseRunListQuery({ page: "-3" }).page).toBe(1)
  })
})

describe("listRuns", () => {
  it("отдаёт разбивку по статусам независимо от фильтра", async () => {
    const pipeline = await createPipeline()
    await createRun(pipeline.id, "success")
    await createRun(pipeline.id, "success")
    await createRun(pipeline.id, "failed")

    const filters = parseRunListQuery({ status: "failed" })
    const result = await listRuns({ ...filters, pipelineId: pipeline.id }, null)

    expect(result.data).toHaveLength(1)
    expect(result.meta.total).toBe(1)
    // «2 успешных, 1 упал» остаётся видно при включённом отборе упавших
    expect(result.meta.statusCounts.success).toBe(2)
    expect(result.meta.statusCounts.failed).toBe(1)
    expect(result.meta.statusTotal).toBe(3)
  })

  it("фильтр по дню отсекает соседние сутки", async () => {
    const pipeline = await createPipeline()
    const today = new Date()
    const yesterday = new Date(Date.now() - DAY_MS)
    await createRun(pipeline.id, "success", { createdAt: today })
    await createRun(pipeline.id, "success", { createdAt: yesterday })

    const filters = parseRunListQuery({ day: ymd(today) })
    const result = await listRuns({ ...filters, pipelineId: pipeline.id }, null)

    expect(result.data).toHaveLength(1)
  })

  it("резолвит того, кто запустил", async () => {
    const user = await prisma.zavodUser.create({
      data: { externalId: 777, email: "run@test.local", name: "Дмитрий", surname: "Кузнецов" },
    })
    const pipeline = await createPipeline()
    await createRun(pipeline.id, "success", { triggeredBy: user.id })

    const result = await listRuns(parseRunListQuery({}), null)

    expect(result.data[0]!.triggeredByUser?.name).toBe("Дмитрий")
    expect(result.data[0]!.triggeredByUser?.surname).toBe("Кузнецов")
  })

  it("число блоков берёт из снимка запуска, а не текущего графа", async () => {
    // В графе конвейера три блока, в снимке запуска — два: граф перерисовали
    const pipeline = await createPipeline()
    await createRun(pipeline.id, "success")

    const result = await listRuns(parseRunListQuery({}), null)

    expect(result.data[0]!.totalNodes).toBe(2)
  })

  it("ограничивает выборку доступными конвейерами", async () => {
    const mine = await createPipeline("Мой")
    const other = await createPipeline("Чужой")
    await createRun(mine.id, "success")
    await createRun(other.id, "success")

    const result = await listRuns(parseRunListQuery({}), [mine.id])

    expect(result.data).toHaveLength(1)
    expect(result.data[0]!.pipeline?.name).toBe("Мой")
  })
})

describe("computeStepDurationNorms", () => {
  async function addSteps(nodeType: string, durations: number[]) {
    const pipeline = await createPipeline(`Норма ${nodeType}`)
    const run = await createRun(pipeline.id, "success")
    for (const duration of durations) {
      await prisma.workflowStep.create({
        data: {
          runId: run.id,
          nodeId: nodeType,
          nodeName: nodeType,
          nodeType,
          status: "success",
          duration,
          finishedAt: new Date(),
        },
      })
    }
  }

  it("считает медиану, а не среднее", async () => {
    // Одно зависшее наблюдение не должно сдвигать норму
    await addSteps("video", [1000, 1000, 1000, 1000, 600_000])

    const result = await computeStepDurationNorms(14)
    const norm = result.norms.find(n => n.nodeType === "video")

    expect(norm?.medianMs).toBe(1000)
    expect(norm?.samples).toBe(5)
  })

  it("не строит норму по недостаточному числу наблюдений", async () => {
    await addSteps("scenario", [1000, 2000])

    const result = await computeStepDurationNorms(14)

    expect(result.norms.some(n => n.nodeType === "scenario")).toBe(false)
  })

  it("отдаёт порог «дольше нормы»", async () => {
    const result = await computeStepDurationNorms(14)
    expect(result.slowFactor).toBe(3)
  })
})
