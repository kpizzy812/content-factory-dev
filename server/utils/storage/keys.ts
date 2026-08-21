/**
 * Единые builders для storage keys. Никаких сырых строк в pipeline-коде —
 * всё через эти функции, иначе при ребрендинге префикса или изменении
 * структуры пути придётся искать по grep'ам.
 *
 * Video.id — Int (autoincrement), ключи `zavodcamp/videos/65/...`. Под
 * scenes используется `order` из VideoAsset (стабильный sceneIndex для
 * type=image|clip; для остальных типов order=0).
 */
import { STORAGE_PATH_PREFIX } from "./prefix-guard"

function vid(videoId: number | string): string {
  return String(videoId)
}

export const StorageKeys = {
  /** Финальный собранный mp4. Хранится в Video.storageKey, а не в VideoAsset. */
  videoFinal: (videoId: number | string): string =>
    `${STORAGE_PATH_PREFIX}videos/${vid(videoId)}/final.mp4`,

  /** Kling-сгенерированный клип сцены. order = VideoAsset.order (sceneIndex). */
  videoSceneClip: (videoId: number | string, sceneOrder: number): string =>
    `${STORAGE_PATH_PREFIX}videos/${vid(videoId)}/scenes/${sceneOrder}.mp4`,

  /** FLUX-сгенерированная картинка сцены (перед image-to-video). */
  videoSceneImage: (videoId: number | string, sceneOrder: number, ext = "png"): string =>
    `${STORAGE_PATH_PREFIX}videos/${vid(videoId)}/scenes/${sceneOrder}.${ext}`,

  /** Один TTS-сегмент. lineId — стабильный идентификатор реплики. */
  videoVoiceoverLine: (videoId: number | string, lineId: string): string =>
    `${STORAGE_PATH_PREFIX}videos/${vid(videoId)}/voiceover/${lineId}.mp3`,

  /** Финальный voiceover mix (после склейки сегментов). */
  videoVoiceoverMix: (videoId: number | string): string =>
    `${STORAGE_PATH_PREFIX}videos/${vid(videoId)}/voiceover_mix.mp3`,

  /** Фоновая музыка. */
  videoMusic: (videoId: number | string): string =>
    `${STORAGE_PATH_PREFIX}videos/${vid(videoId)}/music.mp3`,

  /** Постер (jpeg, 1 кадр). */
  videoThumbnail: (videoId: number | string): string =>
    `${STORAGE_PATH_PREFIX}videos/${vid(videoId)}/thumbnail.jpg`,

  /** Выровненный транскрипт озвучки (границы слов после сопоставления со сценарием). */
  videoTranscript: (videoId: number | string): string =>
    `${STORAGE_PATH_PREFIX}videos/${vid(videoId)}/transcript.json`,

  /** Превью-клип (например, 5s low-res). */
  videoPreview: (videoId: number | string): string =>
    `${STORAGE_PATH_PREFIX}videos/${vid(videoId)}/preview.mp4`,

  /** Lip-sync клип (заменяет соответствующий scene clip в pipeline'е). */
  videoLipSyncClip: (videoId: number | string, basename: string): string =>
    `${STORAGE_PATH_PREFIX}videos/${vid(videoId)}/lipsync/${basename}`,

  /** Durable copy of a temporary media-provider output. */
  mediaPredictionOutput: (predictionId: string, extension = "mp4"): string =>
    `${STORAGE_PATH_PREFIX}media-predictions/${predictionId}/output.${extension.replace(/^\./, "")}`,

  /** App reference image — dedup по sha1. Совпадает с существующей структурой
   *  storage/uploads/app-references/{appId}/{sha1}.{ext}, только под префиксом. */
  appReferenceImage: (appId: number | string, sha1: string, ext = "png"): string =>
    `${STORAGE_PATH_PREFIX}apps/${appId}/references/${sha1}.${ext}`,

  /** Character reference image (F1) — per-character папка с dedup по sha1 на уровне characterId.
   *  GCS path: `zavodcamp/apps/{appId}/characters/{characterId}/{sha1}.{ext}`. */
  characterReferenceImage: (appId: number | string, characterId: string, sha1: string, ext = "png"): string =>
    `${STORAGE_PATH_PREFIX}apps/${appId}/characters/${characterId}/${sha1}.${ext}`,
  /** Reusable presenter footage for provider-neutral lip-sync generation. */
  presenterSourceClip: (appId: number | string, characterId: string, sha1: string, ext = "mp4"): string =>
    `${STORAGE_PATH_PREFIX}apps/${appId}/characters/${characterId}/source-clips/${sha1}.${ext}`,

  /** Длинная запись ведущего целиком, нормализованная. Дедуп по sha1 ОРИГИНАЛА. */
  presenterRecording: (appId: number | string, characterId: string, sha1: string, ext = "mp4"): string =>
    `${STORAGE_PATH_PREFIX}apps/${appId}/characters/${characterId}/recordings/${sha1}.${ext}`,

  /** Scene reference image (F2) — эталонные кадры сцены композитора.
   *  GCS path: `zavodcamp/apps/{appId}/scenes/{sceneId}/refs/{sha1}.{ext}`. */
  sceneReferenceImage: (appId: number | string, sceneId: string, sha1: string, ext = "png"): string =>
    `${STORAGE_PATH_PREFIX}apps/${appId}/scenes/${sceneId}/refs/${sha1}.${ext}`,

  /** Unique variant (Track F) — детерминистический по paramsHash. */
  uniqueVariant: (videoId: number | string, platform: string, paramsHash: string): string =>
    `${STORAGE_PATH_PREFIX}unique-variants/${vid(videoId)}/${platform}_${paramsHash}.mp4`,

  /** Temp scratch (cleanup TTL 24h, lifecycle rule на bucket). */
  tempFile: (runId: string, filename: string): string =>
    `${STORAGE_PATH_PREFIX}temp/${runId}/${filename}`,

  // === Префиксы для cascade-операций ===

  videoPrefix: (videoId: number | string): string =>
    `${STORAGE_PATH_PREFIX}videos/${vid(videoId)}/`,

  appPrefix: (appId: number | string): string =>
    `${STORAGE_PATH_PREFIX}apps/${appId}/`,

  tempPrefix: (runId: string): string => `${STORAGE_PATH_PREFIX}temp/${runId}/`,

  uniqueVariantsPrefix: (videoId: number | string): string =>
    `${STORAGE_PATH_PREFIX}unique-variants/${vid(videoId)}/`,
}
