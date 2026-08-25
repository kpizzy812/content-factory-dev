/**
 * Фикс-раунд 2 (ре-ревью, Н-1 — Critical по честности проверки):
 * `buildScenesByPositionForShotTimeline` — единственное место, где живёт
 * решение «позиционно / по order / отказать» для субтитров кадрового
 * маршрута (фикс Critical 2 фикс-раунда 1). До этого раунда функция не была
 * покрыта НИ ОДНИМ тестом: снятие проверки тождества (ровно то решение,
 * которое хендофф 18.08 §4 п.4 запрещает переоткрывать) проходило зелёным и
 * по всей чистой сьюте, и по живому DB-прогону.
 *
 * Фикстуры и ожидаемые исходы — из таблицы §3 отчёта ре-ревью
 * (`task-6-rereview.md`), которая уже прогнала все четыре пути слома
 * тождества из хендоффа плюс их сочетания с дублем `order`.
 */
import { describe, expect, it } from "vitest"

import {
  buildScenesByPositionForShotTimeline,
  type ShotTimelineTextScene,
} from "~~/server/utils/video-pipeline-steps"
import type { AlignedScene } from "~~/server/utils/transcription/align"

const scene = (order: number, startSec: number, endSec: number): AlignedScene => ({
  order, startSec, endSec, words: [],
})

const plan = (order: number, subtitleCopy: string): ShotTimelineTextScene => ({ order, subtitleCopy })

function texts(result: ReadonlyArray<{ text: string } | undefined>): Array<string | undefined> {
  return result.map(r => r?.text)
}

describe("buildScenesByPositionForShotTimeline — три ветки решения", () => {
  it("тождество ПОДТВЕРЖДЕНО, order дублируется в обоих массивах — сопоставление ПОЗИЦИОННОЕ, каждая сцена получает СВОЙ текст", () => {
    // Сценарий 0б отчёта ре-ревью: то, ради чего фикс Critical 2 писался.
    const planScenes = [plan(1, "A-первая"), plan(1, "A-вторая"), plan(2, "C")]
    const alignedScenes = [scene(1, 0, 2), scene(1, 2, 4), scene(2, 4, 6)]

    const result = buildScenesByPositionForShotTimeline(alignedScenes, planScenes)
    expect(texts(result)).toEqual(["A-первая", "A-вторая", "C"])
  })

  it("тождество СЛОМАНО длиной (сцена выпала из выравнивания), order уникален в обоих массивах — сопоставление ПО ORDER", () => {
    // Сценарий 2 отчёта ре-ревью: сцена с пустыми токенами выпала в align.ts.
    const planScenes = [plan(1, "A"), plan(2, "B"), plan(3, "C")]
    const alignedScenes = [scene(1, 0, 2), scene(3, 2, 4)] // order=2 нет вовсе — длины не совпадают

    const result = buildScenesByPositionForShotTimeline(alignedScenes, planScenes)
    expect(texts(result)).toEqual(["A", "C"])
  })

  it("тождество СЛОМАНО И order дублируется среди alignedScenes — бросает явно, а не гадает", () => {
    // Сценарий 1б/3б/4б отчёта ре-ревью (общий паттерн).
    const planScenes = [plan(1, "A"), plan(2, "B")]
    const alignedScenes = [scene(1, 0, 2), scene(1, 2, 4), scene(2, 4, 6)] // длина 3 vs 2 — тождество сломано

    expect(() => buildScenesByPositionForShotTimeline(alignedScenes, planScenes)).toThrow(/order/)
  })

  // Н-2 (ре-ревью, Important): дубль order ТОЛЬКО в plan.scenes при уникальных
  // alignedScenes раньше решался `Map`-построением «последний победил» — сцена
  // order=1 доставала текст ВТОРОЙ одноимённой сцены плана молча. Замер
  // ре-ревьюера: «A-вторая» вместо «A-первая» (сценарий 5 отчёта).
  it("Н-2: тождество СЛОМАНО, order уникален среди alignedScenes, но дублируется в planScenes — бросает, а не берёт последнего молча", () => {
    const planScenes = [plan(1, "A-первая"), plan(1, "A-вторая"), plan(2, "C")]
    const alignedScenes = [scene(1, 0, 2), scene(2, 2, 4)] // близнец order=1 выпал из выравнивания

    expect(() => buildScenesByPositionForShotTimeline(alignedScenes, planScenes)).toThrow(/order/)
  })

  // Мутации ре-ревьюера дословно (фикс-раунд 2, требование контроллера):
  // обе обязаны краснеть.
  describe("мутации ре-ревьюера (дословно)", () => {
    it("«снять проверку тождества, всегда позиционно» ловится сценарием «тождество сломано длиной»", () => {
      // Если бы функция ВСЕГДА сопоставляла по позиции (без проверки
      // alignedScenesMatchPlanPositions), результат сценария «сцена выпала»
      // выше был бы ["A", "B"] (позиция 1 → planScenes[1]="B") вместо
      // верного ["A", "C"] (order 3 → planScenes[2]="C"). Тест уже это
      // проверяет — здесь просто называем мутацию явно для таблицы отчёта.
      const planScenes = [plan(1, "A"), plan(2, "B"), plan(3, "C")]
      const alignedScenes = [scene(1, 0, 2), scene(3, 2, 4)]
      const result = buildScenesByPositionForShotTimeline(alignedScenes, planScenes)
      expect(texts(result)).not.toEqual(["A", "B"])
      expect(texts(result)).toEqual(["A", "C"])
    })

    it("«снять отказ на дубле order» ловится сценарием «тождество сломано + дубль в alignedScenes»", () => {
      const planScenes = [plan(1, "A"), plan(2, "B")]
      const alignedScenes = [scene(1, 0, 2), scene(1, 2, 4), scene(2, 4, 6)]
      expect(() => buildScenesByPositionForShotTimeline(alignedScenes, planScenes)).toThrow()
    })
  })
})
