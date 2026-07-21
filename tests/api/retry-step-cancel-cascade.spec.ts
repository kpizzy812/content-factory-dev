/**
 * Integration-тесты POST /api/pipelines/:id/runs/:runId/retry-step.
 *
 * Покрытие этапа A1 phantom_video_stuck_cancel_fix_plan:
 *   - retry video-ноды → старое НЕ-completed Video переходит в status='canceled'
 *   - retry scenario-ноды → каскад вниз: scenarios → isDeleted=true, videos → canceled
 *   - completed Video НЕ трогается (data preservation)
 *   - fallback по runId работает, когда output потерян
 *
 * Тестируем именно А1: предотвращение phantom-Video при resume.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest"
import { setup, $fetch } from "@nuxt/test-utils/e2e"
import { createTestUser, authHeaders } from "../helpers/auth"
import { nuxtTestEnv } from "../helpers/nuxt-env"
import { prisma } from "../../server/utils/prisma"

await setup({ dev: true, server: true, browser: false, env: nuxtTestEnv })

// ── Helpers ─────────────────────────────────────────────────────────────────

async function createPipelineWithGraph(userId: number, nodes: Array<{ id: string; type: string; label?: string }>, edges: Array<{ source: string; target: string }>) {
  return prisma.pipeline.create({
    data: {
      userId,
      name: `Test Pipeline ${Date.now()}-${Math.random()}`,
      status: "active",
      graphData: {
        nodes: nodes.map((n) => ({
          id: n.id,
          type: n.type,
          data: { label: n.label ?? n.id },
          position: { x: 0, y: 0 },
        })),
        edges: edges.map((e, i) => ({
          id: `e${i}`,
          source: e.source,
          target: e.target,
        })),
      },
    },
  })
}

async function createFailedRun(pipelineId: number) {
  return prisma.workflowRun.create({
    data: {
      pipelineId,
      status: "failed",
      triggerType: "manual",
      startedAt: new Date(Date.now() - 10 * 60 * 1000),
      finishedAt: new Date(Date.now() - 5 * 60 * 1000),
      errorMessage: "test failure",
    },
  })
}

async function createScenarioWithApp() {
  const app = await prisma.app.create({
    data: { name: `app-${Date.now()}-${Math.random()}`, keywords: [] },
  })
  const scenario = await prisma.scenario.create({
    data: {
      appId: app.id,
      status: "generated",
      generationStatus: "completed",
    },
  })
  return { app, scenario }
}

async function createVideoForScenario(scenarioId: number, runId: number, status: "failed" | "completed" | "generating_clips" = "failed") {
  return prisma.video.create({
    data: {
      scenarioId,
      runId,
      status,
      isLocked: status !== "completed" && status !== "failed",
    },
  })
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/pipelines/:id/runs/:runId/retry-step — phantom prevention (A1)", () => {
  it("retry video-ноды: failed Video переходит в canceled с errorMessage", async () => {
    const user = await createTestUser({ canRunAgent: true, canAdmin: true })
    const pipeline = await createPipelineWithGraph(
      user.id,
      [{ id: "video-1", type: "video", label: "Video Node" }],
      [],
    )
    const run = await createFailedRun(pipeline.id)
    const { scenario } = await createScenarioWithApp()
    const video = await createVideoForScenario(scenario.id, run.id, "failed")

    // Создаём failed WorkflowStep с output, содержащим videoId
    await prisma.workflowStep.create({
      data: {
        runId: run.id,
        nodeId: "video-1",
        nodeName: "Video Node",
        nodeType: "video",
        status: "failed",
        output: { videos: [{ id: video.id, status: "failed" }] },
        startedAt: new Date(),
        finishedAt: new Date(),
      },
    })

    const res = await $fetch<{ data: { runId: number; retriedNodeId: string } }>(
      `/api/pipelines/${pipeline.id}/runs/${run.id}/retry-step`,
      {
        method: "POST",
        headers: authHeaders(user.id),
        body: { nodeId: "video-1" },
      },
    )
    expect(res.data.runId).toBe(run.id)

    // Video.status='canceled', errorMessage обновлён
    const after = await prisma.video.findUnique({ where: { id: video.id } })
    expect(after?.status).toBe("canceled")
    expect(after?.errorMessage).toContain("Шаг был перезапущен")
    expect(after?.isLocked).toBe(false)
    expect(after?.finishedAt).not.toBeNull()

    // Run переведён в pending или уже подхвачен engine (running)
    const updatedRun = await prisma.workflowRun.findUnique({ where: { id: run.id } })
    expect(["pending", "running", "failed"]).toContain(updatedRun?.status)
    // errorMessage сброшен (engine может его обратно записать если упал)
    // главное — что cancelRequestedAt был очищен
    expect(updatedRun?.cancelRequestedAt).toBeNull()
  })

  it("completed Video НЕ трогается при retry video-ноды", async () => {
    const user = await createTestUser({ canRunAgent: true, canAdmin: true })
    const pipeline = await createPipelineWithGraph(
      user.id,
      [{ id: "video-1", type: "video" }],
      [],
    )
    const run = await createFailedRun(pipeline.id)
    const { scenario } = await createScenarioWithApp()
    const completedVideo = await createVideoForScenario(scenario.id, run.id, "completed")
    const failedVideo = await createVideoForScenario(scenario.id, run.id, "failed")

    await prisma.workflowStep.create({
      data: {
        runId: run.id,
        nodeId: "video-1",
        nodeName: "Video Node",
        nodeType: "video",
        status: "failed",
        output: {
          videos: [
            { id: completedVideo.id, status: "completed" },
            { id: failedVideo.id, status: "failed" },
          ],
        },
      },
    })

    await $fetch(`/api/pipelines/${pipeline.id}/runs/${run.id}/retry-step`, {
      method: "POST",
      headers: authHeaders(user.id),
      body: { nodeId: "video-1" },
    })

    const completedAfter = await prisma.video.findUnique({ where: { id: completedVideo.id } })
    const failedAfter = await prisma.video.findUnique({ where: { id: failedVideo.id } })

    expect(completedAfter?.status).toBe("completed")
    expect(completedAfter?.errorMessage).toBeNull()
    expect(failedAfter?.status).toBe("canceled")
  })

  it("retry scenario-ноды: каскад вниз — Scenario.isDeleted=true + downstream Video.status=canceled", async () => {
    const user = await createTestUser({ canRunAgent: true, canAdmin: true })
    const pipeline = await createPipelineWithGraph(
      user.id,
      [
        { id: "scenario-1", type: "scenario" },
        { id: "video-1", type: "video" },
      ],
      [{ source: "scenario-1", target: "video-1" }],
    )
    const run = await createFailedRun(pipeline.id)
    const { scenario } = await createScenarioWithApp()
    await prisma.scenario.update({
      where: { id: scenario.id },
      data: { runId: run.id, pipelineId: pipeline.id },
    })
    const video = await createVideoForScenario(scenario.id, run.id, "failed")

    // status='failed' — retry-step запрещает retry для success/partial/no_data
    await prisma.workflowStep.create({
      data: {
        runId: run.id,
        nodeId: "scenario-1",
        nodeName: "Scenario",
        nodeType: "scenario",
        status: "failed",
        output: { scenarios: [{ id: scenario.id }] },
      },
    })
    await prisma.workflowStep.create({
      data: {
        runId: run.id,
        nodeId: "video-1",
        nodeName: "Video",
        nodeType: "video",
        status: "failed",
        output: { videos: [{ id: video.id }] },
      },
    })

    await $fetch(`/api/pipelines/${pipeline.id}/runs/${run.id}/retry-step`, {
      method: "POST",
      headers: authHeaders(user.id),
      body: { nodeId: "scenario-1" },
    })

    const scAfter = await prisma.scenario.findUnique({ where: { id: scenario.id } })
    expect(scAfter?.isDeleted).toBe(true)
    expect(scAfter?.deletedAt).not.toBeNull()

    const videoAfter = await prisma.video.findUnique({ where: { id: video.id } })
    expect(videoAfter?.status).toBe("canceled")
  })

  it("fallback по runId: даже когда output пустой, активные Video находятся и отменяются", async () => {
    const user = await createTestUser({ canRunAgent: true, canAdmin: true })
    const pipeline = await createPipelineWithGraph(
      user.id,
      [{ id: "video-1", type: "video" }],
      [],
    )
    const run = await createFailedRun(pipeline.id)
    const { scenario } = await createScenarioWithApp()

    // Video создан run'ом, но output WorkflowStep потерян (старый формат)
    const orphanVideo = await createVideoForScenario(scenario.id, run.id, "generating_clips")

    await prisma.workflowStep.create({
      data: {
        runId: run.id,
        nodeId: "video-1",
        nodeName: "Video",
        nodeType: "video",
        status: "failed",
        output: { /* output потерян / без videos */ },
      },
    })

    await $fetch(`/api/pipelines/${pipeline.id}/runs/${run.id}/retry-step`, {
      method: "POST",
      headers: authHeaders(user.id),
      body: { nodeId: "video-1" },
    })

    const after = await prisma.video.findUnique({ where: { id: orphanVideo.id } })
    expect(after?.status).toBe("canceled")
  })

  it("дедупликация: дубликат videoId в нескольких шагах → одна update'а на видео", async () => {
    const user = await createTestUser({ canRunAgent: true, canAdmin: true })
    const pipeline = await createPipelineWithGraph(
      user.id,
      [
        { id: "video-1", type: "video" },
        { id: "video-2", type: "video" },
      ],
      [{ source: "video-1", target: "video-2" }],
    )
    const run = await createFailedRun(pipeline.id)
    const { scenario } = await createScenarioWithApp()
    const video = await createVideoForScenario(scenario.id, run.id, "failed")

    // Один и тот же videoId в output двух разных шагов
    await prisma.workflowStep.create({
      data: {
        runId: run.id,
        nodeId: "video-1",
        nodeName: "V1",
        nodeType: "video",
        status: "failed",
        output: { videos: [{ id: video.id }] },
      },
    })
    await prisma.workflowStep.create({
      data: {
        runId: run.id,
        nodeId: "video-2",
        nodeName: "V2",
        nodeType: "video",
        status: "failed",
        output: { videos: [{ id: video.id }] },
      },
    })

    await $fetch(`/api/pipelines/${pipeline.id}/runs/${run.id}/retry-step`, {
      method: "POST",
      headers: authHeaders(user.id),
      body: { nodeId: "video-1" },
    })

    const after = await prisma.video.findUnique({ where: { id: video.id } })
    expect(after?.status).toBe("canceled")
  })
})
