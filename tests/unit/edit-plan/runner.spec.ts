import { describe, expect, it, vi } from "vitest"

import { runEditPlanStep } from "~~/server/utils/edit-plan/runner"
import { DEFAULT_EDIT_PROFILE } from "~~/server/utils/edit-plan/profile"
import { validateShotPlan } from "~~/server/utils/edit-plan/validate"
import { buildShotGrid } from "~~/server/utils/edit-plan/grid"
import type { EditPlanModelShot, EditPlanStepDeps, EditPlanStepInput } from "~~/server/utils/edit-plan/runner"
import type { PlannedShotWithCost } from "~~/server/utils/edit-plan/types"

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
  imageGenerationAllowed: true,
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

  it("сцену длиннее потолка модели ведущий занимает только там, куда достаёт его клип", async () => {
    // Правка 26.08.2026 (дефект «липсинк застыл в конце», ролик 30). Прежняя
    // редакция этого теста требовала «не меньше двух presenter-кадров» —
    // дробление реплики по §5.3 действительно даёт две части. Но lip-sync
    // производится НА СЦЕНУ одним вызовом, и `planSegmentCut` режет из трека
    // кусок [начало сцены, +потолок]: второй части живого материала не
    // достаётся вовсе, и на экране она была замороженным лицом под живую речь.
    // Утверждение переписано на то, что действительно обязано держаться:
    // ведущий остаётся там, куда достаёт клип, остальное — перебивка, а
    // покрытие трека не рвётся.
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
        profile: { ...DEFAULT_EDIT_PROFILE, shotChangeSec: 12 },
      },
      deps({
        askModel: vi.fn(async (grid: Array<{ order: number }>) => ({
          shots: grid.map(cell => ({ order: cell.order, foreground: "presenter", background: "none" }) as EditPlanModelShot),
        })),
      }),
    )

    const presenters = result.shots.filter(s => s.foreground === "presenter")
    expect(presenters.length).toBeGreaterThanOrEqual(1)
    // Ни один кадр ведущего не заходит за конец клипа сцены (0 + 10).
    for (const shot of presenters) expect(shot.endSec).toBeLessThanOrEqual(10 + 1e-6)
    // Суммарное время ведущего в сцене — то, о чём говорит потолок модели.
    const presenterSec = presenters.reduce((sum, s) => sum + (s.endSec - s.startSec), 0)
    expect(presenterSec).toBeLessThanOrEqual(10 + 1e-6)
    // Хвост сцены не потерян: он покрыт перебивкой, а не выброшен.
    expect(result.shots.some(s => s.foreground !== "presenter" && s.endSec > 10)).toBe(true)
    expect(result.shots.at(-1)!.endSec).toBeCloseTo(14, 6)
  })

  it("дробление длинной реплики §5.3 живёт в сетке — перебивка между частями не привязана к реплике", async () => {
    // Утверждение снято на уровне СЕТКИ (`buildShotGrid`), а не по итогу шага:
    // до правки 26.08.2026 план этой сцены не имел ни одного блокирующего
    // нарушения, ремонт не запускался вовсе, и перебивка доезжала до результата
    // как отдельный кадр. Теперь агрегат сцены — блокирующее нарушение, ремонт
    // запускается, и его слияние коротких кадров (порог 0.4 × shotChangeSec =
    // 8с при shotChangeSec 20) законно поглощает двухсотмиллисекундную
    // перебивку. Проверять `sceneOrder` перебивки по итогу шага стало
    // проверять поведение СЛИЯНИЯ, а не сетки.
    const scene = { order: 1, startSec: 0, endSec: 13, words: [
      { text: "а", startSec: 0, endSec: 0.008, matched: true },
      { text: "б", startSec: 0.3, endSec: 3.0, matched: true },
      { text: "в", startSec: 3.2, endSec: 13.0, matched: true },
    ] }

    const grid = buildShotGrid({
      alignedScenes: [scene],
      presenterSceneOrders: new Set([1]),
      shotChangeSec: 20,
      lipSyncMaxDurationSec: 10,
      fps: 30,
      brollAllowed: true,
    })

    const interlude = grid.cells.find(c => Math.abs(c.startSec - 3.0) < 0.05 && Math.abs(c.endSec - 3.2) < 0.05)
    expect(interlude).toBeDefined()
    expect(interlude!.sceneOrder).toBeNull()
  })

  it("время перебивки не приписывается реплике и по итогу шага", async () => {
    // Вторая половина того же утверждения, но по итогу ШАГА: сам кадр-перебивка
    // может быть поглощён слиянием коротких кадров, а вот его время не имеет
    // права оказаться приписанным реплике — кадр, покрывающий 3.0-3.2, обязан
    // остаться без привязки к сцене и без ведущего.
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

    const covering = result.shots.find(s => s.startSec <= 3.0 + 1e-6 && s.endSec >= 3.2 - 1e-6)
    expect(covering).toBeDefined()
    expect(covering!.sceneOrder).toBeNull()
    expect(covering!.foreground).not.toBe("presenter")
  })

  it("сохраняет кадры один раз за прогон", async () => {
    const dependencies = deps()

    await runEditPlanStep(INPUT, dependencies)

    expect(dependencies.saveShots).toHaveBeenCalledTimes(1)
  })

  it("падает честно, если сетка кадров пуста", async () => {
    await expect(runEditPlanStep({ ...INPUT, alignedScenes: [] }, deps())).rejects.toThrow(/сетка кадров пуста/i)
  })

  it("библиотечный фон и скрин приложения проходят до кадра, когда ссылка известна (happy path, M-7)", async () => {
    // Ни один прежний тест не гонял happy-путь library/app_screen целиком —
    // регрессия в финальном присвоении backgroundClipId/appReferenceId (например,
    // случайное обнуление валидной ссылки) не была бы поймана ничем.
    const backgrounds = [{ id: "clip-1", kind: "footage", name: "Клип", tags: [] }]
    const appScreens = [{ id: "ref-1", tags: [], caption: null }]
    const dependencies = deps({
      askModel: vi.fn(async (grid: Array<{ order: number }>) => ({
        shots: grid.map((cell, index) => ({
          order: cell.order,
          foreground: "none",
          background: index % 2 === 0 ? "library" : "app_screen",
          backgroundClipId: index % 2 === 0 ? "clip-1" : null,
          appReferenceId: index % 2 === 0 ? null : "ref-1",
        }) as EditPlanModelShot),
      })),
    })

    const result = await runEditPlanStep({ ...INPUT, backgrounds, appScreens }, dependencies)

    const libraryShots = result.shots.filter(s => s.background === "library")
    const appScreenShots = result.shots.filter(s => s.background === "app_screen")
    expect(libraryShots.length).toBeGreaterThan(0)
    expect(appScreenShots.length).toBeGreaterThan(0)
    for (const shot of libraryShots) expect(shot.backgroundClipId).toBe("clip-1")
    for (const shot of appScreenShots) expect(shot.appReferenceId).toBe("ref-1")
  })

  it("чинит ссылку модели на несуществующий скрин приложения детерминированно, не спрашивая её второй раз (Critical 2 ре-ревью задачи)", async () => {
    // Симметрично тесту про несуществующий библиотечный фон: раньше
    // `hasAppScreen` была тавтологией (`shot.background === "app_screen"`),
    // и ничто не проверяло существование appReferenceId — createMany падал бы
    // по FK ПОСЛЕ оплаты вызова модели.
    const dependencies = deps({
      askModel: vi.fn(async (grid: Array<{ order: number }>) => ({
        shots: grid.map(cell => ({
          order: cell.order,
          foreground: "none",
          background: "app_screen",
          appReferenceId: "does-not-exist",
        })) as EditPlanModelShot[],
      })),
    })

    const result = await runEditPlanStep(INPUT, dependencies)

    expect(dependencies.askModel).toHaveBeenCalledTimes(1)
    for (const shot of result.shots) {
      expect(shot.background).not.toBe("app_screen")
      expect(shot.appReferenceId).toBeNull()
    }
  })

  it("картинка недоступна (imageGenerationAllowed=false) — кадр отдаётся ведущему, а не остаётся пустым (§10, Important 3), и одинаковая причина деградации не спамит по кадру (Minor М-2)", async () => {
    const dependencies = deps({
      askModel: vi.fn(async (grid: Array<{ order: number }>) => ({
        shots: grid.map(cell => ({ order: cell.order, foreground: "none", background: "image", idea: "фон" }) as EditPlanModelShot),
      })),
    })

    const result = await runEditPlanStep({ ...INPUT, imageGenerationAllowed: false }, dependencies)

    expect(result.shots.length).toBeGreaterThan(1)
    for (const shot of result.shots) {
      expect(shot.background).toBe("none")
      // §10: «фонов нет, генерация запрещена → кадр отдаётся ведущему на весь
      // экран» — не пустой кадр без переднего и без заднего плана разом.
      expect(shot.foreground).toBe("presenter")
      expect(shot.costUsd).toBe(0)
    }
    // Все кадры деградировали по ОДНОЙ И ТОЙ ЖЕ причине — одна строка с
    // счётчиком, а не по отдельной записи на каждый кадр (Minor М-2).
    const degradeWarnings = result.warnings.filter(w => /картинка недоступна/i.test(w))
    expect(degradeWarnings.length).toBe(1)
    expect(degradeWarnings[0]).toMatch(new RegExp(`кадров: ${result.shots.length}`))
  })

  it("форсированный «ведущий на весь экран» сбрасывает pipEnabled — иначе ведущий во весь кадр и PiP поверх себя (ре-ревью 3, Task 5, пункт 1, связанная мелочь)", async () => {
    // Профиль РАЗРЕШАЕТ PiP (pipEnabled: true) и модель его просит — если бы
    // сброс происходил только клэмпом Important 4 (профильный флаг), PiP
    // остался бы включённым здесь. Единственная причина, по которой он ДОЛЖЕН
    // сброситься, — forcedEmpty: фон принудительно схлопнут в "none",
    // background не запрашивал его сам.
    const dependencies = deps({
      askModel: vi.fn(async (grid: Array<{ order: number }>) => ({
        shots: grid.map(cell => ({ order: cell.order, foreground: "none", background: "image", pipEnabled: true }) as EditPlanModelShot),
      })),
    })

    const result = await runEditPlanStep(
      { ...INPUT, profile: { ...DEFAULT_EDIT_PROFILE, pipEnabled: true }, imageGenerationAllowed: false },
      dependencies,
    )

    expect(result.shots.length).toBeGreaterThan(0)
    for (const shot of result.shots) {
      expect(shot.background).toBe("none")
      expect(shot.foreground).toBe("presenter")
      expect(shot.pipEnabled).toBe(false)
    }
  })

  it("PiP выключен профилем — модель не может включить его для кадра (Important 4)", async () => {
    const dependencies = deps({
      askModel: vi.fn(async (grid: Array<{ order: number }>) => ({
        shots: grid.map(cell => ({ order: cell.order, foreground: "none", background: "image", pipEnabled: true }) as EditPlanModelShot),
      })),
    })

    const result = await runEditPlanStep(
      { ...INPUT, profile: { ...DEFAULT_EDIT_PROFILE, pipEnabled: false } },
      dependencies,
    )

    for (const shot of result.shots) expect(shot.pipEnabled).toBe(false)
  })

  it("PiP разрешён профилем — выбор модели по кадру сохраняется", async () => {
    const dependencies = deps({
      askModel: vi.fn(async (grid: Array<{ order: number }>) => ({
        shots: grid.map(cell => ({ order: cell.order, foreground: "none", background: "image", pipEnabled: true }) as EditPlanModelShot),
      })),
    })

    const result = await runEditPlanStep(
      { ...INPUT, profile: { ...DEFAULT_EDIT_PROFILE, pipEnabled: true } },
      dependencies,
    )

    expect(result.shots.some(s => s.pipEnabled === true)).toBe(true)
  })

  it("статус completed достижим, когда ремонт ничего не поправил (Minor М-1)", async () => {
    // Одна сцена, без соседей — нет межсценной дыры для закрытия, план
    // валиден сразу после материализации: repairShotPlan вообще не звался.
    const singleScene = [ALIGNED[0]!]
    const dependencies = deps({
      askModel: vi.fn(async (grid: Array<{ order: number }>) => ({
        shots: grid.map(cell => ({ order: cell.order, foreground: "presenter", background: "none" }) as EditPlanModelShot),
      })),
    })

    const result = await runEditPlanStep(
      { ...INPUT, alignedScenes: singleScene, trackDurationSec: 4 },
      dependencies,
    )

    expect(result.status).toBe("completed")
  })

  it("предупреждения отброшенной первой попытки не переживают успешную вторую (Minor М-2)", async () => {
    // Одна чистая (без word_split) сцена — тот же фикстурный ALIGNED[0], что
    // уже доказал сходимость без единого обращения к repair в тесте
    // "статус completed достижим" выше. Единственная блокирующая проблема
    // первой попытки — presenter_too_long от lipSyncMaxDurationSec=0.
    const scene = [ALIGNED[0]!]
    const input: EditPlanStepInput = { ...INPUT, alignedScenes: scene, trackDurationSec: 4, lipSyncMaxDurationSec: 0 }
    let call = 0
    const askModel = vi.fn(async (grid: Array<{ order: number }>) => {
      call += 1
      if (call === 1) {
        // Только первый кадр — остальные дефолтятся в "presenter" (сцена в
        // presenterSceneOrders), план неустраним при lipSyncMaxDurationSec=0.
        return { shots: [{ order: grid[0]!.order, foreground: "presenter", background: "none" }] } as { shots: EditPlanModelShot[] }
      }
      // Вторая попытка: явный "none" для всех — presenter_too_long больше
      // неоткуда взяться, план валиден без единого обращения к repair.
      return { shots: grid.map(cell => ({ order: cell.order, foreground: "none", background: "image" })) } as { shots: EditPlanModelShot[] }
    })

    const result = await runEditPlanStep(input, deps({ askModel }))

    expect(askModel).toHaveBeenCalledTimes(2)
    expect(result.warnings.some(w => /не заполнила/.test(w))).toBe(false)
  })

  it("modelCallCount считает реальные обращения к модели, plannedMediaCostUsd — прогноз фонов, а не ledger-цену шага (Critical 1 ре-ревью задачи)", async () => {
    const result = await runEditPlanStep(INPUT, deps())

    // Дефолтный мок отвечает с первого раза.
    expect(result.modelCallCount).toBe(1)
    // Дефолтный мок просит "image" на все кадры — прогноз фонов положителен,
    // но это НЕ цена вызова модели (её raннер вообще не считает — это работа
    // video-pipeline-steps.ts, см. отчёт).
    expect(result.plannedMediaCostUsd).toBeGreaterThan(0)
  })

  it("modelUsages несёт usage каждой реальной попытки — раннер только сохраняет, не считает деньги (Critical 1 ре-ревью задачи, фикс-раунд 2)", async () => {
    const usage = { model: "claude-sonnet-4-6", inputTokens: 1234, outputTokens: 567 }
    const dependencies = deps({
      askModel: vi.fn(async (grid: Array<{ order: number }>, _context, reportUsage) => {
        reportUsage(usage)
        return { shots: grid.map(cell => ({ order: cell.order, foreground: "none" as const, background: "image" as const, idea: "идея" })) }
      }),
    })

    const result = await runEditPlanStep(INPUT, dependencies)

    expect(result.modelCallCount).toBe(1)
    expect(result.modelUsages).toEqual([usage])
  })

  it("modelUsages пуст usage'ом null, когда askModel его не сообщает (мок Anthropic) — раннер не подставляет числа сам", async () => {
    // Дефолтный `deps()` не возвращает usage вовсе — ровно то, что реально
    // происходит в ANTHROPIC_MOCK_MODE (tryMockAnthropicAgent не зовёт onUsage).
    const result = await runEditPlanStep(INPUT, deps())

    expect(result.modelUsages).toEqual([null])
  })

  it("modelUsages несёт usage ОБЕИХ попыток при несходимости ремонта (Critical 1, п.3 ре-ревью задачи)", async () => {
    const unfixable: EditPlanStepInput = {
      ...INPUT,
      alignedScenes: [{ order: 1, startSec: 0, endSec: 8, words: [
        { text: "раз", startSec: 0, endSec: 3.8, matched: true },
        { text: "два", startSec: 4.2, endSec: 8.0, matched: true },
      ] }],
      lipSyncMaxDurationSec: 0,
    }
    const usageByAttempt = [
      { model: "claude-sonnet-4-6", inputTokens: 1000, outputTokens: 200 },
      { model: "claude-sonnet-4-6", inputTokens: 1500, outputTokens: 300 },
    ]
    let call = 0
    const dependencies = deps({
      askModel: vi.fn(async (_grid, _context, reportUsage) => {
        reportUsage(usageByAttempt[call++]!)
        return { shots: [] }
      }),
    })

    const { EditPlanUnresolvedError } = await import("~~/server/utils/edit-plan/runner")

    // Ошибка обязана нести usage ОБЕИХ попыток, а не только последней —
    // иначе video-pipeline-steps.ts посчитало бы деньги только за одну из
    // двух реально оплаченных попыток.
    await expect(runEditPlanStep(unfixable, dependencies)).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(EditPlanUnresolvedError)
      const unresolved = error as InstanceType<typeof EditPlanUnresolvedError>
      expect(unresolved.modelCallCount).toBe(2)
      expect(unresolved.modelUsages).toEqual(usageByAttempt)
      return true
    })
  })
})

/**
 * Important 1 финального ревью ветки: `forcedEmpty` ставил
 * `foreground: "presenter"` уже ПОСЛЕ `repairToFixedPoint`, то есть после
 * последней валидации. `foreground` — поле, от которого зависит правило
 * `presenter_too_long` (`validate.ts`) и сама семантика «в этой сцене говорит
 * ведущий»: подмена в обход валидации уводила в БД кадр ведущего длиннее
 * потолка lip-sync и кадр ведущего без единой привязанной реплики
 * (`sceneOrder: null`). Ни один из 27 тестов выше этого не ловил: все они
 * подают короткие кадры внутри presenter-сцен.
 *
 * Выбрана вторая из двух разрешённых мандатом развязок — «подмена сама держит
 * те же инварианты» (а не «переносим её до валидации»): цикл
 * `pickBackgroundSource` обязан идти ПОСЛЕ ремонта, потому что он решает
 * денежный вопрос §7 по ФИНАЛЬНЫМ длительностям кадров, а ремонт эти
 * длительности ещё двигает. Перенос выбора фона выше ремонта означал бы
 * считать деньги по границам, которых в плане не останется.
 */
describe("шаг плана монтажа: форсированный ведущий не обходит инварианты валидации (Important 1)", () => {
  /** Нарушения итогового плана, кроме `broll_ratio` (рулинг: предупреждение, не блокирующее). */
  function blockingViolations(input: EditPlanStepInput, shots: readonly PlannedShotWithCost[]) {
    return validateShotPlan({
      plan: { shots: shots.map(shot => ({ ...shot })) },
      trackDurationSec: input.trackDurationSec,
      fps: input.fps,
      alignedScenes: input.alignedScenes,
      profile: input.profile,
      lipSyncMaxDurationSec: input.lipSyncMaxDurationSec,
      minGenerativeVideoSec: input.minGenerativeVideoSec,
      maxGenerativeVideoSec: input.maxGenerativeVideoSec,
      knownBackgroundIds: new Set(input.backgrounds.map(background => background.id)),
      knownAppScreenIds: new Set(input.appScreens.map(screen => screen.id)),
    }).filter(violation => violation.code !== "broll_ratio")
  }

  // Сцена БЕЗ ведущего длиной 12с при `shotChangeSec: 12` укладывается в один
  // кадр. Верхней границы у `shotChangeSec` в профиле нет (`profile.ts`
  // проверяет только нижнюю, 0.8с), то есть «редкая смена планов» — легальная
  // настройка оператора, а не вырожденный вход.
  const LONG_BROLL_INPUT: EditPlanStepInput = {
    ...INPUT,
    profile: { ...DEFAULT_EDIT_PROFILE, shotChangeSec: 12 },
    presenterSceneOrders: [],
    trackDurationSec: 12,
    alignedScenes: [{ order: 1, startSec: 0, endSec: 12, words: [
      { text: "раз", startSec: 0, endSec: 5.0, matched: true },
      { text: "два", startSec: 5.4, endSec: 12.0, matched: true },
    ] }],
    // Единственный рычаг оператора против расхода на картинки — то есть путь
    // не экзотический, а ровно тот, ради которого флаг заводили.
    imageGenerationAllowed: false,
  }

  it("кадр длиннее потолка lip-sync не отдаётся ведущему — иначе план нарушает presenter_too_long уже после валидации", async () => {
    const result = await runEditPlanStep(LONG_BROLL_INPUT, deps())

    const oversized = result.shots.filter(
      shot => shot.endSec - shot.startSec > LONG_BROLL_INPUT.lipSyncMaxDurationSec,
    )
    // Сам вход обязан оставаться тем, ради чего написан: длинный кадр есть.
    expect(oversized.length).toBeGreaterThan(0)
    for (const shot of oversized) {
      expect(shot.background).toBe("none")
      expect(shot.foreground).not.toBe("presenter")
    }
    // Итоговый план — тот, что уедет в БД, — обязан проходить ту же самую
    // валидацию, которую он проходил до цикла выбора фона.
    expect(blockingViolations(LONG_BROLL_INPUT, result.shots)).toEqual([])
  })

  it("отказ назвать причиной: оператор видит, почему кадр остался пустым", async () => {
    const result = await runEditPlanStep(LONG_BROLL_INPUT, deps())

    expect(result.warnings.some(warning => /потолок lip-sync/i.test(warning))).toBe(true)
    expect(result.shots.some(shot => /потолок lip-sync/i.test(shot.degradeReason ?? ""))).toBe(true)
  })

  // Перебивка между частями длинной реплики (`splitLongPresenterLine`) —
  // единственный кадр сетки с `sceneOrder: null`: он не привязан ни к какой
  // реплике. Реплика 10.5с при потолке 10с дробится ровно один раз; все паузы
  // короче «намеренной» (0.35с), поэтому §5.3 идёт по ветке 2 — перебивка, а
  // не рез. `shotChangeSec: 0.8` — легальный минимум профиля; при нём порог
  // слияния коротких кадров (0.32с) ниже длины перебивки (0.33с), и она
  // доживает до цикла выбора фона.
  const INTERLUDE_INPUT: EditPlanStepInput = {
    ...INPUT,
    profile: { ...DEFAULT_EDIT_PROFILE, shotChangeSec: 0.8 },
    presenterSceneOrders: [1],
    trackDurationSec: 10.5,
    alignedScenes: [{ order: 1, startSec: 0, endSec: 10.5, words: [
      { text: "слово0", startSec: 0, endSec: 0.88, matched: true },
      { text: "слово1", startSec: 1.0, endSec: 1.88, matched: true },
      { text: "слово2", startSec: 2.0, endSec: 2.88, matched: true },
      { text: "слово3", startSec: 3.0, endSec: 3.88, matched: true },
      { text: "слово4", startSec: 4.0, endSec: 4.88, matched: true },
      { text: "слово5", startSec: 5.0, endSec: 5.88, matched: true },
      { text: "слово6", startSec: 6.0, endSec: 6.88, matched: true },
      { text: "слово7", startSec: 7.0, endSec: 7.88, matched: true },
      { text: "слово8", startSec: 8.0, endSec: 8.5, matched: true },
      // Самая широкая пауза реплики (0.34с) — но всё ещё короче «намеренной».
      { text: "слово9", startSec: 8.84, endSec: 9.7, matched: true },
      { text: "слово10", startSec: 9.82, endSec: 10.5, matched: true },
    ] }],
    imageGenerationAllowed: false,
  }

  it("перебивка без привязанной реплики (sceneOrder: null) не отдаётся ведущему — синхронизировать её не с чем", async () => {
    const dependencies = deps({
      askModel: vi.fn(async (grid: Array<{ order: number, sceneOrder: number | null }>) => ({
        shots: grid.map(cell => (cell.sceneOrder === null
          ? { order: cell.order, foreground: "none", background: "image", idea: "перебивка" }
          : { order: cell.order, foreground: "presenter", background: "none" })) as EditPlanModelShot[],
      })),
    })

    const result = await runEditPlanStep(INTERLUDE_INPUT, dependencies)

    const orphans = result.shots.filter(shot => shot.sceneOrder === null)
    // Вход обязан оставаться тем, ради чего написан: перебивка в плане есть.
    expect(orphans.length).toBeGreaterThan(0)
    for (const shot of orphans) {
      expect(shot.background).toBe("none")
      expect(shot.foreground).not.toBe("presenter")
      expect(shot.degradeReason).toMatch(/реплик/i)
    }
    expect(blockingViolations(INTERLUDE_INPUT, result.shots)).toEqual([])
  })

  // Сцена ДЛИННЕЕ потолка lip-sync, нарезанная на короткие кадры: каждый кадр
  // по отдельности потолок проходит, `sceneOrder` у всех проставлен, то есть
  // прежняя пара условий `holdsPresenterInvariants` пропускала ведущего на
  // ВЕСЬ хвост сцены — включая ту его часть, куда клип lip-sync физически не
  // достаёт. Ровно тот же класс, что и Important 1 финального ревью, только
  // третьим условием.
  const LONG_SCENE_INPUT: EditPlanStepInput = {
    ...INPUT,
    profile: { ...DEFAULT_EDIT_PROFILE, shotChangeSec: 3 },
    presenterSceneOrders: [],
    trackDurationSec: 14,
    alignedScenes: [{ order: 1, startSec: 0, endSec: 14, words: Array.from({ length: 14 }, (_, index) => ({
      text: `слово${index}`, startSec: index, endSec: index + 0.8, matched: true,
    })) }],
    imageGenerationAllowed: false,
  }

  it("хвост сцены длиннее потолка lip-sync ведущему не отдаётся — клип туда не достаёт", async () => {
    const result = await runEditPlanStep(LONG_SCENE_INPUT, deps())

    // Вход обязан оставаться тем, ради чего написан: сцена длиннее потолка,
    // а кадры внутри неё — короче.
    expect(result.shots.length).toBeGreaterThan(2)
    expect(result.shots.at(-1)!.endSec).toBeGreaterThan(LONG_SCENE_INPUT.lipSyncMaxDurationSec)
    for (const shot of result.shots) {
      expect(shot.endSec - shot.startSec).toBeLessThanOrEqual(LONG_SCENE_INPUT.lipSyncMaxDurationSec)
    }
    // Ни один кадр за концом клипа сцены (0 + 10) не стал кадром ведущего.
    for (const shot of result.shots) {
      if (shot.endSec > LONG_SCENE_INPUT.lipSyncMaxDurationSec + 1e-6) {
        expect(shot.foreground, `кадр ${shot.order} (${shot.startSec}-${shot.endSec})`).not.toBe("presenter")
      }
    }
    // Итоговый план — тот, что уедет в БД, — обязан проходить ту же валидацию.
    expect(blockingViolations(LONG_SCENE_INPUT, result.shots)).toEqual([])
  })

  it("кадр внутри реплики и в пределах потолка ведущему по-прежнему отдаётся (§10 не отменён)", async () => {
    const result = await runEditPlanStep({ ...INPUT, imageGenerationAllowed: false }, deps())

    expect(result.shots.length).toBeGreaterThan(1)
    for (const shot of result.shots) {
      expect(shot.sceneOrder).not.toBeNull()
      expect(shot.endSec - shot.startSec).toBeLessThanOrEqual(INPUT.lipSyncMaxDurationSec)
      expect(shot.background).toBe("none")
      expect(shot.foreground).toBe("presenter")
    }
  })
})
