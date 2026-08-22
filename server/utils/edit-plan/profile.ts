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
 *
 * Важно: наследование ищет первое ВАЛИДНОЕ значение в цепочке
 * [переопределение ролика, профиль приложения], а не первое ОПРЕДЕЛЁННОЕ.
 * Мусорное переопределение (строка вместо числа, опечатка в enum) обязано
 * провалиться к профилю, а не перепрыгнуть через него сразу к константе —
 * иначе три заявленных уровня наследования на мусорном входе превращаются
 * в два, и настройка бренда стирается молча.
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

/**
 * Разрешения генеративного фона, допустимые в профиле.
 *
 * В `model-specs.ts` нет одной модели, однозначно закрывающей это поле:
 * `p-video-avatar` (спики-ту-видео аватар) описывает `resolutions` именно в
 * формате "720p"/"1080p", а основной провайдер фоновых клипов по PROJECT_CONTEXT
 * §5 — Kling 1.6 (`replicate:kling-v1.6-standard-t2v` / `-i2v`, capability
 * text_to_video/image_to_video) — задаёт `resolutions` в пиксельных строках
 * ("1080x1920" и т.п.), а не в этом формате. Дефолт поля в prisma ("720p")
 * зафиксирован до появления единого списка, поэтому здесь заведён минимальный
 * список из брифа задачи ("720p"/"1080p"), совместимый с текущим дефолтом.
 * Когда конкретная модель для этого поля определится, список нужно свести к
 * её `constraints.resolutions`.
 */
const GENERATIVE_VIDEO_RESOLUTIONS: readonly string[] = ["720p", "1080p"]

/**
 * Порог ВАЛИДНОСТИ шага смены картинки, а не порог зажима: значение короче
 * порога не подтягивается к нему, а считается невалидным целиком и заменяется
 * следующим кандидатом (профилем) или дефолтом. Короче — смена картинки
 * читается как мигание, а не монтаж.
 */
const MIN_VALID_SHOT_CHANGE_SEC = 0.8

/** Минимальный размер PiP-окна: меньше — наложение перестаёт быть видимым. */
const MIN_PIP_SIZE = 0.1

/** Потолок PiP-окна: половина ширины кадра. Больше — это уже не наложение. */
const MAX_PIP_SIZE = 0.5

export const DEFAULT_EDIT_PROFILE: Readonly<ResolvedEditProfile> = Object.freeze({
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

/** Число, не потерявшее смысл как неотрицательное — для денежного потолка. */
function nonNegativeNum(value: unknown): number | null {
  const parsed = num(value)
  return parsed !== null && parsed >= 0 ? parsed : null
}

/** Шаг смены картинки, прошедший порог валидности {@link MIN_VALID_SHOT_CHANGE_SEC}. */
function shotChangeSecOf(value: unknown): number | null {
  const parsed = num(value)
  return parsed !== null && parsed >= MIN_VALID_SHOT_CHANGE_SEC ? parsed : null
}

/** Угол PiP из белого списка {@link PIP_POSITIONS}. */
function positionOf(value: unknown): PipPosition | null {
  const parsed = text(value)
  return parsed !== null && PIP_POSITIONS.includes(parsed as PipPosition) ? (parsed as PipPosition) : null
}

/** Разрешение генеративного фона из белого списка {@link GENERATIVE_VIDEO_RESOLUTIONS}. */
function resolutionOf(value: unknown): string | null {
  const parsed = text(value)
  return parsed !== null && GENERATIVE_VIDEO_RESOLUTIONS.includes(parsed) ? parsed : null
}

/**
 * Берёт первое ВАЛИДНОЕ значение из цепочки кандидатов (переопределение
 * ролика, затем профиль приложения), а не первое ОПРЕДЕЛЁННОЕ. Мусорный
 * кандидат не побеждает валидный — он просто пропускается.
 */
function firstValid<T>(validate: (raw: unknown) => T | null, ...candidates: unknown[]): T | null {
  for (const candidate of candidates) {
    const value = validate(candidate)
    if (value !== null) return value
  }
  return null
}

export function resolveEditProfile(
  profile: Partial<ResolvedEditProfile> | null,
  overrides: unknown,
): ResolvedEditProfile {
  const patch = (overrides && typeof overrides === "object" ? overrides : {}) as Record<string, unknown>

  const brollRatioRaw = firstValid(num, patch.brollRatio, profile?.brollRatio)
  const shotChangeSecRaw = firstValid(shotChangeSecOf, patch.shotChangeSec, profile?.shotChangeSec)
  const pipSizeRaw = firstValid(num, patch.pipSize, profile?.pipSize)
  const pipPositionRaw = firstValid(positionOf, patch.pipPosition, profile?.pipPosition)
  const resolutionRaw = firstValid(resolutionOf, patch.generativeVideoResolution, profile?.generativeVideoResolution)

  // Денежный ограничитель: дефолт 0.5 — только когда поле не задано НИГДЕ, ни
  // в переопределении, ни в профиле. Если оно где-то задано, но невалидно или
  // отрицательно, ворота закрываются в 0, а не открываются в дефолт — иначе
  // мусор на входе разрешал бы трату, вместо того чтобы её запретить (§7).
  const budgetOverrideRaw = patch.generativeVideoBudgetUsd
  const budgetProfileRaw = profile?.generativeVideoBudgetUsd
  const budgetIsSet = budgetOverrideRaw !== undefined || budgetProfileRaw !== undefined
  const budgetValid = firstValid(nonNegativeNum, budgetOverrideRaw, budgetProfileRaw)

  return {
    editPrompt: firstValid(text, patch.editPrompt, profile?.editPrompt) ?? DEFAULT_EDIT_PROFILE.editPrompt,
    brollRatio: brollRatioRaw === null ? DEFAULT_EDIT_PROFILE.brollRatio : clamp(brollRatioRaw, 0, 1),
    shotChangeSec: shotChangeSecRaw ?? DEFAULT_EDIT_PROFILE.shotChangeSec,
    pipEnabled: firstValid(bool, patch.pipEnabled, profile?.pipEnabled) ?? DEFAULT_EDIT_PROFILE.pipEnabled,
    pipPosition: pipPositionRaw ?? DEFAULT_EDIT_PROFILE.pipPosition,
    pipSize: pipSizeRaw === null ? DEFAULT_EDIT_PROFILE.pipSize : clamp(pipSizeRaw, MIN_PIP_SIZE, MAX_PIP_SIZE),
    generativeVideoEnabled: firstValid(bool, patch.generativeVideoEnabled, profile?.generativeVideoEnabled)
      ?? DEFAULT_EDIT_PROFILE.generativeVideoEnabled,
    generativeVideoBudgetUsd: budgetValid !== null
      ? budgetValid
      : budgetIsSet
        ? 0
        : DEFAULT_EDIT_PROFILE.generativeVideoBudgetUsd,
    generativeVideoResolution: resolutionRaw ?? DEFAULT_EDIT_PROFILE.generativeVideoResolution,
    stepwiseApproval: firstValid(bool, patch.stepwiseApproval, profile?.stepwiseApproval)
      ?? DEFAULT_EDIT_PROFILE.stepwiseApproval,
    llmModelId: firstValid(text, patch.llmModelId, profile?.llmModelId) ?? DEFAULT_EDIT_PROFILE.llmModelId,
  }
}
