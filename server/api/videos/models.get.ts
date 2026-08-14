/**
 * GET /api/videos/models
 *
 * Возвращает доступные модели для video generation.
 * Включает реальную проверку доступности через fal.ai probe.
 * Используется VideoConfig.vue для model selectors.
 */
import {
  IMAGE_MODELS,
  VIDEO_MODELS,
  MUSIC_MODELS,
  TTS_MODELS,
  getDefaultImageModel,
  getDefaultVideoModel,
  getDefaultTtsModel,
} from "~~/server/utils/video-models"
import type { ModelMeta } from "~~/server/utils/video-models"
import { falProbeAccessBatch } from "~~/server/utils/fal"
import type { ModelAccessStatus } from "~~/shared/types/video"

async function enrichWithAccess(
  models: ModelMeta[],
): Promise<Array<{ accessStatus: ModelAccessStatus; accessReason: string }>> {
  // Проверяем доступ только для integrated моделей (у неинтегрированных — unsupported_by_runtime)
  const integratedEndpoints = models.filter(m => m.integrated).map(m => m.id)

  const accessMap = integratedEndpoints.length > 0
    ? await falProbeAccessBatch(integratedEndpoints)
    : new Map()

  return models.map((m) => {
    if (!m.integrated) {
      return {
        accessStatus: "unsupported_by_runtime" as ModelAccessStatus,
        accessReason: "Модель не подключена к pipeline",
      }
    }
    const probe = accessMap.get(m.id)
    return {
      accessStatus: probe?.status ?? "probe_error",
      accessReason: probe?.reason ?? "Не удалось проверить доступ",
    }
  })
}

export default defineEventHandler(async () => {
  const [imageAccess, videoAccess, musicAccess, ttsAccess] = await Promise.all([
    enrichWithAccess(IMAGE_MODELS),
    enrichWithAccess(VIDEO_MODELS),
    enrichWithAccess(MUSIC_MODELS),
    enrichWithAccess(TTS_MODELS),
  ])

  return {
    // Дефолты отдаёт сервер, а не угадывает форма: и создание ролика
    // (`videos/generate.post.ts`), и исполнитель ноды (`pipeline-executors.ts`)
    // берут ровно эти модели. Пока фронт держал их литералами, подсветка
    // выбранной модели и смета расходились с тем, что реально запускалось.
    defaults: {
      image: getDefaultImageModel().id,
      video: getDefaultVideoModel().id,
      tts: getDefaultTtsModel()?.id ?? null,
    },
    image: IMAGE_MODELS.map((m: ModelMeta, i: number) => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
      tier: m.tier,
      integrated: m.integrated,
      accessStatus: imageAccess[i]!.accessStatus,
      accessReason: imageAccess[i]!.accessReason,
      strengths: m.strengths,
      tradeoffs: m.tradeoffs,
      avgGenerationTime: m.avgGenerationTime,
      pricing: {
        unit: m.pricing.unit,
        base: m.pricing.base,
      },
    })),
    video: VIDEO_MODELS.map((m: ModelMeta, i: number) => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
      tier: m.tier,
      integrated: m.integrated,
      accessStatus: videoAccess[i]!.accessStatus,
      accessReason: videoAccess[i]!.accessReason,
      strengths: m.strengths,
      tradeoffs: m.tradeoffs,
      avgGenerationTime: m.avgGenerationTime,
      durationRange: m.durationRange,
      durationOptions: m.durationOptions,
      pricing: {
        unit: m.pricing.unit,
        base: m.pricing.base,
        withAudio: m.pricing.withAudio,
      },
    })),
    music: MUSIC_MODELS.map((m: ModelMeta, i: number) => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
      tier: m.tier,
      integrated: m.integrated,
      accessStatus: musicAccess[i]!.accessStatus,
      accessReason: musicAccess[i]!.accessReason,
      pricing: {
        unit: m.pricing.unit,
        base: m.pricing.base,
      },
    })),
    tts: TTS_MODELS.map((m: ModelMeta, i: number) => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
      tier: m.tier,
      integrated: m.integrated,
      accessStatus: ttsAccess[i]!.accessStatus,
      accessReason: ttsAccess[i]!.accessReason,
      strengths: m.strengths,
      tradeoffs: m.tradeoffs,
      avgGenerationTime: m.avgGenerationTime,
      pricing: {
        unit: m.pricing.unit,
        base: m.pricing.base,
      },
    })),
  }
})
