/**
 * Contract-тесты scene-aware ветвления в 3 endpoint'ах (Этап 3 + Этап 7 тестов).
 *
 * Проверяем, что для shadow Scenario (trendId=null, sceneId!=null) endpoint'ы
 * НЕ возвращают 400 (TODO[scene-aware] был снесён), а отрабатывают через scene-driven
 * helpers и возвращают 200.
 *
 * Покрытие:
 *   - POST /api/scenarios/:id/rework-regenerate — 200 для shadow
 *   - POST /api/scenarios/:id/regenerate-block — 200 для blockType=hook
 *   - POST /api/scenarios/:id/improve-visual-style — 200 для variant с
 *     visualStyleStructured.
 *
 * ANTHROPIC_MOCK_MODE=true → scene-scripter + improve-visual-style возвращают
 * фикстуры (scene-scripter-happy.json, improve-visual-style-happy.json).
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'
import { createTestUser, authHeaders } from '../helpers/auth'
import { nuxtTestEnv } from '../helpers/nuxt-env'
import { prisma } from '../../server/utils/prisma'

await setup({
  dev: true,
  server: true,
  browser: false,
  env: {
    ...nuxtTestEnv,
    // improveVisualStylePrompt и scene-scripter гарданы requirePaidApisEnabled.
    // ANTHROPIC_MOCK_MODE подменяет реальный вызов на фикстуру, но guard всё равно
    // отрабатывает на верхнем уровне — поэтому здесь нужно ENABLE_PAID_APIS=true.
    ENABLE_PAID_APIS: 'true',
  },
})

/**
 * Создаёт shadow Scenario (trendId=null, sceneId=<новой сцены>) + 1 ScenarioVariant.
 */
async function createShadowScenario(opts: { withVisualStyleStructured?: boolean } = {}) {
  const seed = Math.floor(Math.random() * 1_000_000_000)
  const app = await prisma.app.create({
    data: {
      name: `Test App ${seed}`,
      description: 'Test app description',
      keywords: ['test'],
    },
  })
  const scene = await prisma.scene.create({
    data: {
      appId: app.id,
      name: `Scene ${seed}`,
      // блок action — чтобы composeScene не упал на пустоте
      blocks: [
        { id: 'b1', kind: 'action', description: 'герой открывает приложение' },
        { id: 'b2', kind: 'style', visualStyle: 'cinematic warm tones' },
      ] as object[],
      tags: [],
      status: 'draft',
    },
  })
  const scenario = await prisma.scenario.create({
    data: {
      trendId: null,
      sceneId: scene.id,
      appId: app.id,
      status: 'generated',
    },
  })
  const variant = await prisma.scenarioVariant.create({
    data: {
      scenarioId: scenario.id,
      variantIndex: 0,
      title: 'Old title',
      hook: 'Old hook',
      body: 'Old body',
      cta: 'Old cta',
      fullScript: 'Old fullScript',
      visualStyleText: 'Old visual style',
      visualStyleStructured: opts.withVisualStyleStructured
        ? {
            colors: ['#FFAA88', '#222222'],
            atmosphere: 'warm intimate',
            character: 'casual lifestyle',
            stylePrompt: 'cinematic warm-tone',
          }
        : undefined,
    },
  })
  await prisma.scenario.update({
    where: { id: scenario.id },
    data: { selectedVariantId: variant.id },
  })
  return { app, scene, scenario, variant }
}

describe('shadow Scenario — scene-aware endpoints', () => {
  it('POST /api/scenarios/:id/rework-regenerate возвращает 200 для shadow (не 400 TODO)', async () => {
    const user = await createTestUser({ canWrite: true, canRunAgent: true, canApprove: true })
    const { scenario, variant } = await createShadowScenario()

    // rework-regenerate требует чтобы variant был в needs_rework — выставим напрямую.
    await prisma.scenarioVariant.update({
      where: { id: variant.id },
      data: { status: 'needs_rework' },
    })

    const res = await $fetch<{ data: unknown; reworkCompleted?: boolean }>(
      `/api/scenarios/${scenario.id}/rework-regenerate`,
      {
        method: 'POST',
        headers: authHeaders(user.id),
        body: { variantId: variant.id },
      },
    )
    expect(res.reworkCompleted).toBe(true)
    const refreshed = await prisma.scenarioVariant.findUnique({ where: { id: variant.id } })
    // hook должен быть перезаписан scripter'ом (фикстура hook = "MockApp за 5 минут...")
    expect(refreshed?.hook).not.toBe('Old hook')
    expect(refreshed?.hook.length).toBeGreaterThan(10)
  })

  it('POST /api/scenarios/:id/regenerate-block возвращает 200 для shadow (blockType=hook)', async () => {
    const user = await createTestUser({ canWrite: true, canRunAgent: true })
    const { scenario, variant } = await createShadowScenario()

    const res = await $fetch<{ data: unknown; regeneratedBlock: string }>(
      `/api/scenarios/${scenario.id}/regenerate-block`,
      {
        method: 'POST',
        headers: authHeaders(user.id),
        body: { variantId: variant.id, blockType: 'hook', reason: 'make it punchier' },
      },
    )
    expect(res.regeneratedBlock).toBe('hook')
    const refreshed = await prisma.scenarioVariant.findUnique({ where: { id: variant.id } })
    expect(refreshed?.hook).not.toBe('Old hook')
    expect(refreshed?.hook.length).toBeGreaterThan(0)
  })

  it('POST /api/scenarios/:id/improve-visual-style возвращает 200 для shadow с structured style', async () => {
    const user = await createTestUser({ canWrite: true, canRunAgent: true })
    const { scenario, variant } = await createShadowScenario({ withVisualStyleStructured: true })

    const res = await $fetch<{ data: unknown; improvedPrompt: string }>(
      `/api/scenarios/${scenario.id}/improve-visual-style`,
      {
        method: 'POST',
        headers: authHeaders(user.id),
        body: { variantId: variant.id },
      },
    )
    expect(typeof res.improvedPrompt).toBe('string')
    expect(res.improvedPrompt.length).toBeGreaterThan(10)
    const refreshed = await prisma.scenarioVariant.findUnique({ where: { id: variant.id } })
    expect(refreshed?.visualStyleText).not.toBe('Old visual style')
  })

  it('POST /api/scenarios/:id/improve-visual-style возвращает 400 если нет visualStyleStructured', async () => {
    const user = await createTestUser({ canWrite: true, canRunAgent: true })
    const { scenario, variant } = await createShadowScenario({ withVisualStyleStructured: false })

    await expect(
      $fetch(`/api/scenarios/${scenario.id}/improve-visual-style`, {
        method: 'POST',
        headers: authHeaders(user.id),
        body: { variantId: variant.id },
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })
})
