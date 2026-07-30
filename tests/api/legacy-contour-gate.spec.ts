import { describe, expect, it } from "vitest"
import { setup, $fetch } from "@nuxt/test-utils/e2e"

describe("legacy contour HTTP gate", async () => {
  await setup({ server: true })

  it("отдаёт 404 на путях выключенных зон", async () => {
    for (const path of ["/api/proxies", "/api/device-profiles", "/api/warmup/sessions", "/api/google-drive"]) {
      await expect($fetch(path)).rejects.toMatchObject({ statusCode: 404 })
    }
  })

  it("не трогает действующие пути фабрики", async () => {
    await expect($fetch("/api/factory/batches")).rejects.not.toMatchObject({ statusCode: 404 })
  })
})
