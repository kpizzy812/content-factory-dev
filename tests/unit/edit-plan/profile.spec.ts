import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

import { DEFAULT_EDIT_PROFILE, GENERATIVE_VIDEO_RESOLUTIONS, resolveEditProfile } from "~~/server/utils/edit-plan/profile"
import { resolveMediaModel } from "~~/server/utils/media-provider/registry"

describe("разрешение монтажного профиля", () => {
  describe("базовое наследование", () => {
    it("без профиля и переопределений отдаёт дефолты", () => {
      const resolved = resolveEditProfile(null, null)

      expect(resolved.brollRatio).toBeCloseTo(0.4, 6)
      expect(resolved.shotChangeSec).toBeCloseTo(1.8, 6)
      expect(resolved.generativeVideoEnabled).toBe(false)
      expect(resolved).toEqual(DEFAULT_EDIT_PROFILE)
    })

    it("профиль перекрывает дефолты", () => {
      const resolved = resolveEditProfile({ brollRatio: 0.6, pipEnabled: true }, null)

      expect(resolved.brollRatio).toBeCloseTo(0.6, 6)
      expect(resolved.pipEnabled).toBe(true)
      expect(resolved.shotChangeSec).toBeCloseTo(1.8, 6)
    })

    it("переопределение ролика главнее профиля", () => {
      const resolved = resolveEditProfile({ pipEnabled: true, brollRatio: 0.6 }, { pipEnabled: false })

      expect(resolved.pipEnabled).toBe(false)
      expect(resolved.brollRatio).toBeCloseTo(0.6, 6)
    })

    it("мусор в переопределениях без профиля откатывается на дефолт", () => {
      // editOverrides — Json из БД, туда может приехать что угодно.
      const resolved = resolveEditProfile(null, { brollRatio: "много", pipSize: null, чужое: 1 })

      expect(resolved.brollRatio).toBeCloseTo(0.4, 6)
      expect(resolved.pipSize).toBeCloseTo(DEFAULT_EDIT_PROFILE.pipSize, 6)
    })

    it("зажимает доли в осмысленный диапазон — точные границы, не откат на дефолт", () => {
      // Доля перебивок 2.0 и PiP на весь кадр — это не «смелая настройка», а
      // сломанный ролик. Зажим должен давать РОВНО границу диапазона: если бы
      // реализация вместо зажима откатывалась на дефолт (0.4 / 0.28), эти
      // toBeCloseTo тоже были бы «в диапазоне» и не поймали бы подмену.
      const high = resolveEditProfile({ brollRatio: 2, pipSize: 5 }, null)
      expect(high.brollRatio).toBeCloseTo(1, 6)
      expect(high.pipSize).toBeCloseTo(0.5, 6)

      const low = resolveEditProfile({ brollRatio: -1, pipSize: -3 }, null)
      expect(low.brollRatio).toBeCloseTo(0, 6)
      expect(low.pipSize).toBeCloseTo(0.1, 6)
    })

    it("не даёт шагу смены картинки уехать в ноль, и хранит границу валидности", () => {
      // shotChangeSec = 0 дал бы бесконечное число кадров при нарезке.
      expect(resolveEditProfile({ shotChangeSec: 0 }, null).shotChangeSec).toBeGreaterThan(0)
      expect(resolveEditProfile({ shotChangeSec: -3 }, null).shotChangeSec).toBeGreaterThan(0)

      // Граница включительно: 0.8 — валидное значение, а не «слишком короткое».
      expect(resolveEditProfile({ shotChangeSec: 0.8 }, null).shotChangeSec).toBeCloseTo(0.8, 6)
      // Валидное значение НИЖЕ дефолта не должно теряться — иначе это не порог
      // валидности, а незаметный зажим к дефолту.
      expect(resolveEditProfile({ shotChangeSec: 0.9 }, null).shotChangeSec).toBeCloseTo(0.9, 6)
      // Чуть ниже порога — невалидно целиком, откат на дефолт (1.8), а не на 0.8.
      expect(resolveEditProfile({ shotChangeSec: 0.79 }, null).shotChangeSec).toBeCloseTo(1.8, 6)
    })

    it("неизвестный угол PiP заменяется дефолтным", () => {
      expect(resolveEditProfile({ pipPosition: "середина" as never }, null).pipPosition)
        .toBe(DEFAULT_EDIT_PROFILE.pipPosition)
    })
  })

  describe("денежный ограничитель не открывается на мусоре (потолок генеративного видео)", () => {
    it("не задано нигде — дефолт 0.5", () => {
      expect(resolveEditProfile(null, null).generativeVideoBudgetUsd).toBeCloseTo(0.5, 6)
    })

    it("явный ноль в профиле выживает сквозь мусорное строковое переопределение", () => {
      // Профиль бренда: генеративное видео на фон запрещено расходом (0).
      // Форма ролика прислала то же значение строкой — типичный Json-мусор.
      // Ноль обязан выжить, а не превратиться в разрешающий дефолт 0.5.
      const resolved = resolveEditProfile(
        { generativeVideoBudgetUsd: 0 },
        { generativeVideoBudgetUsd: "0" },
      )
      expect(resolved.generativeVideoBudgetUsd).toBe(0)
    })

    it("отрицательное явно заданное значение закрывает ворота в 0, а не в дефолт", () => {
      const resolved = resolveEditProfile(null, { generativeVideoBudgetUsd: -1 })
      expect(resolved.generativeVideoBudgetUsd).toBe(0)
    })

    it("валидный профиль переживает отрицательное переопределение — ворота НЕ закрываются", () => {
      // Отличие от предыдущего теста: здесь профиль задаёт валидный потолок
      // (0.5), а мусорное значение прилетает только в override. Ворота в 0 —
      // это исход, когда НИ ОДИН заданный кандидат не валиден, а не любой факт
      // невалидности где бы то ни было: валидный профиль побеждает мусорный
      // override так же, как и для остальных полей.
      const resolved = resolveEditProfile({ generativeVideoBudgetUsd: 0.5 }, { generativeVideoBudgetUsd: -1 })
      expect(resolved.generativeVideoBudgetUsd).toBeCloseTo(0.5, 6)
    })

    it("мусорный тип явно заданного значения (без валидной альтернативы) закрывает ворота в 0", () => {
      // Задано (не отсутствует), но не число — это не «не задано вовсе»,
      // поэтому результат 0, а не разрешающий дефолт 0.5.
      const resolved = resolveEditProfile(null, { generativeVideoBudgetUsd: "много" })
      expect(resolved.generativeVideoBudgetUsd).toBe(0)
    })

    it("верхней границы нет — осознанно большой бюджет проходит как есть", () => {
      const resolved = resolveEditProfile(null, { generativeVideoBudgetUsd: 1_000_000 })
      expect(resolved.generativeVideoBudgetUsd).toBe(1_000_000)
    })
  })

  describe("поле за полем: отсутствие / профиль / переопределение / мусор", () => {
    describe("editPrompt", () => {
      it("отсутствует — null", () => {
        expect(resolveEditProfile(null, null).editPrompt).toBeNull()
      })
      it("валидное значение профиля используется", () => {
        expect(resolveEditProfile({ editPrompt: "Открывай с проблемы" }, null).editPrompt)
          .toBe("Открывай с проблемы")
      })
      it("валидное переопределение важнее профиля", () => {
        expect(resolveEditProfile({ editPrompt: "из профиля" }, { editPrompt: "из ролика" }).editPrompt)
          .toBe("из ролика")
      })
      it("мусорное переопределение (пробелы, число) не топит валидный профиль", () => {
        expect(resolveEditProfile({ editPrompt: "из профиля" }, { editPrompt: "   " }).editPrompt)
          .toBe("из профиля")
        expect(resolveEditProfile({ editPrompt: "из профиля" }, { editPrompt: 42 }).editPrompt)
          .toBe("из профиля")
      })
    })

    describe("brollRatio", () => {
      it("отсутствует — 0.4", () => {
        expect(resolveEditProfile(null, null).brollRatio).toBeCloseTo(0.4, 6)
      })
      it("валидное значение профиля используется", () => {
        expect(resolveEditProfile({ brollRatio: 0.6 }, null).brollRatio).toBeCloseTo(0.6, 6)
      })
      it("валидное переопределение важнее профиля", () => {
        expect(resolveEditProfile({ brollRatio: 0.6 }, { brollRatio: 0.7 }).brollRatio).toBeCloseTo(0.7, 6)
      })
      it("мусорное переопределение не топит валидный профиль", () => {
        expect(resolveEditProfile({ brollRatio: 0.6 }, { brollRatio: "много" }).brollRatio).toBeCloseTo(0.6, 6)
      })
    })

    describe("shotChangeSec", () => {
      it("отсутствует — 1.8", () => {
        expect(resolveEditProfile(null, null).shotChangeSec).toBeCloseTo(1.8, 6)
      })
      it("валидное значение профиля используется", () => {
        expect(resolveEditProfile({ shotChangeSec: 2.5 }, null).shotChangeSec).toBeCloseTo(2.5, 6)
      })
      it("валидное переопределение важнее профиля", () => {
        expect(resolveEditProfile({ shotChangeSec: 2.5 }, { shotChangeSec: 3 }).shotChangeSec).toBeCloseTo(3, 6)
      })
      it("переопределение короче порога валидности не топит валидный профиль", () => {
        expect(resolveEditProfile({ shotChangeSec: 3 }, { shotChangeSec: 0.5 }).shotChangeSec).toBeCloseTo(3, 6)
      })
    })

    describe("pipEnabled", () => {
      it("отсутствует — false", () => {
        expect(resolveEditProfile(null, null).pipEnabled).toBe(false)
      })
      it("валидное значение профиля используется", () => {
        expect(resolveEditProfile({ pipEnabled: true }, null).pipEnabled).toBe(true)
      })
      it("валидное переопределение важнее профиля", () => {
        expect(resolveEditProfile({ pipEnabled: true }, { pipEnabled: false }).pipEnabled).toBe(false)
      })
      it("мусорное переопределение (строка) не гасит включённый в профиле PiP", () => {
        expect(resolveEditProfile({ pipEnabled: true }, { pipEnabled: "no" }).pipEnabled).toBe(true)
      })
    })

    describe("pipPosition", () => {
      it("отсутствует — bottom_right", () => {
        expect(resolveEditProfile(null, null).pipPosition).toBe("bottom_right")
      })
      it("валидное значение профиля используется", () => {
        expect(resolveEditProfile({ pipPosition: "top_left" }, null).pipPosition).toBe("top_left")
      })
      it("валидное переопределение важнее профиля", () => {
        expect(resolveEditProfile({ pipPosition: "top_left" }, { pipPosition: "bottom_left" }).pipPosition)
          .toBe("bottom_left")
      })
      it("мусорное переопределение не топит валидный угол профиля", () => {
        expect(resolveEditProfile({ pipPosition: "top_left" }, { pipPosition: "середина" as never }).pipPosition)
          .toBe("top_left")
      })
    })

    describe("pipSize", () => {
      it("отсутствует — 0.28", () => {
        expect(resolveEditProfile(null, null).pipSize).toBeCloseTo(0.28, 6)
      })
      it("валидное значение профиля используется", () => {
        expect(resolveEditProfile({ pipSize: 0.35 }, null).pipSize).toBeCloseTo(0.35, 6)
      })
      it("валидное переопределение важнее профиля", () => {
        expect(resolveEditProfile({ pipSize: 0.35 }, { pipSize: 0.4 }).pipSize).toBeCloseTo(0.4, 6)
      })
      it("мусорное переопределение (null) не стирает валидный профиль", () => {
        expect(resolveEditProfile({ pipSize: 0.4 }, { pipSize: null }).pipSize).toBeCloseTo(0.4, 6)
      })
    })

    describe("generativeVideoEnabled", () => {
      it("отсутствует — false", () => {
        expect(resolveEditProfile(null, null).generativeVideoEnabled).toBe(false)
      })
      it("валидное значение профиля используется", () => {
        expect(resolveEditProfile({ generativeVideoEnabled: true }, null).generativeVideoEnabled).toBe(true)
      })
      it("валидное переопределение важнее профиля", () => {
        expect(
          resolveEditProfile({ generativeVideoEnabled: true }, { generativeVideoEnabled: false })
            .generativeVideoEnabled,
        ).toBe(false)
      })
      it("мусорное переопределение не гасит включённый в профиле флаг", () => {
        expect(
          resolveEditProfile({ generativeVideoEnabled: true }, { generativeVideoEnabled: "yes" })
            .generativeVideoEnabled,
        ).toBe(true)
      })
    })

    describe("generativeVideoBudgetUsd", () => {
      it("отсутствует нигде — дефолт 0.5", () => {
        expect(resolveEditProfile(null, null).generativeVideoBudgetUsd).toBeCloseTo(0.5, 6)
      })
      it("валидное значение профиля используется", () => {
        expect(resolveEditProfile({ generativeVideoBudgetUsd: 2 }, null).generativeVideoBudgetUsd).toBeCloseTo(2, 6)
      })
      it("валидное переопределение важнее профиля", () => {
        expect(
          resolveEditProfile({ generativeVideoBudgetUsd: 2 }, { generativeVideoBudgetUsd: 3 })
            .generativeVideoBudgetUsd,
        ).toBeCloseTo(3, 6)
      })
      it("мусорное переопределение не топит валидный профиль (не откатывается на 0.5)", () => {
        expect(
          resolveEditProfile({ generativeVideoBudgetUsd: 2 }, { generativeVideoBudgetUsd: "abc" })
            .generativeVideoBudgetUsd,
        ).toBeCloseTo(2, 6)
      })
    })

    describe("generativeVideoResolution", () => {
      // Формат Kling (потребитель поля), не аватарной speech_to_video модели:
      // "1080x1920" / "1920x1080" / "1080x1080" — пиксельные строки из
      // constraints.resolutions обеих способностей Kling в model-specs.ts.
      it("отсутствует — 1080x1920 (вертикаль, дефолт продукта)", () => {
        expect(resolveEditProfile(null, null).generativeVideoResolution).toBe("1080x1920")
      })
      it("валидное значение профиля используется", () => {
        expect(resolveEditProfile({ generativeVideoResolution: "1920x1080" }, null).generativeVideoResolution)
          .toBe("1920x1080")
      })
      it("валидное переопределение важнее профиля", () => {
        expect(
          resolveEditProfile({ generativeVideoResolution: "1080x1920" }, { generativeVideoResolution: "1920x1080" })
            .generativeVideoResolution,
        ).toBe("1920x1080")
      })
      it("переопределение вне белого списка не топит валидный профиль", () => {
        expect(
          resolveEditProfile({ generativeVideoResolution: "1920x1080" }, { generativeVideoResolution: "8k" })
            .generativeVideoResolution,
        ).toBe("1920x1080")
      })
      it("переопределение вне белого списка без валидного профиля откатывается на дефолт", () => {
        expect(resolveEditProfile(null, { generativeVideoResolution: "8k" }).generativeVideoResolution)
          .toBe("1080x1920")
      })
      it("формат аватарной модели ('720p'/'1080p') невалиден — Kling его не примет", () => {
        expect(resolveEditProfile(null, { generativeVideoResolution: "720p" }).generativeVideoResolution)
          .toBe("1080x1920")
        expect(resolveEditProfile(null, { generativeVideoResolution: "1080p" }).generativeVideoResolution)
          .toBe("1080x1920")
      })
    })

    describe("stepwiseApproval", () => {
      it("отсутствует — false", () => {
        expect(resolveEditProfile(null, null).stepwiseApproval).toBe(false)
      })
      it("валидное значение профиля используется", () => {
        expect(resolveEditProfile({ stepwiseApproval: true }, null).stepwiseApproval).toBe(true)
      })
      it("валидное переопределение важнее профиля", () => {
        expect(resolveEditProfile({ stepwiseApproval: true }, { stepwiseApproval: false }).stepwiseApproval)
          .toBe(false)
      })
      it("мусорное переопределение не гасит включённый в профиле флаг", () => {
        expect(resolveEditProfile({ stepwiseApproval: true }, { stepwiseApproval: "yes" }).stepwiseApproval)
          .toBe(true)
      })
    })

    describe("llmModelId", () => {
      it("отсутствует — null", () => {
        expect(resolveEditProfile(null, null).llmModelId).toBeNull()
      })
      it("валидное значение профиля используется", () => {
        expect(resolveEditProfile({ llmModelId: "claude-x" }, null).llmModelId).toBe("claude-x")
      })
      it("валидное переопределение важнее профиля", () => {
        expect(resolveEditProfile({ llmModelId: "claude-x" }, { llmModelId: "claude-y" }).llmModelId)
          .toBe("claude-y")
      })
      it("мусорное переопределение (число, пустая строка) не топит валидный профиль", () => {
        expect(resolveEditProfile({ llmModelId: "claude-x" }, { llmModelId: 5 }).llmModelId).toBe("claude-x")
        expect(resolveEditProfile({ llmModelId: "claude-x" }, { llmModelId: "" }).llmModelId).toBe("claude-x")
      })
    })

    describe("imageGenerationEnabled (ре-ревью 3, Task 5, пункт 1)", () => {
      it("отсутствует — true (дефолт: генерация разрешена, поле — рычаг ВЫКЛЮЧЕНИЯ)", () => {
        expect(resolveEditProfile(null, null).imageGenerationEnabled).toBe(true)
      })
      it("профиль выключает генерацию картинок", () => {
        expect(resolveEditProfile({ imageGenerationEnabled: false }, null).imageGenerationEnabled).toBe(false)
      })
      it("валидное переопределение важнее профиля", () => {
        expect(
          resolveEditProfile({ imageGenerationEnabled: false }, { imageGenerationEnabled: true })
            .imageGenerationEnabled,
        ).toBe(true)
      })
      it("мусорное переопределение (строка) не включает генерацию обратно, если профиль её выключил", () => {
        expect(
          resolveEditProfile({ imageGenerationEnabled: false }, { imageGenerationEnabled: "yes" })
            .imageGenerationEnabled,
        ).toBe(false)
      })
    })
  })

  it("дефолты совпадают с моделью EditProfile в prisma/schema.prisma", () => {
    // process.cwd(), а не import.meta.url: под happy-dom из основного
    // vitest-конфига import.meta.url не является file:-URL (см.
    // tests/unit/content-factory-schema.spec.ts). Дефолты в prisma и в
    // DEFAULT_EDIT_PROFILE — два независимых источника истины; если они
    // разъедутся, ролик с профилем и ролик без него смонтируются по-разному.
    const schema = readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8")
    const modelMatch = schema.match(/model EditProfile \{([\s\S]*?)\n\}/m)
    if (!modelMatch) throw new Error("model EditProfile отсутствует в schema.prisma")
    const body = modelMatch[1]

    // Список полей для сверки НЕ хардкодится: собираем все `имя Тип @default(...)`
    // из тела модели (заодно ловим служебные поля вроде id/isDefault/createdAt —
    // они отсеются на следующем шаге пересечением с ключами DEFAULT_EDIT_PROFILE)
    // и берём пересечение с текущими ключами ResolvedEditProfile. Новое поле с
    // @default, добавленное когда-нибудь в обе стороны (схему и профиль), войдёт
    // в проверку само — без правки этого теста.
    const rawDefaults = new Map<string, string>()
    for (const match of body.matchAll(/(\w+)\s+\S+\s+@default\(([^)]+)\)/g)) {
      const [, fieldName, rawValue] = match
      if (!rawDefaults.has(fieldName)) rawDefaults.set(fieldName, rawValue.trim())
    }

    function parseSchemaDefault(raw: string): string | number | boolean {
      if (raw === "true") return true
      if (raw === "false") return false
      if (raw.startsWith("\"") && raw.endsWith("\"")) return raw.slice(1, -1)
      const parsed = Number(raw)
      if (Number.isNaN(parsed)) throw new Error(`Не удалось разобрать дефолт: "${raw}"`)
      return parsed
    }

    type ProfileKey = keyof typeof DEFAULT_EDIT_PROFILE
    const profileKeys = Object.keys(DEFAULT_EDIT_PROFILE) as ProfileKey[]
    const fieldsWithDefault = profileKeys.filter(field => rawDefaults.has(field))

    // Подстраховка от «регэксп перестал видеть схему и тихо проверяет ноль
    // полей»: сейчас их девять, ниже быть не должно.
    expect(fieldsWithDefault.length).toBeGreaterThanOrEqual(9)

    for (const field of fieldsWithDefault) {
      const expected = parseSchemaDefault(rawDefaults.get(field)!)
      const actual = DEFAULT_EDIT_PROFILE[field]
      if (typeof expected === "number") {
        expect(actual as number, `поле ${field}`).toBeCloseTo(expected, 6)
      } else {
        expect(actual, `поле ${field}`).toBe(expected)
      }
    }

    // editPrompt и llmModelId — единственные поля без @default в схеме
    // (String? — нет дефолтного значения, дефолт null). Явная сверка, а не
    // молчаливое исключение: если завтра у одного из них появится @default,
    // этот список должен измениться осознанно, а не разойтись незаметно.
    const fieldsWithoutDefault = profileKeys.filter(field => !rawDefaults.has(field)).sort()
    expect(fieldsWithoutDefault).toEqual(["editPrompt", "llmModelId"])
    expect(body).toMatch(/\n\s*editPrompt\s+String\?/)
    expect(body).toMatch(/\n\s*llmModelId\s+String\?/)
    expect(DEFAULT_EDIT_PROFILE.editPrompt).toBeNull()
    expect(DEFAULT_EDIT_PROFILE.llmModelId).toBeNull()
  })

  it("белый список generativeVideoResolution совпадает с constraints.resolutions Kling в model-specs.ts", () => {
    // GENERATIVE_VIDEO_RESOLUTIONS в profile.ts — ручная копия
    // constraints.resolutions обеих способностей Kling (t2v/i2v). Дефолты уже
    // стережёт тест выше через schema.prisma, но этот список схемой не
    // описан — без отдельной проверки расхождение с моделью прошло бы молча.
    const t2v = resolveMediaModel("text_to_video", "replicate:kling-v1.6-standard-t2v")
    const i2v = resolveMediaModel("image_to_video", "replicate:kling-v1.6-standard-i2v")

    expect(t2v.constraints.resolutions).toEqual(GENERATIVE_VIDEO_RESOLUTIONS)
    expect(i2v.constraints.resolutions).toEqual(GENERATIVE_VIDEO_RESOLUTIONS)
    // Дефолт профиля обязан быть значением, которое Kling реально принимает —
    // иначе профиль по умолчанию сам себе противоречит.
    expect(t2v.constraints.resolutions).toContain(DEFAULT_EDIT_PROFILE.generativeVideoResolution)
  })
})
