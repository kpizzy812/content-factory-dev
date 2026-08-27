/**
 * Останавливаться ли после шага в пошаговом режиме.
 *
 * Правило чистое, потому что цена ошибки высокая: лишняя пауза оставит ролик
 * стоять навсегда (автопродолжения по таймауту нет — оно обесценило бы сам
 * режим, §9), пропущенная — отдаст оператору готовый ролик вместо решения.
 *
 * Само ожидание устроено ВНЕ прогона: шаг доводится до конца, ролик переходит в
 * статус ожидания, блокировка отпускается, процесс завершает работу. Ждать
 * внутри живого прогона нельзя — удержанный lock и подвешенный процесс не
 * переживают перезапуск воркера (AGENTS.md про идемпотентность и восстановление
 * после рестарта относится и к ожиданию).
 *
 * Отсюда же следует, зачем правилу `approvedThrough`. «Принять» запускает НОВЫЙ
 * прогон, а он переиспользует завершённые шаги из снапшотов и честно доводит их
 * до конца — то есть после каждого «принять» прогон снова упирался бы в тот же
 * шаг. Ролик стоял бы на первом шаге вечно, сколько ни жми. Поэтому решение
 * оператора персистентно (`Video.approvedStepKey`) и подаётся правилу на вход.
 */

import type { StepKey } from "./video-pipeline-db"

/**
 * Статус ролика, ждущего решения оператора.
 *
 * Вне RESUMABLE_VIDEO_STATUSES намеренно: watchdog (server/plugins/video-recovery.ts)
 * фильтрует кандидатов прямо в SQL по этому списку, поэтому ролик в ожидании он
 * не увидит вовсе — и не оплатит следующий шаг за оператора, которого никто не
 * спрашивал. Отдельной защиты внутри watchdog'а по этой же причине не нужно.
 */
export const AWAITING_OPERATOR_STATUS = "awaiting_operator"

export interface StepwiseInput {
  stepwiseEnabled: boolean
  justFinished: StepKey
  /** Порядок исполнения маршрута ролика (executionOrderFor). */
  order: readonly StepKey[]
  /**
   * Последний шаг, решение по которому оператор уже принял.
   *
   * null/undefined — не принято ничего. Значение вне `order` (ролик сменил
   * маршрут) трактуется так же: индекса у такого шага нет, и любое «всё до него
   * принято» было бы выдумкой — честнее спросить оператора заново.
   */
  approvedThrough?: StepKey | null
}

export interface StepwiseDecision {
  pause: boolean
  /** Какой шаг оператор должен принять. null — паузы нет. */
  awaitingStepKey: StepKey | null
  reason: string
}

export function planStepwisePause(input: StepwiseInput): StepwiseDecision {
  if (!input.stepwiseEnabled) {
    return { pause: false, awaitingStepKey: null, reason: "пошаговый режим выключен" }
  }

  const index = input.order.indexOf(input.justFinished)
  if (index < 0) {
    return { pause: false, awaitingStepKey: null, reason: `шаг ${input.justFinished} не в порядке прогона` }
  }
  if (index === input.order.length - 1) {
    return { pause: false, awaitingStepKey: null, reason: "последний шаг — ждать нечего" }
  }

  // Принятое решение распространяется и на все шаги ДО принятого: прогон идёт по
  // порядку вперёд, и остановка на уже пройденном шаге означала бы откат назад.
  const approvedIndex = input.approvedThrough ? input.order.indexOf(input.approvedThrough) : -1
  if (approvedIndex >= 0 && approvedIndex >= index) {
    return {
      pause: false,
      awaitingStepKey: null,
      reason: `шаг ${input.justFinished} уже принят оператором`,
    }
  }

  return {
    pause: true,
    awaitingStepKey: input.justFinished,
    reason: `ждём решения оператора после шага ${input.justFinished}`,
  }
}

export interface StepwiseFlagInput {
  /**
   * Переопределение оператора на самом ролике (`Video.stepwiseApproval`).
   * null — оператор ничего не выбирал, решает профиль.
   */
  videoOverride: boolean | null
  /** Правило монтажного профиля (`EditProfile.stepwiseApproval`). */
  profileStepwise: boolean | null | undefined
}

/**
 * Включён ли пошаговый режим на этом ролике.
 *
 * Три состояния, а не два: «оператор явно выключил» и «оператор ничего не
 * выбирал» — разные вещи. Будь поле ролика обычным boolean с дефолтом false,
 * выключить режим, включённый профилем, было бы нечем: false значил бы и то,
 * и другое.
 */
export function resolveStepwiseEnabled(input: StepwiseFlagInput): boolean {
  if (typeof input.videoOverride === "boolean") return input.videoOverride
  return input.profileStepwise === true
}
