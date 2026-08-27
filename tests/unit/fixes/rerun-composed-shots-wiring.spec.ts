import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

import { describe, expect, it } from "vitest"

/**
 * Ruling S8-9, врезка каскада.
 *
 * Сам `resetComposedShots` покрыт DB-тестами (`tests/integration/edit-plan.spec.ts`),
 * но они зовут функцию НАПРЯМУЮ: `rerunVideoStep` в конце без ожидания
 * запускает `runVideoPipeline`, и дёргать его в лёгком тесте означало бы гонку
 * с `afterEach`, чистящим таблицы (та же причина, по которой отдельной
 * функцией вынесен `resetEditPlanShots`). Значит мутация «вызов из
 * `rerunVideoStep` удалён» не краснела бы нигде: функция есть, тесты на неё
 * зелёные, а в проде перезапуск lip-sync снова молча отдаёт прежний ролик.
 *
 * Этот тест закрывает ровно её — читая исходник, как это уже делают
 * `fal-gate-coverage` и `follower-snapshots`.
 */
const SOURCE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../server/utils/video-pipeline.ts",
)

function rerunVideoStepBody(): string {
  const source = readFileSync(SOURCE, "utf8")
  const start = source.indexOf("export async function rerunVideoStep(")
  expect(start).toBeGreaterThan(-1)
  // Следующее объявление верхнего уровня — граница тела. Функций после
  // `rerunVideoStep` в файле несколько, берём ближайшую.
  const rest = source.slice(start + 1)
  const end = rest.search(/\nexport (async function|function|const) /)
  return end < 0 ? rest : rest.slice(0, end)
}

describe("врезка каскада собранных кадров в rerunVideoStep (Ruling S8-9)", () => {
  it("rerunVideoStep зовёт resetComposedShots", () => {
    expect(rerunVideoStepBody()).toContain("resetComposedShots(videoId, stepKey, stepsToReset)")
  })

  it("зовёт его вместе с каскадом кадров плана — оба сброса в одном месте", () => {
    const body = rerunVideoStepBody()
    const planCascade = body.indexOf("resetEditPlanShots(")
    const composedCascade = body.indexOf("resetComposedShots(")
    expect(planCascade).toBeGreaterThan(-1)
    expect(composedCascade).toBeGreaterThan(planCascade)
    // До сброса статусов шагов: иначе новый прогон стартует раньше, чем
    // кадры обесценены.
    expect(body.indexOf("STEP_RERUN_RESET_PATCH")).toBeGreaterThan(composedCascade)
  })
})
