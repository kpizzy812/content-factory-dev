/**
 * Наложение ведущего поверх фона (PiP).
 *
 * Порядок жёсткий и он не рекомендация: вырезали фрагмент -> отдали в lip-sync
 * ЦЕЛЫМ кадром -> и только потом кроп, маска, скругление, наложение (spec §6.3).
 * Модель не находит лицо в заранее вырезанном кружке и синхронизирует плохо — на
 * этом автор разобранной системы потерял время и перестраивал алгоритм.
 *
 * Правило закреплено ТИПОМ, а не комментарием: `foreground` принимает только
 * `LipSyncedClipPath`, а такую строку создаёт единственная функция
 * `markLipSynced`, экспортированная из `lip-sync-runner.ts`. Передать сюда сырой
 * фрагмент нельзя — проект не скомпилируется.
 *
 * Чистая функция: собирает `filter_complex`, процесс не запускает (по образцу
 * `buildShotVariationFilter` в `./shot-variation.ts`).
 */

import type { PipPosition } from "../edit-plan/types"

/**
 * Путь к клипу, ПРОШЕДШЕМУ lip-sync.
 *
 * Уникальный символ в типе делает строку неподделываемой: обычная строка сюда
 * не подойдёт, а привести её можно только через `markLipSynced`.
 */
declare const lipSyncedBrand: unique symbol
export type LipSyncedClipPath = string & { readonly [lipSyncedBrand]: true }

export interface PipOverlayInput {
  /**
   * Уже синхронизированный клип ведущего. Иначе не собирается.
   *
   * Значение используется ТОЛЬКО на уровне типа: список фильтров ниже
   * оперирует входными метками ffmpeg (`[0:v]` — фон, `[1:v]` — этот клип),
   * а не литеральным путём к файлу — путь подставляет вызывающий код в
   * список `-i` при сборке (шаг 8 спеки, вне этой задачи). Здесь `foreground`
   * существует, чтобы функцию нельзя было вызвать раньше lip-sync.
   */
  foreground: LipSyncedClipPath
  profile: { pipPosition: PipPosition, pipSize: number }
  canvasWidth: number
  canvasHeight: number
  cornerRadiusPx?: number
}

/** Отступ окна от края кадра. */
const MARGIN_PX = 32

/** Радиус скругления по умолчанию. */
const DEFAULT_CORNER_RADIUS_PX = 48

/** Чётный размер: yuv420p нечётные стороны не кодирует. */
function even(value: number): number {
  return Math.max(2, Math.floor(value / 2) * 2)
}

function positionOf(
  position: PipPosition,
  canvasWidth: number,
  canvasHeight: number,
  windowWidth: number,
  windowHeight: number,
): { x: number, y: number } {
  const right = Math.max(0, canvasWidth - windowWidth - MARGIN_PX)
  const bottom = Math.max(0, canvasHeight - windowHeight - MARGIN_PX)
  switch (position) {
    case "top_left": return { x: MARGIN_PX, y: MARGIN_PX }
    case "top_right": return { x: right, y: MARGIN_PX }
    case "bottom_left": return { x: MARGIN_PX, y: bottom }
    case "bottom_right":
    default: return { x: right, y: bottom }
  }
}

/**
 * Альфа-маска скругления окна PiP для ffmpeg `geq`.
 *
 * ПОПРАВКА к брифу задачи: там это выражение было заперто условием
 * `lt(X,R)*lt(Y,R)`, то есть скругляло ТОЛЬКО левый верхний угол — три
 * остальных оставались прямыми (тест брифа этого не ловил, он проверял лишь
 * наличие подстроки `geq`).
 *
 * Здесь маска симметрична для всех четырёх углов: для каждого пикселя (X,Y)
 * ищется ближайшая точка "внутреннего прямоугольника" окна — X зажимается в
 * [R, W-R], Y зажимается в [R, H-R] (W и H — ширина/высота окна, встроенные
 * переменные `geq`). Если расстояние от (X,Y) до этой точки больше радиуса —
 * пиксель прозрачный. На прямых участках краёв (не в углу) зажатая точка
 * совпадает с самой точкой по одной из осей, дистанция всегда <= R, и край
 * остаётся непрозрачным — скругляются только сами углы. Формуле обязательно
 * нужны ОБЕ границы окна (`W-`, `H-`), а не только смещение от нуля — иначе
 * она снова вырождается в скругление одного угла.
 */
function roundedCornersAlphaExpr(radius: number): string {
  // Радиус <=0 (или обнулённый вызывающим кодом) — окно без скругления,
  // прямоугольник целиком непрозрачен. Без этой ветки формула ниже делила бы
  // окно на пиксель нулевой площади и давала бы прозрачность почти везде.
  if (radius <= 0) return "255"
  const clampX = `if(lt(X,${radius}),${radius},if(gt(X,W-${radius}),W-${radius},X))`
  const clampY = `if(lt(Y,${radius}),${radius},if(gt(Y,H-${radius}),H-${radius},Y))`
  const distanceSquared = `(pow(X-(${clampX}),2)+pow(Y-(${clampY}),2))`
  return `if(gt(${distanceSquared},${radius * radius}),0,255)`
}

export function buildPipOverlayFilter(input: PipOverlayInput): string[] {
  const windowWidth = even(input.canvasWidth * input.profile.pipSize)
  // Окно вертикальное, как и сам кадр: ведущий в горизонтальном окне выглядит
  // обрезанным по груди.
  const windowHeight = even(windowWidth * (16 / 9))
  // Радиус не может быть больше половины стороны окна: иначе "внутренний
  // прямоугольник" в roundedCornersAlphaExpr схлопывается и маска ведёт себя
  // непредсказуемо на маленьких окнах.
  const radius = Math.max(0, Math.min(
    input.cornerRadiusPx ?? DEFAULT_CORNER_RADIUS_PX,
    Math.floor(windowWidth / 2),
    Math.floor(windowHeight / 2),
  ))
  const { x, y } = positionOf(
    input.profile.pipPosition, input.canvasWidth, input.canvasHeight, windowWidth, windowHeight,
  )

  return [
    // Кроп по центру уже синхронизированного кадра, затем масштаб в окно.
    `[1:v]crop='min(iw,ih*9/16)':'min(ih,iw*16/9)',scale=${windowWidth}:${windowHeight},format=rgba[pipraw]`,
    // Скругление всех четырёх углов — см. docstring roundedCornersAlphaExpr.
    `[pipraw]geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${roundedCornersAlphaExpr(radius)}'[pip]`,
    // Фон — первый вход overlay, PiP-окно — второй: порядок фиксирован и
    // обратный даёт эффект "фон поверх ведущего", то есть PiP не виден вовсе.
    `[0:v][pip]overlay=${x}:${y}:format=auto[vout]`,
  ]
}
