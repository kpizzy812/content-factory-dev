import { describe, expect, it } from "vitest"

import { pickBackgroundSource } from "~~/server/utils/edit-plan/background-source"
import { DEFAULT_EDIT_PROFILE } from "~~/server/utils/edit-plan/profile"

/**
 * Ставка $0.05/с — фактический тариф Kling 1.6 (`replicateVideoBilling()`,
 * `model-specs.ts:321-333`), подтверждён страницей модели 14.08.2026
 * («or 20 seconds for $1»). Брифовые $0.045/с — это старая заниженная смета
 * (задание, поправка 1): десятисекундный оплачиваемый клип стоит $0.50, а не
 * $0.45. Тест ниже нарочно НЕ использует бюджет по умолчанию (0.5 — ровно
 * равен стоимости такого клипа при новой ставке), чтобы не проверять деньги
 * на самом краю случайно — граница проверяется отдельным именованным тестом.
 */
const RATE_USD_PER_SEC = 0.05

function input(overrides: Record<string, unknown> = {}) {
  return {
    durationSec: 6,
    profile: { ...DEFAULT_EDIT_PROFILE, generativeVideoEnabled: true, generativeVideoBudgetUsd: 0.5 },
    requested: "video" as const,
    spentUsd: 0,
    hasLibraryCandidate: false,
    hasAppScreen: false,
    generativeVideoUsdPerSec: RATE_USD_PER_SEC,
    imageUsd: 0.025,
    minGenerativeVideoSec: 5,
    maxGenerativeVideoSec: 10,
    ...overrides,
  }
}

describe("выбор источника фона", () => {
  it("библиотека бесплатна и выигрывает у генерации", () => {
    const pick = pickBackgroundSource(input({ requested: "library", hasLibraryCandidate: true }))

    expect(pick).toMatchObject({ background: "library", costUsd: 0, degradeReason: null })
  })

  it("библиотека без кандидата уходит в картинку", () => {
    const pick = pickBackgroundSource(input({ requested: "library", hasLibraryCandidate: false }))

    expect(pick.background).toBe("image")
    expect(pick.costUsd).toBeCloseTo(0.025, 6)
    expect(pick.degradeReason).toMatch(/библиотек/i)
  })

  it("скрин приложения тоже бесплатен", () => {
    const pick = pickBackgroundSource(input({ requested: "app_screen", hasAppScreen: true }))

    expect(pick).toMatchObject({ background: "app_screen", costUsd: 0 })
  })

  it("скрин приложения без ссылки уходит в картинку", () => {
    // Мутация: без этого теста ветка "app_screen без hasAppScreen" не покрыта
    // ни одним падающим тестом (в брифе была только позитивная проверка).
    const pick = pickBackgroundSource(input({ requested: "app_screen", hasAppScreen: false }))

    expect(pick.background).toBe("image")
    expect(pick.degradeReason).toMatch(/скрин/i)
  })

  it("картинку по прямому запросу модели отдаёт без деградации", () => {
    // Мутация: requested === "image" в брифе не был протестирован вовсе.
    const pick = pickBackgroundSource(input({ requested: "image" }))

    expect(pick).toMatchObject({ background: "image", costUsd: 0.025, degradeReason: null })
  })

  it("пустой фон бесплатен и деградации не требует", () => {
    const pick = pickBackgroundSource(input({ requested: "none" }))

    expect(pick).toMatchObject({ background: "none", costUsd: 0, degradeReason: null })
  })

  it("деградирует до картинки при выключенном флаге профиля", () => {
    const pick = pickBackgroundSource(input({ profile: DEFAULT_EDIT_PROFILE }))

    expect(pick.background).toBe("image")
    expect(pick.degradeReason).toMatch(/профил/i)
  })

  it("деградирует до картинки на кадре короче пяти секунд", () => {
    const pick = pickBackgroundSource(input({ durationSec: 2 }))

    expect(pick.background).toBe("image")
    expect(pick.degradeReason).toMatch(/короче/i)
  })

  it("на кадре ровно в минимум генеративное видео разрешено (5с не короче 5с)", () => {
    // Проверяет, что граница минимума включительна, и что квантование берёт
    // именно НИЖНИЙ тариф (5с), а не верхний. Мутация замены "<" на "<=" здесь
    // на практике не различима: FLOAT_GUARD в проверке минимума (1e-9) делает
    // точный оператор несущественным на ЛЮБОЙ реалистичной границе — это не
    // дыра теста, а прямое следствие защиты от шума плавающей точки (см. тест
    // "шум плавающей точки..." ниже, где этот допуск проверяется по существу).
    // Мутация ЛОВИТСЯ надёжно, если проверку убрать целиком (см. отчёт задачи).
    const pick = pickBackgroundSource(input({ durationSec: 5, profile: {
      ...DEFAULT_EDIT_PROFILE, generativeVideoEnabled: true, generativeVideoBudgetUsd: 5,
    } }))

    expect(pick.background).toBe("video")
    expect(pick.costUsd).toBeCloseTo(5 * RATE_USD_PER_SEC, 6) // квантуется вниз к 5с, не к 10с
  })

  it("деградирует до картинки на кадре длиннее верхней квантованной границы", () => {
    // Поправка 3: кадр длиннее 10с не заказать одним клипом Kling — billedSeconds
    // из брифа тихо занижала бы смету, округляя к тем же 10с, что и обычный
    // кадр. Кадр обязан деградировать, а не быть оплачен по заниженной цене.
    const pick = pickBackgroundSource(input({ durationSec: 12, profile: {
      ...DEFAULT_EDIT_PROFILE, generativeVideoEnabled: true, generativeVideoBudgetUsd: 5,
    } }))

    expect(pick.background).toBe("image")
    expect(pick.degradeReason).toMatch(/длинн/i)
  })

  it("на кадре ровно в верхнюю квантованную границу генеративное видео разрешено", () => {
    // Граница максимума включительна (10с — ещё можно, 10.000000001с — уже
    // нет). Как и у минимума выше, точный оператор ">" vs ">=" здесь маскирует
    // FLOAT_GUARD (см. тот же комментарий) — надёжно ловится удаление проверки
    // целиком, что и подтверждено мутационным прогоном (см. отчёт задачи).
    const pick = pickBackgroundSource(input({ durationSec: 10, profile: {
      ...DEFAULT_EDIT_PROFILE, generativeVideoEnabled: true, generativeVideoBudgetUsd: 5,
    } }))

    expect(pick.background).toBe("video")
    expect(pick.costUsd).toBeCloseTo(10 * RATE_USD_PER_SEC, 6)
  })

  it("считает генеративное видео по квантованной длительности", () => {
    // 6 с квантуются в 10 (REPLICATE_KLING_16_DURATIONS = [5, 10]), значит и
    // платим за 10, а не за 6. Ставка $0.05/с (поправка 1) — счёт $0.50.
    const pick = pickBackgroundSource(input({ durationSec: 6, profile: {
      ...DEFAULT_EDIT_PROFILE, generativeVideoEnabled: true, generativeVideoBudgetUsd: 5,
    } }))

    expect(pick.background).toBe("video")
    expect(pick.costUsd).toBeCloseTo(0.5, 6)
  })

  it("шум плавающей точки в накопленном spentUsd не блокирует кадр ровно на потолке", () => {
    // 0.1 + 0.2 === 0.30000000000000004 в IEEE754 — реалистичный накопленный
    // spentUsd из нескольких предыдущих трат (не специально подобранное число).
    // Без эпсилон-допуска (FLOAT_GUARD) это ложно считалось бы превышением
    // бюджета ровно 0.3, хотя по смыслу кадр ровно на потолке и должен пройти.
    const pick = pickBackgroundSource(input({
      spentUsd: 0.1 + 0.2, // 0.30000000000000004, а не 0.3
      durationSec: 5,
      profile: { ...DEFAULT_EDIT_PROFILE, generativeVideoEnabled: true, generativeVideoBudgetUsd: 0.3 },
      generativeVideoUsdPerSec: 0, // считаем только сравнение с потолком, не квантование
    }))

    expect(pick.background).toBe("video")
  })

  it("деградирует до картинки при исчерпанном потолке", () => {
    // §7: при исчерпании потолка кадр не ломается, а деградирует, и это
    // пишется в лог шага.
    const pick = pickBackgroundSource(input({ spentUsd: 0.49 }))

    expect(pick.background).toBe("image")
    expect(pick.costUsd).toBeCloseTo(0.025, 6)
    expect(pick.degradeReason).toMatch(/потолок/i)
  })

  it("кадр ровно в оставшийся потолок бюджета разрешён (граница включительно)", () => {
    // Намеренно на самом краю (поправка 1: дефолтная фикстура даёт кадру ровно
    // 0.50 при потолке 0.50). Проверяем это НАРОЧНО, а не случайно: потолок не
    // должен блокировать кадр, который укладывается РОВНО впритык, — только
    // тот, что его превышает. Оговорка: 0.05*10 в IEEE754 даёт РОВНО 0.5 без
    // остатка, поэтому мутация "> " -> ">=" здесь неотличима (FLOAT_GUARD её
    // маскирует на этой конкретной паре чисел) — по существу этот же класс
    // мутаций ловит отдельный тест ниже на реалистичном шуме (0.1+0.2).
    const pick = pickBackgroundSource(input({ durationSec: 6, spentUsd: 0 }))

    expect(pick.background).toBe("video")
    expect(pick.costUsd).toBeCloseTo(0.5, 6)
  })

  it("выключенный профиль приоритетнее короткого кадра в сообщении", () => {
    // Мутация: ловит перестановку порядка проверок "профиль выключен" / "короче
    // минимума" — при обеих причинах одновременно сообщение обязано называть
    // именно профиль (первая проверка в коде).
    const pick = pickBackgroundSource(input({ durationSec: 2, profile: DEFAULT_EDIT_PROFILE }))

    expect(pick.degradeReason).toMatch(/профил/i)
    expect(pick.degradeReason).not.toMatch(/короче/i)
  })
})
