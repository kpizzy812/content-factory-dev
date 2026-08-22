/**
 * Действующие правила монтажа для конкретного ролика.
 *
 * Три уровня: константы -> профиль приложения -> переопределения ролика.
 * Слияние живёт здесь одной функцией, потому что потребителей у него несколько
 * (планировщик кадров, выбор фона, композиция PiP), и разъехавшиеся цепочки
 * `??` дали бы ролик, смонтированный наполовину по одним правилам.
 *
 * `editOverrides` приезжает из БД как Json: там может лежать что угодно,
 * включая строку вместо числа. Поэтому каждое поле не просто читается, а
 * проверяется и зажимается — на монтаже нет места «доверимся данным».
 */

import type { PipPosition } from "./types"

export interface ResolvedEditProfile {
  editPrompt: string | null
  brollRatio: number
  shotChangeSec: number
  pipEnabled: boolean
  pipPosition: PipPosition
  pipSize: number
  generativeVideoEnabled: boolean
  generativeVideoBudgetUsd: number
  generativeVideoResolution: string
  stepwiseApproval: boolean
  llmModelId: string | null
}

const PIP_POSITIONS: readonly PipPosition[] = ["top_left", "top_right", "bottom_left", "bottom_right"]

/** Минимальный кадр. Короче — смена картинки читается как мигание, а не монтаж. */
const MIN_SHOT_CHANGE_SEC = 0.8

/** Потолок PiP-окна: половина ширины кадра. Больше — это уже не наложение. */
const MAX_PIP_SIZE = 0.5

export const DEFAULT_EDIT_PROFILE: ResolvedEditProfile = Object.freeze({
  editPrompt: null,
  brollRatio: 0.4,
  shotChangeSec: 1.8,
  pipEnabled: false,
  pipPosition: "bottom_right",
  pipSize: 0.28,
  generativeVideoEnabled: false,
  generativeVideoBudgetUsd: 0.5,
  generativeVideoResolution: "720p",
  stepwiseApproval: false,
  llmModelId: null,
})

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function resolveEditProfile(
  profile: Partial<ResolvedEditProfile> | null,
  overrides: unknown,
): ResolvedEditProfile {
  const patch = (overrides && typeof overrides === "object" ? overrides : {}) as Record<string, unknown>
  const pick = <K extends keyof ResolvedEditProfile>(key: K): unknown =>
    patch[key as string] !== undefined ? patch[key as string] : profile?.[key]

  const brollRatio = num(pick("brollRatio"))
  const shotChangeSec = num(pick("shotChangeSec"))
  const pipSize = num(pick("pipSize"))
  const budget = num(pick("generativeVideoBudgetUsd"))
  const position = text(pick("pipPosition")) as PipPosition | null

  return {
    editPrompt: text(pick("editPrompt")),
    brollRatio: brollRatio === null ? DEFAULT_EDIT_PROFILE.brollRatio : clamp(brollRatio, 0, 1),
    shotChangeSec: shotChangeSec === null || shotChangeSec < MIN_SHOT_CHANGE_SEC
      ? DEFAULT_EDIT_PROFILE.shotChangeSec
      : shotChangeSec,
    pipEnabled: bool(pick("pipEnabled")) ?? DEFAULT_EDIT_PROFILE.pipEnabled,
    pipPosition: position && PIP_POSITIONS.includes(position) ? position : DEFAULT_EDIT_PROFILE.pipPosition,
    pipSize: pipSize === null ? DEFAULT_EDIT_PROFILE.pipSize : clamp(pipSize, 0.1, MAX_PIP_SIZE),
    generativeVideoEnabled: bool(pick("generativeVideoEnabled")) ?? DEFAULT_EDIT_PROFILE.generativeVideoEnabled,
    generativeVideoBudgetUsd: budget === null || budget < 0
      ? DEFAULT_EDIT_PROFILE.generativeVideoBudgetUsd
      : budget,
    generativeVideoResolution: text(pick("generativeVideoResolution"))
      ?? DEFAULT_EDIT_PROFILE.generativeVideoResolution,
    stepwiseApproval: bool(pick("stepwiseApproval")) ?? DEFAULT_EDIT_PROFILE.stepwiseApproval,
    llmModelId: text(pick("llmModelId")),
  }
}
