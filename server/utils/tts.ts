/**
 * TTS Provider — синтез озвучки.
 *
 * Основной путь — Replicate (minimax/speech-02-turbo): единственный из подключённых,
 * кто произносит русский. Идёт через prediction-service, поэтому идемпотентен и
 * переживает рестарт; см. server/utils/media-provider/tts.ts.
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
import { falRequest } from './fal'
import { withTimeoutAndRetry } from './external-call'
import { downloadFile } from './video-helpers'
import { getModel, getDefaultTtsModel } from './video-models'
import type { ModelMeta } from './video-models'
import { runReplicateTts } from './media-provider/tts'

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

/** Модели Replicate идут своим путём — по ним нельзя ходить в fal Queue API. */
function isReplicateModel(model: ModelMeta): boolean {
  return model.provider.toLowerCase().includes('replicate')
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

  // Replicate — основной путь. Свои голоса, свой формат входа, свой контур
  // predictions, поэтому уходим в адаптер целиком, а не через fal Queue API.
  if (isReplicateModel(model)) {
    const synthesis = await runReplicateTts({
      text,
      outputPath: options.outputPath,
      language: options.language || 'en',
      voiceId: options.voiceId,
      speed: resolveSpeed(options.pacing),
      emotion: options.emotion,
      modelId: model.id,
      videoId: options.videoId ?? null,
    })

    const durationSec = await probeAudioDuration(synthesis.audioPath)
    if (durationSec <= 0) {
      throw new Error(`TTS ${model.id}: скачанный аудиофайл невалиден (duration=0)`)
    }

    return {
      audioPath: synthesis.audioPath,
      durationSec,
      model: { id: model.id, name: model.name, provider: model.provider },
      voiceId: synthesis.voiceId,
      costUsd: synthesis.costUsd,
      remoteUrl: null,
      characters: synthesis.characters,
    }
  }

  const voiceId = options.voiceId || resolveDefaultVoice(model.id, options.language || 'en')
  const input = buildProviderInput(model.id, text, voiceId, options.pacing)

  // Submit via fal.ai queue API — использует FAL_KEY + enablePaidApis guard.
  // Hard timeout 4 минуты per attempt, 3 попытки: TTS обычно занимает 5-15 секунд,
  // 4 минуты с запасом на queue latency. Pipeline #17 завис именно на TTS Scene 5 без
  // timeout — теперь даже если fal.ai зависает, retry даёт второй шанс, и общий
  // upper bound = ~14 минут (3 × 4 мин + backoffs) вместо forever.
  const result = await withTimeoutAndRetry<Record<string, unknown>>(
    () => falRequest<Record<string, unknown>>(model.id, input),
    {
      label: `TTS ${model.id} (${text.length} chars)`,
      timeoutMs: 4 * 60 * 1000,
      maxRetries: 3,
      initialBackoffMs: 3000,
      onRetry: (attempt, err, delayMs) => {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`[tts] ${model?.id} attempt ${attempt} failed: ${msg}. Retry in ${delayMs}ms`)
      },
    },
  )

  const remoteUrl = extractAudioUrl(result)
  if (!remoteUrl) {
    throw new Error(`TTS ${model.id}: провайдер не вернул audio URL (response: ${JSON.stringify(result).slice(0, 300)})`)
  }

  // Download audio → local path
  await downloadFile(remoteUrl, options.outputPath)

  // Probe real duration — critical для reconciliation, не доверяемся estimate
  const durationSec = await probeAudioDuration(options.outputPath)
  if (durationSec <= 0) {
    throw new Error(`TTS ${model.id}: скачанный аудиофайл невалиден (duration=0)`)
  }

  const characters = text.length
  const costUsd = computeSynthesisCost(model, characters, durationSec)

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
