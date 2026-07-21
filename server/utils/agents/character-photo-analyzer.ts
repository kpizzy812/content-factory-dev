/**
 * Character Photo / Scene Shot analyzer — vision-агент по образу screen-tagger.
 * Универсальный: один модуль обслуживает CharacterReferenceImage и SceneReferenceImage,
 * адаптируя promt под доменную задачу.
 *
 * Контракт: достаём bytes из storage (GCS) или legacy FS, base64, шлём в Anthropic
 * vision messages API, валидируем JSON, пишем aiTags + aiCaption + aiVisualDescription
 * + aiAnalyzedAt. aiAttempts инкрементится в любом случае (даже при провале) — иначе
 * fire-and-forget может бесконечно перезапускаться.
 *
 * aiVisualDescription — это та самая "EN-инжекция" в video prompt, ради которой делаются
 * референсы. composeScene склеит её в финальный prompt сцены, а pipeline шлёт референс
 * как image_url в kling-i2v / wan-i2v для consistent character / scene look.
 */
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { getStorageDriver } from '~~/server/utils/storage'
import { StorageError } from '~~/server/utils/storage/types'

const VISION_MAX_BYTES = 5 * 1024 * 1024

const CHARACTER_SYSTEM_PROMPT = `Ты — продюсер видеогенерации. Тебе показывают фотографию персонажа (лицо/тело/одежда/поза). Опиши его так, чтобы text-to-video AI смог воссоздать этого человека на всех кадрах.

Контролируемый словарь тегов (используй до 6 из списка + до 2 свободных):
- gender_male, gender_female, gender_nonbinary
- age_teen, age_young_adult, age_adult, age_senior
- hair_short, hair_long, hair_blonde, hair_brunette, hair_red, hair_black, hair_gray, hair_curly, hair_straight
- skin_light, skin_medium, skin_dark
- emotion_smile, emotion_neutral, emotion_serious, emotion_curious, emotion_surprised, emotion_focused
- outfit_casual, outfit_business, outfit_sport, outfit_streetwear, outfit_formal
- accessory_glasses, accessory_hat, accessory_jewelry
- pose_portrait, pose_full_body, pose_three_quarter, pose_action
- lighting_natural, lighting_studio, lighting_dramatic, lighting_soft

Правила:
- caption — 1-2 предложения на русском с описанием человека (для оператора).
- visualDescription — короткая (≤200 символов) английская строка для генератора видео: "30y woman, short brown hair, blue knitted sweater, friendly smile, natural lighting". Без лишних слов.

Ответь СТРОГО JSON-объектом без markdown:
{
  "tags": ["age_young_adult", "hair_short", "outfit_casual"],
  "caption": "Молодая женщина 25-30 лет с короткой стрижкой и улыбкой.",
  "visualDescription": "young woman, ..."
}`

const SCENE_SYSTEM_PROMPT = `Ты — продюсер видеогенерации. Тебе показывают эталонный кадр сцены — то, как должно получиться готовое видео по mood/lighting/композиции/локации. Опиши кадр так, чтобы text-to-video AI повторил атмосферу.

Контролируемый словарь тегов (используй до 6 + до 2 свободных):
- mood_warm, mood_cold, mood_cinematic, mood_dreamy, mood_energetic, mood_calm, mood_dramatic, mood_nostalgic
- lighting_natural, lighting_golden_hour, lighting_blue_hour, lighting_studio, lighting_neon, lighting_low_key, lighting_high_key
- palette_pastel, palette_vivid, palette_monochrome, palette_warm, palette_cool, palette_earth_tones
- location_indoor, location_outdoor, location_studio, location_urban, location_nature, location_home
- composition_close_up, composition_wide, composition_medium_shot, composition_over_shoulder, composition_pov, composition_birds_eye
- camera_handheld, camera_steady, camera_tracking, camera_dolly
- texture_film_grain, texture_clean_digital, texture_anamorphic, texture_vhs

Правила:
- caption — 1-2 предложения на русском с описанием кадра.
- visualDescription — английская строка ≤250 символов для генератора видео: "cinematic warm-tone shot, golden hour park, soft handheld camera, medium shot, film grain".

Ответь СТРОГО JSON-объектом без markdown:
{
  "tags": ["mood_cinematic", "lighting_golden_hour", "composition_medium_shot"],
  "caption": "Тёплый кинематографичный кадр в парке на закате.",
  "visualDescription": "cinematic warm-tone shot, ..."
}`

export type AnalyzerDomain = 'character' | 'scene'

export interface PhotoAnalysisResult {
  tags: string[]
  caption: string
  visualDescription: string
}

interface AnthropicVisionResponse {
  content: Array<{ type: string; text?: string }>
}

interface RefRow {
  id: string
  fileUrl: string
  storageKey: string | null
  mimeType: string | null
}

function detectMediaType(mimeType: string | null, fileUrl: string): string {
  if (mimeType) return mimeType
  const lower = fileUrl.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  return 'image/png'
}

async function loadBytes(ref: RefRow): Promise<Buffer> {
  if (ref.storageKey) {
    try {
      return await getStorageDriver().downloadToBuffer(ref.storageKey)
    } catch (err) {
      if (err instanceof StorageError && err.code === 'NOT_FOUND') {
        // fall through
      } else {
        throw err
      }
    }
  }
  // legacy fs fallback — file под /tmp или /app/storage; используем fileUrl basename
  const name = basename(ref.fileUrl)
  return readFile(`/app/storage/uploads/${name}`).catch(() => readFile(`./storage/uploads/${name}`))
}

function extractJson(text: string): unknown {
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = codeBlock ? codeBlock[1]!.trim() : text.trim()
  return JSON.parse(raw)
}

function validate(data: unknown): PhotoAnalysisResult {
  if (!data || typeof data !== 'object') throw new Error('photo-analyzer: ответ не объект')
  const d = data as Record<string, unknown>
  const tags = Array.isArray(d.tags)
    ? d.tags
        .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        .map(t => t.trim().toLowerCase().replace(/\s+/g, '_'))
        .slice(0, 8)
    : []
  const caption = typeof d.caption === 'string' && d.caption.trim() ? d.caption.trim().slice(0, 400) : ''
  const visualDescription = typeof d.visualDescription === 'string' && d.visualDescription.trim()
    ? d.visualDescription.trim().slice(0, 500)
    : ''
  if (!caption || !visualDescription) throw new Error('photo-analyzer: пустой caption/visualDescription')
  return { tags, caption, visualDescription }
}

async function callVision(domain: AnalyzerDomain, base64: string, mediaType: string): Promise<PhotoAnalysisResult> {
  requirePaidApisEnabled('Anthropic Claude API')
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY || ''
  if (!anthropicApiKey) {
    throw createError({ statusCode: 500, message: 'API-ключ Anthropic не настроен (ANTHROPIC_API_KEY)' })
  }
  const system = domain === 'character' ? CHARACTER_SYSTEM_PROMPT : SCENE_SYSTEM_PROMPT
  const userText = domain === 'character'
    ? 'Проанализируй фото персонажа по правилам. Верни строго JSON.'
    : 'Проанализируй эталонный кадр по правилам. Верни строго JSON.'

  const response = await $fetch<AnthropicVisionResponse>('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': anthropicApiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    timeout: 60_000,
    body: {
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
      max_tokens: 1024,
      system,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: userText },
          ],
        },
      ],
    },
  }).catch((err) => {
    const status = err?.response?.status || err?.statusCode
    if (status === 429) throw createError({ statusCode: 429, message: 'Anthropic rate-limit' })
    if (status && status >= 500) throw createError({ statusCode: 502, message: 'Anthropic временно недоступен' })
    throw createError({ statusCode: 502, message: `Anthropic vision error: ${err?.message || 'unknown'}` })
  })

  const textBlock = response.content.find(c => c.type === 'text')
  if (!textBlock?.text) throw new Error('photo-analyzer: пустой ответ Claude')
  return validate(extractJson(textBlock.text))
}

export async function analyzeCharacterPhoto(refId: string): Promise<PhotoAnalysisResult | null> {
  const ref = await prisma.characterReferenceImage.findUnique({ where: { id: refId } })
  if (!ref) throw new Error(`CharacterReferenceImage ${refId} не найдена`)
  await prisma.characterReferenceImage.update({
    where: { id: refId },
    data: { aiAttempts: { increment: 1 }, aiError: null },
  })
  try {
    const buf = await loadBytes(ref)
    if (buf.byteLength > VISION_MAX_BYTES) throw new Error(`Файл ${buf.byteLength} > ${VISION_MAX_BYTES}`)
    const mediaType = detectMediaType(ref.mimeType, ref.fileUrl)
    const result = await callVision('character', buf.toString('base64'), mediaType)
    await prisma.characterReferenceImage.update({
      where: { id: refId },
      data: {
        aiTags: result.tags,
        aiCaption: result.caption,
        aiVisualDescription: result.visualDescription,
        aiAnalyzedAt: new Date(),
        aiError: null,
        bytes: buf.byteLength,
        mimeType: mediaType,
      },
    })
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Неизвестная ошибка'
    await prisma.characterReferenceImage.update({
      where: { id: refId },
      data: { aiError: message.slice(0, 500) },
    })
    return null
  }
}

export async function analyzeScenePhoto(refId: string): Promise<PhotoAnalysisResult | null> {
  const ref = await prisma.sceneReferenceImage.findUnique({ where: { id: refId } })
  if (!ref) throw new Error(`SceneReferenceImage ${refId} не найдена`)
  await prisma.sceneReferenceImage.update({
    where: { id: refId },
    data: { aiAttempts: { increment: 1 }, aiError: null },
  })
  try {
    const buf = await loadBytes(ref)
    if (buf.byteLength > VISION_MAX_BYTES) throw new Error(`Файл ${buf.byteLength} > ${VISION_MAX_BYTES}`)
    const mediaType = detectMediaType(ref.mimeType, ref.fileUrl)
    const result = await callVision('scene', buf.toString('base64'), mediaType)
    await prisma.sceneReferenceImage.update({
      where: { id: refId },
      data: {
        aiTags: result.tags,
        aiCaption: result.caption,
        aiVisualDescription: result.visualDescription,
        aiAnalyzedAt: new Date(),
        aiError: null,
        bytes: buf.byteLength,
        mimeType: mediaType,
      },
    })
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Неизвестная ошибка'
    await prisma.sceneReferenceImage.update({
      where: { id: refId },
      data: { aiError: message.slice(0, 500) },
    })
    return null
  }
}

export function scheduleCharacterPhotoAnalysis(refId: string): void {
  analyzeCharacterPhoto(refId).catch(() => {})
}

export function scheduleScenePhotoAnalysis(refId: string): void {
  analyzeScenePhoto(refId).catch(() => {})
}
