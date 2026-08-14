/**
 * Голос ведущей: чей он и откуда берётся.
 *
 * `Video.voiceoverVoiceId` заполнялся на каждый ролик отдельно, а пустое
 * значение уводило синтез на стоковый пресет спеки. При потоке в сотни роликов
 * это вопрос времени, когда на лицо конкретного человека ляжет голос
 * незнакомой женщины — и заметит это зритель, а не оператор.
 *
 * Голос принадлежит персонажу: клон обучен на ЕГО записи и осмыслен только
 * рядом с его лицом. Ролик наследует, оператор может перебить явно.
 */

/** Персонаж в том объёме, в каком его знает разрешение голоса. */
export interface PresenterVoiceCharacter {
  id: string
  name: string
  voiceId: string | null
  voiceModelId: string | null
}

export interface PresenterVoiceRequest {
  /** Явный выбор оператора на этот ролик. */
  requestedVoiceId?: string | null
  requestedModelId?: string | null
  character?: PresenterVoiceCharacter | null
}

export interface ResolvedPresenterVoice {
  voiceId: string | null
  modelId: string | null
  /** Откуда взято: нужен вызывающему, чтобы отличить «выбрали» от «не нашли». */
  source: "request" | "character" | "none"
}

function clean(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

/**
 * Голос и TTS-модель для ролика.
 *
 * Модель разрешается ОТДЕЛЬНО от голоса, и это не мелочь: клон обучен под
 * конкретную модель (`minimax/voice-cloning` принимает её параметром), и тот же
 * `voice_id` в другой модели просто не существует — платный запрос уйдёт в
 * никуда. Поэтому персонаж хранит пару, а не один идентификатор.
 */
export function resolvePresenterVoice(request: PresenterVoiceRequest): ResolvedPresenterVoice {
  const requestedVoice = clean(request.requestedVoiceId)
  const characterVoice = clean(request.character?.voiceId)
  const modelId = clean(request.requestedModelId) ?? clean(request.character?.voiceModelId)

  if (requestedVoice) return { voiceId: requestedVoice, modelId, source: "request" }
  if (characterVoice) return { voiceId: characterVoice, modelId, source: "character" }
  return { voiceId: null, modelId, source: "none" }
}

/**
 * Текст отказа. Отдельная функция, потому что сообщение — часть контракта:
 * оператор должен понять не «что-то не так», а что именно сделать.
 */
export function presenterVoiceMissingMessage(characterName: string): string {
  return `У ведущего «${characterName}» не задан голос, а в кадре он будет. `
    + "Склонируйте голос (scripts/clone-voice.ts) и пропишите его персонажу "
    + "либо выберите голос явно для этого ролика — иначе на его лицо ляжет чужой."
}
