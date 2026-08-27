import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

import {
  EDIT_PROFILE_DEFAULTS,
  EDIT_PROFILE_LIMITS,
  describeGenerativeVideoBudget,
  describeImageBudget,
  editProfileFormFrom,
  parseDecimalInput,
  readEditProfileForm,
} from "~~/app/components/admin/edit-profile-form-model"
import type { EditProfileFormState } from "~~/app/components/admin/edit-profile-form-model"
import type { EditProfile } from "~~/shared/types/edit-console"

const file = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8")

/** Валидная форма, от которой отталкиваются проверки отдельных полей. */
function validForm(patch: Partial<EditProfileFormState> = {}): EditProfileFormState {
  return {
    name: "Продуктовый, вертикаль",
    description: "",
    isDefault: false,
    editPrompt: "",
    brollRatio: "0.4",
    shotChangeSec: "1.8",
    pipEnabled: true,
    pipPosition: "bottom_right",
    pipSize: "0.28",
    imageGenerationEnabled: true,
    imageBudgetUsd: "1.50",
    generativeVideoEnabled: false,
    generativeVideoBudgetUsd: "0.50",
    generativeVideoResolution: "1080x1920",
    stepwiseApproval: false,
    llmModelId: "",
    ...patch,
  }
}

describe("границы формы совпадают с серверными", () => {
  // Требование брифа: клиентская валидация не должна расходиться с серверной.
  // Проверяем не «примерно одинаково», а сами числа в файле сервера — иначе
  // изменение там оставит клиент с прежними границами и вернёт «Ошибка 400»
  // вместо подписи под полем.
  const server = file("server/utils/edit-plan/edit-profile-api.ts")

  it("шаг смены кадра и размер PiP взяты из parseEditProfileWrite", () => {
    expect(server).toContain(`const MIN_SHOT_CHANGE_SEC_INPUT = ${EDIT_PROFILE_LIMITS.shotChangeSecMin}`)
    expect(server).toContain(`const MIN_PIP_SIZE_INPUT = ${EDIT_PROFILE_LIMITS.pipSizeMin}`)
    expect(server).toContain(`const MAX_PIP_SIZE_INPUT = ${EDIT_PROFILE_LIMITS.pipSizeMax}`)
  })

  it("доля перебивок ограничена тем же диапазоном", () => {
    expect(server).toContain(
      `if (value < ${EDIT_PROFILE_LIMITS.brollRatioMin} || value > ${EDIT_PROFILE_LIMITS.brollRatioMax})`,
    )
  })

  it("обе денежные ручки на сервере отвергают отрицательное", () => {
    expect(server).toContain("badRequest(\"Поле \\\"imageBudgetUsd\\\" должно быть неотрицательным\")")
    expect(server).toContain("badRequest(\"Поле \\\"generativeVideoBudgetUsd\\\" должно быть неотрицательным\")")
    expect(EDIT_PROFILE_LIMITS.budgetMin).toBe(0)
  })

  it("дефолты формы — это дефолты профиля с сервера", () => {
    const profile = file("server/utils/edit-plan/profile.ts")
    expect(profile).toContain(`brollRatio: ${EDIT_PROFILE_DEFAULTS.brollRatio}`)
    expect(profile).toContain(`shotChangeSec: ${EDIT_PROFILE_DEFAULTS.shotChangeSec}`)
    expect(profile).toContain(`pipSize: ${EDIT_PROFILE_DEFAULTS.pipSize}`)
    expect(profile).toContain(`imageBudgetUsd: ${EDIT_PROFILE_DEFAULTS.imageBudgetUsd}`)
    expect(profile).toContain(`generativeVideoBudgetUsd: ${EDIT_PROFILE_DEFAULTS.generativeVideoBudgetUsd}`)
  })
})

describe("разбор числового ввода", () => {
  it("пустое поле — это НЕ ноль", () => {
    // `Number('')` равен нулю: без явной проверки пустой потолок уехал бы на
    // сервер нулём, то есть молча выключил бы генерацию.
    expect(parseDecimalInput("")).toBeNull()
    expect(parseDecimalInput("   ")).toBeNull()
  })

  it("принимает запятую как разделитель", () => {
    expect(parseDecimalInput("1,5")).toBe(1.5)
    expect(parseDecimalInput(" 2 ")).toBe(2)
  })

  it("не пропускает мусор", () => {
    expect(parseDecimalInput("abc")).toBeNull()
    expect(parseDecimalInput("1,5,5")).toBeNull()
    expect(parseDecimalInput("Infinity")).toBeNull()
  })
})

describe("форма не отправляет невалидные денежные значения", () => {
  it("отрицательный потолок картинок не даёт тела запроса", () => {
    const { errors, body } = readEditProfileForm(validForm({ imageBudgetUsd: "-1" }))
    expect(body).toBeNull()
    expect(errors.imageBudgetUsd).toBe("Потолок не может быть отрицательным")
  })

  it("отрицательный потолок генеративного видео не даёт тела запроса", () => {
    const { errors, body } = readEditProfileForm(validForm({ generativeVideoBudgetUsd: "-0.01" }))
    expect(body).toBeNull()
    expect(errors.generativeVideoBudgetUsd).toBe("Потолок не может быть отрицательным")
  })

  it("пустое денежное поле — ошибка, а не ноль", () => {
    const { errors, body } = readEditProfileForm(validForm({ imageBudgetUsd: "" }))
    expect(body).toBeNull()
    expect(errors.imageBudgetUsd).toBe("Введите сумму в долларах")
  })

  it("нечисловое денежное поле — ошибка", () => {
    const { body } = readEditProfileForm(validForm({ generativeVideoBudgetUsd: "полтора доллара" }))
    expect(body).toBeNull()
  })

  it("ноль — законный потолок и проходит", () => {
    const { body } = readEditProfileForm(validForm({ imageBudgetUsd: "0" }))
    expect(body?.imageBudgetUsd).toBe(0)
  })
})

describe("остальные поля проверяются по тем же границам, что на сервере", () => {
  it("доля перебивок вне 0..1 отвергается", () => {
    expect(readEditProfileForm(validForm({ brollRatio: "2" })).body).toBeNull()
    expect(readEditProfileForm(validForm({ brollRatio: "-0.1" })).body).toBeNull()
    expect(readEditProfileForm(validForm({ brollRatio: "1" })).body?.brollRatio).toBe(1)
  })

  it("смена кадра короче 0,8 с отвергается", () => {
    expect(readEditProfileForm(validForm({ shotChangeSec: "0.5" })).body).toBeNull()
    expect(readEditProfileForm(validForm({ shotChangeSec: "0.8" })).body?.shotChangeSec).toBe(0.8)
  })

  it("размер PiP вне 0,1..0,5 отвергается", () => {
    expect(readEditProfileForm(validForm({ pipSize: "0.6" })).body).toBeNull()
    expect(readEditProfileForm(validForm({ pipSize: "0.05" })).body).toBeNull()
  })

  it("угол PiP и разрешение — только из белого списка", () => {
    expect(readEditProfileForm(validForm({ pipPosition: "center" as never })).body).toBeNull()
    expect(readEditProfileForm(validForm({ generativeVideoResolution: "720p" })).body).toBeNull()
  })

  it("пустое название отвергается", () => {
    expect(readEditProfileForm(validForm({ name: "   " })).errors.name).toBe("Название обязательно")
  })
})

describe("тело запроса", () => {
  it("пустые текстовые поля уходят как null, а не пустой строкой", () => {
    const { body } = readEditProfileForm(validForm({ description: "  ", editPrompt: "", llmModelId: "" }))
    expect(body?.description).toBeNull()
    expect(body?.editPrompt).toBeNull()
    expect(body?.llmModelId).toBeNull()
  })

  it("несёт все поля профиля, включая обе денежные ручки и пошаговый режим", () => {
    const { body } = readEditProfileForm(validForm({ stepwiseApproval: true, isDefault: true }))
    expect(Object.keys(body!).sort()).toEqual([
      "brollRatio",
      "description",
      "editPrompt",
      "generativeVideoBudgetUsd",
      "generativeVideoEnabled",
      "generativeVideoResolution",
      "imageBudgetUsd",
      "imageGenerationEnabled",
      "isDefault",
      "llmModelId",
      "name",
      "pipEnabled",
      "pipPosition",
      "pipSize",
      "shotChangeSec",
      "stepwiseApproval",
    ])
    expect(body?.stepwiseApproval).toBe(true)
    expect(body?.isDefault).toBe(true)
  })

  it("профиль с сервера доезжает до формы и обратно без потерь", () => {
    const profile: EditProfile = {
      id: 7,
      appId: 3,
      name: "Спокойный",
      description: "Длинные ролики",
      isDefault: true,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
      editPrompt: "Без стоков",
      brollRatio: 0.25,
      shotChangeSec: 2.4,
      pipEnabled: true,
      pipPosition: "top_left",
      pipSize: 0.32,
      imageGenerationEnabled: false,
      imageBudgetUsd: 0.75,
      generativeVideoEnabled: true,
      generativeVideoBudgetUsd: 2,
      generativeVideoResolution: "1920x1080",
      stepwiseApproval: true,
      llmModelId: "claude-sonnet-4-5",
    }

    const { body } = readEditProfileForm(editProfileFormFrom(profile))
    expect(body).toMatchObject({
      name: "Спокойный",
      description: "Длинные ролики",
      isDefault: true,
      editPrompt: "Без стоков",
      brollRatio: 0.25,
      shotChangeSec: 2.4,
      pipEnabled: true,
      pipPosition: "top_left",
      pipSize: 0.32,
      imageGenerationEnabled: false,
      imageBudgetUsd: 0.75,
      generativeVideoEnabled: true,
      generativeVideoBudgetUsd: 2,
      generativeVideoResolution: "1920x1080",
      stepwiseApproval: true,
      llmModelId: "claude-sonnet-4-5",
    })
  })

  it("новый профиль открывается на дефолтах завода, а не на пустых полях", () => {
    const form = editProfileFormFrom(null)
    expect(form.imageBudgetUsd).toBe("1.50")
    expect(form.generativeVideoBudgetUsd).toBe("0.50")
    expect(form.brollRatio).toBe("0.4")
  })
})

describe("денежное поле читается как денежное", () => {
  it("потолок картинок объясняется в кадрах", () => {
    expect(describeImageBudget("1.50")).toContain("60 кадров")
    expect(describeImageBudget("0.025")).toContain("1 кадр")
  })

  it("нулевой потолок называется запретом, а не «примерно 0 кадров»", () => {
    expect(describeImageBudget("0")).toContain("ни одной картинки")
  })

  it("потолок генеративного видео объясняется в клипах", () => {
    expect(describeGenerativeVideoBudget("0.50")).toContain("2 клипа")
    expect(describeGenerativeVideoBudget("0.10")).toContain("Меньше одного клипа")
  })
})
