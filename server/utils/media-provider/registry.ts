/**
 * Реестр медиамоделей: поиск спеки и выбор маршрута способности.
 *
 * Маршрут выбирается в одном месте и по явным правилам (§3.3 спецификации):
 * явный запрос → env-дефолт способности → первая integrated модель. Провайдер
 * берётся из поля спеки, а не угадывается по префиксу id и не задаётся
 * глобальным флагом.
 *
 * Фолбэк — это КОНКРЕТНАЯ спека той же способности со своим маппером и своей
 * ценой. Нет такой спеки — `fallback: null`, и раннер обязан честно упасть,
 * а не слепо сабмитить чужой payload.
 */

import { estimateMediaCost } from "./billing"
import { MEDIA_MODEL_SPECS } from "./model-specs"
import type {
  MapContext,
  MediaCapability,
  MediaInputFor,
  MediaModelSpec,
  MediaProviderName,
  MediaSpecFor,
  MediaTaskInput,
} from "./types"

type Env = Record<string, string | undefined>

export interface MediaRoute<C extends MediaCapability = MediaCapability> {
  primary: MediaSpecFor<C>
  fallback: MediaSpecFor<C> | null
}

export const MEDIA_CAPABILITIES: readonly MediaCapability[] = Object.freeze([
  "lip_sync",
  "text_to_image",
  "text_to_video",
  "image_to_video",
  "text_to_speech",
])

const CAPABILITY_SET = new Set<string>(MEDIA_CAPABILITIES)

const PROVIDER_NAMES: readonly MediaProviderName[] = Object.freeze(["replicate", "fal"])

/**
 * Переменные окружения с дефолтом способности. Для lip-sync поддержан прежний
 * `REPLICATE_DEFAULT_LIPSYNC_MODEL` — он уже прописан на стендах, и ломать его
 * ради единообразия имени нельзя.
 */
const ENV_MODEL_KEYS: Record<MediaCapability, readonly string[]> = Object.freeze({
  lip_sync: Object.freeze(["MEDIA_MODEL_LIP_SYNC", "REPLICATE_DEFAULT_LIPSYNC_MODEL"]),
  text_to_image: Object.freeze(["MEDIA_MODEL_TEXT_TO_IMAGE"]),
  text_to_video: Object.freeze(["MEDIA_MODEL_TEXT_TO_VIDEO"]),
  image_to_video: Object.freeze(["MEDIA_MODEL_IMAGE_TO_VIDEO"]),
  text_to_speech: Object.freeze(["MEDIA_MODEL_TEXT_TO_SPEECH"]),
})

/** По-способностный override резерва поверх общего MEDIA_PROVIDER_FALLBACK. */
const ENV_FALLBACK_KEYS: Record<MediaCapability, string> = Object.freeze({
  lip_sync: "MEDIA_PROVIDER_FALLBACK_LIP_SYNC",
  text_to_image: "MEDIA_PROVIDER_FALLBACK_TEXT_TO_IMAGE",
  text_to_video: "MEDIA_PROVIDER_FALLBACK_TEXT_TO_VIDEO",
  image_to_video: "MEDIA_PROVIDER_FALLBACK_IMAGE_TO_VIDEO",
  text_to_speech: "MEDIA_PROVIDER_FALLBACK_TEXT_TO_SPEECH",
})

const BY_REGISTRY_KEY = new Map<string, MediaModelSpec>(
  MEDIA_MODEL_SPECS.map(spec => [spec.registryKey, spec]),
)
const BY_PROVIDER_ID = new Map<string, MediaModelSpec>(
  MEDIA_MODEL_SPECS.map(spec => [`${spec.provider}:${spec.id}`, spec]),
)
const BY_ID = new Map<string, MediaModelSpec>(
  MEDIA_MODEL_SPECS.map(spec => [spec.id, spec]),
)

/** Все спеки способности в порядке объявления (порядок задаёт дефолты и витрину). */
export function listMediaSpecs(capability?: MediaCapability): readonly MediaModelSpec[] {
  if (!capability) return MEDIA_MODEL_SPECS
  return MEDIA_MODEL_SPECS.filter(spec => spec.capability === capability)
}

/**
 * Поиск спеки по любой из форм записи: внутренний ключ (`fal:flux-dev`),
 * `провайдер:id` (`replicate:kwaivgi/kling-lip-sync`) или голый id провайдера
 * (`fal-ai/flux/dev`) — последнее нужно, потому что в БД у роликов уже лежат
 * именно голые id моделей.
 */
export function findMediaSpec(reference: string | null | undefined): MediaModelSpec | undefined {
  const normalized = reference?.trim()
  if (!normalized) return undefined
  return BY_REGISTRY_KEY.get(normalized)
    ?? BY_PROVIDER_ID.get(normalized)
    ?? BY_ID.get(normalized)
}

function assertKnownCapability(capability: MediaCapability): void {
  if (!CAPABILITY_SET.has(capability)) {
    throw new Error(`Unsupported media capability: ${String(capability)}`)
  }
}

function specForCapability(
  capability: MediaCapability,
  reference: string,
): MediaModelSpec {
  const spec = findMediaSpec(reference)
  if (!spec || spec.capability !== capability) {
    throw new Error(`Unsupported media model for ${capability}: ${reference}`)
  }
  return spec
}

function readEnvDefault(capability: MediaCapability, env: Env): string | null {
  for (const key of ENV_MODEL_KEYS[capability]) {
    const value = env[key]?.trim()
    if (value) return value
  }
  return null
}

function readFallbackProvider(capability: MediaCapability, env: Env): MediaProviderName | null {
  const raw = env[ENV_FALLBACK_KEYS[capability]]?.trim() || env.MEDIA_PROVIDER_FALLBACK?.trim()
  if (!raw) return null
  if (!PROVIDER_NAMES.includes(raw as MediaProviderName)) {
    throw new Error(`MEDIA_PROVIDER_FALLBACK must be empty or one of: ${PROVIDER_NAMES.join(", ")}`)
  }
  return raw as MediaProviderName
}

/**
 * Резерв той же способности у другого провайдера. Требование `integrated`
 * здесь НЕ применяется намеренно: fal-резерв lip-sync не подключён как
 * основной маршрут, но именно он отрабатывает при исчерпании попыток Replicate.
 */
function pickFallbackSpec(
  capability: MediaCapability,
  primary: MediaModelSpec,
  provider: MediaProviderName | null,
): MediaModelSpec | null {
  if (!provider || provider === primary.provider) return null
  const candidates = MEDIA_MODEL_SPECS.filter(
    spec => spec.capability === capability
      && spec.provider === provider
      && spec.registryKey !== primary.registryKey,
  )
  return candidates.find(spec => spec.integrated) ?? candidates[0] ?? null
}

export function resolveMediaRoute<C extends MediaCapability>(
  capability: C,
  requestedId?: string | null,
  env: Env = process.env,
): MediaRoute<C> {
  assertKnownCapability(capability)

  const requested = requestedId?.trim()
  let primary: MediaModelSpec
  if (requested) {
    primary = specForCapability(capability, requested)
  } else {
    const envDefault = readEnvDefault(capability, env)
    if (envDefault) {
      primary = specForCapability(capability, envDefault)
    } else {
      const integrated = MEDIA_MODEL_SPECS.find(
        spec => spec.capability === capability && spec.integrated,
      )
      if (!integrated) {
        throw new Error(`No integrated media model registered for ${capability}`)
      }
      primary = integrated
    }
  }

  const fallback = pickFallbackSpec(capability, primary, readFallbackProvider(capability, env))
  return {
    primary: primary as unknown as MediaSpecFor<C>,
    fallback: fallback as unknown as MediaSpecFor<C> | null,
  }
}

/**
 * Прежний API выбора модели — основной маршрут способности.
 * Используется lip-sync-контуром; новый код берёт `resolveMediaRoute`,
 * потому что ему нужен ещё и резерв.
 */
export function resolveMediaModel<C extends MediaCapability>(
  capability: C,
  modelId?: string | null,
): MediaSpecFor<C> {
  return resolveMediaRoute(capability, modelId).primary
}

/**
 * Маппинг нормализованного входа в payload провайдера.
 * Возвращает только payload — вызывающим, которым нужна фактическая
 * длительность после квантования, следует звать `spec.mapInput` напрямую.
 */
export function mapMediaInput<S extends MediaModelSpec>(
  spec: S,
  input: MediaInputFor<S["capability"]>,
  ctx?: MapContext,
): Record<string, unknown> {
  const mapper = spec.mapInput as (
    value: MediaTaskInput,
    context?: MapContext,
  ) => { payload: Record<string, unknown> }
  return mapper(input, ctx).payload
}

/**
 * Голос по умолчанию для TTS-спеки. Переменные DEFAULT_TTS_VOICE_EN /
 * DEFAULT_TTS_VOICE_RU сохранены ради совместимости с прежним
 * `resolveDefaultVoice` (`tts.ts:77-97`).
 */
export function resolveSpecVoice(
  spec: MediaModelSpec,
  language?: string | null,
  env: Env = process.env,
): string | null {
  if (!spec.voices) return null
  const override = spec.voices.envOverrideKey ? env[spec.voices.envOverrideKey]?.trim() : undefined
  if (override) return override

  const lang = (language || "en").toLowerCase()
  const byLanguage = spec.voices.byLanguage
  if (byLanguage) {
    const exact = Object.keys(byLanguage).find(key => lang.startsWith(key.toLowerCase()))
    if (exact) return byLanguage[exact]!
  }
  return spec.voices.default
}

export { estimateMediaCost }
export { requireSingleOutputUrl } from "./output"
