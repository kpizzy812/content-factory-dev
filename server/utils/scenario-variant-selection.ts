/**
 * Единое правило «какой вариант сценария уходит в Модуль 3 (видео)».
 *
 * ПОЧЕМУ отдельный модуль: правило раньше существовало в двух копиях —
 * в `pipeline-executors.ts` (перед созданием Video) и в `video-pipeline.ts`
 * (перед стартом генерации). Обе копии брали первый `accepted`, а при его
 * отсутствии — первый по `variantIndex`, принудительно акцептили его и
 * ПЕРЕЗАПИСЫВАЛИ `Scenario.selectedVariantId`. Поле `selectedVariantId`, куда
 * пишут выбор оператора (`/api/scenarios/:id/select`) и вердикт критика
 * (`scenario-critic-orchestrator.ts`), не читалось вовсе: оператор выбирал
 * вариант 2, а ролик собирался по варианту 1 (ТЗ, Модуль 2 → Модуль 3).
 *
 * Правильный порядок источников:
 *   1. `selectedVariantId` — явный выбор человека или критика, приоритет выше всего;
 *   2. первый `accepted` по `variantIndex` — исторический выбор без записи в сценарий;
 *   3. первый по `variantIndex` — полностью автономный прогон, где выбирать некому.
 *
 * Авто-акцепт (запись `status=accepted` + `selectedVariantId`) допустим ТОЛЬКО
 * в случае 3: в случаях 1 и 2 выбор уже сделан, и переписывать его — ровно тот
 * дефект, который здесь чинится.
 *
 * Модуль намеренно чистый (без Prisma и без сети), чтобы правило можно было
 * покрыть DB-free тестом и переиспользовать из обоих мест без дублирования.
 */

/** Минимум полей варианта, нужный для выбора. Оба вызывающих места дают больше. */
export interface VariantSelectionCandidate {
  id: number
  variantIndex: number
  status: string
  /** Мягко удалённые варианты в выбор не участвуют — их нет и в UI. */
  isDeleted?: boolean | null
}

/** Откуда взялся выбранный вариант — для логов и для решения об авто-акцепте. */
export type VariantSelectionSource = 'selected' | 'accepted' | 'fallback'

export interface VariantSelectionResult<V extends VariantSelectionCandidate> {
  variant: V
  source: VariantSelectionSource
  /**
   * true только для `fallback`: вызывающий код должен записать
   * `status=accepted` и `selectedVariantId`, чтобы автономный прогон
   * оставил след о том, что именно ушло в видео.
   */
  needsAutoAccept: boolean
  /**
   * Заполняется, когда `selectedVariantId` был указан, но использовать его
   * нельзя (вариант удалён или принадлежит другому сценарию). Нужен для
   * предупреждения в лог: молча собрать не тот ролик — то же самое, что и баг.
   */
  ignoredSelectedReason?: 'deleted' | 'foreign'
}

/** Сортировка-«первый вариант»: по variantIndex, при равенстве — по id (детерминизм). */
function byVariantOrder(a: VariantSelectionCandidate, b: VariantSelectionCandidate): number {
  return a.variantIndex - b.variantIndex || a.id - b.id
}

/**
 * Выбирает вариант сценария для генерации видео.
 *
 * @param variants — все варианты ЭТОГО сценария (порядок неважен, функция сортирует сама).
 * @param selectedVariantId — `Scenario.selectedVariantId`, может быть null.
 * @returns null, если пригодных вариантов нет — вызывающий код обязан сообщить об ошибке.
 */
export function selectScenarioVariantForVideo<V extends VariantSelectionCandidate>(
  variants: readonly V[],
  selectedVariantId: number | null | undefined,
): VariantSelectionResult<V> | null {
  // Удалённые варианты отсекаем на входе: они не должны попасть ни в один из трёх источников.
  const alive = variants.filter(v => v.isDeleted !== true).sort(byVariantOrder)

  let ignoredSelectedReason: VariantSelectionResult<V>['ignoredSelectedReason']

  if (typeof selectedVariantId === 'number') {
    const selected = alive.find(v => v.id === selectedVariantId)
    if (selected) {
      return { variant: selected, source: 'selected', needsAutoAccept: false }
    }
    // Различаем «выбранный вариант удалён» и «выбранный вариант не из этого
    // сценария»: первое — штатная чистка, второе — рассинхрон данных.
    ignoredSelectedReason = variants.some(v => v.id === selectedVariantId) ? 'deleted' : 'foreign'
  }

  if (alive.length === 0) return null

  const accepted = alive.find(v => v.status === 'accepted')
  if (accepted) {
    return { variant: accepted, source: 'accepted', needsAutoAccept: false, ignoredSelectedReason }
  }

  return { variant: alive[0]!, source: 'fallback', needsAutoAccept: true, ignoredSelectedReason }
}

/** Человекочитаемое пояснение для лога — почему в видео ушёл именно этот вариант. */
export function describeVariantSelection(result: VariantSelectionResult<VariantSelectionCandidate>): string {
  const base = result.source === 'selected'
    ? `вариант #${result.variant.variantIndex} выбран оператором/критиком (selectedVariantId=${result.variant.id})`
    : result.source === 'accepted'
      ? `вариант #${result.variant.variantIndex} уже был accepted (id=${result.variant.id})`
      : `вариант #${result.variant.variantIndex} взят как первый по порядку и авто-акцептован (id=${result.variant.id})`
  if (!result.ignoredSelectedReason) return base
  const why = result.ignoredSelectedReason === 'deleted'
    ? 'selectedVariantId указывал на удалённый вариант'
    : 'selectedVariantId указывал на вариант другого сценария'
  return `${base}; внимание: ${why}`
}
