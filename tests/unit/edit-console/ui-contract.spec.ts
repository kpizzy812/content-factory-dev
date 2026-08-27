import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const file = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8")

/**
 * Контракт экранов монтажной консоли: что смонтировано, через какие ручки ходит
 * и что дорогие действия не собраны руками мимо защищённого слоя.
 */

describe("макет монтажной консоли", () => {
  const mockup = "design-preview/catalog/09-edit-console.dc.html"

  it("лежит в каталоге дизайн-системы", () => {
    expect(existsSync(resolve(process.cwd(), mockup))).toBe(true)
  })

  it("показывает все обязательные состояния", () => {
    const html = file(mockup)
    // Дорогие действия с суммой и подтверждением.
    expect(html).toContain("Перегенерация всего трека")
    expect(html).toContain("Клонировать за 3,00")
    // Деградация объясняется причиной сервера, а не «что-то пошло не так».
    expect(html).toContain("Потолок расхода на картинки $1.50 исчерпан")
    // Ожидание решения оператора.
    expect(html).toContain("Ролик ждёт вашего решения")
    // Пустое состояние и ошибка.
    expect(html).toContain("Кадры появятся после шага")
    expect(html).toContain("Не удалось загрузить кадры")
    // Денежные ручки профиля.
    expect(html).toContain("Потолки расхода на один ролик")
  })
})

describe("монтажная консоль в продукте", () => {
  it("вкладка «Монтаж» смонтирована на детали ролика", () => {
    const page = file("app/pages/videos/[id].vue")
    expect(page).toContain("label: 'Монтаж'")
    expect(page).toContain("<VideoShotsTable")
    expect(page).toContain("<VideoVoiceoverPanel")
    expect(page).toContain("<VideoStepwisePanel")
  })

  it("ожидание решения оператора видно на самом ролике, а не спрятано во вкладке", () => {
    const page = file("app/pages/videos/[id].vue")
    expect(page).toContain("<VideoAwaitingOperator")
    expect(page).toContain("awaiting_operator")
    // Ожидание не считается активной генерацией: опрашивать нечего.
    expect(page).not.toContain("'assembling', 'awaiting_operator'")
  })

  it("клон голоса смонтирован на карточке персонажа", () => {
    const page = file("app/pages/characters/[id].vue")
    expect(page).toContain("<CharacterVoiceClone")
    expect(page).toContain(':character-id="character.id"')
  })
})

describe("платные ручки дёргаются только через защищённый слой", () => {
  const guarded = [
    "app/components/video/VideoShotsTable.vue",
    "app/components/video/VideoVoiceoverPanel.vue",
    "app/components/video/VideoStepwisePanel.vue",
    "app/components/video/VideoAwaitingOperator.vue",
    "app/components/character/CharacterVoiceClone.vue",
  ]

  it("компоненты не собирают запросы к платным ручкам руками", () => {
    for (const path of guarded) {
      const source = file(path)
      expect(source, path).not.toContain("regenerate-track")
      expect(source, path).not.toContain("clone-voice")
      expect(source, path).not.toContain("confirmExpensive")
      expect(source, path).not.toContain("confirmUsd")
    }
  })

  it("подтверждение суммы доезжает до слоя запросов, а не только до вида кнопки", () => {
    const voiceover = file("app/components/video/VideoVoiceoverPanel.vue")
    expect(voiceover).toContain("acknowledged: acknowledged.value")

    const clone = file("app/components/character/CharacterVoiceClone.vue")
    expect(clone).toContain("confirmedUsd: acknowledged.value ? VOICE_CLONE_USD : 0")
  })

  it("кнопка дорогого действия несёт сумму, а не голый глагол", () => {
    expect(file("app/components/video/VideoVoiceoverPanel.vue"))
      .toContain("Перегенерировать{{ preview ? ` за ${formatMoney(preview.estimatedCostUsd)}` : '' }}")
    expect(file("app/components/character/CharacterVoiceClone.vue"))
      .toContain("Клонировать голос за {{ formatMoney(VOICE_CLONE_USD) }}")
  })
})

describe("деградация кадра объясняется оператору", () => {
  it("таблица кадров печатает причину сервера как есть", () => {
    const table = file("app/components/video/VideoShotsTable.vue")
    expect(table).toContain("row.degradeReason")
    expect(table).toContain("{{ row.degradeReason }}")
    // Потолки показаны там же, где видно их последствия.
    expect(table).toContain("profile.imageBudgetUsd")
    expect(table).toContain("profile.generativeVideoBudgetUsd")
  })
})

describe("типы монтажной консоли", () => {
  it("описаны в shared, а не разбросаны по компонентам", () => {
    const types = file("shared/types/edit-console.ts")
    expect(types).toContain("export interface EditProfile {")
    expect(types).toContain("imageBudgetUsd: number")
    expect(types).toContain("generativeVideoBudgetUsd: number")
    expect(types).toContain("export interface TrackRegenerationPreview {")
    expect(types).toContain("export const VOICE_CLONE_USD = 3")
  })

  it("пошаговые поля ролика перестали быть безымянными", () => {
    const video = file("shared/types/video.ts")
    expect(video).toContain("stepwiseApproval?: boolean | null")
    expect(video).toContain("awaitingStepKey?: VideoStepKey | string | null")
  })
})
