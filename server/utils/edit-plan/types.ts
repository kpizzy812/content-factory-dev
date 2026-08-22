/**
 * Кадр смонтированного ролика и план кадров.
 *
 * Кадр — это отрезок таймлайна с назначенными передним и задним планом. Границы
 * считает КОД, смысл выбирает МОДЕЛЬ (spec §5.1): модель, которой поручена
 * арифметика таймлайна, рано или поздно вернёт кадры с дырой или нахлёстом, и
 * это увидит зритель.
 */

export type ShotForeground = "presenter" | "none"

export type ShotBackground = "library" | "image" | "video" | "app_screen" | "none"

export type PipPosition = "top_left" | "top_right" | "bottom_left" | "bottom_right"

export interface PlannedShot {
  order: number
  startSec: number
  endSec: number
  /** Смысловая сцена сценария. null — перебивка без своей реплики. */
  sceneOrder: number | null
  foreground: ShotForeground
  background: ShotBackground
  backgroundClipId: string | null
  appReferenceId: string | null
  /** Смысл кадра словами — вход промпта генерации фона. */
  idea: string | null
  pipEnabled: boolean
}

export interface ShotPlan {
  shots: PlannedShot[]
}

/**
 * Кадр плана вместе с деньгами и деградацией `pickBackgroundSource` (Task 5,
 * требование 5) — то, что реально пишется в колонки `VideoShot.costUsd` /
 * `VideoShot.degradeReason`. `PlannedShot` сам по себе денег не знает: он
 * описывает ЗАПРОШЕННЫЙ фон (что решила модель или дефолт), а не то, что
 * реально было исполнено после проверки бюджета §7.
 */
export interface PlannedShotWithCost extends PlannedShot {
  costUsd: number
  degradeReason: string | null
}
