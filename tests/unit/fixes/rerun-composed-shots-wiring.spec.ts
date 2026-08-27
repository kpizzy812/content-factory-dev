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

function functionBody(name: string): string {
  const source = readFileSync(SOURCE, "utf8")
  const start = source.indexOf(`export async function ${name}(`)
  expect(start, `функция ${name} не найдена`).toBeGreaterThan(-1)
  // Следующее объявление верхнего уровня — граница тела.
  const rest = source.slice(start + 1)
  const end = rest.search(/\nexport (async function|function|const) /)
  return end < 0 ? rest : rest.slice(0, end)
}

/**
 * Сброс каскада живёт в `resetVideoStepForRerun` — её выделили из
 * `rerunVideoStep` ради пошагового режима, чтобы «перегенерировать» сбрасывало
 * шаг тем же кодом, но не стартовало прогон дважды. Проверяем ОБЕ стороны
 * связи: вызов внутри сброса и то, что перезапуск шага действительно идёт
 * через него, — иначе рефакторинг мог бы оставить сброс мёртвым кодом.
 */
function resetCascadeBody(): string {
  return functionBody("resetVideoStepForRerun")
}

describe("врезка каскада собранных кадров в rerunVideoStep (Ruling S8-9)", () => {
  it("сброс шага зовёт resetComposedShots", () => {
    expect(resetCascadeBody()).toContain("resetComposedShots(videoId, stepKey, stepsToReset)")
  })

  it("перезапуск шага идёт через этот сброс, а не мимо него", () => {
    expect(functionBody("rerunVideoStep")).toContain("resetVideoStepForRerun(videoId, stepKey)")
  })

  it("зовёт его вместе с каскадом кадров плана — оба сброса в одном месте", () => {
    const body = resetCascadeBody()
    const planCascade = body.indexOf("resetEditPlanShots(")
    const composedCascade = body.indexOf("resetComposedShots(")
    expect(planCascade).toBeGreaterThan(-1)
    expect(composedCascade).toBeGreaterThan(planCascade)
    // До сброса статусов шагов: иначе новый прогон стартует раньше, чем
    // кадры обесценены.
    expect(body.indexOf("STEP_RERUN_RESET_PATCH")).toBeGreaterThan(composedCascade)
  })
})
