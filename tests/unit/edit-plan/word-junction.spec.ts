/**
 * Слитная транскрипция: слова ВСТЫК, ни одной межсловной паузы.
 *
 * Боевой дефект 28.08.2026, ролик 34 (стенд cf-dev, сценарий 28). Проект
 * перешёл на модель транскрипции `vaibhavs10/incredibly-fast-whisper`
 * (коммит `b8dfc22`, 27.08), и она отдаёт слова встык: `endSec` слова РОВНО
 * равен `startSec` следующего. Шаг `edit_plan` упал со статусом `failed`:
 *
 *   «План монтажа невалиден после ремонта и 2 запросов к модели:
 *    Граница кадра 1 в 1.80с приходится на середину слова;
 *    Граница кадра 2 в 3.60с приходится на середину слова; …»
 *
 * — и так по двум десяткам кадров, все границы кратны `shotChangeSec = 1.8`.
 *
 * Причина: кандидаты на рез собираются ТОЛЬКО из интервалов положительной
 * ширины (условие `next > end` в `wordGaps` сетки, `collectGaps` ремонта и
 * `collectPauses` дробления реплики — все три до фикса).
 * На слитной транскрипции таких интервалов нет вовсе, список кандидатов пуст,
 * и код режет по наивной точке `cursor + shotChangeSec` — она приходится на
 * середину слова, ремонт двигать её некуда, а второй платный запрос к модели
 * геометрию не меняет в принципе (`materializeShots` берёт границы только из
 * сетки). Предыдущая модель (WhisperX) паузы давала — ролики 30 и 33 от 26.08
 * собрались, а первый же ролик на новой модели упал. Фикстуры всех прежних
 * тестов — со «здоровыми» паузами, поэтому дефект и дожил до стенда.
 *
 * Ключевое соображение фикса: граница РОВНО НА СТЫКЕ двух слов
 * (`endSec == startSec`) никакого слова не разрезает — она законна, просто её
 * ширина нулевая. Стык обязан быть кандидатом на рез, но кандидатом ХУДШИМ,
 * чем настоящая пауза: смена плана в паузе выглядит намеренной, на стыке слов
 * она резче.
 */

import { describe, expect, it, vi } from "vitest"

import { buildShotGrid } from "~~/server/utils/edit-plan/grid"
import { repairShotPlan } from "~~/server/utils/edit-plan/repair"
import { runEditPlanStep } from "~~/server/utils/edit-plan/runner"
import { splitLongPresenterLine } from "~~/server/utils/edit-plan/split-line"
import { validateShotPlan } from "~~/server/utils/edit-plan/validate"
import { DEFAULT_EDIT_PROFILE } from "~~/server/utils/edit-plan/profile"
import type { EditPlanModelShot, EditPlanStepDeps, EditPlanStepInput } from "~~/server/utils/edit-plan/runner"
import type { PlannedShot } from "~~/server/utils/edit-plan/types"

/**
 * Слова ролика 34 из `VideoGenerationStep.outputSnapshot` — как есть, встык.
 * Хвост («форму», «другой») дописан теми же встык-таймингами до 6.00с ровно:
 * конец трека обязан лежать на границе кадра, иначе к дефекту примешивается
 * `out_of_track` от округления и портит чистоту воспроизведения.
 */
const WORDS_34 = [
  { text: "Вот", startSec: 0, endSec: 0.3, matched: true },
  { text: "два", startSec: 0.3, endSec: 0.56, matched: true },
  { text: "дня", startSec: 0.56, endSec: 0.94, matched: true },
  { text: "рациона", startSec: 0.94, endSec: 1.6, matched: true },
  { text: "без", startSec: 1.6, endSec: 2.2, matched: true },
  { text: "фастфуда.", startSec: 2.2, endSec: 3.22, matched: true },
  { text: "Один", startSec: 3.22, endSec: 4.06, matched: true },
  { text: "держит", startSec: 4.06, endSec: 4.92, matched: true },
  { text: "форму", startSec: 4.92, endSec: 5.5, matched: true },
  { text: "другой", startSec: 5.5, endSec: 6.0, matched: true },
]

const SCENE_34 = { order: 1, startSec: 0, endSec: 6.0, words: WORDS_34 }
const TRACK_34 = 6.0
const FPS = 30

/** Ни один момент внутри слова — тот же вопрос, что задаёт `validateShotPlan`. */
function insideAnyWord(
  atSec: number,
  words: readonly { startSec: number, endSec: number }[] = WORDS_34,
): boolean {
  const tolerance = 1 / (2 * FPS) + 0.003
  return words.some(word => atSec > word.startSec + tolerance && atSec < word.endSec - tolerance)
}

const SHOT_BASE: PlannedShot = {
  order: 0,
  startSec: 0,
  endSec: 6,
  sceneOrder: 1,
  foreground: "none",
  background: "image",
  backgroundClipId: null,
  appReferenceId: null,
  idea: null,
  pipEnabled: false,
}

function planFromGrid(cells: ReadonlyArray<{ order: number, startSec: number, endSec: number, sceneOrder: number | null }>) {
  return {
    shots: cells.map(cell => ({
      ...SHOT_BASE,
      order: cell.order,
      startSec: cell.startSec,
      endSec: cell.endSec,
      sceneOrder: cell.sceneOrder,
    })),
  }
}

function context(shots: PlannedShot[], overrides: Record<string, unknown> = {}) {
  return {
    plan: { shots },
    trackDurationSec: TRACK_34,
    fps: FPS,
    alignedScenes: [SCENE_34],
    profile: DEFAULT_EDIT_PROFILE,
    lipSyncMaxDurationSec: 10,
    minGenerativeVideoSec: 5,
    maxGenerativeVideoSec: 10,
    knownBackgroundIds: new Set<string>(),
    knownAppScreenIds: new Set<string>(),
    ...overrides,
  } as never
}

function grid34() {
  return buildShotGrid({
    alignedScenes: [SCENE_34],
    presenterSceneOrders: new Set([1]),
    shotChangeSec: DEFAULT_EDIT_PROFILE.shotChangeSec,
    lipSyncMaxDurationSec: 10,
    fps: FPS,
    brollAllowed: true,
  })
}

describe("ролик 34: слова встык, план обязан собираться", () => {
  it("сетка не ставит ни одной границы внутрь слова", () => {
    const { cells } = grid34()

    // Внутренние границы — старт первого кадра и конец последнего совпадают с
    // границами трека и слово не рвут по построению (то же правило, что в
    // `validateShotPlan`).
    const internal = cells.slice(1).map(cell => cell.startSec)
    expect(internal.length).toBeGreaterThan(0)
    for (const boundary of internal) {
      expect(insideAnyWord(boundary), `граница ${boundary.toFixed(4)}с приходится на середину слова`).toBe(false)
    }
  })

  it("валидация не находит ни одного word_split на сетке слитной транскрипции", () => {
    const violations = validateShotPlan(context(planFromGrid(grid34().cells).shots))

    // Именно это и падало на стенде: «Граница кадра 1 в 1.80с приходится на
    // середину слова; Граница кадра 2 в 3.60с …».
    expect(violations.filter(v => v.code === "word_split")).toEqual([])
  })

  it("ремонт не оставляет блокирующих нарушений", () => {
    const { remaining } = repairShotPlan(context(planFromGrid(grid34().cells).shots))

    // `broll_ratio` — предупреждение, а не блокирующее нарушение (рулинг
    // задачи, см. `isBlocking` в раннере): доля перебивок — вопрос смысла, а
    // не арифметики границ.
    expect(remaining.filter(v => v.code !== "broll_ratio")).toEqual([])
  })

  it("раннер собирает ролик за ОДИН платный запрос к модели, а не за два", async () => {
    const askModel = vi.fn(async (cells: Array<{ order: number, sceneOrder: number | null }>) => ({
      shots: cells.map(cell => ({
        order: cell.order,
        foreground: cell.sceneOrder === null ? "none" : "presenter",
        background: cell.sceneOrder === null ? "image" : "none",
        idea: "идея",
      })) as EditPlanModelShot[],
    }))

    const input: EditPlanStepInput = {
      videoId: 34,
      trackDurationSec: TRACK_34,
      fps: FPS,
      alignedScenes: [SCENE_34],
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
    const deps: EditPlanStepDeps = {
      askModel,
      saveShots: vi.fn(async () => {}),
      log: vi.fn(async () => {}),
    }

    const result = await runEditPlanStep(input, deps)

    // Деньги (требование 4): отказ на стенде происходил ПОСЛЕ второго платного
    // запроса, который геометрию изменить не мог в принципе.
    expect(askModel).toHaveBeenCalledTimes(1)
    for (const shot of result.shots.slice(1)) {
      expect(insideAnyWord(shot.startSec), `граница ${shot.startSec.toFixed(4)}с рвёт слово`).toBe(false)
    }
  })
})

describe("полноразмерный ролик со слитной транскрипцией", () => {
  /**
   * 36 секунд, четыре сцены, слова встык — масштаб боевого ролика 34
   * («и так по двум десяткам кадров»). Длины слов взяты циклом 0.30-1.02с,
   * как в снимке ролика 34, чтобы стыки не ложились на сетку `shotChangeSec`
   * кратно и рез приходился на разные места слова.
   */
  const LENGTHS = [0.3, 0.26, 0.38, 0.66, 0.6, 1.02, 0.84, 0.86, 0.58, 0.5]
  const LONG_SCENES = (() => {
    const scenes: Array<{ order: number, startSec: number, endSec: number, words: typeof WORDS_34 }> = []
    let cursor = 0
    let index = 0
    for (let order = 1; order <= 4; order += 1) {
      const words: typeof WORDS_34 = []
      const sceneStart = cursor
      while (cursor < sceneStart + 9) {
        const length = LENGTHS[index % LENGTHS.length]!
        const startSec = Number(cursor.toFixed(2))
        const endSec = Number((cursor + length).toFixed(2))
        words.push({ text: `w${index}`, startSec, endSec, matched: true })
        cursor = endSec
        index += 1
      }
      scenes.push({ order, startSec: sceneStart, endSec: cursor, words })
    }
    return scenes
  })()
  const LONG_WORDS = LONG_SCENES.flatMap(scene => scene.words)
  const LONG_TRACK = LONG_SCENES[LONG_SCENES.length - 1]!.endSec

  it("ни одной паузы во всём треке — предпосылка теста, а не догадка", () => {
    for (let index = 1; index < LONG_WORDS.length; index += 1) {
      expect(LONG_WORDS[index]!.startSec).toBeCloseTo(LONG_WORDS[index - 1]!.endSec, 9)
    }
    expect(LONG_WORDS.length).toBeGreaterThan(40)
  })

  it("собирается за один запрос к модели и без границ внутри слов", async () => {
    const askModel = vi.fn(async (cells: Array<{ order: number, sceneOrder: number | null }>) => ({
      shots: cells.map(cell => ({
        order: cell.order,
        foreground: cell.sceneOrder === null ? "none" : "presenter",
        background: cell.sceneOrder === null ? "image" : "none",
        idea: "идея",
      })) as EditPlanModelShot[],
    }))

    const result = await runEditPlanStep({
      videoId: 34,
      trackDurationSec: LONG_TRACK,
      fps: FPS,
      alignedScenes: LONG_SCENES,
      profile: { ...DEFAULT_EDIT_PROFILE },
      lipSyncMaxDurationSec: 10,
      minGenerativeVideoSec: 5,
      maxGenerativeVideoSec: 10,
      generativeVideoUsdPerSec: 0.05,
      imageUsd: 0.025,
      imageGenerationAllowed: true,
      presenterSceneOrders: [1, 2, 3, 4],
      backgrounds: [],
      appScreens: [],
    }, {
      askModel,
      saveShots: vi.fn(async () => {}),
      log: vi.fn(async () => {}),
    })

    expect(askModel).toHaveBeenCalledTimes(1)
    expect(result.shots.length).toBeGreaterThan(15)
    for (const shot of result.shots.slice(1)) {
      expect(insideAnyWord(shot.startSec, LONG_WORDS), `граница ${shot.startSec.toFixed(4)}с рвёт слово`).toBe(false)
    }
  })
})

describe("приоритет: настоящая пауза важнее стыка слов", () => {
  it("сетка предпочитает паузу, даже когда стык ближе к желаемой точке", () => {
    // Желаемый рез — 1.80с (`shotChangeSec`). Стык «а|б» стоит в 1.75с (в
    // 0.05с от желаемой точки), настоящая пауза — 2.40-2.80с (её ближняя
    // точка в 0.60с). По одному расстоянию победил бы стык; §5.3 требует
    // паузу — смена плана в паузе выглядит намеренной.
    const scene = {
      order: 1,
      startSec: 0,
      endSec: 5,
      words: [
        { text: "а", startSec: 0, endSec: 1.75, matched: true },
        { text: "б", startSec: 1.75, endSec: 2.4, matched: true },
        { text: "в", startSec: 2.8, endSec: 5, matched: true },
      ],
    }

    const { cells } = buildShotGrid({
      alignedScenes: [scene],
      presenterSceneOrders: new Set<number>(),
      shotChangeSec: 1.8,
      lipSyncMaxDurationSec: 10,
      fps: FPS,
      brollAllowed: true,
    })

    expect(cells).toHaveLength(2)
    expect(cells[0]!.endSec).toBeGreaterThanOrEqual(2.4)
    expect(cells[0]!.endSec).toBeLessThanOrEqual(2.8)
  })

  it("ремонт предпочитает паузу, даже когда стык ближе к желаемой точке", () => {
    // Граница 1.30с рвёт слово «б» (1.20-1.50). Стык «а|б» — 1.20с (0.10с),
    // настоящая пауза 1.50-1.90с (ближняя безопасная точка ~1.52с, 0.22с).
    // Оба кандидата в пределах окна поиска, стык ближе — приоритет обязан
    // отдать паузу.
    const words = [
      { text: "а", startSec: 0, endSec: 1.2, matched: true },
      { text: "б", startSec: 1.2, endSec: 1.5, matched: true },
      { text: "в", startSec: 1.9, endSec: 3.0, matched: true },
    ]
    const scenes = [{ order: 1, startSec: 0, endSec: 3.0, words }]
    const shots: PlannedShot[] = [
      { ...SHOT_BASE, order: 0, startSec: 0, endSec: 1.3 },
      { ...SHOT_BASE, order: 1, startSec: 1.3, endSec: 3.0 },
    ]

    const { before, plan } = repairShotPlan(context(shots, { alignedScenes: scenes, trackDurationSec: 3.0 }))

    // Вход действительно порочен — иначе тест доказывал бы пустоту.
    expect(before.some(v => v.code === "word_split")).toBe(true)
    expect(plan.shots[0]!.endSec).toBeGreaterThanOrEqual(1.5)
    expect(plan.shots[0]!.endSec).toBeLessThanOrEqual(1.9)
  })

  it("дробление реплики предпочитает паузу, даже когда стык ближе к потолку модели", () => {
    // Пауза 9.00-9.20 (0.20с — короче MEANINGFUL_PAUSE_SEC, branch 1 её не
    // берёт) и стык «б|в» в 9.70с. Потолок — 10с, стык ближе к нему, но
    // branch 3 обязан сначала перебрать настоящие паузы.
    const result = splitLongPresenterLine({
      scene: {
        order: 1,
        startSec: 0,
        endSec: 15,
        words: [
          { text: "а", startSec: 0, endSec: 9.0, matched: true },
          { text: "б", startSec: 9.2, endSec: 9.7, matched: true },
          { text: "в", startSec: 9.7, endSec: 15, matched: true },
        ],
      },
      maxDurationSec: 10,
      fps: FPS,
      brollAllowed: false,
    })

    expect(result.parts[0]!.endSec).toBeGreaterThanOrEqual(9.0)
    expect(result.parts[0]!.endSec).toBeLessThanOrEqual(9.2)
  })
})

describe("граница внутри слова остаётся нарушением всегда", () => {
  it("граница ровно на стыке слов нарушением НЕ считается", () => {
    // 2.20с — стык «без|фастфуда.», ширина стыка нулевая, но слова он не рвёт.
    const shots: PlannedShot[] = [
      { ...SHOT_BASE, order: 0, startSec: 0, endSec: 2.2 },
      { ...SHOT_BASE, order: 1, startSec: 2.2, endSec: 6.0 },
    ]

    expect(validateShotPlan(context(shots)).filter(v => v.code === "word_split")).toEqual([])
  })

  it("граница внутри слова — нарушение, стык её не оправдывает", () => {
    // 1.80с — середина слова «без» (1.60-2.20). Ровно то, что упало на стенде.
    const shots: PlannedShot[] = [
      { ...SHOT_BASE, order: 0, startSec: 0, endSec: 1.8 },
      { ...SHOT_BASE, order: 1, startSec: 1.8, endSec: 6.0 },
    ]

    const violations = validateShotPlan(context(shots)).filter(v => v.code === "word_split")

    expect(violations).toHaveLength(1)
    expect(violations[0]!.message).toContain("Граница кадра 1 в 1.80с приходится на середину слова")
  })
})

describe("дробление длинной реплики на слитной транскрипции", () => {
  /** 30 слов по 0.70с встык: 0.00-21.00, ни одной паузы. */
  const DENSE_WORDS = Array.from({ length: 30 }, (_, index) => ({
    text: `w${index}`,
    startSec: Number((index * 0.7).toFixed(2)),
    endSec: Number(((index + 1) * 0.7).toFixed(2)),
    matched: true,
  }))

  it("режет по стыку слов, а не по потолку модели посреди слова", () => {
    const result = splitLongPresenterLine({
      scene: { order: 1, startSec: 0, endSec: 21, words: DENSE_WORDS },
      maxDurationSec: 10,
      fps: FPS,
      brollAllowed: false,
    })

    // Ветка 4 (рез ровно по потолку) дала бы 10.00с — середину слова
    // w14 (9.80-10.50). Стык 9.80с законен и ближе всего к потолку снизу.
    expect(result.parts[0]!.endSec).toBeCloseTo(9.8, 6)
    for (const part of result.parts) {
      expect(insideAnyWord(part.startSec, DENSE_WORDS), `начало части ${part.startSec} рвёт слово`).toBe(false)
      expect(insideAnyWord(part.endSec, DENSE_WORDS), `конец части ${part.endSec} рвёт слово`).toBe(false)
      expect(part.endSec - part.startSec).toBeLessThanOrEqual(10 + 1e-6)
    }
    expect(result.warning).toMatch(/стык/)
  })
})
