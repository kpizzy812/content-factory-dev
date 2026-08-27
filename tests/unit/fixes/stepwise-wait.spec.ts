/**
 * Пошаговый режим (§9 плана «Локальная замена сегмента и интерфейс монтажа»):
 * оператор принимает результат шага ВНЕ прогона.
 *
 * Здесь проверяется только чистое правило «останавливаться ли после шага».
 * Механика ожидания (статус ролика, отпущенная блокировка, продолжение новым
 * прогоном) живёт в tests/integration/stepwise-approval.spec.ts — её без БД
 * не проверить честно.
 *
 * DB-free: правило не ходит ни в Prisma, ни в файловую систему.
 */

import { describe, expect, it } from "vitest"

import {
  AWAITING_OPERATOR_STATUS,
  planStepwisePause,
  resolveStepwiseEnabled,
} from "../../../server/utils/video-pipeline-stepwise"
import {
  executionOrderFor,
  RESUMABLE_VIDEO_STATUSES,
} from "../../../server/utils/video-pipeline-run-policy"

const ORDER = [
  "prompt_generation", "voiceover_generation", "transcription",
  "image_generation", "clip_generation", "lip_sync_generation",
  "music_generation", "assembly",
] as const

describe("пошаговый режим", () => {
  it("выключен — прогон не останавливается никогда", () => {
    const decision = planStepwisePause({
      stepwiseEnabled: false, justFinished: "transcription", order: ORDER,
    })

    expect(decision.pause).toBe(false)
    expect(decision.awaitingStepKey).toBeNull()
  })

  it("включён — останавливается после каждого шага", () => {
    for (const step of ORDER.slice(0, -1)) {
      const decision = planStepwisePause({ stepwiseEnabled: true, justFinished: step, order: ORDER })
      expect(decision.pause).toBe(true)
      expect(decision.awaitingStepKey).toBe(step)
    }
  })

  it("после последнего шага не ждёт — ждать нечего", () => {
    const decision = planStepwisePause({
      stepwiseEnabled: true, justFinished: "assembly", order: ORDER,
    })

    expect(decision.pause).toBe(false)
  })

  it("шаг не из порядка прогона паузы не вызывает", () => {
    const decision = planStepwisePause({
      stepwiseEnabled: true, justFinished: "edit_plan" as never, order: ORDER,
    })

    expect(decision.pause).toBe(false)
    expect(decision.reason).toMatch(/не в порядке/i)
  })

  it("статус ожидания НЕ входит в список подхватываемых watchdog'ом", () => {
    // §9: watchdog ролики в этом статусе зависшими не считать не должен,
    // иначе он поднимет прогон, которого оператор не просил, и заплатит за
    // следующий шаг сам.
    expect(RESUMABLE_VIDEO_STATUSES).not.toContain("awaiting_operator")
    expect(RESUMABLE_VIDEO_STATUSES).not.toContain(AWAITING_OPERATOR_STATUS)
  })

  /**
   * Без этого блока пошаговый режим встал бы на первом же шаге навсегда:
   * «принять» запускает НОВЫЙ прогон, тот переиспользует шаг из снапшота,
   * доводит его до конца — и правило снова требует паузы на том же шаге.
   * Оператор жал бы «принять» бесконечно, ни разу не сдвинувшись дальше.
   */
  describe("уже принятые шаги", () => {
    it("на принятом шаге прогон не останавливается второй раз", () => {
      const decision = planStepwisePause({
        stepwiseEnabled: true,
        justFinished: "prompt_generation",
        order: ORDER,
        approvedThrough: "prompt_generation",
      })

      expect(decision.pause).toBe(false)
      expect(decision.awaitingStepKey).toBeNull()
      expect(decision.reason).toMatch(/принят/i)
    })

    it("шаги ДО принятого тоже пройдены — назад прогон не откатывается", () => {
      const decision = planStepwisePause({
        stepwiseEnabled: true,
        justFinished: "prompt_generation",
        order: ORDER,
        approvedThrough: "transcription",
      })

      expect(decision.pause).toBe(false)
    })

    it("первый шаг ПОСЛЕ принятого снова требует решения", () => {
      const decision = planStepwisePause({
        stepwiseEnabled: true,
        justFinished: "transcription",
        order: ORDER,
        approvedThrough: "voiceover_generation",
      })

      expect(decision.pause).toBe(true)
      expect(decision.awaitingStepKey).toBe("transcription")
    })

    it("принятый шаг не из порядка прогона не считается принятым ничем", () => {
      // Ролик мог сменить маршрут: принятый когда-то `shot_background` в
      // прежнем порядке отсутствует. Считать по нему «всё до него принято»
      // нельзя — индекса у него нет, и любая трактовка была бы выдумкой.
      const decision = planStepwisePause({
        stepwiseEnabled: true,
        justFinished: "prompt_generation",
        order: ORDER,
        approvedThrough: "shot_background" as never,
      })

      expect(decision.pause).toBe(true)
      expect(decision.awaitingStepKey).toBe("prompt_generation")
    })

    it("null — не принято ничего, останавливаемся на первом же шаге", () => {
      const decision = planStepwisePause({
        stepwiseEnabled: true,
        justFinished: "prompt_generation",
        order: ORDER,
        approvedThrough: null,
      })

      expect(decision.pause).toBe(true)
    })
  })

  /**
   * Правило обязано работать на ОБОИХ маршрутах: на audio-first порядок шагов
   * другой (озвучка первая, транскрипция второй), и последний шаг там тот же
   * `assembly` — но список между ними длиннее вдвое.
   */
  describe("оба маршрута прогона", () => {
    it.each([
      ["прежний", false],
      ["audio-first", true],
    ] as const)("%s: пауза после каждого шага, кроме последнего", (_label, editPipeline) => {
      const order = executionOrderFor(editPipeline)

      for (const step of order.slice(0, -1)) {
        expect(planStepwisePause({ stepwiseEnabled: true, justFinished: step, order }).pause).toBe(true)
      }
      expect(planStepwisePause({
        stepwiseEnabled: true, justFinished: order[order.length - 1]!, order,
      }).pause).toBe(false)
    })
  })

  /**
   * Флаг ролика — переопределение оператора поверх монтажного профиля
   * (`EditProfile.stepwiseApproval`). Не выражается одним boolean с дефолтом
   * false: «оператор явно выключил» и «оператор ничего не выбирал» — разные
   * состояния, и во втором профиль обязан решать сам.
   */
  describe("откуда берётся флаг", () => {
    it("ничего не настроено — режим выключен", () => {
      expect(resolveStepwiseEnabled({ videoOverride: null, profileStepwise: null })).toBe(false)
    })

    it("включён профилем — наследуется роликом", () => {
      expect(resolveStepwiseEnabled({ videoOverride: null, profileStepwise: true })).toBe(true)
    })

    it("оператор выключил на ролике — профиль не перебивает", () => {
      expect(resolveStepwiseEnabled({ videoOverride: false, profileStepwise: true })).toBe(false)
    })

    it("оператор включил на ролике — профиль не перебивает", () => {
      expect(resolveStepwiseEnabled({ videoOverride: true, profileStepwise: false })).toBe(true)
    })

    it("профиля у ролика нет вовсе — undefined читается как «не настроено»", () => {
      expect(resolveStepwiseEnabled({ videoOverride: null, profileStepwise: undefined })).toBe(false)
      expect(resolveStepwiseEnabled({ videoOverride: true, profileStepwise: undefined })).toBe(true)
    })
  })

  it("статус ожидания назван ровно так, как записан в enum схемы", () => {
    // Литерал в двух местах (модуль и миграция) разошёлся бы молча: Prisma
    // принимает строку статуса как есть, а ролик с чужим значением упал бы
    // только в рантайме прогона.
    expect(AWAITING_OPERATOR_STATUS).toBe("awaiting_operator")
  })
})
