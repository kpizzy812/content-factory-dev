/**
 * Регрессия buildImageScenePlan: сцена плана ищется по order, а не по позиции.
 *
 * Дефект: фолбэк «найти сцену плана по order» был недостижим — else-ветка всё равно
 * возвращала planScenes[i]. Порядок scenePrompts приходит от Claude и нигде не
 * сортируется, так что при перестановке (order'ы 3,1,2) в prompt изображения уезжал
 * AVOID-список ЧУЖОЙ сцены: устройства и негативы менялись местами.
 *
 * DB-free: buildImageScenePlan — чистая функция, БД и сеть не трогает.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest"
import type { DeviceType } from "~~/shared/utils/video-prompt-helpers"
import { DEVICE_NEGATIVES } from "~~/shared/utils/video-prompt-helpers"
import { buildImageScenePlan, indexPlanScenesByOrder } from "../../../server/utils/video-pipeline-steps"
import type { PromptGenerationResult } from "../../../server/utils/video-pipeline-db"

/** Промпты в story-driven виде: важен только order каждой сцены. */
function promptsWithOrders(orders: Array<number | undefined>): PromptGenerationResult {
  return {
    hook: "legacy hook",
    body: "legacy body",
    cta: "legacy cta",
    scenePrompts: {
      // order намеренно бывает мусорным (undefined) — данные приходят от модели.
      scenes: orders.map((order, i) => ({
        order: order as number,
        prompt: `prompt-${i}`,
        purpose: "scene",
      })),
    },
  }
}

function planScene(order: number, devicesInScene?: DeviceType[]) {
  return devicesInScene ? { order, devicesInScene } : { order }
}

function build(
  orders: Array<number | undefined>,
  planScenes: Array<{ order: number; devicesInScene?: DeviceType[] }> | null,
  thumbnailOnly = false,
) {
  return buildImageScenePlan({
    prompts: promptsWithOrders(orders),
    imageCount: 3,
    thumbnailOnly,
    planScenes,
  })
}

/** AVOID-хвост инжектируется в prompt только когда у сцены есть устройства. */
function hasAvoid(prompt: string): boolean {
  return prompt.includes(`AVOID: ${DEVICE_NEGATIVES.join(", ")}`)
}

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  // Позиционный фолбэк обязан быть слышен в логе, но засорять вывод тестов не должен.
  warn = vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  warn.mockRestore()
})

describe("buildImageScenePlan: сопоставление сцены плана по order", () => {
  it("перемешанный порядок — устройства берутся из сцены с тем же order, а не с той же позиции", () => {
    const plan = build(
      [3, 1, 2],
      [
        planScene(1, ["phone"]),
        planScene(2),
        planScene(3, ["laptop"]),
      ],
    )

    // Раньше было позиционно: ['phone'], undefined, ['laptop'] — ровно перепутанные сцены.
    expect(plan.scenes.map(s => s.devicesInScene)).toEqual([["laptop"], ["phone"], undefined])
    expect(plan.positionalFallbackKeys).toEqual([])
    expect(warn).not.toHaveBeenCalled()
  })

  it("перемешанный порядок — AVOID-хвост уезжает вместе с устройствами", () => {
    const plan = build([3, 1, 2], [planScene(1, ["phone"]), planScene(2), planScene(3, ["laptop"])])

    expect(hasAvoid(plan.scenes[0]!.prompt)).toBe(true)
    expect(hasAvoid(plan.scenes[1]!.prompt)).toBe(true)
    // Сцена плана order=2 без устройств — AVOID не нужен. Позиционно сюда приезжал laptop.
    expect(hasAvoid(plan.scenes[2]!.prompt)).toBe(false)
    expect(plan.scenes[2]!.prompt).toBe("prompt-2")
  })

  it("key и order ассета остаются от индекса цикла — файлы сцен не коллизируют", () => {
    const plan = build([3, 1, 2], [planScene(1, ["phone"]), planScene(2), planScene(3, ["laptop"])])

    expect(plan.scenes.map(s => s.key)).toEqual(["scene_1", "scene_2", "scene_3"])
    expect(plan.scenes.map(s => s.order)).toEqual([0, 1, 2])
    expect(plan.storyDriven).toBe(true)
    expect(plan.sourceSceneCount).toBe(3)
  })

  it("дубликат order В ПЛАНЕ — сопоставление неоднозначно, откат на позицию с WARN", () => {
    const plan = build(
      [2, 1],
      [
        planScene(1, ["phone"]),
        planScene(1, ["tv"]),
        planScene(2, ["tablet"]),
      ],
    )

    // order=2 в плане уникален — сцена сопоставилась честно.
    expect(plan.scenes[0]!.devicesInScene).toEqual(["tablet"])
    // order=1 в плане дважды: выбирать наугад нельзя, берём planScenes[1].
    expect(plan.scenes[1]!.devicesInScene).toEqual(["tv"])
    expect(plan.positionalFallbackKeys).toEqual(["scene_2"])
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it("дубликат order В ПРОМПТАХ — обе сцены претендуют на одну сцену плана, откат на позицию", () => {
    const plan = build(
      [2, 2, 1],
      [
        planScene(1, ["phone"]),
        planScene(2, ["tablet"]),
        planScene(3, ["tv"]),
      ],
    )

    expect(plan.duplicateOrders).toEqual([2])
    expect(plan.positionalFallbackKeys).toEqual(["scene_1", "scene_2"])
    expect(plan.scenes[0]!.devicesInScene).toEqual(["phone"])
    expect(plan.scenes[1]!.devicesInScene).toEqual(["tablet"])
    // Третья сцена с уникальным order=1 всё равно сопоставилась по order.
    expect(plan.scenes[2]!.devicesInScene).toEqual(["phone"])
  })

  it("отсутствующий order у сцены промпта — откат на позицию с WARN", () => {
    const plan = build(
      [1, undefined],
      [planScene(1, ["phone"]), planScene(2, ["tablet"])],
    )

    expect(plan.scenes[0]!.devicesInScene).toEqual(["phone"])
    expect(plan.scenes[1]!.devicesInScene).toEqual(["tablet"])
    expect(plan.positionalFallbackKeys).toEqual(["scene_2"])
  })

  it("order есть, но такой сцены нет в плане — откат на позицию с WARN", () => {
    const plan = build([1, 9], [planScene(1, ["phone"]), planScene(2, ["tablet"])])

    expect(plan.scenes[1]!.devicesInScene).toEqual(["tablet"])
    expect(plan.positionalFallbackKeys).toEqual(["scene_2"])
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it("сцен плана больше, чем промптов — сопоставление по order не смотрит на позицию", () => {
    const plan = build(
      [4],
      [planScene(1, ["phone"]), planScene(2), planScene(3, ["tv"]), planScene(4, ["smartwatch"])],
    )

    expect(plan.scenes[0]!.devicesInScene).toEqual(["smartwatch"])
    expect(plan.positionalFallbackKeys).toEqual([])
  })

  it("плана сцен нет вовсе — это не фолбэк, WARN не пишем", () => {
    const plan = build([2, 1], null)

    expect(plan.scenes.map(s => s.devicesInScene)).toEqual([undefined, undefined])
    expect(plan.positionalFallbackKeys).toEqual([])
    expect(warn).not.toHaveBeenCalled()
  })

  it("thumbnail-only берёт первую сцену промптов и её же сцену плана по order", () => {
    const plan = build(
      [3, 1, 2],
      [planScene(1, ["phone"]), planScene(2), planScene(3, ["laptop"])],
      true,
    )

    expect(plan.scenes).toHaveLength(1)
    expect(plan.scenes[0]!.key).toBe("scene_1")
    // Позиционно сюда приезжал phone от сцены плана order=1.
    expect(plan.scenes[0]!.devicesInScene).toEqual(["laptop"])
    expect(plan.sourceSceneCount).toBe(3)
    expect(plan.positionalFallbackKeys).toEqual([])
  })

  it("legacy-режим без scenePrompts не трогает сопоставление", () => {
    const legacy = buildImageScenePlan({
      prompts: { hook: "h", body: "b", cta: "c" },
      imageCount: 3,
      thumbnailOnly: false,
      planScenes: [planScene(1, ["phone"])],
    })

    expect(legacy.storyDriven).toBe(false)
    expect(legacy.scenes.map(s => s.key)).toEqual(["hook", "body_1", "cta"])
    expect(legacy.positionalFallbackKeys).toEqual([])
    expect(legacy.duplicateOrders).toEqual([])
  })
})

describe("indexPlanScenesByOrder: индекс только по однозначным order", () => {
  it("уникальные order попадают в индекс", () => {
    const a = planScene(1, ["phone"])
    const b = planScene(5, ["tv"])
    const map = indexPlanScenesByOrder([a, b])

    expect(map.get(1)).toBe(a)
    expect(map.get(5)).toBe(b)
    expect(map.size).toBe(2)
  })

  it("повторяющийся order выкидывается целиком — «первый выигрывает» тут было бы враньём", () => {
    const map = indexPlanScenesByOrder([planScene(1, ["phone"]), planScene(1, ["tv"]), planScene(2)])

    expect(map.has(1)).toBe(false)
    expect(map.has(2)).toBe(true)
  })

  it("нечисловой order в индекс не попадает", () => {
    const map = indexPlanScenesByOrder([
      { order: Number.NaN },
      { order: undefined as unknown as number },
      planScene(3),
    ])

    expect(map.size).toBe(1)
    expect(map.has(3)).toBe(true)
  })

  it("пустой вход — пустой индекс, без падений", () => {
    expect(indexPlanScenesByOrder(null).size).toBe(0)
    expect(indexPlanScenesByOrder(undefined).size).toBe(0)
    expect(indexPlanScenesByOrder([]).size).toBe(0)
  })
})
