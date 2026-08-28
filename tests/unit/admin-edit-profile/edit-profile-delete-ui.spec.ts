/**
 * Кнопка удаления монтажного профиля.
 *
 * Долг §8.5 отчёта: ручки `DELETE /api/edit-profiles/:id` не было, кнопки —
 * тоже. Удаление профиля меняет правила монтажа СРАЗУ ВСЕХ роликов приложения,
 * поэтому клик обязан быть двухшаговым и называть последствие ДО подтверждения:
 * останется ли приложение с профилем по умолчанию и что будет, если это
 * последний профиль.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it, vi } from "vitest"

import { deleteEditProfile } from "~~/app/components/admin/edit-profile-client"
import {
  EDIT_PROFILE_DEFAULTS,
  describeProfileDeletion,
} from "~~/app/components/admin/edit-profile-form-model"
import { formatMoney } from "~~/shared/utils/money"

const file = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8")

describe("запрос на удаление", () => {
  it("уходит методом DELETE на адрес конкретного профиля", async () => {
    const fetcher = vi.fn().mockResolvedValue({ data: { id: 12, promotedDefaultId: null, promotedDefaultName: null, note: "" } })
    await deleteEditProfile(fetcher, 12)
    expect(fetcher).toHaveBeenCalledWith("/api/edit-profiles/12", { method: "DELETE" })
  })

  it("не подставляет id из воздуха: нечисловой id до сети не доходит", async () => {
    const fetcher = vi.fn()
    await expect(deleteEditProfile(fetcher, Number.NaN)).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })
})

describe("последствие удаления называется до подтверждения", () => {
  it("профиль по умолчанию: сказано, что дефолт переедет на другой профиль", () => {
    const text = describeProfileDeletion({ name: "Продуктовый", isDefault: true }, 2)
    expect(text).toContain("по умолчанию")
    expect(text).toMatch(/станет|перейдёт|переедет/)
  })

  it("последний профиль приложения: названы встроенные значения, а не «настроек не будет»", () => {
    const text = describeProfileDeletion({ name: "Продуктовый", isDefault: true }, 0)
    expect(text).toContain("встроенны")
    // Числа собраны из констант профиля, а не переписаны строкой — иначе они
    // разъедутся с сервером на первой же смене дефолта.
    expect(text).toContain(String(EDIT_PROFILE_DEFAULTS.brollRatio).replace(".", ","))
    expect(text).toContain(formatMoney(EDIT_PROFILE_DEFAULTS.imageBudgetUsd)!)
  })

  it("обычный профиль: дефолт не трогается, и это сказано", () => {
    const text = describeProfileDeletion({ name: "Запасной", isDefault: false }, 3)
    expect(text).toContain("по умолчанию не")
  })

  it("везде предупреждает, что ролики по профилю удалить не дадут", () => {
    for (const input of [
      describeProfileDeletion({ name: "A", isDefault: true }, 2),
      describeProfileDeletion({ name: "A", isDefault: false }, 2),
      describeProfileDeletion({ name: "A", isDefault: true }, 0),
    ]) {
      expect(input).toMatch(/ролик/i)
    }
  })
})

describe("кнопка на форме профиля", () => {
  const form = file("app/components/admin/EditProfileForm.vue")

  it("есть только в режиме правки — у несозданного профиля удалять нечего", () => {
    expect(form).toContain("Удалить профиль")
    expect(form).toContain("v-if=\"isEdit\"")
  })

  it("двухшаговая: сначала подтверждение с последствием, потом запрос", () => {
    expect(form).toContain("confirmingDelete")
    expect(form).toContain("describeProfileDeletion")
  })

  it("ходит через проверяющий слой, а не собирает запрос руками", () => {
    expect(form).toContain("deleteEditProfile($fetch")
    expect(form).not.toContain("method: 'DELETE'")
  })

  it("отказ сервера (409 «профилем пользуются ролики») показывается текстом сервера", () => {
    expect(form).toContain("adminErrorText(error, 'Не удалось удалить профиль')")
  })
})

describe("список профилей переживает удаление", () => {
  const list = file("app/components/admin/AppEditProfiles.vue")

  it("после удаления список перечитывается, а выбор сбрасывается", () => {
    expect(list).toContain("@deleted")
    expect(list).toContain("refresh()")
    expect(list).toContain("selectedId.value = null")
  })

  it("оператору показывается, что стало с профилем по умолчанию", () => {
    // Сервер отвечает объяснением (`note`) — оно и показывается: угадывать
    // преемника на клиенте значило бы завести второй источник правды.
    expect(list).toContain("note")
  })
})
