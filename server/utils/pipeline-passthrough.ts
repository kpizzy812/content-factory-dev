/**
 * Pass-through helper для control-flow / transport нод (loop, wait, set, if_switch, filter).
 *
 * ## Контракт
 *
 * Control-flow ноды НЕ "съедают" данные предыдущих блоков. Они только аннотируют
 * (добавляют `_condition`, `items`, `_waitedSeconds`, и т.п.) и пропускают upstream
 * shape дальше. Иначе downstream domain-ноды (scenario, video, upload) теряют
 * `trends/scenarios/videos` и валятся в "Нет данных на входе".
 *
 * ## Hop-by-hop поля (всегда мержатся через `...input`)
 *
 *  - **No-data контракт:** `_noData` / `_noDataReason` / `_domainStatus`.
 *  - **System context (engine инжектит в `pipeline-engine.ts:146-153`):**
 *    `_runId` / `_pipelineId` / `_nodeCanvasId` / `_triggerType` / `_pipelineName`.
 *  - **Error edge routing:** `_error` / `errorMessage` / `errorCategory`.
 *  - **Domain payload:** `trends` / `scenarios` / `videos` / `captions` и любые
 *    другие domain-ключи. Loop/wait/set/if/filter эти поля НЕ должны терять.
 *
 * Шум типа `_waitedSeconds` / `_condition` локален для своей ноды и тоже
 * пропускается без специальной фильтрации: downstream через `collectInput` всё
 * равно получит, не помешает.
 *
 * ## Решение по edge case: items.length>0 + upstream `_noData=true`
 *
 * `withPassthrough` ВСЕГДА пробрасывает `_noData` из input (через `...input`).
 * Caller сам решает, чистить или нет. Логика: мы НЕ маскируем мусор — если
 * upstream сигналил `_noData`, но в input есть полезные данные (items), это
 * грязное состояние, и engine/downstream разберётся. Loop явно различает:
 *  - `len > 0` → `withPassthrough(input, overrides)` — _noData проходит как есть.
 *  - `len == 0` → `withPassthroughNoData(...)` — гарантированно ставит _noData=true.
 *
 * ## Использование
 *
 * ```ts
 * // Loop с непустыми items
 * return withPassthrough(input, { items, totalItems, currentIndex: 0 })
 *
 * // Loop с пустым массивом — собственный _noData
 * return withPassthroughNoData(input, { items: [], totalItems: 0, currentIndex: 0 },
 *   `Пустой массив для итерации (поле "${arrayField}")`)
 *
 * // Wait
 * return withPassthrough(input, { _waitedSeconds: 5 })
 *
 * // If/Switch
 * return withPassthrough(input, { _condition: passes, _conditionField: field })
 * ```
 */

/** Проверка, что upstream помечен как no_data. */
export function detectUpstreamNoData(input: Record<string, unknown>): boolean {
  return input._noData === true || input._domainStatus === 'no_data'
}

/**
 * Извлечь NoDataReason из input: либо явный, либо undefined.
 *
 * Не пытается «угадать» причину из других полей — это контракт: причина либо
 * явно проброшена через `_noDataReason`, либо её нет.
 */
export function getUpstreamNoDataReason(input: Record<string, unknown>): string | undefined {
  const direct = input._noDataReason
  if (typeof direct === 'string' && direct.trim()) return direct
  return undefined
}

/**
 * Мержит upstream input с overrides ноды. Overrides побеждают при конфликте ключей.
 *
 * Все hop-by-hop поля (`_noData`, `_runId` и т.п.) пробрасываются автоматически
 * через `...input`. Если нода хочет ПЕРЕЗАПИСАТЬ их (например, очистить _noData,
 * раз есть валидные items) — кладёт явные значения в overrides.
 *
 * @example
 * withPassthrough({ trends: [1,2], _runId: 5 }, { items: [1,2], totalItems: 2 })
 * // → { trends: [1,2], _runId: 5, items: [1,2], totalItems: 2 }
 */
export function withPassthrough(
  input: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  return { ...input, ...overrides }
}

/**
 * Pass-through + сигнализация собственного `_noData` ноды.
 *
 * Используется когда нода САМА обнаружила пустой результат (loop: пустой
 * массив; filter: значение ниже threshold). Поведение по reason:
 *  - Если upstream уже сигналил `_noDataReason` — сохраняем upstream reason
 *    (он более информативен: «Apify вернул 0 элементов» полезнее, чем
 *    «Пустой массив»).
 *  - Иначе — ставим `overrideReason` из аргумента (reason конкретной ноды).
 *
 * Поля `_noData=true` и `_domainStatus='no_data'` ставятся всегда (overrides
 * побеждают над `...input`).
 *
 * @param overrideReason fallback причина, если ни input._noDataReason, ни
 *   getUpstreamNoDataReason(input) не дали ничего.
 *
 * @example
 * withPassthroughNoData({ trends: [] }, { items: [], totalItems: 0 },
 *   'Пустой массив для итерации (поле "trends")')
 * // → { trends: [], items: [], totalItems: 0,
 * //     _noData: true, _noDataReason: 'Пустой массив...', _domainStatus: 'no_data' }
 */
export function withPassthroughNoData(
  input: Record<string, unknown>,
  overrides: Record<string, unknown>,
  overrideReason: string,
): Record<string, unknown> {
  const upstreamReason = getUpstreamNoDataReason(input)
  const reason = upstreamReason ?? overrideReason
  return {
    ...input,
    ...overrides,
    _noData: true,
    _noDataReason: reason,
    _domainStatus: 'no_data',
  }
}
