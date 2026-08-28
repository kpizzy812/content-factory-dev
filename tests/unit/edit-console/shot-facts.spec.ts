/**
 * Факт исполнения кадров на клиенте: разбор ответа `GET /api/videos/:id/shots`
 * и то, как таблица отличает «кадр деградировал» от «кадр ещё не исполнялся».
 *
 * До появления ручки таблица подписывала колонку факта баннером «сервер её не
 * отдаёт». Ручка появилась — баннер обязан уйти, но на его место не должно
 * прийти враньё: у только что запланированного кадра `backgroundActual: null`,
 * и это НЕ отсутствие данных и НЕ ошибка, а «шаг фонов до него не дошёл».
 */
import { describe, expect, it } from "vitest"

import {
  buildShotRows,
  readShotFacts,
  shotsAwaitingExecution,
} from "../../../app/components/video/edit-console-model"
import { fetchEditProfile, fetchShotFacts } from "../../../app/components/video/edit-console-api"
import type { PlannedShot, ShotFact } from "../../../shared/types/edit-console"

function fact(over: Partial<ShotFact> = {}): ShotFact {
  return {
    order: 1,
    startSec: 0,
    endSec: 2.4,
    sceneOrder: 1,
    backgroundActual: null,
    status: "planned",
    costUsd: 0,
    degradeReason: null,
    assetPath: null,
    perceptualHash: null,
    ...over,
  }
}

function plannedShot(over: Partial<PlannedShot> = {}): PlannedShot {
  return {
    order: 1,
    startSec: 0,
    endSec: 2.4,
    sceneOrder: 1,
    foreground: "presenter",
    background: "library",
    backgroundClipId: "clip_1",
    appReferenceId: null,
    idea: "Ведущий в кадре",
    pipEnabled: false,
    costUsd: 0,
    degradeReason: null,
    ...over,
  }
}

describe("разбор ответа ручки кадров", () => {
  it("читает список из обёртки data и сортирует по позиции", () => {
    const facts = readShotFacts({
      data: [
        fact({ order: 3, backgroundActual: "image" }),
        fact({ order: 1, backgroundActual: "library" }),
      ],
    })

    expect(facts.map(f => f.order)).toEqual([1, 3])
    expect(facts[0]!.backgroundActual).toBe("library")
  })

  it("мусор вместо списка — пусто, а не падение экрана", () => {
    expect(readShotFacts(null)).toEqual([])
    expect(readShotFacts(undefined)).toEqual([])
    expect(readShotFacts({})).toEqual([])
    expect(readShotFacts({ data: "не массив" })).toEqual([])
    // Строка без номера кадра склеить с планом нельзя — она бесполезна.
    expect(readShotFacts({ data: [{ backgroundActual: "image" }] })).toEqual([])
  })

  it("не выдумывает факт: null остаётся null, а не превращается в «нет фона»", () => {
    const [row] = readShotFacts({ data: [fact()] })

    expect(row!.backgroundActual).toBeNull()
    expect(row!.status).toBe("planned")
    expect(row!.perceptualHash).toBeNull()
    expect(row!.assetPath).toBeNull()
  })

  it("везёт поля исполнения целиком — границы, сцену, хеш и путь к файлу", () => {
    const [row] = readShotFacts({
      data: [fact({
        order: 2,
        startSec: 2.4,
        endSec: 5.1,
        sceneOrder: 3,
        backgroundActual: "image",
        status: "completed",
        costUsd: 0.04,
        degradeReason: "Потолок расхода на видео исчерпан — снята картинка",
        assetPath: "videos/7/shot_2_composed.mp4",
        perceptualHash: "a1b2c3d4",
      })],
    })

    expect(row).toEqual({
      order: 2,
      startSec: 2.4,
      endSec: 5.1,
      sceneOrder: 3,
      backgroundActual: "image",
      status: "completed",
      costUsd: 0.04,
      degradeReason: "Потолок расхода на видео исчерпан — снята картинка",
      assetPath: "videos/7/shot_2_composed.mp4",
      perceptualHash: "a1b2c3d4",
    })
  })
})

describe("«кадры ещё не исполнялись» — отдельное состояние, а не ошибка", () => {
  it("все кадры без факта — это ожидание шага фонов", () => {
    expect(shotsAwaitingExecution([fact({ order: 1 }), fact({ order: 2 })])).toBe(true)
  })

  it("хотя бы один исполненный кадр — ожидание закончилось", () => {
    expect(shotsAwaitingExecution([
      fact({ order: 1, backgroundActual: "library", status: "completed" }),
      fact({ order: 2 }),
    ])).toBe(false)
  })

  it("кадров нет вовсе — ждать нечего (план ещё не построен)", () => {
    expect(shotsAwaitingExecution([])).toBe(false)
  })

  it("неисполненный кадр не помечается деградировавшим", () => {
    // Главная ловушка подключения факта: строка факта теперь есть ВСЕГДА,
    // сразу после шага плана. Если бы `buildShotRows` считала пустой
    // `backgroundActual` расхождением с планом, вся таблица покраснела бы
    // «деградацией» ещё до того, как фоны вообще начали сниматься.
    const [row] = buildShotRows([plannedShot({ background: "image" })], [fact({ order: 1 })])

    expect(row!.degraded).toBe(false)
    expect(row!.backgroundActual).toBeNull()
    expect(row!.status).toBe("planned")
  })

  it("плановая стоимость не обнуляется фактом неисполненного кадра", () => {
    // `VideoShot.costUsd` пишется ещё планом (saveShots), а шаг фонов его
    // перезаписывает фактом. Значит смета кадра видна оператору до исполнения,
    // и подключение факта не должно превратить её в прочерк.
    const [row] = buildShotRows(
      [plannedShot({ background: "image", costUsd: 0.04 })],
      [fact({ order: 1, costUsd: 0.04 })],
    )

    expect(row!.costUsd).toBeCloseTo(0.04, 6)
  })
})

describe("запросы читающих ручек", () => {
  it("факт кадров берётся ровно у своей ручки и методом по умолчанию", async () => {
    const calls: Array<{ url: string, method?: string }> = []
    const fetcher = async <T = unknown>(url: string, options?: { method?: string }) => {
      calls.push({ url, method: options?.method })
      return { data: [fact({ order: 5, backgroundActual: "video" })] } as T
    }

    const facts = await fetchShotFacts(fetcher, 42)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe("/api/videos/42/shots")
    // Чтение обязано остаться чтением: никакого method: POST здесь быть не может.
    expect(calls[0]!.method).toBeUndefined()
    expect(facts.map(f => f.order)).toEqual([5])
  })

  it("профиль читается по своему id, а не списком через чужой модуль", async () => {
    const calls: string[] = []
    const fetcher = async <T = unknown>(url: string) => {
      calls.push(url)
      return { data: { id: 9, name: "Бренд A", imageBudgetUsd: 1.5 } } as T
    }

    const profile = await fetchEditProfile(fetcher, 9)

    expect(calls).toEqual(["/api/edit-profiles/9"])
    expect(profile?.id).toBe(9)
    // Профиля нет — это не исключение экрана, а честный null.
    expect(await fetchEditProfile(async <T = unknown>() => ({} as T), 9)).toBeNull()
  })

  it("профиль ролика больше не ходит через чужой модуль первым делом", async () => {
    const { readFileSync } = await import("node:fs")
    const { resolve } = await import("node:path")
    const source = readFileSync(resolve(process.cwd(), "app/composables/useVideoEditProfile.ts"), "utf8")

    expect(source).toContain("fetchEditProfile")
    // Цепочка через сценарий остаётся — но только как запасной путь для
    // роликов без явного профиля, а не как единственный.
    expect(source).toContain("/api/scenarios/")
    expect(source.indexOf("fetchEditProfile($fetch")).toBeLessThan(source.indexOf("/api/scenarios/"))
  })
})

describe("таблица кадров подключена к факту", () => {
  const table = "app/components/video/VideoShotsTable.vue"

  it("баннер «факта нет» снят — ручка появилась", async () => {
    const { readFileSync } = await import("node:fs")
    const { resolve } = await import("node:path")
    const source = readFileSync(resolve(process.cwd(), table), "utf8")

    expect(source).not.toContain("отдельной ручкой сервер пока не отдаёт")
    expect(source).not.toContain("колонка «факт» пуста намеренно")
  })

  it("факт грузится через защищённый слой запросов, а не собранным руками URL", async () => {
    const { readFileSync } = await import("node:fs")
    const { resolve } = await import("node:path")
    const source = readFileSync(resolve(process.cwd(), table), "utf8")

    expect(source).toContain("fetchShotFacts")
    // Адрес ручки собирается в `edit-console-api.ts`, а не здесь: иначе он
    // разъедется с тем, что покрыто тестами слоя запросов.
    expect(source).not.toContain("`/api/videos/${")
    // Отказ ручки объясняется словами сервера — таблица не молчит и не врёт.
    expect(source).toContain("Не удалось загрузить кадры")
  })

  it("состояние «кадры ещё не исполнялись» подписано отдельно от ошибки", async () => {
    const { readFileSync } = await import("node:fs")
    const { resolve } = await import("node:path")
    const source = readFileSync(resolve(process.cwd(), table), "utf8")

    expect(source).toContain("shotsAwaitingExecution")
  })
})

describe("контракт факта кадра в shared", () => {
  it("описывает поля исполнения, а не только фон", async () => {
    const { readFileSync } = await import("node:fs")
    const { resolve } = await import("node:path")
    const types = readFileSync(resolve(process.cwd(), "shared/types/edit-console.ts"), "utf8")

    expect(types).toContain("export interface ShotFact {")
    expect(types).toContain("perceptualHash: string | null")
    expect(types).toContain("assetPath: string | null")
    expect(types).toContain("sceneOrder: number | null")
  })
})
