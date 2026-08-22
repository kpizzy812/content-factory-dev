import { describe, expect, it, vi } from "vitest"

import { runEditPlanStep } from "~~/server/utils/edit-plan/runner"
import { DEFAULT_EDIT_PROFILE } from "~~/server/utils/edit-plan/profile"
import type { EditPlanModelShot, EditPlanStepDeps, EditPlanStepInput } from "~~/server/utils/edit-plan/runner"

/**
 * Тесты раннера шага плана монтажа.
 *
 * Раннер — пример строгого разделения §5.1: границы кадров считает КОД
 * (`grid.ts`), смысл заполняет МОДЕЛЬ. Ключевое отличие от брифа задачи
 * (см. отчёт task-5-report.md): модель НИКОГДА не может подменить геометрию —
 * `materializeShots` берёт `startSec`/`endSec` только из сетки, любые
 * присланные моделью границы молча игнорируются. Поэтому тест "модель вернула
 * мусорные границы" из брифа не воспроизводим буквально: такой мусор просто
 * не долетает до валидации. Вместо этого ниже — сценарии, которые
 * действительно проходят через `validateShotPlan`/`repairShotPlan`.
 */

const ALIGNED = [
  { order: 1, startSec: 0, endSec: 4, words: [
    { text: "первое", startSec: 0, endSec: 1.8, matched: true },
    { text: "второе", startSec: 2.0, endSec: 4.0, matched: true },
  ] },
  { order: 2, startSec: 4.2, endSec: 8, words: [
    { text: "третье", startSec: 4.2, endSec: 6.0, matched: true },
    { text: "четвёртое", startSec: 6.2, endSec: 8.0, matched: true },
  ] },
]

const INPUT: EditPlanStepInput = {
  videoId: 7,
  trackDurationSec: 8,
  fps: 30,
  alignedScenes: ALIGNED,
  profile: { ...DEFAULT_EDIT_PROFILE },
  lipSyncMaxDurationSec: 10,
  minGenerativeVideoSec: 5,
  maxGenerativeVideoSec: 10,
  generativeVideoUsdPerSec: 0.05,
  imageUsd: 0.025,
  presenterSceneOrders: [1],
  backgrounds: [],
  appScreens: [],
}

function deps(overrides: Partial<EditPlanStepDeps> = {}): EditPlanStepDeps {
  return {
    askModel: vi.fn(async (grid: Array<{ order: number }>): Promise<{ shots: EditPlanModelShot[] }> => ({
      shots: grid.map(cell => ({ ...cell, foreground: "none", background: "image", idea: "идея" }) as EditPlanModelShot),
    })),
    saveShots: vi.fn(async () => {}),
    log: vi.fn(async () => {}),
    ...overrides,
  }
}

describe("шаг плана монтажа", () => {
  it("кадры покрывают трек без дыр и нахлёстов", async () => {
    const result = await runEditPlanStep(INPUT, deps())

    expect(result.status).not.toBe("failed" as never)
    expect(result.shots[0]!.startSec).toBeCloseTo(0, 3)
    expect(result.shots[result.shots.length - 1]!.endSec).toBeCloseTo(8, 3)
    for (let i = 1; i < result.shots.length; i += 1) {
      expect(result.shots[i]!.startSec).toBeCloseTo(result.shots[i - 1]!.endSec, 3)
    }
  })

  it("не спрашивает у модели секунды — сетка кадров считается кодом", async () => {
    const dependencies = deps()

    await runEditPlanStep(INPUT, dependencies)

    const [grid] = (dependencies.askModel as ReturnType<typeof vi.fn>).mock.calls[0]!
    // В сетке уже есть границы: модель заполняет только смысл.
    expect(grid[0]).toHaveProperty("startSec")
    expect(grid[0]).toHaveProperty("endSec")
    expect(grid[0]).toHaveProperty("text")
  })

  it("ответ модели склеивается с сеткой ПО order, а не по позиции в массиве", async () => {
    // Модель возвращает ОДИН элемент, помеченный ПОСЛЕДНИМ order сетки, но
    // кладёт его ПЕРВЫМ (и единственным) элементом ответа. Склейка по позиции
    // (modelShots[index]) ошибочно применила бы его к кадру order=0; склейка
    // по order обязана применить его к кадру с ЭТИМ order, где бы он ни стоял
    // в массиве ответа.
    const dependencies = deps({
      askModel: vi.fn(async (grid: Array<{ order: number }>) => ({
        shots: [{
          order: grid[grid.length - 1]!.order,
          foreground: "presenter",
          background: "video",
          idea: "маркер",
        }] as EditPlanModelShot[],
      })),
    })

    const result = await runEditPlanStep(INPUT, dependencies)

    const lastOrder = result.shots.length - 1
    // Кадр с ПОСЛЕДНИМ order получил ИМЕННО присланные моделью значения.
    expect(result.shots[lastOrder]!.idea).toBe("маркер")
    // Кадр с order=0 остался НЕЗАПОЛНЕННЫМ (получил дефолт), а не значения,
    // присланные для последнего кадра.
    expect(result.shots[0]!.idea).not.toBe("маркер")
  })

  it("модель не обязана заполнить все кадры — сетка склеивается по order, незаполненные получают дефолт", async () => {
    // Мок Anthropic грузит СТАТИЧЕСКУЮ фикстуру: она физически не может
    // совпасть по длине с ДИНАМИЧЕСКОЙ сеткой ролика. Возвращаем только
    // ПЕРВЫЙ кадр (order=0) — остальные обязаны получить детерминированный
    // дефолт, а не упасть с ошибкой длины.
    const dependencies = deps({
      askModel: vi.fn(async (grid: Array<{ order: number, sceneOrder: number | null }>) => ({
        shots: [{ order: grid[0]!.order, foreground: "none", background: "image", idea: "идея" }],
      })),
    })

    const result = await runEditPlanStep(INPUT, dependencies)

    // Presenter-сцена (order=1) не заполнена моделью -> дефолт "presenter"/"none".
    const presenterShot = result.shots.find(s => s.sceneOrder === 1 && s.order !== 0)
    expect(presenterShot).toBeDefined()
    expect(presenterShot!.foreground).toBe("presenter")
    expect(presenterShot!.background).toBe("none")
    // Не-presenter сцена (order=2), тоже не заполненная -> дефолт "none"/"image".
    const brollShot = result.shots.find(s => s.sceneOrder === 2)
    expect(brollShot).toBeDefined()
    expect(brollShot!.foreground).toBe("none")
    expect(brollShot!.background).toBe("image")
    expect(result.warnings.some(w => /не заполнила/.test(w))).toBe(true)
  })

  it("чинит ссылку модели на несуществующий фон детерминированно, не спрашивая её второй раз", async () => {
    const dependencies = deps({
      askModel: vi.fn(async (grid: Array<{ order: number }>) => ({
        // "library" без известного клипа (backgrounds: []) — unknown_background,
        // код обязан починить сам, без похода к модели за деньги повторно.
        shots: grid.map(cell => ({
          order: cell.order,
          foreground: "none",
          background: "library",
          backgroundClipId: "does-not-exist",
        })) as EditPlanModelShot[],
      })),
    })

    const result = await runEditPlanStep(INPUT, dependencies)

    expect(dependencies.askModel).toHaveBeenCalledTimes(1)
    expect(result.status).toBe("repaired")
    for (const shot of result.shots) {
      expect(shot.background).not.toBe("library")
      expect(shot.backgroundClipId).toBeNull()
    }
  })

  it("broll_ratio — предупреждение, а не блокирующее нарушение: план завершается, а не уходит на второй запрос", async () => {
    // Все кадры без ведущего -> доля перебивок 100% при цели 40% (дефолт
    // профиля) — далеко за пределами допуска, но раскладка ведущего и
    // перебивок это СМЫСЛ (работа модели), а не арифметика, которую чинит код.
    const dependencies = deps()

    const result = await runEditPlanStep(INPUT, dependencies)

    expect(dependencies.askModel).toHaveBeenCalledTimes(1)
    expect(result.warnings.some(w => /перебивк/i.test(w))).toBe(true)
  })

  it("каждый кадр проходит через pickBackgroundSource: потолок бюджета исчерпан — код деградирует до картинки, а не repair", async () => {
    // Это единственный сценарий, который различает pickBackgroundSource и
    // repairShotPlan: repair умеет отклонить "video" по ДЛИТЕЛЬНОСТИ кадра и
    // по флагу профиля (оба — чистая функция без памяти о соседях), но не
    // умеет накопить бюджет ПО ВСЕМУ ПЛАНУ — это единственная работа
    // pickBackgroundSource, вызываемого раннером в порядке кадров.
    const scenes = [
      { order: 1, startSec: 0, endSec: 5, words: [{ text: "а", startSec: 0, endSec: 5, matched: true }] },
      { order: 2, startSec: 5, endSec: 10, words: [{ text: "б", startSec: 5, endSec: 10, matched: true }] },
      { order: 3, startSec: 10, endSec: 15, words: [{ text: "в", startSec: 10, endSec: 15, matched: true }] },
    ]
    const budgetInput: EditPlanStepInput = {
      ...INPUT,
      alignedScenes: scenes,
      trackDurationSec: 15,
      presenterSceneOrders: [],
      profile: { ...DEFAULT_EDIT_PROFILE, shotChangeSec: 5, generativeVideoEnabled: true },
    }
    const dependencies = deps({
      askModel: vi.fn(async (grid: Array<{ order: number }>) => ({
        shots: grid.map(cell => ({ order: cell.order, foreground: "none", background: "video", idea: "рывок камеры" }) as EditPlanModelShot),
      })),
    })

    const result = await runEditPlanStep(budgetInput, dependencies)

    // Бюджет по умолчанию $0.5, каждый клип (5с по ставке $0.05/с) стоит
    // $0.25 — ровно два кадра укладываются в потолок, третий его исчерпывает.
    expect(result.shots[0]!.background).toBe("video")
    expect(result.shots[0]!.costUsd).toBeCloseTo(0.25, 6)
    expect(result.shots[1]!.background).toBe("video")
    expect(result.shots[1]!.costUsd).toBeCloseTo(0.25, 6)
    expect(result.shots[2]!.background).toBe("image")
    expect(result.shots[2]!.degradeReason).toMatch(/потолок/i)
    expect(result.shots[2]!.costUsd).toBeCloseTo(INPUT.imageUsd, 6)
  })

  it("бюджет генеративного видео копится по countsAgainstBudgetUsd, а не по costUsd картинок", async () => {
    // Требование 5, буквально: pick.costUsd картинки (не ноль) не имеет права
    // засчитываться в потолок Kling — иначе после каждой картинки-перебивки
    // бюджет исчерпывался бы быстрее, чем должен по деньгам, реально идущим на
    // видео. Первый кадр — картинка ($0.025, НЕ в счёт бюджета), второй и
    // третий — video по $0.25: оба обязаны поместиться в потолок $0.5, если
    // картинка бюджет не тронула.
    const scenes = [
      { order: 1, startSec: 0, endSec: 5, words: [{ text: "а", startSec: 0, endSec: 5, matched: true }] },
      { order: 2, startSec: 5, endSec: 10, words: [{ text: "б", startSec: 5, endSec: 10, matched: true }] },
      { order: 3, startSec: 10, endSec: 15, words: [{ text: "в", startSec: 10, endSec: 15, matched: true }] },
    ]
    const budgetInput: EditPlanStepInput = {
      ...INPUT,
      alignedScenes: scenes,
      trackDurationSec: 15,
      presenterSceneOrders: [],
      profile: { ...DEFAULT_EDIT_PROFILE, shotChangeSec: 5, generativeVideoEnabled: true },
    }
    const dependencies = deps({
      askModel: vi.fn(async (grid: Array<{ order: number }>) => ({
        shots: grid.map((cell, index) => ({
          order: cell.order,
          foreground: "none",
          background: index === 0 ? "image" : "video",
          idea: "рывок камеры",
        }) as EditPlanModelShot),
      })),
    })

    const result = await runEditPlanStep(budgetInput, dependencies)

    expect(result.shots[0]!.background).toBe("image")
    expect(result.shots[0]!.costUsd).toBeCloseTo(INPUT.imageUsd, 6)
    // Оба video-кадра уместились: картинка бюджет не тронула.
    expect(result.shots[1]!.background).toBe("video")
    expect(result.shots[1]!.costUsd).toBeCloseTo(0.25, 6)
    expect(result.shots[2]!.background).toBe("video")
    expect(result.shots[2]!.costUsd).toBeCloseTo(0.25, 6)
  })

  it("спрашивает модель второй раз, когда ремонт не помог", async () => {
    // Presenter-сцена занимает ВЕСЬ трек и потолок lip-sync невалиден (0) —
    // presenter_too_long неустраним: нет ни одного non-presenter соседа,
    // в которого можно сдвинуть границу (relieveOversizedPresenters).
    const unfixable: EditPlanStepInput = {
      ...INPUT,
      alignedScenes: [{ order: 1, startSec: 0, endSec: 8, words: [
        { text: "раз", startSec: 0, endSec: 3.8, matched: true },
        { text: "два", startSec: 4.2, endSec: 8.0, matched: true },
      ] }],
      lipSyncMaxDurationSec: 0,
    }
    const dependencies = deps({ askModel: vi.fn(async () => ({ shots: [] })) })

    await runEditPlanStep(unfixable, dependencies).catch(() => {})

    expect(dependencies.askModel).toHaveBeenCalledTimes(2)
  })

  it("падает честно после второй неудачи — ролик не идёт дальше с битым планом", async () => {
    const unfixable: EditPlanStepInput = {
      ...INPUT,
      alignedScenes: [{ order: 1, startSec: 0, endSec: 8, words: [
        { text: "раз", startSec: 0, endSec: 3.8, matched: true },
        { text: "два", startSec: 4.2, endSec: 8.0, matched: true },
      ] }],
      lipSyncMaxDurationSec: 0,
    }
    const dependencies = deps({ askModel: vi.fn(async () => ({ shots: [] })) })

    await expect(runEditPlanStep(unfixable, dependencies)).rejects.toThrow(/план монтажа/i)
  })

  it("дробит presenter-сцену длиннее потолка модели", async () => {
    const long = [{ order: 1, startSec: 0, endSec: 14, words: [
      { text: "а", startSec: 0, endSec: 6, matched: true },
      { text: "б", startSec: 7, endSec: 14, matched: true },
    ] }]
    const result = await runEditPlanStep(
      {
        ...INPUT,
        alignedScenes: long,
        trackDurationSec: 14,
        presenterSceneOrders: [1],
        // Шаг смены картинки шире потолка lip-sync: только тогда дробление
        // presenter-реплики видно в самой сетке, а не тонет в более частой
        // нарезке по shotChangeSec.
        profile: { ...DEFAULT_EDIT_PROFILE, shotChangeSec: 12 },
      },
      deps({
        askModel: vi.fn(async (grid: Array<{ order: number }>) => ({
          shots: grid.map(cell => ({ order: cell.order, foreground: "presenter", background: "none" }) as EditPlanModelShot),
        })),
      }),
    )

    for (const shot of result.shots.filter(s => s.foreground === "presenter")) {
      expect(shot.endSec - shot.startSec).toBeLessThanOrEqual(10 + 1e-6)
    }
    expect(result.shots.filter(s => s.foreground === "presenter").length).toBeGreaterThanOrEqual(2)
  })

  it("перебивка между частями длинной реплики получает sceneOrder: null", async () => {
    // Тот же вход, что у теста branch 2 в split-line.spec.ts: пауза
    // [3.0, 3.2] недостаточно длинная (0.2с) для "намеренного" реза (branch 1
    // просит >= 0.35с), но проходит требование 10 (>= 0.1с) — splitLongPresenterLine
    // ставит между частями перебивку. Она не привязана ни к какой реплике,
    // grid.ts обязан отдать ей sceneOrder: null, а не sceneOrder сцены.
    const scene = [{ order: 1, startSec: 0, endSec: 13, words: [
      { text: "а", startSec: 0, endSec: 0.008, matched: true },
      { text: "б", startSec: 0.3, endSec: 3.0, matched: true },
      { text: "в", startSec: 3.2, endSec: 13.0, matched: true },
    ] }]
    const dependencies = deps({
      askModel: vi.fn(async (grid: Array<{ order: number, sceneOrder: number | null }>) => ({
        shots: grid.map(cell => ({
          order: cell.order,
          foreground: cell.sceneOrder === null ? "none" : "presenter",
          background: cell.sceneOrder === null ? "image" : "none",
        }) as EditPlanModelShot),
      })),
    })

    const result = await runEditPlanStep(
      {
        ...INPUT,
        alignedScenes: scene,
        trackDurationSec: 13,
        presenterSceneOrders: [1],
        // Шире любой части реплики: sliceRange не дробит части ДАЛЬШЕ того,
        // что уже безопасно нарезал splitLongPresenterLine — тест проверяет
        // sceneOrder перебивки, а не качество вторичной нарезки по словам
        // внутри одного длинного слова без внутренних пауз.
        profile: { ...DEFAULT_EDIT_PROFILE, shotChangeSec: 20 },
      },
      dependencies,
    )

    const interlude = result.shots.find(s => Math.abs(s.startSec - 3.0) < 0.05 && Math.abs(s.endSec - 3.2) < 0.05)
    expect(interlude).toBeDefined()
    expect(interlude!.sceneOrder).toBeNull()
  })

  it("сохраняет кадры один раз за прогон", async () => {
    const dependencies = deps()

    await runEditPlanStep(INPUT, dependencies)

    expect(dependencies.saveShots).toHaveBeenCalledTimes(1)
  })

  it("падает честно, если сетка кадров пуста", async () => {
    await expect(runEditPlanStep({ ...INPUT, alignedScenes: [] }, deps())).rejects.toThrow(/сетка кадров пуста/i)
  })
})
