import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const file = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8")

describe("legacy navigation contract", () => {
  it("публикует карту зон для клиента", () => {
    expect(existsSync(resolve(process.cwd(), "server/api/product-modules.get.ts"))).toBe(true)
    expect(existsSync(resolve(process.cwd(), "app/composables/useLegacyModules.ts"))).toBe(true)
  })

  it("прячет пункты меню выключенных зон", () => {
    const layout = file("app/layouts/default.vue")
    expect(layout).toContain("useLegacyModules")
    expect(layout).toContain("legacyModules.value.deviceAutomation")
    expect(layout).toContain("legacyModules.value.proxyPool")
    expect(layout).toContain("legacyModules.value.googleDrive")
  })
})
