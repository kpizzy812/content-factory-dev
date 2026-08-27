import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

import { EDIT_PROFILE_DEFAULTS } from "~~/app/components/admin/edit-profile-form-model"
import { formatMoney } from "~~/shared/utils/money"

const file = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8")
const exists = (path: string) => existsSync(resolve(process.cwd(), path))

/**
 * Контракт двух экранов, которых не было в продукте после Task 7: формы
 * монтажного профиля и библиотеки фонов. Обе ручки работают по `appId`, поэтому
 * место экранов — карточка приложения в админке.
 */

describe("экраны смонтированы в админке приложения", () => {
  const page = "app/pages/admin/apps/[id].vue"

  it("страница приложения несёт обе секции", () => {
    const source = file(page)
    expect(source).toContain("<AdminAppEditProfiles")
    expect(source).toContain("<AdminAppBackgroundLibrary")
    expect(source).toContain(':app-id="app.id"')
  })

  it("компоненты лежат на месте", () => {
    for (const path of [
      "app/components/admin/AppEditProfiles.vue",
      "app/components/admin/EditProfileForm.vue",
      "app/components/admin/AppBackgroundLibrary.vue",
      "app/components/admin/edit-profile-form-model.ts",
      "app/components/admin/edit-profile-client.ts",
      "app/components/admin/background-library-model.ts",
      "app/components/admin/background-library-client.ts",
    ]) {
      expect(exists(path), path).toBe(true)
    }
  })
})

describe("форма профиля ходит только через проверяющий слой", () => {
  const form = file("app/components/admin/EditProfileForm.vue")

  it("не собирает запрос к /api/edit-profiles руками", () => {
    expect(form).not.toContain("'/api/edit-profiles'")
    expect(form).not.toContain("method: 'POST'")
    expect(form).not.toContain("method: 'PUT'")
    expect(form).toContain("saveEditProfile($fetch")
  })

  it("показывает отказ валидации подписями под полями, а не текстом ошибки сервера", () => {
    expect(form).toContain("error instanceof EditProfileValidationError")
    expect(form).toContain("errors.value = error.errors")
  })
})

describe("денежные ручки читаются как денежные", () => {
  const form = file("app/components/admin/EditProfileForm.vue")

  it("обе суммы подписаны единицей измерения и дефолтом", () => {
    expect(form).toContain("Потолок расхода на картинки, $")
    expect(form).toContain("Потолок генеративного видео, $")
    // Дефолт не переписан руками, а собран из константы профиля — иначе он
    // разъедется с сервером на первой же смене значения.
    expect(form).toContain("по умолчанию ${formatMoney(EDIT_PROFILE_DEFAULTS.imageBudgetUsd)}")
    expect(form).toContain("по умолчанию ${formatMoney(EDIT_PROFILE_DEFAULTS.generativeVideoBudgetUsd)}")
  })

  it("дефолт печатается деньгами: 1,50 $ и 0,50 $", () => {
    const image = formatMoney(EDIT_PROFILE_DEFAULTS.imageBudgetUsd)
    const video = formatMoney(EDIT_PROFILE_DEFAULTS.generativeVideoBudgetUsd)
    expect(image?.startsWith("1,50")).toBe(true)
    expect(image?.endsWith("$")).toBe(true)
    expect(video?.startsWith("0,50")).toBe(true)
    expect(video?.endsWith("$")).toBe(true)
  })

  it("объясняют, что произойдёт при исчерпании", () => {
    const model = file("app/components/admin/edit-profile-form-model.ts")
    // Формулировки повторяют поведение pickBackgroundSource, а не «превышен лимит».
    expect(model).toContain("задний план кадра остаётся пустым")
    expect(model).toContain("кадр отдаётся ведущему")
    expect(model).toContain("деградирует до картинки с движением")
    expect(form).toContain("IMAGE_BUDGET_EXHAUSTED_NOTE")
    expect(form).toContain("VIDEO_BUDGET_EXHAUSTED_NOTE")
  })

  it("выключатель генерации картинок и пошаговый режим на форме есть", () => {
    expect(form).toContain("form.imageGenerationEnabled")
    expect(form).toContain("form.generativeVideoEnabled")
    expect(form).toContain("form.stepwiseApproval")
  })
})

describe("библиотека фонов не выдаёт дубль за успех", () => {
  const library = file("app/components/admin/AppBackgroundLibrary.vue")

  it("вердикт по каждому файлу берётся из разбора ответа, а не из «запрос прошёл»", () => {
    expect(library).toContain("describeBackgroundUpload(response.data")
    expect(library).toContain("notice.similarNames")
  })

  it("не собирает multipart мимо проверки формата и размера", () => {
    expect(library).not.toContain("new FormData()")
    expect(library).toContain("uploadBackgroundClip($fetch")
  })

  it("пустое состояние объясняет цену пустой библиотеки", () => {
    expect(library).toContain("Фонов пока нет")
    expect(library).toContain("тратит потолок")
  })
})
