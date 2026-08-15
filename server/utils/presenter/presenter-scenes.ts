/**
 * Какие сцены играет живая ведущая — в том виде, в каком их адресуют шаги.
 *
 * Набор строился как ПОЗИЦИИ в `videoPlan.scenes`, а `runClipGeneration`
 * спрашивал у него `has(scene.order)`. Пространства чисел разные: при order'ах
 * 1..9 сцены ведущей дают позиции {0,3,6,8}, и шаг клипов пропускал сцены с
 * order 3, 6, 8 — не ведущей, — а для настоящих сцен ведущей платно
 * генерировал клипы, которые тут же выбрасывались.
 *
 * Отсюда росли и «индекс клипа 6 вне списка из 5 путей», и дубль сцены, и
 * четыре сцены, не дошедшие до сборки.
 *
 * Поэтому адресация одна и явная — order. Позиция сцены в массиве остаётся
 * деталью конкретного массива и за его пределы не выходит.
 */

export interface PresenterSceneLike {
  order?: number
  spokenLine?: string | null
}

/**
 * Order'ы сцен, где ведущая говорит в кадре.
 *
 * Сцена без `order` в набор не попадает: адресовать её нечем, а молча взять
 * позицию — вернуть ровно тот баг, из-за которого набор и переписан.
 */
export function presenterSceneOrdersFrom(
  scenes: readonly PresenterSceneLike[],
): Set<number> {
  const orders = new Set<number>()
  for (const scene of scenes) {
    if (typeof scene.order !== "number" || !Number.isFinite(scene.order)) continue
    if (!scene.spokenLine || scene.spokenLine.trim().length === 0) continue
    orders.add(scene.order)
  }
  return orders
}

/**
 * Перевод набора ПОЗИЦИЙ в набор order'ов по тому же плану.
 *
 * Нужен на границе с `runClipGeneration`: внутри пайплайна наборы удобно
 * держать позициями (там же считаются длительности и сметы по `filter((_, i) =>
 * ...)`), а шаг клипов адресует сцены `scene.order`. Раньше границы не было
 * вовсе — набор позиций уходил в шаг как есть, и тот пропускал чужие сцены.
 *
 * Позиция за пределами плана отбрасывается: адресовать нечего.
 */
export function sceneOrdersByIndexes(
  scenes: readonly PresenterSceneLike[],
  indexes: ReadonlySet<number>,
): Set<number> {
  const orders = new Set<number>()
  for (const index of indexes) {
    const order = scenes[index]?.order
    if (typeof order === "number" && Number.isFinite(order)) orders.add(order)
  }
  return orders
}
