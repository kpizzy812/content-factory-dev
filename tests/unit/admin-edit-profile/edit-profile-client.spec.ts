import { describe, expect, it, vi } from "vitest"

import { EditProfileValidationError, saveEditProfile } from "~~/app/components/admin/edit-profile-client"
import type { AdminFetcher } from "~~/app/components/admin/edit-profile-client"
import { editProfileFormFrom } from "~~/app/components/admin/edit-profile-form-model"
import type { EditProfileFormState } from "~~/app/components/admin/edit-profile-form-model"

function form(patch: Partial<EditProfileFormState> = {}): EditProfileFormState {
  return { ...editProfileFormFrom(null), name: "Продуктовый", ...patch }
}

interface Call { url: string, options?: { method?: string, body?: unknown } }

function spyFetcher() {
  const calls: Call[] = []
  const mock = vi.fn(async (url: string, options?: { method?: string, body?: unknown }) => {
    calls.push({ url, options })
    return { data: { id: 1 } }
  })
  return { fetcher: mock as unknown as AdminFetcher, calls, mock }
}

describe("невалидная форма не доходит до сети", () => {
  it("отрицательный потолок картинок — ноль запросов", async () => {
    const { fetcher, mock } = spyFetcher()

    await expect(saveEditProfile(fetcher, {
      appId: 3,
      profileId: null,
      form: form({ imageBudgetUsd: "-5" }),
    })).rejects.toBeInstanceOf(EditProfileValidationError)

    expect(mock).not.toHaveBeenCalled()
  })

  it("отрицательный потолок генеративного видео — ноль запросов", async () => {
    const { fetcher, mock } = spyFetcher()

    await expect(saveEditProfile(fetcher, {
      appId: 3,
      profileId: 12,
      form: form({ generativeVideoBudgetUsd: "-0.5" }),
    })).rejects.toBeInstanceOf(EditProfileValidationError)

    expect(mock).not.toHaveBeenCalled()
  })

  it("ошибка несёт разметку по полям, а не одну строку на всю форму", async () => {
    const { fetcher } = spyFetcher()

    const error: unknown = await saveEditProfile(fetcher, {
      appId: 3,
      profileId: null,
      form: form({ imageBudgetUsd: "", shotChangeSec: "0.1", name: "" }),
    }).then(() => null).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(EditProfileValidationError)
    expect(Object.keys((error as EditProfileValidationError).errors).sort())
      .toEqual(["imageBudgetUsd", "name", "shotChangeSec"])
  })
})

describe("валидная форма уходит по правильному маршруту", () => {
  it("создание — POST с appId в теле", async () => {
    const { fetcher, calls } = spyFetcher()

    await saveEditProfile(fetcher, { appId: 3, profileId: null, form: form() })

    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe("/api/edit-profiles")
    expect(calls[0]!.options?.method).toBe("POST")
    expect((calls[0]!.options?.body as { appId: number }).appId).toBe(3)
  })

  it("правка — PUT без appId: сервер запрещает его менять", async () => {
    const { fetcher, calls } = spyFetcher()

    await saveEditProfile(fetcher, { appId: 3, profileId: 12, form: form() })

    expect(calls[0]!.url).toBe("/api/edit-profiles/12")
    expect(calls[0]!.options?.method).toBe("PUT")
    expect(calls[0]!.options?.body).not.toHaveProperty("appId")
  })

  it("обе денежные ручки уходят числами, а не строками из поля", async () => {
    const { fetcher, calls } = spyFetcher()

    await saveEditProfile(fetcher, {
      appId: 3,
      profileId: null,
      form: form({ imageBudgetUsd: "2,25", generativeVideoBudgetUsd: "1,00" }),
    })

    const body = calls[0]!.options?.body as { imageBudgetUsd: unknown, generativeVideoBudgetUsd: unknown }
    expect(body.imageBudgetUsd).toBe(2.25)
    expect(body.generativeVideoBudgetUsd).toBe(1)
  })
})
