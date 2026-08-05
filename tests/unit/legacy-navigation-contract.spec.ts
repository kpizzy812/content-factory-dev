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
    // Структура навигации переехала из layouts/default.vue в composable —
    // его читают сайдбар, крошки и командная палитра, поэтому гейт зон
    // должен стоять именно там, иначе выключенный раздел останется в ⌘K.
    const nav = file("app/composables/useAppNavigation.ts")
    expect(nav).toContain("useLegacyModules")
    expect(nav).toContain("legacyModules.value.deviceAutomation")
    expect(nav).toContain("legacyModules.value.proxyPool")
    expect(nav).toContain("legacyModules.value.googleDrive")
  })

  it("карта зон загружается оболочкой", () => {
    const layout = file("app/layouts/default.vue")
    expect(layout).toContain("loadLegacyModules")
  })
})
