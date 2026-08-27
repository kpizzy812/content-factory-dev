import { describe, expect, it } from "vitest"

import { buildTrackRequest } from "~~/server/utils/voiceover/track-builder"

const scene = (order: number, text: string) => ({ order, text, source: "spoken" as const })

describe("сборка единого трека озвучки", () => {
  it("склеивает реплики сцен в один текст", () => {
    const request = buildTrackRequest([scene(1, "Первая реплика."), scene(2, "Вторая реплика.")])

    expect(request.text).toBe("Первая реплика. Вторая реплика.")
    expect(request.pauses).toEqual([])
  })

  it("вынимает маркер паузы из текста и запоминает её длину", () => {
    const request = buildTrackRequest([
      scene(1, "Смотри сюда. [пауза 2с]"),
      scene(2, "А теперь вывод."),
    ])

    // Маркер не должен попасть в синтез — модель прочитала бы его вслух.
    expect(request.text).toBe("Смотри сюда. А теперь вывод.")
    expect(request.pauses).toEqual([{ afterSceneOrder: 1, durationSec: 2 }])
  })

  it("отдаёт сцены с ОЧИЩЕННЫМ текстом для выравнивания", () => {
    const request = buildTrackRequest([scene(1, "Раз. [пауза 1.5с] Два.")])

    // В выравнивание должен уходить тот же текст, что ушёл в синтез: иначе
    // «пауза» и «1.5с» станут словами сценария, которых нет в транскрипте.
    expect(request.scenes).toEqual([{ order: 1, text: "Раз. Два." }])
    expect(request.pauses).toEqual([{ afterSceneOrder: 1, durationSec: 1.5 }])
  })

  it("падает, если текст не влезает в лимит модели", () => {
    expect(() => buildTrackRequest([scene(1, "а".repeat(120))], { maxCharacters: 100 }))
      .toThrow(/длиннее 100 символов/)
  })

  it("не отдаёт пустой запрос на синтез", () => {
    expect(() => buildTrackRequest([scene(1, "   ")])).toThrow(/пустой текст/)
  })

  it("маркер в конце заменяемой фразы не уходит в синтез", () => {
    // Локальная замена синтезирует ОДНУ фразу тем же сборщиком. Если маркер
    // проедет в текст, модель прочитает «пауза два с» вслух.
    const request = buildTrackRequest([scene(2, "Смотри сюда. [пауза 2с]")])

    expect(request.text).toBe("Смотри сюда.")
    expect(request.pauses).toEqual([{ afterSceneOrder: 2, durationSec: 2 }])
  })

  it("сцена из одного маркера даёт паузу, но не текст для синтеза", () => {
    // Такая сцена не попадает в `scenes` (очищенный текст пуст), и пауза
    // остаётся без точки вставки — это уже обрабатывается planPauseSplit
    // через skippedPauses, но проверить связку надо здесь.
    expect(() => buildTrackRequest([scene(3, "[пауза 1.5с]")])).toThrow(/пустой текст/)
  })

  it("регистр и пробел перед «с» маркер не ломают", () => {
    // Оператор пишет маркер руками в тексте сцены, и заглавная буква после
    // точки — норма для русского текста. Не распознанный маркер остался бы в
    // тексте и был бы прочитан вслух, поэтому послабление обязано держаться.
    const request = buildTrackRequest([scene(1, "Пауза дальше. [Пауза 2 с] Продолжаем.")])

    expect(request.text).toBe("Пауза дальше. Продолжаем.")
    expect(request.pauses).toEqual([{ afterSceneOrder: 1, durationSec: 2 }])
  })

  it("десятичная запятая читается как дробь, а не обрезается до целого", () => {
    // На русской раскладке запятая — привычный разделитель дроби. Обрезка до
    // «1» дала бы паузу вдвое короче заказанной, причём молча.
    const request = buildTrackRequest([scene(1, "Раз. [пауза 1,5с] Два.")])

    expect(request.pauses).toEqual([{ afterSceneOrder: 1, durationSec: 1.5 }])
  })

  it("маркер нулевой длины паузы не создаёт", () => {
    // Тишина в ноль секунд — это лишняя точка разреза трека без единого
    // сэмпла тишины: работа ffmpeg ради ничего.
    const request = buildTrackRequest([scene(1, "Раз. [пауза 0с] Два.")])

    expect(request.text).toBe("Раз. Два.")
    expect(request.pauses).toEqual([])
  })
})
