/**
 * Important 5 финального ревью ветки (он же отложенный пункт 7):
 * `calculateAnthropicCost` стала считать ДЕНЬГИ шага `edit_plan` — сумму,
 * которая уходит в `AiAuditLog` и `Video.totalCostActual`, — оставаясь без
 * единого теста во всём проекте. DB-тесты `tests/integration/edit-plan.spec.ts`
 * считают ожидаемое значение ВЫЗОВОМ ТОЙ ЖЕ ФУНКЦИИ, то есть при ошибке в
 * арифметике кэш-токенов код и тест ошибутся одинаково и останутся зелёными:
 * мутация «умножить `cacheWriteCost` на 0» проходила всю сьюту.
 *
 * Ставки здесь НЕ ДУБЛИРУЮТСЯ: тест читает ту же таблицу и те же множители,
 * из которых их берёт сама функция. Тест, повторяющий константу своим
 * литералом, проверяет только то, что кто-то дважды набрал одно число.
 * Проверяется СТРУКТУРА расчёта, которую дублирование константы не защищает:
 *  * каждое из четырёх слагаемых реально входит в сумму (аддитивность —
 *    ловит выброшенное или занулённое слагаемое БЕЗ единого числа в тесте);
 *  * кэш считается по ставке ВХОДА, а не выхода, и ровно на свой множитель;
 *  * чтение кэша дешевле обычного входа, а запись — дороже (ловит
 *    перепутанные местами множители независимо от их значений);
 *  * неизвестная модель — `null`, а не ноль: ноль означал бы «вызов
 *    бесплатен» и молча стёр бы расход из учёта.
 *
 * Сьюта чистая: ни БД, ни сети, ни платных вызовов.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest"
import {
  ANTHROPIC_CACHE_READ_MULTIPLIER,
  ANTHROPIC_CACHE_WRITE_MULTIPLIER,
  ANTHROPIC_PRICING_TABLE,
  calculateAnthropicCost,
} from "~~/server/utils/ai-pricing"

/** Модель, у которой ставки входа и выхода ЗАВЕДОМО разные — иначе перепутать их незаметно. */
const ASYMMETRIC = ANTHROPIC_PRICING_TABLE.find(
  row => row.pricing.inputPerMtok !== row.pricing.outputPerMtok,
)!

describe("calculateAnthropicCost: арифметика денег шага edit_plan", () => {
  it("таблица ставок не пуста и ни одна ставка не выродилась в ноль", () => {
    expect(ANTHROPIC_PRICING_TABLE.length).toBeGreaterThan(0)
    for (const { prefix, pricing } of ANTHROPIC_PRICING_TABLE) {
      expect(pricing.inputPerMtok, `input ${prefix}`).toBeGreaterThan(0)
      expect(pricing.outputPerMtok, `output ${prefix}`).toBeGreaterThan(0)
    }
    expect(ASYMMETRIC).toBeDefined()
  })

  it("обычные input/output токены: сумма считается по ставке своей строки таблицы", () => {
    for (const { prefix, pricing } of ANTHROPIC_PRICING_TABLE) {
      const expected = (1_200_000 / 1_000_000) * pricing.inputPerMtok
        + (34_000 / 1_000_000) * pricing.outputPerMtok

      expect(
        calculateAnthropicCost(prefix, { inputTokens: 1_200_000, outputTokens: 34_000 }),
        `ставка строки "${prefix}"`,
      ).toBeCloseTo(expected, 10)
    }
  })

  it("строка таблицы находится по ПРЕФИКСУ — суффикс даты и регистр не мешают", () => {
    const { prefix, pricing } = ASYMMETRIC
    const usage = { inputTokens: 1_000_000, outputTokens: 0 }

    expect(calculateAnthropicCost(`${prefix}-20260101`, usage)).toBeCloseTo(pricing.inputPerMtok, 10)
    expect(calculateAnthropicCost(prefix.toUpperCase(), usage)).toBeCloseTo(pricing.inputPerMtok, 10)
  })

  // Главная защита от «выкинули слагаемое»: ни одного числа-ставки в тесте,
  // но ЛЮБОЕ занулённое/потерянное слагаемое ломает равенство.
  it("каждое из четырёх слагаемых реально входит в сумму", () => {
    const model = ASYMMETRIC.prefix
    const tokens = { inputTokens: 700_000, outputTokens: 90_000, cacheReadTokens: 400_000, cacheCreateTokens: 250_000 }
    const zero = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 }

    const parts = [
      calculateAnthropicCost(model, { ...zero, inputTokens: tokens.inputTokens })!,
      calculateAnthropicCost(model, { ...zero, outputTokens: tokens.outputTokens })!,
      calculateAnthropicCost(model, { ...zero, cacheReadTokens: tokens.cacheReadTokens })!,
      calculateAnthropicCost(model, { ...zero, cacheCreateTokens: tokens.cacheCreateTokens })!,
    ]
    // Каждое слагаемое по отдельности положительно — иначе «сумма сошлась»
    // выполнялась бы и на функции, которая не считает вообще ничего.
    for (const [index, part] of parts.entries()) {
      expect(part, `слагаемое ${index}`).toBeGreaterThan(0)
    }

    expect(calculateAnthropicCost(model, tokens)).toBeCloseTo(parts.reduce((a, b) => a + b, 0), 10)
  })

  it("кэш тарифицируется по ставке ВХОДА и ровно на свой множитель", () => {
    const model = ASYMMETRIC.prefix
    const N = 1_000_000
    const inputOnly = calculateAnthropicCost(model, { inputTokens: N, outputTokens: 0 })!
    const readOnly = calculateAnthropicCost(model, { inputTokens: 0, outputTokens: 0, cacheReadTokens: N })!
    const writeOnly = calculateAnthropicCost(model, { inputTokens: 0, outputTokens: 0, cacheCreateTokens: N })!

    // Отношение к обычному входу — это и есть множитель. Если бы кэш считался
    // по ставке ВЫХОДА, отношение было бы другим (ставки строки специально
    // выбраны разными).
    expect(readOnly / inputOnly).toBeCloseTo(ANTHROPIC_CACHE_READ_MULTIPLIER, 10)
    expect(writeOnly / inputOnly).toBeCloseTo(ANTHROPIC_CACHE_WRITE_MULTIPLIER, 10)
  })

  // Не зависит от значений множителей вовсе: ловит их перестановку местами.
  it("чтение кэша дешевле обычного входа, запись — дороже", () => {
    const model = ASYMMETRIC.prefix
    const N = 1_000_000
    const inputOnly = calculateAnthropicCost(model, { inputTokens: N, outputTokens: 0 })!
    const readOnly = calculateAnthropicCost(model, { inputTokens: 0, outputTokens: 0, cacheReadTokens: N })!
    const writeOnly = calculateAnthropicCost(model, { inputTokens: 0, outputTokens: 0, cacheCreateTokens: N })!

    expect(readOnly).toBeLessThan(inputOnly)
    expect(writeOnly).toBeGreaterThan(inputOnly)
  })

  it("нулевой usage даёт ровно 0, а не null и не NaN", () => {
    const result = calculateAnthropicCost(ASYMMETRIC.prefix, { inputTokens: 0, outputTokens: 0 })

    expect(result).toBe(0)
  })

  it("отсутствующие поля кэша считаются нулями, а не превращают сумму в NaN", () => {
    const model = ASYMMETRIC.prefix
    const withoutCache = calculateAnthropicCost(model, { inputTokens: 5000, outputTokens: 500 })
    const withZeroCache = calculateAnthropicCost(model, {
      inputTokens: 5000, outputTokens: 500, cacheReadTokens: 0, cacheCreateTokens: 0,
    })

    expect(Number.isFinite(withoutCache!)).toBe(true)
    expect(withoutCache).toBe(withZeroCache)
  })

  it("неизвестная модель даёт null, а не ноль — иначе расход молча исчезает из учёта", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000 }

    expect(calculateAnthropicCost("gpt-неизвестная-модель", usage)).toBeNull()
    expect(calculateAnthropicCost("", usage)).toBeNull()
    // Префикс должен совпадать с НАЧАЛОМ имени, а не встречаться где-то внутри.
    expect(calculateAnthropicCost(`vendor/${ASYMMETRIC.prefix}`, usage)).toBeNull()
  })
})
