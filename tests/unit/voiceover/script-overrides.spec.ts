/**
 * Правки сценария, ЛИЧНЫЕ для ролика (`Video.scriptOverrides`).
 *
 * Дыра, которую закрывает модуль: `ScenarioVariant.storyPlan` — общий артефакт.
 * Один вариант может кормить несколько роликов, и правка фразы на ролике A,
 * записанная в вариант, меняла сценарий ролику B — уже снятому или снимающемуся.
 * B при следующей перегенерации получил бы чужой текст и заплатил за синтез и
 * lip-sync того, чего никто не просил.
 *
 * Проверяется здесь ровно контракт наложения: где живёт правка, кому она видна и
 * во что превращается общий сценарий для КОНКРЕТНОГО ролика. Межроликовая
 * изоляция на настоящей БД — `tests/integration/scenario-per-video-script.spec.ts`.
 */

import { describe, expect, it } from "vitest"

import {
  applyScriptOverrides,
  planVideoScriptOverride,
  readScriptOverrides,
} from "~~/server/utils/voiceover/script-overrides"

/** Общий сценарий варианта: сцена 2 — реплика ведущего, сцена 3 — закадровая. */
function basePlan(): Record<string, unknown> {
  return {
    version: "1.0",
    scenes: [
      { order: 1, spokenLine: "первая", subtitleCopy: "первая" },
      { order: 2, spokenLine: "вторая", subtitleCopy: "вторая" },
      { order: 3, spokenLine: null, subtitleCopy: "третья" },
    ],
    voiceoverPlan: {
      enabled: true,
      lines: [{ sceneOrder: 3, text: "третья", emotion: "neutral" }],
    },
  }
}

function spokenOf(plan: unknown, order: number): string | null {
  const scenes = ((plan as Record<string, unknown>).scenes ?? []) as Array<{ order: number, spokenLine: string | null }>
  return scenes.find(scene => scene.order === order)?.spokenLine ?? null
}

function narrationOf(plan: unknown, order: number): string | null {
  const voiceoverPlan = (plan as Record<string, unknown>).voiceoverPlan as
    { lines?: Array<{ sceneOrder: number, text: string }> } | undefined
  return voiceoverPlan?.lines?.find(line => line.sceneOrder === order)?.text ?? null
}

describe("applyScriptOverrides — общий сценарий глазами одного ролика", () => {
  it("ролик без правок читает ТОТ ЖЕ объект сценария, а не копию", () => {
    // Ленивость: копия плана заводится только при первой правке. Копируй мы
    // всегда — у каждого ролика появился бы мёртвый дубль большого storyPlan,
    // и любое законное изменение варианта перестало бы до ролика доезжать.
    const plan = basePlan()

    expect(applyScriptOverrides(plan, null)).toBe(plan)
    expect(applyScriptOverrides(plan, { v: 1, lines: [] })).toBe(plan)
  })

  it("правка ролика ложится в реплику ведущего и не трогает исходный сценарий", () => {
    const plan = basePlan()
    const overrides = { v: 1, lines: [{ sceneOrder: 2, target: "spoken", text: "Новая формулировка.", at: "t" }] }

    const effective = applyScriptOverrides(plan, overrides)

    expect(spokenOf(effective, 2)).toBe("Новая формулировка.")
    // Общий вариант обязан остаться нетронутым: его читают другие ролики.
    expect(spokenOf(plan, 2)).toBe("вторая")
    expect(effective).not.toBe(plan)
    // Соседние сцены не задеты.
    expect(spokenOf(effective, 1)).toBe("первая")
  })

  it("правка закадровой сцены не создаёт ведущего в кадре", () => {
    // `mergeScriptLines` берёт закадровую строку только когда реплики в кадре
    // нет. Запиши мы текст в `spokenLine` такой сцены — ролик получил бы
    // говорящего в кадре там, где его не было, и оплатил бы лишний lip-sync.
    const plan = basePlan()
    const overrides = { v: 1, lines: [{ sceneOrder: 3, target: "narration", text: "Новая закадровая.", at: "t" }] }

    const effective = applyScriptOverrides(plan, overrides)

    expect(narrationOf(effective, 3)).toBe("Новая закадровая.")
    expect(spokenOf(effective, 3)).toBeNull()
  })

  it("правки разных сцен накладываются обе", () => {
    const effective = applyScriptOverrides(basePlan(), {
      v: 1,
      lines: [
        { sceneOrder: 2, target: "spoken", text: "Новая вторая.", at: "t1" },
        { sceneOrder: 3, target: "narration", text: "Новая третья.", at: "t2" },
      ],
    })

    expect(spokenOf(effective, 2)).toBe("Новая вторая.")
    expect(narrationOf(effective, 3)).toBe("Новая третья.")
  })

  it("правка сцены, исчезнувшей из сценария, роняет только себя", () => {
    // Вариант могли переписать целиком (rework). Якоря нет — писать некуда, и
    // выдумывать сцену нельзя: остальные правки ролика при этом обязаны выжить.
    const effective = applyScriptOverrides(basePlan(), {
      v: 1,
      lines: [
        { sceneOrder: 99, target: "spoken", text: "сцены больше нет", at: "t1" },
        { sceneOrder: 2, target: "spoken", text: "Новая вторая.", at: "t2" },
      ],
    })

    expect(spokenOf(effective, 2)).toBe("Новая вторая.")
    expect((effective as { scenes: unknown[] }).scenes).toHaveLength(3)
  })

  it("сценария нет вовсе — накладывать не на что, и это не падение", () => {
    expect(applyScriptOverrides(null, { v: 1, lines: [{ sceneOrder: 2, target: "spoken", text: "x", at: "t" }] }))
      .toBeNull()
  })
})

describe("readScriptOverrides — обратная совместимость чтения", () => {
  it("ролик, снятый до появления правок, отдаёт пустой список", () => {
    // Колонка появилась миграцией и у всех прежних роликов равна null. Ни один
    // из них не должен ни упасть, ни получить чужой текст.
    expect(readScriptOverrides(null)).toEqual([])
    expect(readScriptOverrides(undefined)).toEqual([])
  })

  it("мусор в колонке игнорируется целиком, а не роняет чтение сценария", () => {
    expect(readScriptOverrides("строка")).toEqual([])
    expect(readScriptOverrides([1, 2, 3])).toEqual([])
    expect(readScriptOverrides({ v: 1 })).toEqual([])
    // Строка без номера сцены или без текста бесполезна: наложить её некуда.
    expect(readScriptOverrides({ v: 1, lines: [{ text: "без сцены" }, { sceneOrder: 2 }] })).toEqual([])
  })

  it("читается версия, которую пишем мы", () => {
    const lines = readScriptOverrides({
      v: 1,
      lines: [{ sceneOrder: 2, target: "spoken", text: "Новая.", at: "2026-08-27T00:00:00.000Z" }],
    })

    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ sceneOrder: 2, target: "spoken", text: "Новая." })
  })
})

describe("planVideoScriptOverride — запись правки в ролик", () => {
  it("первая правка заводит ровно одну строку, а не копию плана", () => {
    const patch = planVideoScriptOverride({
      storyPlan: basePlan(),
      overrides: null,
      sceneOrder: 2,
      newText: "Новая формулировка.",
      at: "2026-08-27T00:00:00.000Z",
    })

    expect(patch.ok).toBe(true)
    if (!patch.ok) return
    expect(patch.changed).toBe(true)
    expect(patch.target).toBe("spoken")
    expect(patch.overrides.lines).toHaveLength(1)
    expect(patch.overrides.lines[0]).toMatchObject({ sceneOrder: 2, target: "spoken", text: "Новая формулировка." })
    // Хранится ПРАВКА, а не сценарий: дубль большого плана на каждом ролике —
    // это и рост базы, и потеря наследования от варианта.
    expect(JSON.stringify(patch.overrides).length).toBeLessThan(JSON.stringify(basePlan()).length)
  })

  it("вторая правка той же сцены заменяет прежнюю, а не копится", () => {
    const first = planVideoScriptOverride({
      storyPlan: basePlan(), overrides: null, sceneOrder: 2, newText: "Первая правка.",
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const second = planVideoScriptOverride({
      storyPlan: basePlan(), overrides: first.overrides, sceneOrder: 2, newText: "Вторая правка.",
    })
    expect(second.ok).toBe(true)
    if (!second.ok) return

    expect(second.overrides.lines).toHaveLength(1)
    expect(second.overrides.lines[0]!.text).toBe("Вторая правка.")
    expect(spokenOf(applyScriptOverrides(basePlan(), second.overrides), 2)).toBe("Вторая правка.")
  })

  it("правка другой сцены дописывается к прежней", () => {
    const first = planVideoScriptOverride({
      storyPlan: basePlan(), overrides: null, sceneOrder: 2, newText: "Новая вторая.",
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const second = planVideoScriptOverride({
      storyPlan: basePlan(), overrides: first.overrides, sceneOrder: 3, newText: "Новая третья.",
    })
    expect(second.ok).toBe(true)
    if (!second.ok) return

    expect(second.overrides.lines).toHaveLength(2)
    expect(second.target).toBe("narration")
  })

  it("текст, уже стоящий в сценарии ролика, ничего не пишет", () => {
    // Иначе повторный заход замены плодил бы записи и обновления Video на
    // пустом месте — а замена обязана быть идемпотентной.
    const same = planVideoScriptOverride({
      storyPlan: basePlan(), overrides: null, sceneOrder: 2, newText: "вторая",
    })

    expect(same.ok).toBe(true)
    if (!same.ok) return
    expect(same.changed).toBe(false)
  })

  it("текст, уже поправленный этим роликом, второй раз не пишется", () => {
    const overrides = { v: 1, lines: [{ sceneOrder: 2, target: "spoken", text: "Новая.", at: "t" }] }

    const repeat = planVideoScriptOverride({
      storyPlan: basePlan(), overrides, sceneOrder: 2, newText: "Новая.",
    })

    expect(repeat.ok).toBe(true)
    if (!repeat.ok) return
    expect(repeat.changed).toBe(false)
  })

  it("сцены нет в сценарии — отказ с причиной, а не молчаливая запись в никуда", () => {
    const patch = planVideoScriptOverride({
      storyPlan: basePlan(), overrides: null, sceneOrder: 99, newText: "Некуда.",
    })

    expect(patch.ok).toBe(false)
    if (patch.ok) return
    expect(patch.reason).toContain("99")
  })

  it("у ролика нет сценария — отказ, замена живёт только в треке", () => {
    const patch = planVideoScriptOverride({
      storyPlan: null, overrides: null, sceneOrder: 2, newText: "Некуда.",
    })

    expect(patch.ok).toBe(false)
  })
})

describe("конвейер читает сценарий ролика, а не общий вариант", () => {
  it("runVideoPipeline строит план по сценарию С правками ролика", async () => {
    // Контрактная проверка исходника (приём этого репозитория, см.
    // tests/unit/legacy-navigation-contract.spec.ts): `runVideoPipeline` —
    // единственная точка, где общий вариант превращается в план прогона, и
    // прогнать её тестом можно только целым конвейером (десятки минут).
    // Потеряй эта строка `video.scriptOverrides` — полная перегенерация
    // синтезировала бы ОБЩИЙ текст, то есть ровно ту дыру, которую чиним:
    // оператор заплатил бы за возврат старой фразы.
    const { readFile } = await import("node:fs/promises")
    const source = await readFile("server/utils/video-pipeline.ts", "utf-8")

    expect(source).toMatch(/applyScriptOverrides\(\s*variant\.storyPlan\s*,\s*video\.scriptOverrides\s*\)/)
    // В сборку плана уезжает результат наложения, а не общий вариант.
    expect(source).toMatch(/buildStoryVideoPlan\(\{\s*\n\s*storyPlan: effectiveStoryPlan/)
  })

  it("ручка перегенерации трека читает сценарий РОЛИКА, а не вариант", async () => {
    // Та же контрактная проверка для второй точки чтения. Верни ручка
    // `scenarioVariant.storyPlan` — окно подтверждения показало бы расхождение
    // с треком там, где его нет, и оператор оплатил бы пересинтез всего трека
    // ради возврата к фразе, которую сам же и переписал.
    const { readFile } = await import("node:fs/promises")
    const source = await readFile("server/api/videos/[id]/voiceover/regenerate-track.post.ts", "utf-8")

    expect(source).toMatch(/loadVideoStoryPlan\(video\.id\)/)
    expect(source).toMatch(/storyPlan: storyPlan \?\? null/)
    // Прямого чтения варианта в ручке остаться не должно вовсе.
    expect(source).not.toMatch(/scenarioVariant/)
  })
})
