import { describe, expect, it } from "vitest"

import {
  clipVolumeWithVoiceoverFor,
  planAlignedClipTargets,
  planTrackClipFit,
  shouldReconcileVoiceover,
} from "~~/server/utils/video-pipeline-run-policy"
import type { AlignedScene } from "~~/server/utils/transcription/align"

// planTrackClipFit — фикс-раунд 1 (ревью Task 10, RULING 1, блокер): подгон под
// границы трека не имеет верхнего предела отказа. Расхождение больше секунды на
// этом пути — норма (see комментарий в video-pipeline-run-policy.ts), а не сбой:
// порог отказа здесь ронял бы сборку после всех оплаченных шагов на штатных
// перебивках.
describe("подгон клипа под границы трека (planTrackClipFit) — без верхнего предела отказа", () => {
  it("расхождение в пределах допуска не трогает ничего", () => {
    expect(planTrackClipFit({ expectedSec: 4, actualSec: 4.02 })).toMatchObject({ action: "none" })
  })

  it("клип длиннее заказанного — trim", () => {
    const fit = planTrackClipFit({ expectedSec: 4, actualSec: 4.6 })
    expect(fit.action).toBe("trim")
    expect(fit.deltaSec).toBeCloseTo(0.6, 6)
  })

  it("клип короче заказанного — hold_last_frame", () => {
    expect(planTrackClipFit({ expectedSec: 4, actualSec: 3.5 })).toMatchObject({ action: "hold_last_frame" })
  })

  it("расхождение больше секунды — по-прежнему подгон, никогда не fail", () => {
    // Явный маркер паузы (`[пауза 2с]`) целиком уходит в цель предыдущего
    // клипа — Δ ≈ −2с. Это штатный сценарий, а не брак.
    expect(planTrackClipFit({ expectedSec: 4, actualSec: 1.2 })).toMatchObject({ action: "hold_last_frame" })
    expect(planTrackClipFit({ expectedSec: 4, actualSec: 9 })).toMatchObject({ action: "trim" })
  })

  it("публичный toleranceSec переопределяет допуск по умолчанию", () => {
    expect(planTrackClipFit({ expectedSec: 4, actualSec: 4.3, toleranceSec: 0.5 })).toMatchObject({ action: "none" })
  })
})

describe("решения сборки по маршруту", () => {
  it("на audio-first дорожки клипов глушатся полностью", () => {
    // Единый трек не совпадает по фазе с речью внутри lip-sync клипа: 0.3 дали
    // бы двойную речь с эхом (spec §6.4).
    expect(clipVolumeWithVoiceoverFor(true)).toBe(0)
  })

  it("на старом маршруте прежние 0.3 сохраняются", () => {
    expect(clipVolumeWithVoiceoverFor(false)).toBeCloseTo(0.3, 6)
  })

  it("на audio-first сведение длины отключено", () => {
    expect(shouldReconcileVoiceover(true)).toBe(false)
  })

  it("на старом маршруте сведение работает как прежде", () => {
    expect(shouldReconcileVoiceover(false)).toBe(true)
  })
})

// planAlignedClipTargets — расширение сверх брифа (progress.md, Task 9 «вход для
// Task 10»): перебивки между кусками ведущего вставали в таймлайн с ПЛАНОВЫМИ
// длительностями, и звук уезжал от картинки к концу ролика. Функция строит
// заказанную длину КАЖДОГО клипа так, чтобы их сумма сходилась с длиной трека
// целиком. Фикс-раунд 1 (ревью Task 10, RULING 2 + порядок): неанкорные клипы
// делят остаток пропорционально фактическим длительностям, а не добавляют свою
// длину сверху; при невозможности посчитать долю или при нарушении порядка сцен
// подгон отключается ЦЕЛИКОМ (`ok: false`), а не молча по одному клипу.
function scene(order: number, startSec: number, endSec: number): AlignedScene {
  return { order, startSec, endSec, words: [] }
}

describe("заказанная длина клипов по выравниванию (planAlignedClipTargets)", () => {
  it("сумма заказанных длин сходится с длиной трека целиком (все клипы анкорные)", () => {
    const plan = planAlignedClipTargets({
      alignedScenes: [scene(1, 0.2, 4.6), scene(2, 5.0, 8.5), scene(3, 9.0, 11.9)],
      trackDurationSec: 12.4,
      positionByOrder: new Map([[1, 0], [2, 1], [3, 2]]),
      actualDurationsSec: [5, 5, 5],
      clipCount: 3,
    })

    expect(plan.ok).toBe(true)
    expect(plan.targets[0]).toBeCloseTo(5.0, 6)
    expect(plan.targets[1]).toBeCloseTo(4.0, 6)
    expect(plan.targets[2]).toBeCloseTo(3.4, 6)
    expect(plan.targets.reduce((a, b) => a! + b!, 0)).toBeCloseTo(12.4, 6)
  })

  it("не зависит от порядка сцен во входном массиве", () => {
    const scenes = [scene(3, 9.0, 11.9), scene(1, 0.2, 4.6), scene(2, 5.0, 8.5)]
    const plan = planAlignedClipTargets({
      alignedScenes: scenes,
      trackDurationSec: 12.4,
      positionByOrder: new Map([[1, 0], [2, 1], [3, 2]]),
      actualDurationsSec: [5, 5, 5],
      clipCount: 3,
    })

    expect(plan.targets[0]).toBeCloseTo(5.0, 6)
    expect(plan.targets[1]).toBeCloseTo(4.0, 6)
    expect(plan.targets[2]).toBeCloseTo(3.4, 6)
  })

  it("неанкорный клип делит остаток бакета пропорционально фактической длительности, а не добавляет её сверху", () => {
    // Сцена 2 (позиция 1) не звучит вовсе — немая перебивка между сценой 1 и
    // сценой 3. Её фактическая длина (6с) вдвое больше соседа по бакету (3с),
    // поэтому и доля вдвое больше — но бакет 1..3 (6с интервала трека) не
    // должен вырасти сверх этих 6 секунд ни на секунду.
    const plan = planAlignedClipTargets({
      alignedScenes: [scene(1, 0.5, 3.0), scene(3, 6.5, 9.0)],
      trackDurationSec: 8.0,
      positionByOrder: new Map([[1, 0], [3, 2]]),
      actualDurationsSec: [3, 6, 1],
      clipCount: 3,
    })

    expect(plan.ok).toBe(true)
    // Первый анкор (позиция 0) сам ведущий — его бакет поглощает ещё и вдох
    // ДО первой реплики (см. timeStart-carry): [0, 6.5) = 6.5с, а не [0.5,
    // 6.5) = 6с. Делится между позициями 0 (вес 3) и 1 (вес 6) в отношении
    // 3:6 → 6.5*3/9 и 6.5*6/9.
    expect(plan.targets[0]).toBeCloseTo(6.5 * (3 / 9), 6)
    expect(plan.targets[1]).toBeCloseTo(6.5 * (6 / 9), 6)
    // Последний бакет: [6.5, 8.0) = 1.5с, единственный член — позиция 2.
    expect(plan.targets[2]).toBeCloseTo(1.5, 6)
    // Сумма сходится с треком ЦЕЛИКОМ независимо от распределения внутри бакета.
    expect(plan.targets.reduce((a, b) => a! + b!, 0)).toBeCloseTo(8.0, 6)
  })

  it("ведущие неанкорные клипы (до первой реплики) получают долю вступления", () => {
    // Первый клип в склейке — немой, реплика начинается только со второго.
    const plan = planAlignedClipTargets({
      alignedScenes: [scene(2, 3.0, 6.0)],
      trackDurationSec: 8.0,
      positionByOrder: new Map([[2, 1]]),
      actualDurationsSec: [1, 4],
      clipCount: 2,
    })

    expect(plan.ok).toBe(true)
    // Бакет [0, 3.0) = 3с — единственный член: позиция 0 (виртуальный старт
    // сразу граничит с анкором на позиции 1, ведущих неанкорных членов нет
    // ПОСЛЕ него, но САМ виртуальный бакет [0, position 1) включает позицию 0).
    expect(plan.targets[0]).toBeCloseTo(3.0, 6)
    // Бакет [1, 2) = позиция 1 (анкор), время [3.0, 8.0) = 5с.
    expect(plan.targets[1]).toBeCloseTo(5.0, 6)
    expect(plan.targets.reduce((a, b) => a! + b!, 0)).toBeCloseTo(8.0, 6)
  })

  it("клип без своей сцены в выравнивании получает долю бакета, а не остаётся без цели", () => {
    const plan = planAlignedClipTargets({
      alignedScenes: [scene(1, 0.2, 4.6), scene(3, 9.0, 11.9)],
      trackDurationSec: 12.4,
      positionByOrder: new Map([[1, 0], [3, 2]]),
      actualDurationsSec: [4, 4, 4],
      clipCount: 3,
    })

    expect(plan.ok).toBe(true)
    expect(plan.targets[1]).not.toBeNull()
    expect(plan.targets.reduce((a, b) => a! + b!, 0)).toBeCloseTo(12.4, 6)
  })

  // Фикс-раунд 2 (ревью Task 10, Important): деградированное выравнивание может
  // схлопнуть соседнюю пару сцен в одну точку времени (span=0 при интерполяции
  // в align.ts) — раньше бакет между ними молча получал target=0, клип уходил
  // в fitClipsToTrack БЕЗ подгона (expectedSec<=0), а summary.applied оставался
  // true — лог рапортовал успех при фактически разъехавшемся ролике.
  it("схлопнутый бакет (две сцены с одинаковым startSec) отключает подгон целиком, а не отдаёт target=0", () => {
    const plan = planAlignedClipTargets({
      // order2 и order3 звучат в ОДНУ и ту же точку трека (3.0с) — деградация.
      alignedScenes: [scene(1, 1.0, 2.0), scene(2, 3.0, 3.0), scene(3, 3.0, 3.0)],
      trackDurationSec: 8.0,
      positionByOrder: new Map([[1, 0], [2, 1], [3, 2]]),
      actualDurationsSec: [3, 2, 4],
      clipCount: 3,
    })

    expect(plan.ok).toBe(false)
    expect(plan.reason).toMatch(/нулев|схлопн/)
    expect(plan.targets).toEqual([null, null, null])
  })

  // Граница отказа (preflight, задача 5): отказ подгона теперь РОНЯЕТ сборку
  // (`runAssembly`), поэтому важно, где именно он начинается. Схлопнувшаяся пара
  // сама по себе отказом НЕ является: если между анкорами всё же остаётся
  // положительный интервал (первая пара забирает время от виртуального старта),
  // бакеты считаются, сумма сходится с треком, и ролик собирается как прежде.
  // Иначе честный отказ сползал бы на штатное частичное схождение (§10).
  it("схлопнутая пара, у которой интервал всё же положительный, подгон НЕ отключает", () => {
    const plan = planAlignedClipTargets({
      // order1 и order2 звучат в одну точку (5.0с), но перед ними — интервал от
      // начала трека, и он достаётся первому бакету целиком.
      alignedScenes: [scene(1, 5.0, 5.0), scene(2, 5.0, 8.0)],
      trackDurationSec: 10.0,
      positionByOrder: new Map([[1, 0], [2, 1]]),
      actualDurationsSec: [4, 4],
      clipCount: 2,
    })

    expect(plan.ok).toBe(true)
    expect(plan.targets[0]).toBeCloseTo(5.0, 6)
    expect(plan.targets[1]).toBeCloseTo(5.0, 6)
    expect(plan.targets.reduce((a, b) => a! + b!, 0)).toBeCloseTo(10.0, 6)
  })

  it("нарушение порядка (сцена раньше по треку, но позже по клипам) отключает подгон целиком", () => {
    const plan = planAlignedClipTargets({
      alignedScenes: [scene(1, 5.0, 8.0), scene(2, 1.0, 4.0)], // сцена 2 звучит РАНЬШЕ сцены 1
      trackDurationSec: 10.0,
      positionByOrder: new Map([[1, 0], [2, 1]]), // но клип сцены 1 идёт ПЕРВЫМ в склейке
      actualDurationsSec: [4, 3],
      clipCount: 2,
    })

    expect(plan.ok).toBe(false)
    expect(plan.reason).toMatch(/порядок/)
    expect(plan.targets).toEqual([null, null])
  })

  it("неизмеримый клип в бакете отключает подгон целиком, а не только для себя", () => {
    const plan = planAlignedClipTargets({
      alignedScenes: [scene(1, 0.5, 3.0), scene(3, 6.5, 9.0)],
      trackDurationSec: 8.0,
      positionByOrder: new Map([[1, 0], [3, 2]]),
      actualDurationsSec: [3, null, 1], // позиция 1 (неанкорная) не измерена
      clipCount: 3,
    })

    expect(plan.ok).toBe(false)
    expect(plan.reason).toMatch(/не измерен/)
    expect(plan.targets).toEqual([null, null, null])
  })

  it("нулевая либо отрицательная фактическая длительность тоже считается неизмеримой", () => {
    const plan = planAlignedClipTargets({
      alignedScenes: [scene(1, 0, 4)],
      trackDurationSec: 4,
      positionByOrder: new Map([[1, 0]]),
      actualDurationsSec: [0],
      clipCount: 1,
    })

    expect(plan.ok).toBe(false)
  })

  it("ни одна сцена не сопоставилась с клипом — честный отказ, а не пустой но валидный план", () => {
    const plan = planAlignedClipTargets({
      alignedScenes: [scene(1, 0, 4)],
      trackDurationSec: 4,
      positionByOrder: new Map(), // нет clipSceneOrders — карта позиций пуста
      actualDurationsSec: [4],
      clipCount: 1,
    })

    expect(plan.ok).toBe(false)
    expect(plan.reason).toMatch(/не сопоставилась/)
  })

  it("без выравнивания или без длины трека — валидный no-op план, не отказ", () => {
    expect(planAlignedClipTargets({
      alignedScenes: [],
      trackDurationSec: 12.4,
      positionByOrder: new Map(),
      actualDurationsSec: [4, 4],
      clipCount: 2,
    })).toMatchObject({ ok: true, targets: [null, null] })

    expect(planAlignedClipTargets({
      alignedScenes: [scene(1, 0, 4)],
      trackDurationSec: 0,
      positionByOrder: new Map([[1, 0]]),
      actualDurationsSec: [4],
      clipCount: 1,
    })).toMatchObject({ ok: true, targets: [null] })
  })
})
