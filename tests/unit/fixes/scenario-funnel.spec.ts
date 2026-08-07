/**
 * Резолвер воронки для генерации сценария.
 * Дефект: конвейерная нода не подтягивала воронку вообще, и автопрогон писал
 * CTA «скачай приложение» вместо кодового слова в директ.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest"
import {
  resolveScenarioFunnel,
  type ScenarioFunnelLookup,
  type ScenarioFunnelRecord,
} from "~~/server/utils/scenario-funnel"

const ACTIVE: ScenarioFunnelRecord = {
  id: "funnel-active",
  keyword: "РЕФОРМА",
  leadMagnet: { title: "Гайд: 7 дней без срывов" },
}

const FACTORY: ScenarioFunnelRecord = {
  id: "funnel-batch",
  keyword: "СТАРТ",
  leadMagnet: { title: "Чек-лист новичка" },
}

/** Заглушка БД: отдаёт запись по id из карты, без id — «последнюю активную». */
function lookupFrom(
  byId: Record<string, ScenarioFunnelRecord>,
  latestActive: ScenarioFunnelRecord | null,
): { lookup: ScenarioFunnelLookup; calls: Array<{ appId: number; funnelId?: string }> } {
  const calls: Array<{ appId: number; funnelId?: string }> = []
  const lookup: ScenarioFunnelLookup = async (args) => {
    calls.push(args)
    if (args.funnelId) return byId[args.funnelId] ?? null
    return latestActive
  }
  return { lookup, calls }
}

describe("resolveScenarioFunnel", () => {
  it("берёт последнюю активную воронку юнита и отдаёт формат ручного эндпоинта", async () => {
    const { lookup } = lookupFrom({}, ACTIVE)
    const result = await resolveScenarioFunnel(7, undefined, lookup)

    expect(result.funnel).toEqual({
      keyword: "РЕФОРМА",
      leadMagnetTitle: "Гайд: 7 дней без срывов",
    })
    expect(result.source).toBe("active")
    expect(result.warning).toBeNull()
  })

  it("отдаёт приоритет воронке из контекста фабрики", async () => {
    const { lookup, calls } = lookupFrom({ "funnel-batch": FACTORY }, ACTIVE)
    const result = await resolveScenarioFunnel(7, "funnel-batch", lookup)

    expect(result.funnel).toEqual({ keyword: "СТАРТ", leadMagnetTitle: "Чек-лист новичка" })
    expect(result.source).toBe("factory")
    // Активную воронку в этом случае даже не спрашиваем.
    expect(calls).toEqual([{ appId: 7, funnelId: "funnel-batch" }])
  })

  it("если воронка партии больше не активна — падает на активную и предупреждает", async () => {
    const { lookup, calls } = lookupFrom({}, ACTIVE)
    const result = await resolveScenarioFunnel(7, "funnel-gone", lookup)

    expect(result.funnel).toEqual({
      keyword: "РЕФОРМА",
      leadMagnetTitle: "Гайд: 7 дней без срывов",
    })
    expect(result.source).toBe("active")
    expect(result.warning).toContain("funnel-gone")
    expect(calls).toEqual([{ appId: 7, funnelId: "funnel-gone" }, { appId: 7 }])
  })

  it("без воронок отдаёт null, а не падает", async () => {
    const { lookup } = lookupFrom({}, null)
    const result = await resolveScenarioFunnel(7, undefined, lookup)

    expect(result.funnel).toBeNull()
    expect(result.source).toBe("none")
  })

  it("воронка без лид-магнита отдаётся с leadMagnetTitle=null", async () => {
    const { lookup } = lookupFrom({}, { id: "f", keyword: "СЛОВО", leadMagnet: null })
    const result = await resolveScenarioFunnel(7, undefined, lookup)

    expect(result.funnel).toEqual({ keyword: "СЛОВО", leadMagnetTitle: null })
  })
})
