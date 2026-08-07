/**
 * Регрессия P1-2: выбор варианта сценария для Модуля 3 (видео).
 *
 * Дефект: `pipeline-executors.ts` и `video-pipeline.ts` брали первый `accepted`,
 * иначе первый по `variantIndex`, и принудительно акцептили его, перезаписывая
 * `Scenario.selectedVariantId`. Поле `selectedVariantId` — куда пишут выбор
 * оператора (`/api/scenarios/:id/select`) и вердикт критика — не читалось вовсе:
 * оператор выбирал вариант 2, а ролик собирался по варианту 1.
 *
 * Требуемый порядок: selectedVariantId → accepted → первый по variantIndex,
 * и авто-акцепт допустим ТОЛЬКО в последнем случае.
 *
 * Тест DB-free: правило вынесено в чистую функцию, оба вызывающих места
 * пользуются ей же.
 */
import { describe, it, expect } from 'vitest'
import {
  selectScenarioVariantForVideo,
  describeVariantSelection,
  type VariantSelectionCandidate,
} from '~~/server/utils/scenario-variant-selection'

/** Фабрика варианта: по умолчанию черновик, не удалён. */
function variant(
  id: number,
  variantIndex: number,
  overrides: Partial<VariantSelectionCandidate> = {},
): VariantSelectionCandidate {
  return { id, variantIndex, status: 'draft', isDeleted: false, ...overrides }
}

describe('selectScenarioVariantForVideo — приоритет источников', () => {
  it('selectedVariantId выигрывает у accepted (главный сценарий дефекта)', () => {
    const variants = [
      variant(101, 0, { status: 'accepted' }),
      variant(102, 1),
      variant(103, 2),
    ]

    const result = selectScenarioVariantForVideo(variants, 102)

    expect(result?.variant.id).toBe(102)
    expect(result?.source).toBe('selected')
    // Выбор уже сделан — статусы и selectedVariantId переписывать нельзя.
    expect(result?.needsAutoAccept).toBe(false)
  })

  it('selectedVariantId выигрывает, даже если выбранный вариант ещё не accepted', () => {
    // Критик (scenario-critic-orchestrator) ставит только selectedVariantId,
    // статус варианта не трогает — это штатное состояние, а не поломка.
    const variants = [variant(201, 0), variant(202, 1), variant(203, 2)]

    const result = selectScenarioVariantForVideo(variants, 203)

    expect(result?.variant.id).toBe(203)
    expect(result?.source).toBe('selected')
    expect(result?.needsAutoAccept).toBe(false)
  })

  it('selectedVariantId уважается и когда совпадает с accepted', () => {
    const variants = [variant(301, 0), variant(302, 1, { status: 'accepted' })]

    const result = selectScenarioVariantForVideo(variants, 302)

    expect(result?.variant.id).toBe(302)
    expect(result?.source).toBe('selected')
    expect(result?.needsAutoAccept).toBe(false)
  })

  it('без selectedVariantId берётся accepted, а не первый по variantIndex', () => {
    const variants = [variant(401, 0), variant(402, 1, { status: 'accepted' }), variant(403, 2)]

    const result = selectScenarioVariantForVideo(variants, null)

    expect(result?.variant.id).toBe(402)
    expect(result?.source).toBe('accepted')
    // accepted уже стоит — второй раз его акцептить не надо.
    expect(result?.needsAutoAccept).toBe(false)
  })

  it('несколько accepted — берётся наименьший variantIndex', () => {
    const variants = [
      variant(503, 2, { status: 'accepted' }),
      variant(501, 1, { status: 'accepted' }),
    ]

    const result = selectScenarioVariantForVideo(variants, undefined)

    expect(result?.variant.id).toBe(501)
    expect(result?.source).toBe('accepted')
  })

  it('нет ни выбора, ни accepted — первый по variantIndex + авто-акцепт', () => {
    // Полностью автономный прогон: выбирать некому, след о выборе оставить надо.
    const variants = [variant(602, 1), variant(601, 0), variant(603, 2)]

    const result = selectScenarioVariantForVideo(variants, null)

    expect(result?.variant.id).toBe(601)
    expect(result?.source).toBe('fallback')
    expect(result?.needsAutoAccept).toBe(true)
  })

  it('порядок на входе не важен — сортировка по variantIndex внутри функции', () => {
    const variants = [variant(703, 2), variant(702, 1), variant(701, 0)]

    expect(selectScenarioVariantForVideo(variants, null)?.variant.id).toBe(701)
  })
})

describe('selectScenarioVariantForVideo — испорченный selectedVariantId', () => {
  it('выбранный вариант удалён — откат к accepted с пометкой deleted', () => {
    const variants = [
      variant(801, 0, { status: 'accepted' }),
      variant(802, 1, { isDeleted: true }),
    ]

    const result = selectScenarioVariantForVideo(variants, 802)

    expect(result?.variant.id).toBe(801)
    expect(result?.source).toBe('accepted')
    expect(result?.ignoredSelectedReason).toBe('deleted')
    expect(result?.needsAutoAccept).toBe(false)
  })

  it('выбранный вариант удалён и accepted нет — первый живой + авто-акцепт', () => {
    const variants = [variant(901, 0, { isDeleted: true }), variant(902, 1)]

    const result = selectScenarioVariantForVideo(variants, 901)

    expect(result?.variant.id).toBe(902)
    expect(result?.source).toBe('fallback')
    expect(result?.needsAutoAccept).toBe(true)
    expect(result?.ignoredSelectedReason).toBe('deleted')
  })

  it('удалённый вариант не выбирается никогда, даже будучи accepted и первым', () => {
    const variants = [
      variant(1001, 0, { status: 'accepted', isDeleted: true }),
      variant(1002, 1),
    ]

    const result = selectScenarioVariantForVideo(variants, null)

    expect(result?.variant.id).toBe(1002)
    expect(result?.source).toBe('fallback')
  })

  it('выбранный вариант не принадлежит этому сценарию — помечается foreign', () => {
    const variants = [variant(1101, 0), variant(1102, 1, { status: 'accepted' })]

    const result = selectScenarioVariantForVideo(variants, 9999)

    expect(result?.variant.id).toBe(1102)
    expect(result?.source).toBe('accepted')
    expect(result?.ignoredSelectedReason).toBe('foreign')
  })

  it('чужой selectedVariantId и никого accepted — fallback с авто-акцептом', () => {
    const variants = [variant(1201, 0), variant(1202, 1)]

    const result = selectScenarioVariantForVideo(variants, 9999)

    expect(result?.variant.id).toBe(1201)
    expect(result?.source).toBe('fallback')
    expect(result?.needsAutoAccept).toBe(true)
    expect(result?.ignoredSelectedReason).toBe('foreign')
  })
})

describe('selectScenarioVariantForVideo — пустые входы', () => {
  it('вариантов нет вовсе — null (вызывающий обязан сообщить об ошибке)', () => {
    expect(selectScenarioVariantForVideo([], null)).toBeNull()
  })

  it('все варианты удалены — null, а не «оживший» удалённый', () => {
    const variants = [
      variant(1301, 0, { status: 'accepted', isDeleted: true }),
      variant(1302, 1, { isDeleted: true }),
    ]

    expect(selectScenarioVariantForVideo(variants, 1301)).toBeNull()
  })

  it('isDeleted не задан (undefined) — вариант считается живым', () => {
    const result = selectScenarioVariantForVideo(
      [{ id: 1401, variantIndex: 0, status: 'draft' }],
      null,
    )

    expect(result?.variant.id).toBe(1401)
    expect(result?.source).toBe('fallback')
  })
})

describe('describeVariantSelection', () => {
  it('явный выбор описывается как выбор оператора/критика', () => {
    const result = selectScenarioVariantForVideo([variant(1501, 1)], 1501)!

    expect(describeVariantSelection(result)).toContain('выбран оператором/критиком')
  })

  it('испорченный selectedVariantId попадает в текст предупреждения', () => {
    const result = selectScenarioVariantForVideo([variant(1601, 0)], 9999)!

    expect(describeVariantSelection(result)).toContain('другого сценария')
  })
})
