import { describe, expect, it } from "vitest"

import { DEFAULT_EDIT_PROFILE } from "~~/server/utils/edit-plan/profile"
import { validateShotPlan } from "~~/server/utils/edit-plan/validate"
import { planLipSyncParts } from "~~/server/utils/presenter/lip-sync-parts"
import type { PlannedShot } from "~~/server/utils/edit-plan/types"

const WORDS = [
  { text: "первое", startSec: 0, endSec: 0.9, matched: true },
  { text: "второе", startSec: 1.0, endSec: 1.9, matched: true },
  { text: "третье", startSec: 2.1, endSec: 3.0, matched: true },
]

const SCENES = [{ order: 1, startSec: 0, endSec: 3.0, words: WORDS }]

function shot(overrides: Partial<PlannedShot> = {}): PlannedShot {
  return {
    order: 0,
    startSec: 0,
    endSec: 3.0,
    sceneOrder: 1,
    foreground: "presenter",
    background: "none",
    backgroundClipId: null,
    appReferenceId: null,
    idea: null,
    pipEnabled: false,
    ...overrides,
  }
}

function context(shots: PlannedShot[], overrides: Record<string, unknown> = {}) {
  return {
    plan: { shots },
    trackDurationSec: 3.0,
    fps: 30,
    alignedScenes: SCENES,
    profile: DEFAULT_EDIT_PROFILE,
    lipSyncMaxDurationSec: 10,
    minGenerativeVideoSec: 5,
    maxGenerativeVideoSec: 10,
    knownBackgroundIds: new Set<string>(),
    knownAppScreenIds: new Set<string>(),
    ...overrides,
  } as never
}

describe("валидация плана кадров", () => {
  it("принимает план, покрывающий трек без дыр", () => {
    // Второй кадр — foreground: "none", а не дефолтный "presenter": иначе
    // перебивок в плане ноль при целевых 40% (DEFAULT_EDIT_PROFILE.brollRatio)
    // и допуске 0.15, и validateShotPlan честно вернёт broll_ratio. С этой
    // расстановкой доля перебивок 1.05/3.0 = 0.35 — внутри допуска.
    // Граница 1.95 попадает в межсловный интервал (1.9-2.1 между «второе» и
    // «третье»), слово не рвётся.
    const violations = validateShotPlan(context([
      shot({ order: 0, startSec: 0, endSec: 1.95 }),
      shot({ order: 1, startSec: 1.95, endSec: 3.0, foreground: "none" }),
    ]))

    expect(violations).toEqual([])
  })

  it("ловит дыру между кадрами", () => {
    const violations = validateShotPlan(context([
      shot({ order: 0, startSec: 0, endSec: 1.0 }),
      shot({ order: 1, startSec: 1.5, endSec: 3.0 }),
    ]))

    expect(violations.map(v => v.code)).toContain("gap")
  })

  it("ловит дыру в хвосте — план не дотягивает до конца трека", () => {
    // В отличие от предыдущего теста здесь нет ни внутренней дыры, ни
    // нахлёста: единственный кадр просто не дотягивает до конца трека.
    // Это отдельная ветка проверки (после основного цикла по кадрам), и
    // тест выше её не задевает — оба кадра там в сумме покрывают весь трек.
    const violations = validateShotPlan(context([
      shot({ order: 0, startSec: 0, endSec: 2.0, foreground: "none" }),
    ]))

    expect(violations.map(v => v.code)).toContain("gap")
  })

  it("не считает дырой хвост между trackEndFrame и сырой длительностью трека (Critical 2)", () => {
    // trackDurationSec = 3.02 с: 3.02 * 30 = 90.6 кадра, trackEndFrame
    // (floor) = 90/30 = 3.0 — граница кадра НЕ ПОЗЖЕ конца трека. Кадр,
    // доходящий ровно до этой точки, покрывает ВЕСЬ реальный звук трека.
    // Старая валидация сверяла хвост с сырыми 3.02 и объявляла дыру там, где
    // репэйр (repair.ts) уже поставил конец кадра ровно в trackEndFrame —
    // расхождение воспроизводилось на ~49% случайных длительностей.
    const violations = validateShotPlan(context([
      shot({ order: 0, startSec: 0, endSec: 3.0, foreground: "none" }),
    ], { trackDurationSec: 3.02 }))

    expect(violations.map(v => v.code)).not.toContain("gap")
    expect(violations.map(v => v.code)).not.toContain("out_of_track")
  })

  it("ловит нахлёст кадров", () => {
    const violations = validateShotPlan(context([
      shot({ order: 0, startSec: 0, endSec: 2.0 }),
      shot({ order: 1, startSec: 1.5, endSec: 3.0 }),
    ]))

    expect(violations.map(v => v.code)).toContain("overlap")
  })

  it("ловит границу посреди слова", () => {
    // 1.4 с — середина слова «второе» (1.0-1.9). Смена картинки там режет
    // слово пополам, и это слышно и видно.
    const violations = validateShotPlan(context([
      shot({ order: 0, startSec: 0, endSec: 1.4 }),
      shot({ order: 1, startSec: 1.4, endSec: 3.0 }),
    ]))

    expect(violations.map(v => v.code)).toContain("word_split")
  })

  it("ловит presenter-кадр длиннее потолка lip-sync модели", () => {
    const violations = validateShotPlan(context(
      [shot({ order: 0, startSec: 0, endSec: 12 })],
      { trackDurationSec: 12 },
    ))

    expect(violations.map(v => v.code)).toContain("presenter_too_long")
  })

  it("ловит ссылку на несуществующий фон", () => {
    const violations = validateShotPlan(context([
      shot({ order: 0, background: "library", backgroundClipId: "нет-такого" }),
    ]))

    expect(violations.map(v => v.code)).toContain("unknown_background")
  })

  it("принимает ссылку на фон, который есть в библиотеке", () => {
    // Зеркало предыдущего теста: тот же background: "library", но id
    // известен движку. Без этого теста проверка «ссылка на фон существует»
    // могла бы вырождаться в «background === library всегда невалиден» —
    // и дедуп-тест выше этого бы не заметил.
    const violations = validateShotPlan(context([
      shot({ order: 0, background: "library", backgroundClipId: "клип-1", foreground: "none" }),
    ], { knownBackgroundIds: new Set(["клип-1"]), knownAppScreenIds: new Set<string>() }))

    expect(violations.map(v => v.code)).not.toContain("unknown_background")
  })

  it("ловит app_screen без ссылки на источник (Minor 5)", () => {
    // §5.3 «ссылки на фоны существуют» — не только у библиотечных клипов.
    // Кадр со скрином приложения без appReferenceId так же не из чего собрать.
    const violations = validateShotPlan(context([
      shot({ order: 0, background: "app_screen", appReferenceId: null }),
    ]))

    expect(violations.map(v => v.code)).toContain("unknown_background")
  })

  it("ловит ссылку на несуществующий скрин приложения (Critical 2 ре-ревью задачи)", () => {
    // Раньше проверялось только "поле не пустое" — модель могла назвать
    // НЕСУЩЕСТВУЮЩИЙ id, и это считалось валидным: `createMany` в раннере
    // падал бы по FK ПОСЛЕ того, как вызов модели уже оплачен. Симметрично
    // "ловит ссылку на несуществующий фон" для library.
    const violations = validateShotPlan(context([
      shot({ order: 0, background: "app_screen", appReferenceId: "выдуманный-скрин", foreground: "none" }),
    ]))

    expect(violations.map(v => v.code)).toContain("unknown_background")
  })

  it("принимает app_screen со ссылкой на источник, которая есть среди референсов", () => {
    // Зеркало предыдущего теста: тот же background: "app_screen", но id
    // известен движку — без этого теста проверка «ссылка существует» могла
    // бы вырождаться в «background === app_screen всегда невалиден».
    const violations = validateShotPlan(context([
      shot({ order: 0, background: "app_screen", appReferenceId: "ref-1", foreground: "none" }),
    ], { knownAppScreenIds: new Set(["ref-1"]) }))

    expect(violations.map(v => v.code)).not.toContain("unknown_background")
  })

  it("отклоняет генеративное видео на кадре короче пяти секунд", () => {
    // §7: длительность квантуется в 5 или 10 секунд, поэтому двухсекундная
    // перебивка обошлась бы в цену пятисекундного клипа. Отклонять надо ДО
    // оплаты, а не после.
    const violations = validateShotPlan(context([
      shot({ order: 0, startSec: 0, endSec: 2.0, foreground: "none", background: "video" }),
      shot({ order: 1, startSec: 2.0, endSec: 3.0, foreground: "none", background: "none" }),
    ]))

    expect(violations.map(v => v.code)).toContain("generative_video_too_short")
  })

  it("отклоняет генеративное видео на кадре длиннее одного клипа (требование 8, задача 5)", () => {
    // Один клип Kling не заказать длиннее 10с (REPLICATE_KLING_16_DURATIONS[1]).
    // Кадр без ведущего геометрически валиден (presenter_too_long его не
    // ограничивает), но исполнение (pickBackgroundSource) всё равно отдало бы
    // картинку — план не должен молчать об этом до оплаты.
    const violations = validateShotPlan(context([
      shot({ order: 0, startSec: 0, endSec: 3.0, foreground: "none", background: "video" }),
    ], {
      trackDurationSec: 3.0,
      minGenerativeVideoSec: 1,
      maxGenerativeVideoSec: 2,
      profile: { ...DEFAULT_EDIT_PROFILE, generativeVideoEnabled: true },
    }))

    expect(violations.map(v => v.code)).toContain("generative_video_too_long")
  })

  it("принимает генеративное видео на кадре достаточной длины при включённом флаге профиля", () => {
    // Зеркало предыдущего теста: минимум опущен до 1 с, кадр длится 3 с —
    // «video» не должен считаться коротким сам по себе, только относительно
    // порога minGenerativeVideoSec. Флаг профиля включён явно: по умолчанию
    // DEFAULT_EDIT_PROFILE.generativeVideoEnabled === false, и без явного
    // включения этот тест ловил бы generative_video_disabled, а не то, что
    // заявлено в названии.
    const violations = validateShotPlan(context([
      shot({ order: 0, startSec: 0, endSec: 3.0, foreground: "none", background: "video" }),
    ], {
      minGenerativeVideoSec: 1,
      maxGenerativeVideoSec: 10,
      profile: { ...DEFAULT_EDIT_PROFILE, generativeVideoEnabled: true },
    }))

    expect(violations.map(v => v.code)).not.toContain("generative_video_too_short")
    expect(violations.map(v => v.code)).not.toContain("generative_video_disabled")
  })

  it("ловит генеративное видео при выключенном флаге профиля (Minor 6)", () => {
    // §7: генеративное видео допустимо «только... по флагу профиля». Кадр
    // достаточной длины (не short), но флаг выключен — старая валидация
    // проверяла только длину и молча пропускала такой кадр к оплате.
    const violations = validateShotPlan(context([
      shot({ order: 0, startSec: 0, endSec: 3.0, foreground: "none", background: "video" }),
    ], { minGenerativeVideoSec: 1, maxGenerativeVideoSec: 10 }))

    expect(violations.map(v => v.code)).toContain("generative_video_disabled")
    expect(violations.map(v => v.code)).not.toContain("generative_video_too_short")
  })

  it("ловит кадр за концом трека", () => {
    const violations = validateShotPlan(context([shot({ order: 0, startSec: 0, endSec: 4.5 })]))

    expect(violations.map(v => v.code)).toContain("out_of_track")
  })

  it("сообщает о доле перебивок вне допуска", () => {
    const violations = validateShotPlan(context([
      shot({ order: 0, startSec: 0, endSec: 3.0, foreground: "presenter" }),
    ]))

    // Ноль перебивок при целевых 40% — ролик целиком говорящая голова.
    expect(violations.map(v => v.code)).toContain("broll_ratio")
  })

  it("не отклоняет план на плавающей границе допуска доли перебивок (Minor 2)", () => {
    // trackEnd = 2.0, broll = 0.5 → ratio = 0.25. |0.25 − 0.4| в IEEE754 —
    // 0.15000000000000002, строго больше номинальных 0.15. Слово в
    // alignedScenes подобрано так, чтобы граница 1.5 попадала в хвостовую
    // тишину (0 нет, единственное слово 0-1.0, конец сцены 2.0) и не рвала
    // ничего — единственное, что тест проверяет, это плавающая точка.
    const violations = validateShotPlan(context([
      shot({ order: 0, startSec: 0, endSec: 1.5, foreground: "presenter" }),
      shot({ order: 1, startSec: 1.5, endSec: 2.0, foreground: "none" }),
    ], {
      trackDurationSec: 2.0,
      alignedScenes: [{ order: 1, startSec: 0, endSec: 2.0, words: [{ text: "w", startSec: 0, endSec: 1.0, matched: true }] }],
    }))

    expect(violations.map(v => v.code)).not.toContain("broll_ratio")
  })

  it("считает долю перебивок от длины трека, а не от суммы длин кадров (Minor 8)", () => {
    // Один кадр 0-4 на треке 10 с (дыра 4-10 не мешает: она отдельно ловится
    // как gap). Если знаменатель — сумма длин кадров (4), доля выходит 100%
    // и вне допуска; если знаменатель — длина трека (10), доля ровно 40% —
    // в целевой доле, отклонений быть не должно.
    const violations = validateShotPlan(context([
      shot({ order: 0, startSec: 0, endSec: 4, foreground: "none" }),
    ], { trackDurationSec: 10 }))

    expect(violations.map(v => v.code)).not.toContain("broll_ratio")
  })

  it("отклоняет пустой план — покрывать таймлайн нечем", () => {
    expect(validateShotPlan(context([])).map(v => v.code)).toContain("empty")
  })

  it("ловит нечисловые границы кадра, не глуша проверку последующих кадров (Important 2)", () => {
    // NaN/Infinity в сравнениях всегда ложны: без явной проверки такой кадр
    // не породил бы ни gap, ни overlap, ни out_of_track — план прошёл бы
    // ворота перед оплатой чистым. Хуже: `cursor = Math.max(cursor, NaN)`
    // отравляет курсор NaN НАВСЕГДА, и все проверки для ВСЕХ следующих
    // кадров тоже гаснут молча. Второй кадр здесь специально оторван от
    // трека (startSec: 10 при треке 3с) — его gap обязан быть пойман, даже
    // если первый кадр — мусор.
    const violations = validateShotPlan(context([
      shot({ order: 0, startSec: 0, endSec: Number.NaN }),
      shot({ order: 1, startSec: 10, endSec: 11 }),
    ], { trackDurationSec: 11 }))

    expect(violations.map(v => v.code)).toContain("invalid_bounds")
    expect(violations.map(v => v.code)).toContain("gap")
  })

  it("ловит кадр нулевой или отрицательной длины (Critical 3)", () => {
    const violations = validateShotPlan(context([
      shot({ order: 0, startSec: 1.0, endSec: 1.0 }),
    ], { trackDurationSec: 3.0 }))

    expect(violations.map(v => v.code)).toContain("invalid_bounds")
  })

  it("не путает шум округления с дырой на нестандартном fps (Minor 1)", () => {
    // Допуск раньше был захардкожен под 30 fps (1/60 ≈ 16.7 мс). На 24 fps
    // половина кадра — 20.8 мс, и разрыв в 20 мс (чистый шум округления на
    // этом fps) старый код принял бы за настоящую дыру.
    const violations = validateShotPlan(context([
      shot({ order: 0, startSec: 0, endSec: 1.0, foreground: "none" }),
      shot({ order: 1, startSec: 1.02, endSec: 2.0, foreground: "none" }),
    ], { fps: 24, trackDurationSec: 2.0 }))

    expect(violations.map(v => v.code)).not.toContain("gap")
  })

  it("допуск word_split зависит от fps так же, как допуск округления (Minor 10)", () => {
    // Слово (0-2.0), граница 1.978 — на 22 мс раньше конца слова. Старый
    // фиксированный допуск 20 мс объявил бы это разрывом слова. Новый допуск
    // на fps 24 — halfFrameSec(24) + 3 мс запаса ≈ 23.8 мс — уже не считает
    // это разрывом: сама притяжка границы к кадру на этом fps может занести
    // её вглубь слова на величину до половины кадра (20.8 мс), и допуск
    // обязан покрывать этот шум, а не только числа для 30 fps.
    const violations = validateShotPlan(context([
      shot({ order: 0, startSec: 0, endSec: 1.978, foreground: "none" }),
      shot({ order: 1, startSec: 1.978, endSec: 3.0, foreground: "none" }),
    ], {
      fps: 24,
      alignedScenes: [{ order: 1, startSec: 0, endSec: 3.0, words: [{ text: "w", startSec: 0, endSec: 2.0, matched: true }] }],
    }))

    expect(violations.map(v => v.code)).not.toContain("word_split")
  })

  it("не мутирует входной план", () => {
    // Спека и бриф требуют чистоты: план приходит из ответа модели, и его
    // порча стёрла бы то, что должно уйти в диагностику повторного запроса.
    const shots = [
      shot({ order: 1, startSec: 1.95, endSec: 3.0, foreground: "none" }),
      shot({ order: 0, startSec: 0, endSec: 1.95 }),
    ]
    const snapshot = JSON.parse(JSON.stringify(shots))

    validateShotPlan(context(shots))

    expect(shots).toEqual(snapshot)
  })
})

/**
 * Агрегат сцены против потолка lip-sync (дефект «липсинк застыл» на ролике 30).
 *
 * Числа настоящие: сцена 9 занимает в треке 79.57-90.93 (11.36с), клип lip-sync
 * из снапшота шага — 9.90с, потолок `kwaivgi/kling-lip-sync` — 10 секунд. Каждый
 * из семи кадров сцены короткий и `presenter_too_long` проходит, но lip-sync
 * производится НА СЦЕНУ, и клип покрывает только первые 10 секунд её времени —
 * остаток добивался удержанием последнего кадра, то есть замороженным лицом под
 * живую речь.
 */
const SCENE9_START = 79.57
const SCENE9_END = 90.93
const TRACK_SEC = 90.93

function scene9Words() {
  // Слова встык по 0.4с с паузами 0.1с — чтобы границы кадров ниже попадали в
  // межсловные интервалы и `word_split` не шумел в списке нарушений.
  const words: Array<{ text: string, startSec: number, endSec: number, matched: boolean }> = []
  for (let cursor = SCENE9_START; cursor + 0.4 < SCENE9_END; cursor += 0.5) {
    words.push({ text: `w${words.length}`, startSec: cursor, endSec: cursor + 0.4, matched: true })
  }
  return words
}

const SCENE9 = { order: 9, startSec: SCENE9_START, endSec: SCENE9_END, words: scene9Words() }

/** Кадры сцены 9 по 1.62с, как в реальном плане: 7 штук на 11.36 секунды. */
function scene9Shots(foregroundOf: (index: number) => "presenter" | "none"): PlannedShot[] {
  const bounds = [79.57, 81.19, 82.81, 84.43, 86.05, 87.67, 89.29, 90.93]
  return bounds.slice(0, -1).map((startSec, index) => ({
    order: index,
    startSec,
    endSec: bounds[index + 1]!,
    sceneOrder: 9,
    foreground: foregroundOf(index),
    background: foregroundOf(index) === "presenter" ? "none" : "image",
    backgroundClipId: null,
    appReferenceId: null,
    idea: null,
    pipEnabled: false,
  })) as PlannedShot[]
}

function scene9Context(shots: PlannedShot[], overrides: Record<string, unknown> = {}) {
  return context(shots, {
    trackDurationSec: TRACK_SEC,
    alignedScenes: [SCENE9],
    // Кадры покрывают только сцену 9, а трек длиннее её начала — дыра в голове
    // трека здесь заведомо есть и проверке агрегата не мешает.
    profile: { ...DEFAULT_EDIT_PROFILE, brollRatio: 0 },
    ...overrides,
  })
}

describe("потолок lip-sync на СЦЕНУ, а не только на кадр", () => {
  /** Та же сцена, но БЕЗ пословных границ: дробить реплику нечем (§5.3). */
  const SCENE9_NO_WORDS = { ...SCENE9, words: [] }

  it("сцену, которую ДРОБИТЬ УДАЛОСЬ, агрегат не обвиняет — части покрывают реплику целиком", () => {
    // Правка 26.08.2026: lip-sync больше не режет из трека один префикс
    // [начало сцены, +потолок], а дробит длинную реплику и платит за каждую
    // часть отдельно (spec §5.3). Кадры, нарезанные ПО ЧАСТЯМ (ровно так их
    // отдаёт `buildShotGrid`), живой материал получают все до одного.
    const parts = planLipSyncParts({
      scene: SCENE9,
      maxDurationSec: 10,
      fps: 30,
      brollAllowed: false,
    }).parts
    // Вход обязан оставаться тем, ради чего написан: реплика реально разбита.
    expect(parts.length).toBeGreaterThan(1)

    const shots = parts.map((part, index) => ({
      ...scene9Shots(() => "presenter")[0]!,
      order: index,
      startSec: part.startSec,
      endSec: part.endSec,
    })) as PlannedShot[]

    expect(validateShotPlan(scene9Context(shots)).map(v => v.code)).not.toContain("presenter_scene_too_long")
  })

  it("кадр, переехавший границу частей, обвиняется — живого материала на всю его длину нет", () => {
    // Кадры по 1.62с нарезаны БЕЗ оглядки на точки дробления, и один из них
    // приходится ровно на стык двух частей: первая часть до него не достаёт,
    // вторая начинается позже его начала. Композиция такой кадр уведёт на фон
    // (`presenterLiveSec`), и план обязан сказать об этом заранее.
    const violations = validateShotPlan(scene9Context(scene9Shots(() => "presenter")))
    const codes = violations.map(v => v.code)

    expect(codes).toContain("presenter_scene_too_long")
    // Именно агрегат, а не кадр: ни один кадр сцены не длиннее потолка.
    expect(codes).not.toContain("presenter_too_long")
    expect(violations.find(v => v.code === "presenter_scene_too_long")!.message).toContain("9")
  })

  it("сцену БЕЗ пословных границ дробить нечем — хвост обвиняется, как и до дробления", () => {
    // Единственный случай, ради которого код нарушения и сохранён: без слов
    // §5.3 резать не по чему (по таймеру дробить прямо запрещено), часть одна
    // и её окно обрывается на потолке. Кадр 6 (89.29-90.93) — единственный,
    // которому клип ведущей физически не покрывает время: 89.29 + 1.64 уже за
    // 89.57 = 79.57 + 10.
    const codes = validateShotPlan(scene9Context(scene9Shots(() => "presenter"), {
      alignedScenes: [SCENE9_NO_WORDS],
    })).map(v => v.code)

    expect(codes).toContain("presenter_scene_too_long")
    expect(codes).not.toContain("presenter_too_long")
  })

  it("тот же план БЕЗ слов и с последним кадром-перебивкой нарушения не даёт", () => {
    const violations = validateShotPlan(scene9Context(
      scene9Shots(index => (index === 6 ? "none" : "presenter")),
      { alignedScenes: [SCENE9_NO_WORDS] },
    ))
    expect(violations.map(v => v.code)).not.toContain("presenter_scene_too_long")
  })

  it("первый кадр сцены не обвиняется никогда — живой материал у него есть по построению", () => {
    // Единственный кадр ведущего, длиннее потолка: это `presenter_too_long`
    // (дробление реплики, §5.3), а не агрегат сцены. Два кода на одну причину
    // отправили бы план на платный повторный запрос дважды.
    const shots = [{
      ...scene9Shots(() => "presenter")[0]!,
      order: 0,
      startSec: SCENE9_START,
      endSec: SCENE9_END,
    }] as PlannedShot[]
    const codes = validateShotPlan(scene9Context(shots)).map(v => v.code)

    expect(codes).toContain("presenter_too_long")
    expect(codes).not.toContain("presenter_scene_too_long")
  })

  it("негодный потолок модели агрегат не проверяет — окна не существует", () => {
    for (const lipSyncMaxDurationSec of [0, -3, Number.NaN]) {
      const violations = validateShotPlan(scene9Context(scene9Shots(() => "presenter"), { lipSyncMaxDurationSec }))
      expect(violations.map(v => v.code)).not.toContain("presenter_scene_too_long")
    }
  })

  it("сцены нет в выравнивании — окна тоже нет, агрегат молчит", () => {
    // Ровно та ветка, что и в `fitPresenterClipsToScenes`: без границ сцены в
    // ТЕКУЩЕМ выравнивании клип используется как есть, приводить его не к чему.
    const violations = validateShotPlan(scene9Context(scene9Shots(() => "presenter"), {
      alignedScenes: [{ ...SCENE9, order: 3 }],
    }))
    expect(violations.map(v => v.code)).not.toContain("presenter_scene_too_long")
  })
})
