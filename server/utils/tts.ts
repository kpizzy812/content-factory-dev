/**
 * TTS Provider — синтез озвучки.
 *
 * Маршрут выбирает реестр спек (media-provider/registry), а не этот модуль:
 * основной путь — Replicate (minimax/speech-02-turbo), единственная подключённая
 * модель, которая произносит русский. Она идёт через prediction-service, поэтому
 * синтез идемпотентен и переживает рестарт.
 *
 * fal.ai — оставшийся с VideoCamp запасной путь через Queue API (FAL_KEY):
 *   - fal-ai/kokoro/american-english  (budget, open-source, только английский)
 *   - fal-ai/playai/tts/v3            (standard, multilingual)
 *   - fal-ai/elevenlabs/tts/turbo-v2.5 (premium, opt-in)
 *
 * Runtime behavior:
 *   - Accepts text + voice options, returns local audio file + real duration (probed).
 *   - Cost tracked per-call (character- or audio-second-based depending on model).
 *   - Fails loudly when the provider key is missing or the endpoint 403s (no silent fake-success).
 */

import { join } from 'node:path'
import ffmpeg from 'fluent-ffmpeg'
import { estimateMediaCost, resolveMediaModel, resolveSpecVoice } from './media-provider/registry'
import { runMediaTask } from './media-provider/run-media-task'
import { getModel, getDefaultTtsModel } from './video-models'
import type { ModelMeta } from './video-models'

export interface TtsSynthesisOptions {
  /** Text to synthesize (required) */
  text: string
  /** Absolute path for the resulting audio file (mp3/wav) */
  outputPath: string
  /** TTS model id from video-models registry. If null — default integrated model used. */
  modelId?: string | null
  /** Provider-specific voice id (overrides defaults). */
  voiceId?: string | null
  /** ISO language code hint (en / ru / ...) — used to pick defaults if voiceId missing. */
  language?: string
  /** Speaking pacing — maps to provider-specific speed parameter when supported. */
  pacing?: 'slow' | 'moderate' | 'fast'
  /** Emotional hint (для providers с expressivity) */
  emotion?: string | null
  /** Привязка prediction к видео — чтобы он удалялся вместе с ним. */
  videoId?: number | null
}

export interface TtsSynthesisResult {
  /** Local absolute path to the synthesized audio file */
  audioPath: string
  /** Duration in seconds (probed with ffprobe — trustworthy, not estimated) */
  durationSec: number
  /** Model used (id + name) */
  model: { id: string; name: string; provider: string }
  /** Voice id used for synthesis */
  voiceId: string
  /** Actual cost in USD */
  costUsd: number
  /** Remote URL returned by provider (for audit) */
  remoteUrl: string | null
  /** Character count sent to provider */
  characters: number
}

/**
 * Probe audio duration using ffprobe.
 */
export async function probeAudioDuration(path: string): Promise<number> {
  return new Promise<number>((resolve) => {
    ffmpeg.ffprobe(path, (err, metadata) => {
      if (err || !metadata?.format?.duration) {
        resolve(0)
        return
      }
      resolve(Math.round(metadata.format.duration * 100) / 100)
    })
  })
}

/**
 * Default voice for a given model + language.
 * Keeps provider quirks isolated here.
 */
function resolveDefaultVoice(modelId: string, language: string): string {
  const defaultVoiceEn = process.env.DEFAULT_TTS_VOICE_EN || 'af_heart'
  const defaultVoiceRu = process.env.DEFAULT_TTS_VOICE_RU || 'bf_emma'
  const lang = (language || 'en').toLowerCase()

  if (modelId === 'fal-ai/kokoro/american-english') {
    return defaultVoiceEn
  }
  if (modelId === 'fal-ai/kokoro/russian') {
    return defaultVoiceRu
  }
  if (modelId === 'fal-ai/playai/tts/v3') {
    return lang.startsWith('ru')
      ? 's3://voice-cloning-zero-shot/baf1ef41-36b6-428c-9bdf-50ba54682bd8/original/manifest.json'
      : 's3://voice-cloning-zero-shot/820da3f2-2b81-4a43-9ed3-4e1a2b7f2c34/original/manifest.json'
  }
  if (modelId === 'fal-ai/elevenlabs/tts/turbo-v2.5') {
    return 'Rachel'
  }
  return defaultVoiceEn
}

/**
 * Map pacing string to provider-specific speed value.
 */
function resolveSpeed(pacing: 'slow' | 'moderate' | 'fast' | undefined): number {
  switch (pacing) {
    case 'slow': return 0.85
    case 'fast': return 1.15
    case 'moderate':
    default: return 1.0
  }
}

/**
 * Build provider-specific request payload.
 */
function buildProviderInput(
  modelId: string,
  text: string,
  voiceId: string,
  pacing: 'slow' | 'moderate' | 'fast' | undefined,
): Record<string, unknown> {
  const speed = resolveSpeed(pacing)

  if (modelId.startsWith('fal-ai/kokoro')) {
    return {
      prompt: text,
      voice: voiceId,
      speed,
    }
  }
  if (modelId === 'fal-ai/playai/tts/v3') {
    return {
      input: text,
      voice: voiceId,
      response_format: 'mp3',
      // PlayAI "speed" range: 0.5-2.0
      speed,
    }
  }
  if (modelId === 'fal-ai/elevenlabs/tts/turbo-v2.5') {
    return {
      text,
      voice: voiceId,
      stability: 0.5,
      similarity_boost: 0.75,
    }
  }
  // Generic fallback — best-guess shape
  return { prompt: text, voice: voiceId, speed }
}

/**
 * Extract audio URL from a heterogeneous provider response.
 */
function extractAudioUrl(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>

  // Kokoro / PlayAI / ElevenLabs: { audio: { url } }
  const audio = r.audio
  if (audio && typeof audio === 'object') {
    const a = audio as Record<string, unknown>
    if (typeof a.url === 'string') return a.url
  }
  // Some endpoints: { audio_url }
  if (typeof r.audio_url === 'string') return r.audio_url
  // Some endpoints: { output: { audio: { url } } }
  const output = r.output
  if (output && typeof output === 'object') {
    const o = output as Record<string, unknown>
    const oAudio = o.audio
    if (oAudio && typeof oAudio === 'object' && typeof (oAudio as Record<string, unknown>).url === 'string') {
      return (oAudio as Record<string, unknown>).url as string
    }
  }
  // Top-level url
  if (typeof r.url === 'string') return r.url
  return null
}

/**
 * Compute actual cost for a synthesis call based on model pricing unit.
 */
function computeSynthesisCost(model: ModelMeta, characters: number, durationSec: number): number {
  const unit = model.pricing.unit
  if (unit === 'character') {
    return characters * model.pricing.base
  }
  if (unit === 'audio_second') {
    return durationSec * model.pricing.base
  }
  // Fallback: per-call
  return model.pricing.base
}

/**
 * Главная функция — синтезирует аудио одной фразы.
 * Бросает ошибку если:
 *   - FAL_KEY отсутствует
 *   - TTS модель не integrated
 *   - Провайдер вернул не-audio
 *   - Текст пустой
 */
export async function synthesizeSpeech(options: TtsSynthesisOptions): Promise<TtsSynthesisResult> {
  const text = (options.text || '').trim()
  if (!text) {
    throw new Error('TTS synthesis: empty text')
  }

  // Resolve model
  let model: ModelMeta | null = null
  if (options.modelId) {
    const m = getModel(options.modelId)
    if (!m || m.task !== 'tts') {
      throw new Error(`TTS synthesis: "${options.modelId}" не TTS модель`)
    }
    if (!m.integrated) {
      throw new Error(`TTS модель "${m.name}" не подключена к pipeline (integrated=false)`)
    }
    model = m
  } else {
    model = getDefaultTtsModel()
  }
  if (!model) {
    throw new Error('TTS synthesis: нет доступных TTS моделей в реестре')
  }

  // Спека способности вместо самодельных buildProviderInput / resolveDefaultVoice /
  // extractAudioUrl: payload, голос по умолчанию, разбор выхода и таймаут лежат
  // в одной записи реестра. Витрина `ModelMeta` остаётся источником правил
  // выбора модели (integrated / task), поэтому спека ищется по её id.
  //
  // Ветвления «Replicate идёт своим путём» здесь больше нет: маршрут выбирает
  // `spec.execution`, а не подстрока «replicate» в имени провайдера витрины.
  const spec = resolveMediaModel('text_to_speech', model.id)
  const language = options.language || 'en'
  const voiceId = options.voiceId
    || resolveSpecVoice(spec, language)
    || resolveDefaultVoice(model.id, language)

  // Ретраи прежние (3 попытки с backoff). Таймаут ОДНОЙ попытки берётся из
  // спеки способности, а не из локальной константы 4 минуты: у TTS собственная
  // длительность работы, и держать её в коде шага — ровно та связка модели с
  // бизнес-логикой, от которой мы уходим. Pipeline #17 завис именно на TTS без
  // таймаута — сам механизм остаётся на месте.
  const task = await runMediaTask({
    capability: 'text_to_speech',
    spec,
    input: {
      text,
      voiceId,
      speed: resolveSpeed(options.pacing),
      language,
      format: 'mp3',
      emotion: options.emotion ?? null,
    },
    // Без videoId prediction не привязан к ролику и не удалится вместе с ним;
    // у моделей на async_prediction это ещё и условие переиспользования уровня 2.
    videoId: options.videoId ?? null,
    unitKey: `tts:${model.id}`,
    outputPath: options.outputPath,
    retry: {
      maxRetries: 3,
      initialBackoffMs: 3000,
      label: `TTS ${model.id} (${text.length} chars)`,
    },
  })

  const remoteUrl = task.remoteUrl

  // Probe real duration — critical для reconciliation, не доверяемся estimate
  const durationSec = await probeAudioDuration(options.outputPath)
  if (durationSec <= 0) {
    throw new Error(`TTS ${model.id}: скачанный аудиофайл невалиден (duration=0)`)
  }

  const characters = text.length
  // Цена по спеке того, кто реально исполнял: audio_second — по фактической
  // длительности, character — по числу символов. Числа те же, что и раньше,
  // но живут они теперь в одном месте с моделью.
  const costUsd = estimateMediaCost(spec, { characters, audioSeconds: durationSec })

  return {
    audioPath: options.outputPath,
    durationSec,
    model: { id: model.id, name: model.name, provider: model.provider },
    voiceId,
    costUsd,
    remoteUrl,
    characters,
  }
}

/**
 * Собирает per-scene audio клипы в единый voiceover track:
 *   clip_1.mp3 (scene duration padded) + silence (pauseAfter) + clip_2.mp3 + ...
 * Возвращает путь к смиксованному .mp3 и его фактическую длительность.
 *
 * Важно: этот трек уже имеет timing выравненный под scene boundaries —
 * финальный FFmpeg просто микширует его с clip audio + music.
 */
export async function buildVoiceoverTrack(options: {
  scenes: Array<{
    sceneOrder: number
    audioPath: string
    /** Start time of this scene in the final video timeline (sec) */
    sceneStartSec: number
    /** Voiceover duration (from ffprobe) */
    voiceoverDurationSec: number
    /** Allotted scene slot duration — для padding (если vo короче scene) */
    sceneDurationSec: number
  }>
  outputPath: string
  /** Total timeline duration — track будет padded до этого */
  totalDurationSec: number
}): Promise<{ audioPath: string; durationSec: number }> {
  const { scenes, outputPath, totalDurationSec } = options

  if (scenes.length === 0) {
    throw new Error('buildVoiceoverTrack: no scenes to mix')
  }

  // Strategy: создаём один FFmpeg complex filter, который:
  //   [i:a] adelay=<sceneStart*1000>|<sceneStart*1000> — сдвигает каждую фразу на её scene start
  //   amix всех сдвинутых треков с normalize=0
  //   apad=pad_dur=... — дотягивает до totalDurationSec

  return new Promise((resolve, reject) => {
    let command = ffmpeg()
    for (const s of scenes) {
      command = command.input(s.audioPath)
    }

    const filters: string[] = []
    const mixedLabels: string[] = []

    for (let i = 0; i < scenes.length; i++) {
      const s = scenes[i]!
      const delayMs = Math.max(0, Math.round(s.sceneStartSec * 1000))
      const label = `v${i}`
      // adelay expects same delay for each channel (stereo: "ms|ms")
      filters.push(`[${i}:a]adelay=${delayMs}|${delayMs},apad[${label}]`)
      mixedLabels.push(`[${label}]`)
    }

    const totalMs = Math.ceil(totalDurationSec * 1000)
    // amix normalize=0 — сохраняем исходную громкость каждого сегмента
    filters.push(`${mixedLabels.join('')}amix=inputs=${scenes.length}:normalize=0:duration=longest,atrim=0:${totalDurationSec.toFixed(2)},asetpts=N/SR/TB[aout]`)

    command
      .complexFilter(filters, ['aout'])
      .outputOptions([
        '-c:a', 'libmp3lame',
        '-b:a', '192k',
        '-y',
        '-t', totalDurationSec.toFixed(2),
      ])
      .output(outputPath)
      .on('end', async () => {
        const duration = await probeAudioDuration(outputPath)
        resolve({ audioPath: outputPath, durationSec: duration })
      })
      .on('error', (err) => {
        reject(new Error(`Voiceover track mix failed: ${err.message}`))
      })
      .run()
  })
}
