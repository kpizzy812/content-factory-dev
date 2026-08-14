/**
 * AI-аватар: сцена, где ведущего не снимали.
 *
 * Ведущая в ролике собирается из фрагментов реальной съёмки
 * (docs/operations/presenter-library.md). Когда библиотека пуста, а у персонажа
 * есть портрет, сцену снимает аватар — портрет плюс готовая речь через
 * `speech_to_video`. Здесь проверяются выбор портрета, промпт, ключ хранения и
 * контроль дублей — без сети и БД.
 */

import { describe, expect, it } from "vitest"
import {
  avatarSourceStorageKey,
  buildAvatarClipPrompt,
  findSimilarAvatarClip,
  pickAvatarPortrait,
} from "../../../server/utils/avatar-source"
import { StorageKeys } from "../../../server/utils/storage/keys"

describe("pickAvatarPortrait", () => {
  const face = {
    id: "face_1", kind: "face", order: 5, storageKey: "k1", fileUrl: "/f1.png", mimeType: null,
    usageCount: 0, lastUsedAt: null,
  }
  const body = {
    id: "body_1", kind: "body", order: 0, storageKey: "k2", fileUrl: "/f2.png", mimeType: null,
    usageCount: 0, lastUsedAt: null,
  }

  it("портрет лица выигрывает у любого другого кадра", () => {
    // Lip-sync работает с губами: кадр в полный рост даёт лицо в несколько
    // пикселей, и синхронизировать там нечего.
    expect(pickAvatarPortrait([body, face])?.id).toBe("face_1")
  })

  it("среди равных по типу берёт наименее использованный", () => {
    // PROJECT_CONTEXT §7: один и тот же кадр во всех сценах и роликах — это
    // «меняются только губы». Ротация обязана размазывать нагрузку по портретам.
    const worn = { ...face, id: "face_worn", order: 0, usageCount: 12 }
    const fresh = { ...face, id: "face_fresh", order: 9, usageCount: 1 }
    expect(pickAvatarPortrait([worn, fresh])?.id).toBe("face_fresh")
  })

  it("при равном счётчике первым идёт тот, кого дольше не брали", () => {
    const recent = { ...face, id: "face_recent", order: 0, usageCount: 3, lastUsedAt: new Date("2026-08-14T10:00:00Z") }
    const old = { ...face, id: "face_old", order: 1, usageCount: 3, lastUsedAt: new Date("2026-08-01T10:00:00Z") }
    expect(pickAvatarPortrait([recent, old])?.id).toBe("face_old")
  })

  it("ни разу не использованный опережает использованный", () => {
    const used = { ...face, id: "face_used", order: 0, usageCount: 2, lastUsedAt: new Date("2026-08-01T10:00:00Z") }
    const never = { ...face, id: "face_never", order: 7, usageCount: 0, lastUsedAt: null }
    expect(pickAvatarPortrait([used, never])?.id).toBe("face_never")
  })

  it("порядок в карточке решает только при полном равенстве", () => {
    const second = { ...face, id: "face_2", order: 9 }
    expect(pickAvatarPortrait([second, face])?.id).toBe("face_1")
  })

  it("портрет из этого же ролика не берётся второй раз, пока есть другие", () => {
    // Иначе ротация упирается в один кадр внутри одного ролика: счётчик в БД
    // растёт только после прогона, а сцены выбираются подряд.
    const other = { ...face, id: "face_other", order: 9 }
    expect(pickAvatarPortrait([face, other], { exclude: ["face_1"] })?.id).toBe("face_other")
  })

  it("единственный портрет берётся повторно, а не роняет сцену", () => {
    expect(pickAvatarPortrait([face], { exclude: ["face_1"] })?.id).toBe("face_1")
  })

  it("без лица берёт что есть, а на пустом списке отдаёт null", () => {
    expect(pickAvatarPortrait([body])?.id).toBe("body_1")
    expect(pickAvatarPortrait([])).toBeNull()
  })

  it("референс без файла не годится: доставить его нечем", () => {
    const orphan = {
      id: "x", kind: "face", order: 0, storageKey: null, fileUrl: "/api/files/x.png", mimeType: null,
      usageCount: 0, lastUsedAt: null,
    }
    expect(pickAvatarPortrait([orphan])).toBeNull()
  })
})

describe("buildAvatarClipPrompt", () => {
  it("описывает внешность персонажа и удержание лица в кадре", () => {
    const prompt = buildAvatarClipPrompt({ name: "Лиана", visualPrompt: "woman in a beige blazer" })
    expect(prompt).toContain("woman in a beige blazer")
    expect(prompt.toLowerCase()).toContain("mouth visible")
    expect(prompt.toLowerCase()).toContain("static camera")
  })

  it("работает и без визуального описания персонажа", () => {
    const prompt = buildAvatarClipPrompt({ name: "Лиана", visualPrompt: null })
    expect(prompt.length).toBeGreaterThan(0)
    expect(prompt.toLowerCase()).toContain("static camera")
  })

  it("настроение сцены попадает в промпт", () => {
    // Пластику задаёт речь (speech_to_video), а промпт — то, о чём сцена.
    const prompt = buildAvatarClipPrompt(
      { name: "Лиана", visualPrompt: null },
      "рассказывает о своей ошибке, сдержанно",
    )
    expect(prompt).toContain("рассказывает о своей ошибке, сдержанно")
  })

  it("детерминирован: те же входы — тот же промпт", () => {
    // Иначе повторный прогон сцены создаёт новую платную задачу вместо
    // переиспользования готового prediction.
    const character = { name: "Лиана", visualPrompt: null }
    expect(buildAvatarClipPrompt(character, "спокойно")).toBe(buildAvatarClipPrompt(character, "спокойно"))
  })
})


describe("findSimilarAvatarClip", () => {
  const hash = "ffff0000ffff0000"

  it("находит сцену, чей аватарный кадр повторяется", () => {
    // Гейт уникальности сравнивает готовый ролик с прошлыми публикациями и
    // не видит, что внутри одного ролика девять сцен показывают один кадр.
    expect(findSimilarAvatarClip(hash, [{ sceneIndex: 0, hash }])).toEqual({ sceneIndex: 0, distance: 0 })
  })

  it("разные кадры дублем не считаются", () => {
    expect(findSimilarAvatarClip(hash, [{ sceneIndex: 0, hash: "0000ffff0000ffff" }])).toBeNull()
  })

  it("пустая история и негодный хеш не ломают шаг", () => {
    // Хеш считается ffmpeg'ом и может не посчитаться вовсе — это диагностика,
    // а не повод уронить платный шаг.
    expect(findSimilarAvatarClip(hash, [])).toBeNull()
    expect(findSimilarAvatarClip("не-хеш", [{ sceneIndex: 0, hash }])).toBeNull()
    expect(findSimilarAvatarClip(hash, [{ sceneIndex: 0, hash: "мусор" }])).toBeNull()
  })
})

describe("avatarSourceStorageKey", () => {
  it("не занимает ключ клипа сцены", () => {
    // Аватарный клип — исходник для lip-sync, а не готовый клип сцены. Общий
    // ключ означал бы, что один перезапишет другой в смешанном ролике.
    expect(avatarSourceStorageKey(3, 2)).not.toBe(StorageKeys.videoSceneClip(3, 2))
  })

  it("разные сцены одного ролика не делят один объект", () => {
    expect(avatarSourceStorageKey(3, 2)).not.toBe(avatarSourceStorageKey(3, 5))
  })
})
