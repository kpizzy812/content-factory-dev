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
    // М-10 ре-ревью: по умолчанию картинка доступна — тесты на её отсутствие
    // переопределяют явно.
    imageGenerationAllowed: true,
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
    // Ставка намеренно исчезающе мала (1e-12, а не 0 — М-2 ре-ревью запрещает
    // нулевую ставку отдельным шлюзом ДО этой проверки), чтобы её собственный
    // вклад в сумму не маскировал шум `spentUsd`, но сама попадала под "ставка
    // положительна".
    const pick = pickBackgroundSource(input({
      spentUsd: 0.1 + 0.2, // 0.30000000000000004, а не 0.3
      durationSec: 5,
      profile: { ...DEFAULT_EDIT_PROFILE, generativeVideoEnabled: true, generativeVideoBudgetUsd: 0.3 },
      generativeVideoUsdPerSec: 1e-12,
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

describe("И-5 (ре-ревью): нефинитный вход не открывает оплату", () => {
  const enabledProfile = { ...DEFAULT_EDIT_PROFILE, generativeVideoEnabled: true, generativeVideoBudgetUsd: 5 }

  it("NaN durationSec не проходит оба шлюза длительности молча", () => {
    const pick = pickBackgroundSource(input({ durationSec: Number.NaN, profile: enabledProfile }))

    expect(pick.background).toBe("image")
    expect(pick.costUsd).toBeCloseTo(0.025, 6)
    expect(pick.countsAgainstBudgetUsd).toBe(0)
  })

  it("Infinity durationSec — тот же безопасный исход", () => {
    const pick = pickBackgroundSource(input({ durationSec: Number.POSITIVE_INFINITY, profile: enabledProfile }))

    expect(pick.background).toBe("image")
  })

  it("NaN spentUsd не гасит проверку потолка навсегда", () => {
    const pick = pickBackgroundSource(input({ spentUsd: Number.NaN, profile: enabledProfile }))

    expect(pick.background).toBe("image")
  })
})

describe("И-6 (ре-ревью): countsAgainstBudgetUsd отделён от costUsd", () => {
  it("картинка стоит денег, но не считается против потолка генеративного видео", () => {
    const pick = pickBackgroundSource(input({ requested: "library", hasLibraryCandidate: false }))

    expect(pick.costUsd).toBeCloseTo(0.025, 6)
    expect(pick.countsAgainstBudgetUsd).toBe(0)
  })

  it("деградировавшая до картинки генерация видео тоже не списывается с потолка", () => {
    // Ключевой сценарий И-6: кадр ХОТЕЛ быть video, потолок исчерпан, деградация
    // в картинку не должна повторно "тратить" бюджет генеративного видео.
    const pick = pickBackgroundSource(input({ spentUsd: 0.49 }))

    expect(pick.background).toBe("image")
    expect(pick.costUsd).toBeCloseTo(0.025, 6)
    expect(pick.countsAgainstBudgetUsd).toBe(0)
  })

  it("успешное генеративное видео целиком идёт в счёт потолка", () => {
    const pick = pickBackgroundSource(input({ durationSec: 6, spentUsd: 0 }))

    expect(pick.background).toBe("video")
    expect(pick.countsAgainstBudgetUsd).toBeCloseTo(pick.costUsd, 9)
    expect(pick.countsAgainstBudgetUsd).toBeCloseTo(0.5, 6)
  })

  it("пустой фон не считается против потолка", () => {
    const pick = pickBackgroundSource(input({ requested: "none" }))

    expect(pick.countsAgainstBudgetUsd).toBe(0)
  })
})

describe("М-2 (ре-ревью): неположительная ставка закрывает ворота, а не открывает", () => {
  const enabledProfile = { ...DEFAULT_EDIT_PROFILE, generativeVideoEnabled: true, generativeVideoBudgetUsd: 0 }

  it("ставка 0 при нулевом бюджете раньше разрешала видео бесконечно — теперь деградирует", () => {
    const pick = pickBackgroundSource(input({ generativeVideoUsdPerSec: 0, profile: enabledProfile }))

    expect(pick.background).toBe("image")
    expect(pick.degradeReason).toMatch(/ставк/i)
  })

  it("отрицательная ставка — тот же безопасный исход", () => {
    const pick = pickBackgroundSource(input({ generativeVideoUsdPerSec: -0.05, profile: enabledProfile }))

    expect(pick.background).toBe("image")
  })
})

describe("М-9 (ре-ревью): полнота разбора ShotBackground", () => {
  it("неизвестный источник фона деградирует, а не тратит бюджет генеративного видео", () => {
    // Симулирует будущий член юниона, который забыли обработать явно (TS не
    // даст скомпилировать такой вызов без `as never` — сам факт, что здесь
    // нужен каст, и есть проверка полноты разбора компилятором).
    const pick = pickBackgroundSource(input({ requested: "stock_video" as never }))

    expect(pick.background).not.toBe("video")
    expect(pick.countsAgainstBudgetUsd).toBe(0)
  })
})

describe("М-10 (ре-ревью): §10 «фонов нет, генерация запрещена» — ведущий на весь экран", () => {
  it("библиотека без кандидата и запрещённая генерация картинки уходят в none, а не в image", () => {
    const pick = pickBackgroundSource(input({
      requested: "library", hasLibraryCandidate: false, imageGenerationAllowed: false,
    }))

    expect(pick.background).toBe("none")
    expect(pick.costUsd).toBe(0)
    expect(pick.degradeReason).toMatch(/картинк/i)
  })

  it("прямой запрос картинки при запрещённой генерации тоже уходит в none", () => {
    const pick = pickBackgroundSource(input({ requested: "image", imageGenerationAllowed: false }))

    expect(pick.background).toBe("none")
    expect(pick.costUsd).toBe(0)
    expect(pick.degradeReason).not.toBeNull()
  })

  it("исчерпанный потолок генеративного видео при запрещённой генерации картинки — тоже none", () => {
    const pick = pickBackgroundSource(input({ spentUsd: 0.49, imageGenerationAllowed: false }))

    expect(pick.background).toBe("none")
    expect(pick.costUsd).toBe(0)
  })

  it("при разрешённой генерации картинки поведение не меняется (регрессия по умолчанию)", () => {
    const pick = pickBackgroundSource(input({ requested: "library", hasLibraryCandidate: false, imageGenerationAllowed: true }))

    expect(pick.background).toBe("image")
  })
})
