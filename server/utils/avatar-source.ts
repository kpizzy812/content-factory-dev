/**
 * AI-аватар: сцена, где ведущего не снимали.
 *
 * Ведущая в ролике собирается из фрагментов реальной съёмки — библиотека
 * исходников описана в `docs/operations/presenter-library.md`. Но персонаж не
 * обязан быть снятым человеком: если библиотека пуста, а у персонажа есть
 * портрет, сцену снимает аватар.
 *
 * Способ — `speech_to_video`: портрет плюс готовое TTS-аудио, на выходе сразу
 * говорящее видео со звуком. Прежняя схема (оживить портрет через
 * `image_to_video`, потом натянуть губы через `lip_sync`) стоила два платных
 * вызова и генерировала движение ДО того, как известно, что человек говорит —
 * разбор в `docs/superpowers/specs/2026-08-14-avatar-pipeline.md` §1.
 *
 * Оплата и идемпотентность общие для всех способностей: повторный прогон той
 * же сцены не создаёт новой платной задачи.
 */

import { resolveMediaRoute } from "./media-provider/registry"
import { runMediaTask } from "./media-provider/run-media-task"
import {
  detectReferenceMediaType,
  type ResolvedReferenceFrame,
} from "./media-provider/reference-frame"
import { materializeReferenceFrame } from "./media-provider/reference-frame-repository"
import { DEFAULT_SIMILARITY_THRESHOLD, hammingDistance } from "./presenter/perceptual-hash"
import { prisma } from "./prisma"
import { StorageKeys } from "./storage/keys"

/** Кадр персонажа в том виде, в каком он лежит в БД. */
export interface CharacterPortraitCandidate {
  id: string
  kind: string
  order: number
  storageKey: string | null
  fileUrl: string
  mimeType: string | null
  usageCount: number
  lastUsedAt: Date | null
}

export interface AvatarClipRequest {
  characterId: string
  videoId: number
  stepId: number
  unitKey: string
  sceneOrder: number
  /** Локальный файл готовой речи сцены. Он же диктует длину клипа. */
  audioPath: string
  /** Длина аудио в секундах — по ней считаются деньги и таймлайн. */
  durationSec: number
  /** Формат кадра ролика: спека сводит к разрешению своей модели. */
  resolution: string
  outputPath: string
  workDir: string
  /** Поведение в кадре; модели без такого поля промпт игнорируют. */
  prompt?: string
  /** Портреты, уже занятые сценами этого прогона: ротация внутри ролика. */
  usedPortraitIds?: readonly string[]
}

export interface AvatarClipResult {
  path: string
  costUsd: number
  provider: string
  modelId: string
  portraitId: string
  effectiveDurationSec: number
  /** dHash первого кадра. null — ffmpeg не отдал кадр, это диагностика. */
  frameHash: string | null
  /** Снят заново (оплачен) или взят из готового результата. */
  generated: boolean
}

/** Откуда берётся картинка для сцены, где ведущий говорит в кадре. */
export type PresenterSourceStrategy = "library" | "avatar" | "generated" | "none"

/**
 * Порядок выбора исходника (spec 2026-08-14-avatar-pipeline §3.2).
 *
 * Живая съёмка первая: кадры уже сняты и оплачены, синтезировать их заново
 * незачем. Аватар опережает сгенерированный клип, потому что сцена размечена
 * `spokenLine` — в ней говорит человек, а клип из text-to-video покажет что
 * угодно, только не его.
 */
export function planPresenterSourceStrategy(input: {
  hasLibraryClip: boolean
  hasPortrait: boolean
  hasGeneratedClip: boolean
}): PresenterSourceStrategy {
  if (input.hasLibraryClip) return "library"
  if (input.hasPortrait) return "avatar"
  if (input.hasGeneratedClip) return "generated"
  return "none"
}

/**
 * Выбирает кадр, который годится в lip-sync.
 *
 * Приоритет у портрета лица: модель синхронизирует губы, и на кадре в полный
 * рост синхронизировать нечего. Дальше — ротация: наименее использованный, при
 * равенстве тот, кого дольше не брали. Без ротации выбор детерминирован, один
 * кадр уходит во все сцены и все ролики, и получается ровно тот дубль, который
 * `docs/PROJECT_CONTEXT.md` §7 описывает как «меняются только губы и субтитры».
 *
 * `exclude` — портреты, уже занятые в этом же прогоне: счётчик в БД растёт
 * только после сцены, а сцены выбираются подряд, и без этого списка ротация
 * внутри одного ролика не работала бы вовсе. Если исключить нечего (портрет
 * один), он берётся повторно — сцена без картинки хуже, чем повтор кадра.
 *
 * Референс без доставляемого файла отбрасывается — платить за пустой вход нельзя.
 */
export function pickAvatarPortrait(
  candidates: readonly CharacterPortraitCandidate[],
  options?: { exclude?: readonly string[] },
): CharacterPortraitCandidate | null {
  const deliverable = candidates.filter(candidate =>
    !!candidate.storageKey || /^https?:\/\//i.test(candidate.fileUrl))
  if (deliverable.length === 0) return null

  const excluded = new Set(options?.exclude ?? [])
  const pool = deliverable.filter(candidate => !excluded.has(candidate.id))
  const sorted = [...(pool.length > 0 ? pool : deliverable)].sort(compareAvatarPortraits)
  return sorted[0] ?? null
}

function compareAvatarPortraits(
  a: CharacterPortraitCandidate,
  b: CharacterPortraitCandidate,
): number {
  const faceFirst = Number(b.kind === "face") - Number(a.kind === "face")
  if (faceFirst !== 0) return faceFirst

  const byUsage = a.usageCount - b.usageCount
  if (byUsage !== 0) return byUsage

  // Ни разу не использованный идёт раньше любого использованного.
  const aLast = a.lastUsedAt?.getTime() ?? -1
  const bLast = b.lastUsedAt?.getTime() ?? -1
  if (aLast !== bLast) return aLast - bLast

  return a.order - b.order
}

/**
 * Промпт поведения в кадре.
 *
 * Перебирать заготовки микро-движений больше не нужно: в `speech_to_video`
 * мимика и пластика выводятся из самой речи. Промпт описывает, КАК держится
 * человек и о чём говорит сцена, а не какими движениями различать клипы.
 *
 * Модели без поля промпта (fabric-1.0, omni-human) его игнорируют — маппер
 * спеки просто не кладёт его в payload.
 */
export function buildAvatarClipPrompt(
  character: { name: string, visualPrompt?: string | null },
  sceneMood?: string | null,
): string {
  return [
    character.visualPrompt?.trim(),
    "speaking to the camera, natural expression, mouth visible and unobstructed",
    sceneMood?.trim(),
    "static camera, fixed framing",
  ].filter(Boolean).join(", ")
}

export interface AvatarClipFrameRecord {
  sceneIndex: number
  hash: string
}

/**
 * Ищет сцену этого же ролика, чей аватарный кадр повторяет переданный.
 *
 * Гейт уникальности (`quality/video-uniqueness.ts`) сравнивает готовый ролик с
 * прошлыми публикациями и по устройству не видит, что внутри одного ролика все
 * сцены показывают один и тот же кадр. Это второй контроль, ближе к месту, где
 * кадр появляется.
 *
 * Негодный хеш — не повод падать: он считается ffmpeg'ом и может не посчитаться.
 * Тогда проверка молча отвечает «дубля не нашли», а решение остаётся за гейтом.
 */
export function findSimilarAvatarClip(
  hash: string,
  seen: readonly AvatarClipFrameRecord[],
  threshold: number = DEFAULT_SIMILARITY_THRESHOLD,
): { sceneIndex: number, distance: number } | null {
  for (const record of seen) {
    try {
      const distance = hammingDistance(hash, record.hash)
      if (distance <= threshold) return { sceneIndex: record.sceneIndex, distance }
    }
    catch {
      // Один негодный хеш в истории не отменяет проверку остальных.
    }
  }
  return null
}

/**
 * Ключ постоянного хранения аватарной сцены. Отдельный от клипа сцены: клип
 * сцены делает шаг генерации, а этот файл — результат аватарной ветки, и общий
 * ключ означал бы, что в смешанном ролике один перезаписывает другой.
 */
export function avatarSourceStorageKey(videoId: number, sceneIndex: number): string {
  return StorageKeys.videoLipSyncClip(videoId, `avatar_scene_${sceneIndex}.mp4`)
}

/** Есть ли у персонажа портрет, которым вообще можно снять аватарную сцену. */
export async function characterHasAvatarPortrait(characterId: string): Promise<boolean> {
  const portraits = await prisma.characterReferenceImage.findMany({
    where: { characterId },
    select: { id: true, kind: true, order: true, storageKey: true, fileUrl: true, mimeType: true, usageCount: true, lastUsedAt: true },
  })
  return pickAvatarPortrait(portraits) !== null
}

/**
 * Снимает аватарную сцену: портрет плюс готовая речь — сразу говорящее видео.
 *
 * Null означает «аватаром снять нечем» — у персонажа нет пригодного портрета
 * или его файл недоступен; вызывающий шаг обязан продолжить прежним путём, а
 * не падать.
 */
export async function generateAvatarSourceClip(
  request: AvatarClipRequest,
): Promise<AvatarClipResult | null> {
  const character = await prisma.character.findUnique({
    where: { id: request.characterId },
    select: {
      id: true,
      name: true,
      visualPrompt: true,
      referenceImages: {
        select: {
          id: true,
          kind: true,
          order: true,
          storageKey: true,
          fileUrl: true,
          mimeType: true,
          usageCount: true,
          lastUsedAt: true,
        },
      },
    },
  })
  if (!character) return null

  const portrait = pickAvatarPortrait(character.referenceImages, {
    exclude: request.usedPortraitIds,
  })
  if (!portrait) return null

  const frame: ResolvedReferenceFrame = {
    source: "character",
    imageId: portrait.id,
    appId: null,
    fileUrl: portrait.fileUrl,
    storageKey: portrait.storageKey,
    mimeType: detectReferenceMediaType(portrait.mimeType, portrait.fileUrl),
  }
  const portraitPath = await materializeReferenceFrame(frame, request.workDir)
  if (!portraitPath) return null

  const route = resolveMediaRoute("speech_to_video")

  const task = await runMediaTask({
    capability: "speech_to_video",
    spec: route.primary,
    fallbackSpec: route.fallback,
    input: {
      // Оба URL подставит runMediaTask после заливки локальных файлов: в ключ
      // идемпотентности идёт sha256 содержимого, а не временный адрес заливки.
      imageUrl: "",
      audioUrl: "",
      durationSec: request.durationSec,
      resolution: request.resolution,
      prompt: buildAvatarClipPrompt(character, request.prompt),
    },
    inputUploads: [
      { field: "imageUrl", path: portraitPath, contentType: frame.mimeType },
      { field: "audioUrl", path: request.audioPath, contentType: "audio/mpeg" },
    ],
    videoId: request.videoId,
    stepId: request.stepId,
    unitKey: request.unitKey,
    sceneOrder: request.sceneOrder,
    outputPath: request.outputPath,
    usage: { outputSeconds: request.durationSec, resolution: request.resolution },
    persist: {
      storageKey: avatarSourceStorageKey(request.videoId, request.sceneOrder),
      contentType: "video/mp4",
    },
  })

  // Счётчик растёт только за реально снятый клип: повторный прогон ролика
  // переиспользует готовый prediction и накручивать ротацию не должен.
  const generated = task.source === "generated"
  if (generated) {
    await prisma.characterReferenceImage.update({
      where: { id: portrait.id },
      data: { usageCount: { increment: 1 }, lastUsedAt: new Date() },
    }).catch(() => {
      // Учёт использования — не причина терять оплаченный клип.
    })
  }

  return {
    path: task.localPath,
    costUsd: task.costUsd,
    provider: task.provider,
    modelId: task.modelId,
    portraitId: portrait.id,
    effectiveDurationSec: task.effectiveDurationSec ?? request.durationSec,
    frameHash: await hashAvatarFirstFrame(task.localPath),
    generated,
  }
}

/**
 * dHash первого кадра снятого клипа. Отказ ffmpeg — это null, а не исключение:
 * контроль похожести диагностический и не имеет права ронять оплаченный шаг.
 */
async function hashAvatarFirstFrame(filePath: string): Promise<string | null> {
  try {
    const { hashVideoFrames } = await import("./quality/video-frame-hasher")
    const { frames } = await hashVideoFrames(filePath, [{ label: "first", atSec: 0 }])
    return frames[0]?.hash ?? null
  }
  catch {
    return null
  }
}
