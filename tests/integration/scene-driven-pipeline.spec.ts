/**
 * Integration test для scene-driven pipeline (Этап 7).
 *
 * Покрывает end-to-end: создание сцены композитора (с character блоком) → POST
 * /api/scenes/:id/generate → создаётся shadow Scenario с осмысленным textovem
 * hook (через scene-scripter agent mock) + ScenarioVariant с storyPlan версии
 * "scene-driven-1.0" + ≥2 scenes с visualPromptGuidance.
 *
 * Реального HTTP не идёт — ANTHROPIC_MOCK_MODE=true + фикстура scene-scripter-happy.json.
 *
 * Что проверяем:
 *   - Scenario создан с trendId=null, sceneId=<id сцены>
 *   - ScenarioVariant.hook это нормальный текст, НЕ compiled visual prompt
 *   - storyPlan.version === 'scene-driven-1.0'
 *   - storyPlan.scenes.length >= 2 (для detectRuntimeMode → story_driven)
 *   - каждый scenes[i].visualPromptGuidance не пустой
 *   - scene.status обновлён до 'ready' + scene.generatedScenarioId привязан
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
  env: nuxtTestEnv,
})

describe('scene-driven pipeline (character + scene_composer → scenario)', () => {
  it('POST /api/scenes/:id/generate создаёт shadow Scenario с textovym hook и story_driven storyPlan', async () => {
    const seed = Math.floor(Math.random() * 1_000_000_000)
    const user = await createTestUser({ canRunAgent: true })

    const app = await prisma.app.create({
      data: {
        name: `IntegrationApp ${seed}`,
        description: 'Test app for scene-driven integration',
        keywords: ['integration', 'test'],
      },
    })
    const character = await prisma.character.create({
      data: {
        appId: app.id,
        name: 'Hero Alex',
        description: 'Молодой профессионал 28 лет',
        visualPrompt: '28y athletic male, short brown hair, casual look',
        role: 'protagonist',
      },
    })
    const scene = await prisma.scene.create({
      data: {
        appId: app.id,
        name: 'Morning routine',
        blocks: [
          { id: 'b1', kind: 'character', characterId: character.id },
          { id: 'b2', kind: 'style', visualStyle: 'cinematic warm tones' },
          { id: 'b3', kind: 'environment', location: 'minimalist loft', timeOfDay: 'morning' },
          { id: 'b4', kind: 'action', description: 'герой открывает приложение' },
        ] as object[],
        tags: [],
        status: 'draft',
      },
    })

    // POST /api/scenes/:id/generate → должен запустить runScenarioGenerationForScene
    const res = await $fetch<{ data: { scenarioId: number; variantId: number; compiledPrompt: string } }>(
      `/api/scenes/${scene.id}/generate`,
      { method: 'POST', headers: authHeaders(user.id) },
    )

    expect(res.data.scenarioId).toBeGreaterThan(0)
    expect(res.data.variantId).toBeGreaterThan(0)
    expect(res.data.compiledPrompt.length).toBeGreaterThan(0)

    // Проверяем shadow Scenario
    const scenario = await prisma.scenario.findUnique({ where: { id: res.data.scenarioId } })
    expect(scenario).not.toBeNull()
    expect(scenario!.trendId).toBeNull() // shadow path
    expect(scenario!.sceneId).toBe(scene.id)
    expect(scenario!.appId).toBe(app.id)

    // Проверяем variant
    const variant = await prisma.scenarioVariant.findUnique({ where: { id: res.data.variantId } })
    expect(variant).not.toBeNull()
    expect(variant!.hook.length).toBeGreaterThan(0)
    // Hook это нормальный текст, а НЕ compiled visual prompt (длинная mash из визуальных деталей).
    // Из фикстуры scene-scripter-happy: "MockApp за 5 минут собрал план дня…"
    expect(variant!.hook).not.toContain('cinematic')
    expect(variant!.hook).not.toContain('warm tones')

    // Проверяем storyPlan
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const storyPlan = variant!.storyPlan as any
    expect(storyPlan).not.toBeNull()
    expect(storyPlan.version).toBe('scene-driven-1.0')
    expect(Array.isArray(storyPlan.scenes)).toBe(true)
    expect(storyPlan.scenes.length).toBeGreaterThanOrEqual(2)
    for (const s of storyPlan.scenes) {
      expect(typeof s.visualPromptGuidance).toBe('string')
      expect(s.visualPromptGuidance.length).toBeGreaterThan(0)
      expect(typeof s.duration).toBe('string')
    }

    // Проверяем, что сцена обновлена
    const refreshed = await prisma.scene.findUnique({ where: { id: scene.id } })
    expect(refreshed!.status).toBe('ready')
    expect(refreshed!.generatedScenarioId).toBe(res.data.scenarioId)
  })

  it('повторный POST /api/scenes/:id/generate создаёт НОВЫЙ Scenario (без idempotency на ручном вызове)', async () => {
    const seed = Math.floor(Math.random() * 1_000_000_000)
    const user = await createTestUser({ canRunAgent: true })

    const app = await prisma.app.create({
      data: { name: `App ${seed}`, description: 'd', keywords: [] },
    })
    const scene = await prisma.scene.create({
      data: {
        appId: app.id,
        name: 'Scene',
        blocks: [{ id: 'b1', kind: 'action', description: 'герой действует' }] as object[],
        tags: [],
        status: 'draft',
      },
    })
    const first = await $fetch<{ data: { scenarioId: number } }>(
      `/api/scenes/${scene.id}/generate`,
      { method: 'POST', headers: authHeaders(user.id) },
    )
    const second = await $fetch<{ data: { scenarioId: number } }>(
      `/api/scenes/${scene.id}/generate`,
      { method: 'POST', headers: authHeaders(user.id) },
    )
    expect(second.data.scenarioId).not.toBe(first.data.scenarioId)
  })

  it('пустая сцена возвращает 400', async () => {
    const seed = Math.floor(Math.random() * 1_000_000_000)
    const user = await createTestUser({ canRunAgent: true })
    const app = await prisma.app.create({
      data: { name: `App ${seed}`, description: 'd', keywords: [] },
    })
    const scene = await prisma.scene.create({
      data: { appId: app.id, name: 'Empty', blocks: [], tags: [], status: 'draft' },
    })
    await expect(
      $fetch(`/api/scenes/${scene.id}/generate`, { method: 'POST', headers: authHeaders(user.id) }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })
})
