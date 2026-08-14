/**
 * Голос ведущей задаётся персонажем, а не роликом.
 *
 * `Video.voiceoverVoiceId` заполнялся руками на каждый ролик, а незаполненный
 * уводил синтез на стоковый пресет спеки (`Wise_Woman`). При потоке в сотни
 * роликов это вопрос времени, когда на лицо конкретного человека ляжет голос
 * незнакомой женщины — и заметит это зритель, а не оператор.
 *
 * Поэтому: голос живёт на `Character`, ролик его наследует, а явный выбор
 * оператора по-прежнему главнее. И там, где ведущий в кадре ЕСТЬ, а голоса нет
 * ни у ролика, ни у персонажа, — отказ вместо тихой подмены.
 */

import { describe, expect, it } from "vitest"
import {
  presenterVoiceMissingMessage,
  resolvePresenterVoice,
} from "~~/server/utils/presenter/voice-defaults"

const liana = {
  id: "cmliana000000reforma0001",
  name: "Лиана",
  voiceId: "R8_DZK7FMFF",
  voiceModelId: "minimax/speech-02-turbo",
}

describe("resolvePresenterVoice", () => {
  it("берёт голос персонажа, когда ролик его не задал", () => {
    expect(resolvePresenterVoice({ character: liana })).toEqual({
      voiceId: "R8_DZK7FMFF",
      modelId: "minimax/speech-02-turbo",
      source: "character",
    })
  })

  it("явный выбор оператора главнее персонажа", () => {
    // Перегенерация с другим голосом — осознанное действие, ломать его нельзя.
    expect(resolvePresenterVoice({
      requestedVoiceId: "English_Wiselady",
      character: liana,
    })).toMatchObject({ voiceId: "English_Wiselady", source: "request" })
  })

  it("модель голоса наследуется отдельно от самого голоса", () => {
    // Клон обучен под конкретную модель: voice_id от speech-02-turbo в другой
    // модели не существует, и подставлять его туда — платный запрос в никуда.
    expect(resolvePresenterVoice({
      requestedVoiceId: "Custom",
      character: liana,
    }).modelId).toBe("minimax/speech-02-turbo")

    expect(resolvePresenterVoice({
      requestedModelId: "fal-ai/playai/tts/v3",
      character: liana,
    }).modelId).toBe("fal-ai/playai/tts/v3")
  })

  it("нет ни у ролика, ни у персонажа — source none", () => {
    expect(resolvePresenterVoice({ character: { ...liana, voiceId: null, voiceModelId: null } }))
      .toMatchObject({ voiceId: null, source: "none" })
    expect(resolvePresenterVoice({})).toMatchObject({ voiceId: null, source: "none" })
  })

  it("пробелы вместо голоса — это отсутствие голоса", () => {
    expect(resolvePresenterVoice({ requestedVoiceId: "   ", character: { ...liana, voiceId: "  " } }))
      .toMatchObject({ voiceId: null, source: "none" })
  })

  it("сообщение об отказе называет персонажа и что делать", () => {
    const message = presenterVoiceMissingMessage(liana.name)
    expect(message).toContain("Лиана")
    expect(message.toLowerCase()).toContain("голос")
  })
})
