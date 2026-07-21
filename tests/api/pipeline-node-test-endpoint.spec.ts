/**
 * Регрессионный contract-тест POST /api/pipelines/nodes/test для трёх типов,
 * которых раньше не было в локальном VALID_NODE_TYPES (caption_generator,
 * google_drive_scanner, video_analyzer).
 *
 * Цель: убедиться, что endpoint больше не возвращает 400 «Неизвестный тип
 * ноды» для этих типов. Реальное выполнение (через executeNode) может
 * упасть из-за отсутствующего конфига или внешних API — это ок, мы ловим
 * другую регрессию (валидация типа).
 *
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest"
import { setup, $fetch } from "@nuxt/test-utils/e2e"
import { createTestUser, authHeaders } from "../helpers/auth"
import { nuxtTestEnv } from "../helpers/nuxt-env"

await setup({
  dev: true,
  server: true,
  browser: false,
  env: nuxtTestEnv,
})

interface TestEndpointResponse {
  data: {
    success: boolean
    output?: unknown
    error?: string
    duration: number
  }
}

const PREVIOUSLY_UNKNOWN_TYPES = [
  "caption_generator",
  "google_drive_scanner",
  "video_analyzer",
] as const

describe("POST /api/pipelines/nodes/test — реестр типов нод", () => {
  it.each(PREVIOUSLY_UNKNOWN_TYPES)(
    "тип %s не отклоняется как «неизвестный»",
    async (nodeType) => {
      const user = await createTestUser({ canRunAgent: true })

      try {
        const res = await $fetch<TestEndpointResponse>(
          "/api/pipelines/nodes/test",
          {
            method: "POST",
            headers: authHeaders(user.id),
            body: { nodeType, nodeConfig: {}, mockInput: {} },
          },
        )
        // Endpoint вернул 200 — может быть success=true или success=false
        // (внутри executeNode упало по другой причине). Главное — НЕ
        // отвалилось до executeNode из-за валидации типа.
        expect(res.data).toBeDefined()
        if (res.data.success === false && res.data.error) {
          expect(res.data.error).not.toMatch(/Неизвестный тип ноды/i)
        }
      }
      catch (err) {
        const e = err as { statusCode?: number; data?: { message?: string }; message?: string }
        // Если вылетел 400 с сообщением «Неизвестный тип ноды» — это та
        // самая регрессия, которую мы починили. Любая другая ошибка ок.
        const message = e.data?.message ?? e.message ?? ""
        if (e.statusCode === 400) {
          expect(message).not.toMatch(/Неизвестный тип ноды/i)
        }
      }
    },
    60_000,
  )

  it("явно мусорный тип всё ещё отклоняется с 400", async () => {
    const user = await createTestUser({ canRunAgent: true })

    let caught = false
    try {
      await $fetch("/api/pipelines/nodes/test", {
        method: "POST",
        headers: authHeaders(user.id),
        body: { nodeType: "definitely_not_a_real_node_type_xyz", nodeConfig: {}, mockInput: {} },
      })
    }
    catch (err) {
      caught = true
      const e = err as { statusCode?: number; data?: { message?: string } }
      expect(e.statusCode).toBe(400)
      expect(e.data?.message ?? "").toMatch(/Неизвестный тип ноды/i)
    }
    expect(caught).toBe(true)
  })
})
