import { describe, expect, it } from "vitest"

import { planShotBackgroundExecution, type PlannedShotRow } from "~~/server/utils/edit-plan/shot-background-runner"

function lcg(seed: number) {
  let state = seed >>> 0
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 0x100000000 }
}

const BACKGROUNDS = ["library", "image", "video", "app_screen", "none"] as const

/** Реальный ролик — 40-100 кадров, а не 2-6: узкий домен уже прятал дефекты трижды. */
function generate(seed: number) {
  const rnd = lcg(seed)
  const count = 40 + Math.floor(rnd() * 61)
  const shots: PlannedShotRow[] = []
  let cursor = 0
  for (let i = 0; i < count; i += 1) {
    const duration = 0.8 + rnd() * 9.5
    const background = BACKGROUNDS[Math.floor(rnd() * BACKGROUNDS.length)]!
    shots.push({
      order: i,
      startSec: cursor,
      endSec: cursor + duration,
      sceneOrder: rnd() < 0.3 ? null : 1 + Math.floor(rnd() * 8),
      foreground: rnd() < 0.5 ? "presenter" : "none",
      background,
      // Ветка «ссылка существует» обязана порождаться, а не быть всегда пустой.
      backgroundClipId: background === "library" ? (rnd() < 0.8 ? "bg1" : "нет-такого") : null,
      appReferenceId: background === "app_screen" ? (rnd() < 0.8 ? "scr1" : "нет-такого") : null,
      idea: rnd() < 0.15 ? null : `идея ${i}`,
      pipEnabled: rnd() < 0.4,
    })
    cursor += duration
  }
  return {
    shots,
    imageUsd: 0.025,
    imageGenerationAllowed: rnd() < 0.85,
    generativeVideoEnabled: rnd() < 0.5,
    generativeVideoBudgetUsd: Math.round(rnd() * 200) / 100,
    generativeVideoUsdPerSec: 0.05,
    minGenerativeVideoSec: 5,
    maxGenerativeVideoSec: 10,
    knownBackgroundIds: new Set(["bg1"]),
    knownAppScreenIds: new Set(["scr1"]),
  }
}

const SEEDS = 20_000

/**
 * Вход и план считаются РОВНО ОДИН РАЗ на сид (не по разу на каждое из семи
 * свойств): `generate()` строит 40-100 объектов и гоняет их через
 * `pickBackgroundSource`, и семикратный пересчёт одного и того же входа на
 * 20 000 сидов ощутимо утяжелил бы файл без единого нового наблюдения.
 * Свойство 6 (детерминизм) намеренно продолжает звать функцию ВТОРОЙ раз само
 * — иначе ему нечего было бы сравнивать.
 */
const INPUTS = Array.from({ length: SEEDS }, (_, i) => generate(i + 1))
const PLANS = INPUTS.map(input => planShotBackgroundExecution(input))

/**
 * Каждое свойство копит нарушения в массив и делает ОДИН `expect()` в конце,
 * а не один `expect()` на каждый кадр каждого сида (до 2 млн вызовов на
 * свойство). Сама проверка (свойство) не ослабляется — при первом же
 * нарушении оно попадёт в массив и провалит тест, только диагностика
 * печатается за один раз, а не построчно. Ре-ревью брифа: "если файл свойств
 * стал дольше 30 с — оптимизируй генератор", а не сокращай число сидов;
 * доминирующая стоимость была не в `pickBackgroundSource`, а в накладных
 * расходах vitest на миллионы отдельных `expect()`.
 */
function collectViolations<T>(count: number, check: (index: number) => string | null): string[] {
  const violations: string[] = []
  for (let i = 0; i < count; i += 1) {
    const message = check(i)
    if (message) violations.push(message)
  }
  return violations
}

describe("свойства планирования фонов кадров", () => {
  it("Свойство 1: каждому кадру ровно один пункт плана, порядок сохранён", () => {
    const violations = collectViolations(SEEDS, (i) => {
      const got = PLANS[i]!.items.map(x => x.order)
      const want = INPUTS[i]!.shots.map(s => s.order)
      return JSON.stringify(got) === JSON.stringify(want) ? null : `seed=${i + 1}: ${JSON.stringify(got)} !== ${JSON.stringify(want)}`
    })
    expect(violations).toEqual([])
  })

  it("Свойство 2: сумма countsAgainstBudgetUsd никогда не превышает потолок профиля", () => {
    const violations = collectViolations(SEEDS, (i) => {
      const spent = PLANS[i]!.items.reduce((acc, x) => acc + x.countsAgainstBudgetUsd, 0)
      const budget = INPUTS[i]!.generativeVideoBudgetUsd
      return spent <= budget + 1e-9 ? null : `seed=${i + 1}: потрачено ${spent} > потолка ${budget}`
    })
    expect(violations).toEqual([])
  })

  it("Свойство 3: в потолок идёт ТОЛЬКО генеративное видео", () => {
    const violations: string[] = []
    for (let i = 0; i < SEEDS; i += 1) {
      for (const item of PLANS[i]!.items) {
        if (item.action.kind !== "video") {
          if (item.countsAgainstBudgetUsd !== 0) {
            violations.push(`seed=${i + 1}, order=${item.order}: kind=${item.action.kind} но countsAgainstBudgetUsd=${item.countsAgainstBudgetUsd}`)
          }
        } else if (Math.abs(item.countsAgainstBudgetUsd - item.costUsd) > 1e-9) {
          violations.push(`seed=${i + 1}, order=${item.order}: video countsAgainstBudgetUsd=${item.countsAgainstBudgetUsd} != costUsd=${item.costUsd}`)
        }
      }
    }
    expect(violations).toEqual([])
  })

  it("Свойство 4: генеративного видео нет ни на одном кадре короче минимума", () => {
    const violations: string[] = []
    for (let i = 0; i < SEEDS; i += 1) {
      const input = INPUTS[i]!
      PLANS[i]!.items.forEach((item, index) => {
        if (item.action.kind !== "video") return
        const duration = input.shots[index]!.endSec - input.shots[index]!.startSec
        if (duration < input.minGenerativeVideoSec) {
          violations.push(`seed=${i + 1}, order=${item.order}: video длиной ${duration} короче минимума ${input.minGenerativeVideoSec}`)
        }
      })
    }
    expect(violations).toEqual([])
  })

  it("Свойство 5: всякая деградация НАЗВАНА", () => {
    const violations: string[] = []
    for (let i = 0; i < SEEDS; i += 1) {
      const input = INPUTS[i]!
      PLANS[i]!.items.forEach((item, index) => {
        const requested = input.shots[index]!.background
        if (requested !== item.action.kind && !item.degradeReason) {
          violations.push(`seed=${i + 1}, order=${item.order}: requested=${requested} -> ${item.action.kind} без degradeReason`)
        }
      })
    }
    expect(violations).toEqual([])
  })

  it("Свойство 6: план детерминирован — тот же вход даёт побайтово тот же выход", () => {
    const violations = collectViolations(SEEDS, (i) => {
      const again = JSON.stringify(planShotBackgroundExecution(INPUTS[i]!))
      const first = JSON.stringify(PLANS[i])
      return again === first ? null : `seed=${i + 1}: повторный вызов дал другой JSON`
    })
    expect(violations).toEqual([])
  })

  it("Свойство 7: промпт просят ровно те кадры, которым назначена картинка или видео", () => {
    const violations = collectViolations(SEEDS, (i) => {
      const needPrompt = PLANS[i]!.items
        .filter(x => x.action.kind === "image" || x.action.kind === "video")
        .map(x => x.order)
      const got = PLANS[i]!.promptOrders
      return JSON.stringify(got) === JSON.stringify(needPrompt) ? null : `seed=${i + 1}: promptOrders=${JSON.stringify(got)} != ${JSON.stringify(needPrompt)}`
    })
    expect(violations).toEqual([])
  })

  /**
   * Свойство 8 (ре-ревью Task 4, сомнение А): обратная сторона потолка §7.
   * Свойства 2 и 3 структурно не могут поймать «накопитель считает
   * costUsd вместо countsAgainstBudgetUsd» — Свойство 2 одностороннее
   * (переучёт делает накопитель ТОЛЬКО консервативнее, сумма не может его
   * превысить), Свойство 3 сверяет поля ОДНОГО пункта между собой, а
   * мутация портит внутренний счётчик, влияющий на РЕШЕНИЯ по следующим
   * кадрам. Это свойство проверяет именно решение: если кадр деградировал
   * ПО ПРИЧИНЕ ПОТОЛКА (а не по длине/выключенному флагу/несуществующей
   * ссылке), то одобренное К ЭТОМУ МОМЕНТУ плюс цена ЭТОГО кадра
   * действительно превышают потолок — иначе деградация была бы
   * необоснованной. На чистом коде — 0 нарушений, на мутации 1 — тысячи
   * (проверено ре-ревьюером на этом же домене: 12 281 из 20 000 сидов).
   */
  it("Свойство 8: отказ по потолку обоснован — одобренное к этому моменту плюс цена этого кадра превышают потолок", () => {
    const violations: string[] = []
    for (let i = 0; i < SEEDS; i += 1) {
      const input = INPUTS[i]!
      let spentSoFar = 0
      PLANS[i]!.items.forEach((item, index) => {
        const isBudgetDegrade = (item.degradeReason ?? "").toLowerCase().includes("потолок")
        if (isBudgetDegrade) {
          const shot = input.shots[index]!
          const duration = shot.endSec - shot.startSec
          const billedSec = duration <= input.minGenerativeVideoSec ? input.minGenerativeVideoSec : input.maxGenerativeVideoSec
          const wouldBeCost = billedSec * input.generativeVideoUsdPerSec
          if (!(spentSoFar + wouldBeCost > input.generativeVideoBudgetUsd + 1e-9)) {
            violations.push(
              `seed=${i + 1}, order=${item.order}: деградация "по потолку", но `
              + `${spentSoFar} + ${wouldBeCost} не превышает потолок ${input.generativeVideoBudgetUsd}`,
            )
          }
        }
        spentSoFar += item.countsAgainstBudgetUsd
      })
    }
    expect(violations).toEqual([])
  })

  /**
   * Свойство 9 (ре-ревью Task 4, сомнение А): §10 — если генерация картинки
   * запрещена профилем, НИ ОДИН пункт плана не может быть "image", включая
   * пути деградации (video/library/app_screen без кандидата упираются в
   * ЭТОТ же флаг). Мутация 6 таблицы отчёта property-сьюту не красила —
   * домен даёт 3 038 из 20 000 сидов с выключенным флагом, но свойства на
   * этот случай не было вовсе.
   */
  it("Свойство 9: imageGenerationAllowed=false — ни один пункт плана не image", () => {
    const violations = collectViolations(SEEDS, (i) => {
      const input = INPUTS[i]!
      if (input.imageGenerationAllowed) return null
      const offender = PLANS[i]!.items.find(x => x.action.kind === "image")
      return offender ? `seed=${i + 1}, order=${offender.order}: imageGenerationAllowed=false, но kind=image` : null
    })
    expect(violations).toEqual([])
  })
})
