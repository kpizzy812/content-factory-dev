/**
 * Contract-тест endpoint'а POST /api/pipelines/nodes/test для типа
 * google_drive_uploader. Проверяем что:
 *  - Валидный nodeType распознан реестром (НЕ "Неизвестный тип ноды").
 *  - При отсутствии credentialId — внятная ошибка с упоминанием credentialId.
 *  - При отсутствии folderId — внятная ошибка с упоминанием folderId.
 *
 * Endpoint оборачивает все ошибки executor'а в success:false + error,
 * поэтому ловим ошибки в data.error, а не как throw.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'
import { createTestUser, authHeaders } from '../helpers/auth'
import { nuxtTestEnv } from '../helpers/nuxt-env'

await setup({
  dev: true,
  server: true,
  browser: false,
  env: nuxtTestEnv,
})

interface TestResponse {
  data: {
    success: boolean
    error?: string
    output?: unknown
  }
}

describe('POST /api/pipelines/nodes/test — nodeType=google_drive_uploader', () => {
  it('распознаёт тип google_drive_uploader (не "Неизвестный тип ноды")', async () => {
    const user = await createTestUser({ canRunAgent: true })
    const res = await $fetch<TestResponse>('/api/pipelines/nodes/test', {
      method: 'POST',
      headers: authHeaders(user.id),
      body: {
        nodeType: 'google_drive_uploader',
        nodeConfig: { credentialId: 1, folderId: 'folder1234567890' },
        mockInput: { _runId: 0, videos: [] },
      },
    })
    // Может упасть из-за отсутствующих сущностей, но НЕ из-за неизвестного типа
    if (!res.data.success) {
      expect(res.data.error).not.toMatch(/Неизвестный тип ноды/i)
    } else {
      expect(res.data.success).toBe(true)
    }
  })

  it('без credentialId — ошибка с упоминанием credentialId', async () => {
    const user = await createTestUser({ canRunAgent: true })
    const res = await $fetch<TestResponse>('/api/pipelines/nodes/test', {
      method: 'POST',
      headers: authHeaders(user.id),
      body: {
        nodeType: 'google_drive_uploader',
        nodeConfig: { folderId: 'folder1234567890' },
        mockInput: { _runId: 1, videos: [] },
      },
    })
    expect(res.data.success).toBe(false)
    expect(res.data.error).toMatch(/credentialId/)
  })

  it('без folderId — ошибка с упоминанием folderId', async () => {
    const user = await createTestUser({ canRunAgent: true })
    const res = await $fetch<TestResponse>('/api/pipelines/nodes/test', {
      method: 'POST',
      headers: authHeaders(user.id),
      body: {
        nodeType: 'google_drive_uploader',
        nodeConfig: { credentialId: 42 },
        mockInput: { _runId: 1, videos: [] },
      },
    })
    expect(res.data.success).toBe(false)
    expect(res.data.error).toMatch(/folderId/)
  })
})
