/**
 * Contract-тесты POST /api/scenes/:id/blocks/:blockId/regenerate (Этап 4).
 *
 * Что покрыто:
 *   - 200 happy path для kind=action (мокаемый Anthropic возвращает фикстуру)
 *   - 200 happy path для kind=style
 *   - 200 happy path для kind=environment
 *   - блок сохраняется в БД с тем же id и kind
 *   - 400 для kind=character/app_screen/app_context (не AI-генеративный)
 *   - 404 для несуществующего blockId
 *   - 404 для несуществующего sceneId
 *   - 403 без canRunAgent
 *
 * ANTHROPIC_MOCK_MODE=true в nuxtTestEnv → callAnthropicAgent грузит фикстуру.
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

async function createTestScene(opts: { blockKind?: 'action' | 'style' | 'environment' | 'character' | 'app_screen' | 'app_context' } = {}) {
  const seed = Math.floor(Math.random() * 1_000_000_000)
  const app = await prisma.app.create({
    data: {
      name: `Test App ${seed}`,
      description: 'Test app description',
      keywords: ['test'],
    },
  })

  const kind = opts.blockKind ?? 'action'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let block: any
  switch (kind) {
    case 'action': block = { id: 'b-act', kind: 'action', description: 'old' }; break
    case 'style': block = { id: 'b-stl', kind: 'style', visualStyle: 'old' }; break
    case 'environment': block = { id: 'b-env', kind: 'environment', location: 'old' }; break
    case 'character': block = { id: 'b-chr', kind: 'character', characterId: 'noop' }; break
    case 'app_screen': block = { id: 'b-as', kind: 'app_screen', referenceImageId: 'noop' }; break
    case 'app_context': block = { id: 'b-ac', kind: 'app_context', focus: 'value-prop' }; break
  }
  const scene = await prisma.scene.create({
    data: {
      appId: app.id,
      name: `Scene ${seed}`,
      blocks: [block] as object[],
      tags: [],
      status: 'draft',
    },
  })
  return { app, scene, blockId: block.id as string }
}

describe('POST /api/scenes/:id/blocks/:blockId/regenerate — happy paths', () => {
  it('200 для kind=action, блок сохранён с тем же id', async () => {
    const user = await createTestUser({ canRunAgent: true })
    const { scene, blockId } = await createTestScene({ blockKind: 'action' })
    const res = await $fetch<{ data: { updatedBlock: { id: string; kind: string; description: string } } }>(
      `/api/scenes/${scene.id}/blocks/${blockId}/regenerate`,
      { method: 'POST', headers: authHeaders(user.id), body: { reason: 'add motion' } },
    )
    expect(res.data.updatedBlock.id).toBe(blockId)
    expect(res.data.updatedBlock.kind).toBe('action')
    expect(res.data.updatedBlock.description.length).toBeGreaterThan(0)
    // verify DB persisted
    const refreshed = await prisma.scene.findUnique({ where: { id: scene.id } })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blocks = refreshed?.blocks as any[]
    expect(blocks[0].id).toBe(blockId)
    expect(blocks[0].kind).toBe('action')
  })

  it('200 для kind=style', async () => {
    const user = await createTestUser({ canRunAgent: true })
    const { scene, blockId } = await createTestScene({ blockKind: 'style' })
    const res = await $fetch<{ data: { updatedBlock: { kind: string; visualStyle: string } } }>(
      `/api/scenes/${scene.id}/blocks/${blockId}/regenerate`,
      { method: 'POST', headers: authHeaders(user.id), body: {} },
    )
    expect(res.data.updatedBlock.kind).toBe('style')
    expect(res.data.updatedBlock.visualStyle.length).toBeGreaterThan(0)
  })

  it('200 для kind=environment', async () => {
    const user = await createTestUser({ canRunAgent: true })
    const { scene, blockId } = await createTestScene({ blockKind: 'environment' })
    const res = await $fetch<{ data: { updatedBlock: { kind: string; location: string } } }>(
      `/api/scenes/${scene.id}/blocks/${blockId}/regenerate`,
      { method: 'POST', headers: authHeaders(user.id), body: {} },
    )
    expect(res.data.updatedBlock.kind).toBe('environment')
    expect(res.data.updatedBlock.location.length).toBeGreaterThan(0)
  })
})

describe('POST /api/scenes/:id/blocks/:blockId/regenerate — errors', () => {
  it('400 для kind=character (не регенерируется AI)', async () => {
    const user = await createTestUser({ canRunAgent: true })
    const { scene, blockId } = await createTestScene({ blockKind: 'character' })
    await expect(
      $fetch(`/api/scenes/${scene.id}/blocks/${blockId}/regenerate`, {
        method: 'POST',
        headers: authHeaders(user.id),
        body: {},
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('400 для kind=app_screen', async () => {
    const user = await createTestUser({ canRunAgent: true })
    const { scene, blockId } = await createTestScene({ blockKind: 'app_screen' })
    await expect(
      $fetch(`/api/scenes/${scene.id}/blocks/${blockId}/regenerate`, {
        method: 'POST',
        headers: authHeaders(user.id),
        body: {},
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('400 для kind=app_context', async () => {
    const user = await createTestUser({ canRunAgent: true })
    const { scene, blockId } = await createTestScene({ blockKind: 'app_context' })
    await expect(
      $fetch(`/api/scenes/${scene.id}/blocks/${blockId}/regenerate`, {
        method: 'POST',
        headers: authHeaders(user.id),
        body: {},
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('404 для несуществующего blockId', async () => {
    const user = await createTestUser({ canRunAgent: true })
    const { scene } = await createTestScene()
    await expect(
      $fetch(`/api/scenes/${scene.id}/blocks/nonexistent-id/regenerate`, {
        method: 'POST',
        headers: authHeaders(user.id),
        body: {},
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('404 для несуществующего sceneId', async () => {
    const user = await createTestUser({ canRunAgent: true })
    await expect(
      $fetch(`/api/scenes/00000000-0000-0000-0000-000000000000/blocks/foo/regenerate`, {
        method: 'POST',
        headers: authHeaders(user.id),
        body: {},
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('403 без canRunAgent', async () => {
    // Юзер без canRunAgent (но с canRead — должен пройти module-access, но упасть на permission)
    const user = await createTestUser({ canRunAgent: false, canRead: true, canAdmin: false })
    const { scene, blockId } = await createTestScene({ blockKind: 'action' })
    await expect(
      $fetch(`/api/scenes/${scene.id}/blocks/${blockId}/regenerate`, {
        method: 'POST',
        headers: authHeaders(user.id),
        body: {},
      }),
    ).rejects.toMatchObject({ statusCode: 403 })
  })
})
