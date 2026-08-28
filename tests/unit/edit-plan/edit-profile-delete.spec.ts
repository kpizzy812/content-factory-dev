/**
 * Удаление монтажного профиля: решение о том, можно ли удалять и что станет с
 * профилем по умолчанию.
 *
 * Долг из отчёта `admin-edit-profile-backgrounds-report.md` §8.5: ручки
 * `DELETE /api/edit-profiles/:id` не было вовсе, и созданный по ошибке профиль
 * оставался в приложении навсегда.
 *
 * Два факта схемы, из которых вырастают все проверки ниже.
 *
 * 1. `Video.editProfileId Int?` + `onDelete: SetNull` (`prisma/schema.prisma`,
 *    строки 977-978). Удаление строки НЕ роняет ролик — оно молча обнуляет
 *    ссылку (это прибито интеграционным тестом «удаление монтажного профиля не
 *    уносит ролик — обнуляет editProfileId», `tests/integration/edit-plan.spec.ts`).
 *    Снимка разрешённого профиля на ролике нет: `resolveEditProfile` считает
 *    правила на каждом прогоне из `video.editProfile ?? профиль приложения по
 *    умолчанию` (`video-pipeline.ts`, `video-pipeline-steps.ts`). Значит после
 *    удаления уже смонтированный ролик начнёт читаться как собранный по ЧУЖИМ
 *    правилам — по профилю приложения по умолчанию или по встроенным
 *    значениям. Это не потеря ссылки, это подмена истории, поэтому ответ —
 *    отказ, а не отвязка.
 * 2. `EditProfile.isDefault` — обычный индекс `@@index([appId, isDefault])`,
 *    не уникальный. Конвейер берёт дефолт через
 *    `findFirst({ where: { appId, isDefault: true } })`. Удаление дефолтного
 *    профиля, когда у приложения есть другие, оставило бы приложение со
 *    списком профилей, из которых не действует НИ ОДИН: конвейер свалится на
 *    встроенные значения молча. Поэтому дефолт переезжает на преемника в той же
 *    транзакции.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

import { planEditProfileDeletion } from "../../../server/utils/edit-plan/edit-profile-delete"

const file = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8")

const profile = { id: 10, appId: 7, name: "Продуктовый", isDefault: false }
const sibling = (id: number, name: string, createdAt: string) => ({ id, name, createdAt: new Date(createdAt) })

describe("профиль, на который ссылаются ролики", () => {
  it("удалить нельзя — 409 с числом роликов", () => {
    const plan = planEditProfileDeletion({ profile, videoCount: 3, siblings: [] })
    expect(plan.allowed).toBe(false)
    if (plan.allowed) throw new Error("unreachable")
    expect(plan.statusCode).toBe(409)
    expect(plan.message).toContain("3")
    expect(plan.message).toContain("Продуктовый")
  })

  it("объясняет ПОЧЕМУ отказ, а не просто «профиль используется»", () => {
    const plan = planEditProfileDeletion({ profile, videoCount: 1, siblings: [] })
    if (plan.allowed) throw new Error("unreachable")
    // Оператору нужна причина: ссылка обнулится, и ролик станет выглядеть
    // собранным по другим правилам — снимка правил на ролике нет.
    expect(plan.message).toContain("ссылк")
    expect(plan.message).toMatch(/умолчанию|встроенн/)
  })

  it("ноль роликов удалению не мешает", () => {
    const plan = planEditProfileDeletion({ profile, videoCount: 0, siblings: [] })
    expect(plan.allowed).toBe(true)
  })
})

describe("профиль по умолчанию", () => {
  it("передаёт дефолт самому свежему из оставшихся — приложение не остаётся без действующего профиля", () => {
    const plan = planEditProfileDeletion({
      profile: { ...profile, isDefault: true },
      videoCount: 0,
      siblings: [
        sibling(3, "Старый", "2026-01-01T00:00:00Z"),
        sibling(5, "Свежий", "2026-06-01T00:00:00Z"),
        sibling(4, "Средний", "2026-03-01T00:00:00Z"),
      ],
    })
    if (!plan.allowed) throw new Error("unreachable")
    expect(plan.promoteDefaultId).toBe(5)
    expect(plan.promoteDefaultName).toBe("Свежий")
    expect(plan.note).toContain("Свежий")
  })

  it("порядок преемника детерминирован при равном createdAt — по большему id", () => {
    const plan = planEditProfileDeletion({
      profile: { ...profile, isDefault: true },
      videoCount: 0,
      siblings: [
        sibling(8, "A", "2026-06-01T00:00:00Z"),
        sibling(9, "B", "2026-06-01T00:00:00Z"),
      ],
    })
    if (!plan.allowed) throw new Error("unreachable")
    expect(plan.promoteDefaultId).toBe(9)
  })

  it("последний профиль приложения удаляется, но оператор узнаёт про встроенные значения", () => {
    const plan = planEditProfileDeletion({
      profile: { ...profile, isDefault: true },
      videoCount: 0,
      siblings: [],
    })
    if (!plan.allowed) throw new Error("unreachable")
    expect(plan.promoteDefaultId).toBeNull()
    expect(plan.note).toContain("встроенны")
  })

  it("не дефолтный профиль дефолт не двигает", () => {
    const plan = planEditProfileDeletion({
      profile: { ...profile, isDefault: false },
      videoCount: 0,
      siblings: [sibling(3, "Старый", "2026-01-01T00:00:00Z")],
    })
    if (!plan.allowed) throw new Error("unreachable")
    expect(plan.promoteDefaultId).toBeNull()
    expect(plan.note).not.toContain("Старый")
  })

  it("общий шаблон (appId: null) преемника не назначает — дефолт приложения решает не он", () => {
    const plan = planEditProfileDeletion({
      profile: { id: 10, appId: null, name: "Шаблон", isDefault: true },
      videoCount: 0,
      siblings: [sibling(3, "Другой шаблон", "2026-01-01T00:00:00Z")],
    })
    if (!plan.allowed) throw new Error("unreachable")
    expect(plan.promoteDefaultId).toBeNull()
  })
})

describe("ручка DELETE /api/edit-profiles/:id", () => {
  const path = "server/api/edit-profiles/[id].delete.ts"

  it("существует", () => {
    expect(() => file(path)).not.toThrow()
  })

  it("авторизует ДО чтения БД — отказ не зависит от существования профиля", () => {
    const source = file(path)
    const firstAuth = source.indexOf("requireScopedAccess")
    const firstRead = source.indexOf("prisma.editProfile.findUnique")
    expect(firstAuth).toBeGreaterThan(-1)
    expect(firstRead).toBeGreaterThan(-1)
    expect(firstAuth).toBeLessThan(firstRead)
    // Право проверяется именно ДО чтения — и это `canDelete`, а не `canRead`:
    // иначе любой читатель модуля сносил бы правила монтажа бренда.
    expect(source.slice(0, firstRead)).toContain("canDelete")
    expect(source).not.toContain("permissions: [\"canRead\"")
  })

  it("на ЧУЖОЙ и на НЕСУЩЕСТВУЮЩИЙ профиль отвечает одинаково — иначе перебор id выдаёт карту чужих профилей", () => {
    const source = file(path)
    // Тот же приём, что в `[id].get.ts`: отказ доступа к конкретному профилю
    // подменяется 404 с тем же текстом, а 500 остаётся собой.
    expect(source).toContain("statusCode === 401 || statusCode === 403")
    // Текст один на оба случая — он вынесен в константу и подставляется в обоих
    // местах, а не переписан дважды (второй раз он бы однажды разъехался).
    expect(source).toMatch(/const NOT_FOUND = "Профиль не найден"/)
    const uses = source.match(/message: NOT_FOUND/g) ?? []
    expect(uses.length).toBeGreaterThanOrEqual(2)
    // Ответа 403 про чужой профиль в ручке нет вовсе.
    expect(source).not.toContain("statusCode: 403")
  })

  it("решение об удалении принимает разобранный модуль, а не inline-логика в ручке", () => {
    const source = file(path)
    expect(source).toContain("planEditProfileDeletion")
    expect(source).toContain("deleteEditProfileExclusive")
  })

  it("смена дефолта и удаление идут одной транзакцией", () => {
    const store = file("server/utils/edit-plan/edit-profile-delete.ts")
    expect(store).toContain("prisma.$transaction")
  })
})
