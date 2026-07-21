/**
 * Contract-тесты POST /api/characters/:id/regenerate (Этап 5).
 *
 * Что покрыто:
 *   - 200 happy path для blockType=description
 *   - 200 happy path для blockType=visualPrompt
 *   - значения в БД действительно перезаписываются
 *   - 400 для невалидного blockType
 *   - 400 для отсутствующего blockType
 *   - 404 для несуществующего character
 *   - 403 без canRunAgent
 *
 * ANTHROPIC_MOCK_MODE=true → callAnthropicAgent грузит фикстуру.
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

async function createTestCharacter() {
  const seed = Math.floor(Math.random() * 1_000_000_000)
  const app = await prisma.app.create({
    data: {
      name: `Test App ${seed}`,
      description: 'Test app description',
      keywords: ['test'],
    },
  })
  const character = await prisma.character.create({
    data: {
      appId: app.id,
      name: `Hero ${seed}`,
      description: 'old description',
      visualPrompt: 'old visual prompt',
      role: 'protagonist',
    },
  })
  return { app, character }
}

describe('POST /api/characters/:id/regenerate — happy paths', () => {
  it('200 для blockType=description, поле в БД обновляется', async () => {
    const user = await createTestUser({ canRunAgent: true })
    const { character } = await createTestCharacter()

    const res = await $fetch<{ data: { newValue: string; oldValue: string; blockType: string } }>(
      `/api/characters/${character.id}/regenerate`,
      { method: 'POST', headers: authHeaders(user.id), body: { blockType: 'description' } },
    )

    expect(res.data.blockType).toBe('description')
    expect(res.data.oldValue).toBe('old description')
    expect(res.data.newValue.length).toBeGreaterThan(10)
    expect(res.data.newValue).not.toBe('old description')

    const refreshed = await prisma.character.findUnique({ where: { id: character.id } })
    expect(refreshed?.description).toBe(res.data.newValue)
    // visualPrompt не тронут
    expect(refreshed?.visualPrompt).toBe('old visual prompt')
  })

  it('200 для blockType=visualPrompt с reason', async () => {
    const user = await createTestUser({ canRunAgent: true })
    const { character } = await createTestCharacter()

    const res = await $fetch<{ data: { newValue: string; oldValue: string; blockType: string } }>(
      `/api/characters/${character.id}/regenerate`,
      {
        method: 'POST',
        headers: authHeaders(user.id),
        body: { blockType: 'visualPrompt', reason: 'add tattoo on arm' },
      },
    )
    expect(res.data.blockType).toBe('visualPrompt')
    expect(res.data.oldValue).toBe('old visual prompt')
    expect(res.data.newValue.length).toBeGreaterThan(10)

    const refreshed = await prisma.character.findUnique({ where: { id: character.id } })
    expect(refreshed?.visualPrompt).toBe(res.data.newValue)
    // description не тронут
    expect(refreshed?.description).toBe('old description')
  })
})

describe('POST /api/characters/:id/regenerate — validation errors', () => {
  it('400 для невалидного blockType', async () => {
    const user = await createTestUser({ canRunAgent: true })
    const { character } = await createTestCharacter()
    await expect(
      $fetch(`/api/characters/${character.id}/regenerate`, {
        method: 'POST',
        headers: authHeaders(user.id),
        body: { blockType: 'weird' },
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('400 для отсутствующего blockType', async () => {
    const user = await createTestUser({ canRunAgent: true })
    const { character } = await createTestCharacter()
    await expect(
      $fetch(`/api/characters/${character.id}/regenerate`, {
        method: 'POST',
        headers: authHeaders(user.id),
        body: {},
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('404 для несуществующего character', async () => {
    const user = await createTestUser({ canRunAgent: true })
    await expect(
      $fetch(`/api/characters/00000000-0000-0000-0000-000000000000/regenerate`, {
        method: 'POST',
        headers: authHeaders(user.id),
        body: { blockType: 'description' },
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('403 без canRunAgent', async () => {
    const user = await createTestUser({ canRunAgent: false, canRead: true, canAdmin: false })
    const { character } = await createTestCharacter()
    await expect(
      $fetch(`/api/characters/${character.id}/regenerate`, {
        method: 'POST',
        headers: authHeaders(user.id),
        body: { blockType: 'description' },
      }),
    ).rejects.toMatchObject({ statusCode: 403 })
  })
})
