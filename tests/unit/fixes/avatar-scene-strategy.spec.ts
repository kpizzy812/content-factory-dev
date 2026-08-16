/**
 * Как выбирается исходник для сцены, где ведущий говорит в кадре.
 *
 * Порядок задан spec 2026-08-14-avatar-pipeline §3.2: живая съёмка, затем
 * AI-аватар из портрета, затем прежнее поведение. Раньше выбор был зашит в
 * ветвление посреди шага lip-sync и проверялся только целиком, вместе с ffmpeg,
 * Replicate и базой.
 */

import { describe, expect, it } from "vitest"
import { planPresenterSourceStrategy } from "../../../server/utils/avatar-source"

describe("planPresenterSourceStrategy", () => {
  it("живая съёмка выигрывает у аватара", () => {
    // Снятый человек всегда лучше сгенерированного: у нас уже есть кадры,
    // и платить за их синтез незачем.
    expect(planPresenterSourceStrategy({
      hasLibraryClip: true,
      hasPortrait: true,
      hasGeneratedClip: true,
    })).toBe("library")
  })

  it("библиотека пуста, есть портрет — снимает аватар", () => {
    expect(planPresenterSourceStrategy({
      hasLibraryClip: false,
      hasPortrait: true,
      hasGeneratedClip: false,
    })).toBe("avatar")
  })

  it("аватар выигрывает у сгенерированного клипа: в кадре должен быть ведущий", () => {
    // Сцена размечена spokenLine — значит в ней говорит человек. Клип из
    // text-to-video покажет что угодно, только не его.
    expect(planPresenterSourceStrategy({
      hasLibraryClip: false,
      hasPortrait: true,
      hasGeneratedClip: true,
    })).toBe("avatar")
  })

  it("нет ни фрагмента, ни портрета — остаётся сгенерированный клип", () => {
    expect(planPresenterSourceStrategy({
      hasLibraryClip: false,
      hasPortrait: false,
      hasGeneratedClip: true,
    })).toBe("generated")
  })

  it("не осталось ничего — сцену собирать нечем", () => {
    expect(planPresenterSourceStrategy({
      hasLibraryClip: false,
      hasPortrait: false,
      hasGeneratedClip: false,
    })).toBe("none")
  })
})

describe("planPresenterSourceStrategy: принудительный аватарный маршрут", () => {
  /**
   * Библиотека Лианы — съёмка в полный рост: лицо занимает восьмую часть кадра,
   * рот около 50 пикселей из 1080. Липсинку такого входа мало по построению, и
   * сравнивать маршруты надо на одном и том же сценарии. Переключатель нужен
   * ровно для этого: живая съёмка остаётся выбором по умолчанию.
   */
  it("с preferAvatar портрет побеждает живую съёмку", () => {
    expect(planPresenterSourceStrategy({
      hasLibraryClip: true,
      hasPortrait: true,
      hasGeneratedClip: true,
      preferAvatar: true,
    })).toBe("avatar")
  })

  it("портрета нет — переключатель ничего не меняет", () => {
    expect(planPresenterSourceStrategy({
      hasLibraryClip: true,
      hasPortrait: false,
      hasGeneratedClip: true,
      preferAvatar: true,
    })).toBe("library")
  })

  it("без переключателя порядок прежний", () => {
    expect(planPresenterSourceStrategy({
      hasLibraryClip: true,
      hasPortrait: true,
      hasGeneratedClip: true,
    })).toBe("library")
  })
})
