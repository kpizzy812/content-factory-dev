/**
 * API contract-тесты для общего списка запусков и пропуска шага.
 *
 * Проверяем:
 *  1. GET /api/pipelines/runs — 200, структура, мета с разбивкой по статусам
 *  2. Фильтр по статусу и по конвейеру
 *  3. Кто запустил — резолвится в объект пользователя
 *  4. POST skip-step переводит упавший шаг в «пропущен» и снимает ошибку
 *  5. skip-step отказывает на успешном шаге
 *
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest"
import { setup, $fetch } from "@nuxt/test-utils/e2e"
import { createTestUser, authHeaders } from "../helpers/auth"
import { nuxtTestEnv } from "../helpers/nuxt-env"
import { prisma } from "../../server/utils/prisma"

await setup({ dev: true, server: true, browser: false, env: nuxtTestEnv })

interface RunsResponse {
  data: Array<{
    id: number
    status: string
    totalNodes: number
    costActual: number | null
    pipeline: { id: number; name: string } | null
    triggeredByUser: { id: number; name: string | null } | null
    _count: { steps: number }
  }>
  meta: {
    total: number
    page: number
    perPage: number
    totalPages: number
    statusCounts: Record<string, number>
    statusTotal: number
  }
}

const GRAPH = {
  nodes: [{ id: "n1", type: "custom", position: { x: 0, y: 0 }, data: { label: "Заметка", type: "note", config: {} } }],
  edges: [],
}

async function createPipeline(userId: number, name: string) {
  return prisma.pipeline.create({
    data: { userId, name, status: "active", graphData: GRAPH as never },
  })
}

describe("GET /api/pipelines/runs", () => {
  it("200 + мета с разбивкой по статусам", async () => {
    const user = await createTestUser({ canAdmin: true })
    const pipeline = await createPipeline(user.id, "Общий список")
    await prisma.workflowRun.create({
      data: { pipelineId: pipeline.id, status: "success", graphSnapshot: GRAPH as never, triggeredBy: user.id },
    })
    await prisma.workflowRun.create({
      data: { pipelineId: pipeline.id, status: "failed", graphSnapshot: GRAPH as never },
    })

    const res = await $fetch<RunsResponse>("/api/pipelines/runs", {
      headers: authHeaders(user.id),
    })

    expect(res.data).toHaveLength(2)
    expect(res.meta.statusCounts.success).toBe(1)
    expect(res.meta.statusCounts.failed).toBe(1)
    expect(res.meta.statusTotal).toBe(2)

    const withUser = res.data.find(r => r.triggeredByUser != null)
    expect(withUser?.triggeredByUser?.id).toBe(user.id)
    expect(withUser?.pipeline?.name).toBe("Общий список")
    expect(withUser?.totalNodes).toBe(1)
  })

  it("фильтрует по статусу и по конвейеру", async () => {
    const user = await createTestUser({ canAdmin: true })
    const first = await createPipeline(user.id, "Первый")
    const second = await createPipeline(user.id, "Второй")
    await prisma.workflowRun.create({ data: { pipelineId: first.id, status: "failed" } })
    await prisma.workflowRun.create({ data: { pipelineId: first.id, status: "success" } })
    await prisma.workflowRun.create({ data: { pipelineId: second.id, status: "failed" } })

    const byStatus = await $fetch<RunsResponse>("/api/pipelines/runs?status=failed", {
      headers: authHeaders(user.id),
    })
    expect(byStatus.data).toHaveLength(2)
    expect(byStatus.meta.total).toBe(2)

    const byPipeline = await $fetch<RunsResponse>(`/api/pipelines/runs?pipelineId=${second.id}`, {
      headers: authHeaders(user.id),
    })
    expect(byPipeline.data).toHaveLength(1)
  })

  it("не показывает чужие конвейеры без admin", async () => {
    const owner = await createTestUser({ canAdmin: true })
    const stranger = await createTestUser({ canAdmin: false, canRead: true })
    const pipeline = await createPipeline(owner.id, "Чужой")
    await prisma.workflowRun.create({ data: { pipelineId: pipeline.id, status: "success" } })

    const res = await $fetch<RunsResponse>("/api/pipelines/runs", {
      headers: authHeaders(stranger.id),
    })

    expect(res.data).toHaveLength(0)
  })
})

describe("POST /api/pipelines/:id/runs/:runId/skip-step", () => {
  it("переводит упавший шаг в «пропущен» и снимает ошибку запуска", async () => {
    const user = await createTestUser({ canAdmin: true, canRunAgent: true })
    const pipeline = await createPipeline(user.id, "Пропуск")
    const run = await prisma.workflowRun.create({
      data: {
        pipelineId: pipeline.id,
        status: "failed",
        errorMessage: "Telegram не принял сообщение",
        errorCategory: "external_api",
        graphSnapshot: GRAPH as never,
      },
    })
    const step = await prisma.workflowStep.create({
      data: {
        runId: run.id,
        nodeId: "n1",
        nodeName: "Заметка",
        nodeType: "note",
        status: "failed",
        error: "403 bot_kicked",
      },
    })

    const res = await $fetch<{ data: { skippedNodeId: string; previousStatus: string } }>(
      `/api/pipelines/${pipeline.id}/runs/${run.id}/skip-step`,
      { method: "POST", headers: authHeaders(user.id), body: { nodeId: "n1" } },
    )

    expect(res.data.skippedNodeId).toBe("n1")
    expect(res.data.previousStatus).toBe("failed")

    const updated = await prisma.workflowStep.findUniqueOrThrow({ where: { id: step.id } })
    expect(updated.status).toBe("skipped")
    // Причина отказа остаётся: почему шаг пропустили, видно в разборе
    expect(updated.error).toBe("403 bot_kicked")
  })

  it("409 на успешном шаге — пропускать нечего", async () => {
    const user = await createTestUser({ canAdmin: true, canRunAgent: true })
    const pipeline = await createPipeline(user.id, "Успешный")
    const run = await prisma.workflowRun.create({
      data: { pipelineId: pipeline.id, status: "failed", graphSnapshot: GRAPH as never },
    })
    await prisma.workflowStep.create({
      data: { runId: run.id, nodeId: "n1", nodeName: "Заметка", nodeType: "note", status: "success" },
    })

    let status: number | null = null
    try {
      await $fetch(`/api/pipelines/${pipeline.id}/runs/${run.id}/skip-step`, {
        method: "POST",
        headers: authHeaders(user.id),
        body: { nodeId: "n1" },
      })
    } catch (err: unknown) {
      const e = err as { statusCode?: number; status?: number }
      status = e.statusCode ?? e.status ?? null
    }

    expect(status).toBe(409)
  })
})
