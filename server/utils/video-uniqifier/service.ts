/**
 * Track F — service-level entry point.
 *
 * getOrCreateUniqueVariant:
 *   1. Сгенерить детерминистические params (seed = `<videoId>:<platform>:v1`).
 *   2. paramsHash = hashParams(params).
 *   3. Если force=false и существует запись + файл на диске — return cached.
 *   4. Иначе uniqifyVideo → computeFileHash → ffprobeDuration → upsert запись.
 *
 * Storage layout: `storage/uploads/unique-variants/<videoId>/<platform>_<hash>.mp4`.
 * filePath в БД хранится как относительный (от storage/uploads), fileUrl — публичный
 * `/api/files/<filePath>`.
 */

import { mkdir, stat, unlink } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { prisma } from "../prisma"
import { getUploadsBase } from "../storage-paths"
import { StorageKeys } from "../storage/keys"
import { uploadLocalAsset } from "../storage/persist-asset"
import { storageKeyToLegacyUrl } from "../storage/download-to-storage"
import {
  generateUniqifyParams,
  hashParams,
  PLATFORM_PRESETS,
  type UniqifyPlatform,
  type UniqifyParams,
} from "./params"
import { uniqifyVideo, computeFileHash, ffprobeDuration } from "./ffmpeg"

const VARIANTS_SUBDIR = "unique-variants"

export interface GetOrCreateOpts {
  videoId: number
  platform: UniqifyPlatform
  /** Абсолютный путь к исходному файлу. */
  sourceAbsPath: string
  /** Принудительное пересоздание (обходит кеш). */
  force?: boolean
}

export interface UniqueVariantResult {
  /** Относительный путь от storage/uploads. */
  filePath: string
  /** Публичный URL: /api/files/<filePath>. */
  fileUrl: string
  fileHash: string
  fileSize: number
  durationSec: number
  paramsJson: UniqifyParams
  paramsHash: string
  /** true — отдали существующую запись, false — пересоздали. */
  cached: boolean
}

export async function getOrCreateUniqueVariant(opts: GetOrCreateOpts): Promise<UniqueVariantResult> {
  const { videoId, platform, sourceAbsPath, force = false } = opts
  const seed = `${videoId}:${platform}:v1`
  const params = generateUniqifyParams(seed)
  const paramsHash = hashParams(params)

  // Кеш-проверка
  if (!force) {
    const existing = await prisma.videoUniqueVariant.findUnique({
      where: { videoId_platform_paramsHash: { videoId, platform, paramsHash } },
    })
    if (existing) {
      const absPath = join(getUploadsBase(), existing.filePath)
      if (existsSync(absPath)) {
        return {
          filePath: existing.filePath,
          fileUrl: existing.fileUrl,
          fileHash: existing.fileHash,
          fileSize: existing.fileSize,
          durationSec: existing.durationSec,
          paramsJson: existing.paramsJson as unknown as UniqifyParams,
          paramsHash: existing.paramsHash,
          cached: true,
        }
      }
      // Запись есть, файл потерян — снесём запись и продолжим как miss.
      await prisma.videoUniqueVariant.delete({ where: { id: existing.id } })
    }
  } else {
    // force=true: delete существующий перед re-create
    await prisma.videoUniqueVariant.deleteMany({
      where: { videoId, platform, paramsHash },
    })
  }

  // Подготовка путей
  const dirRel = `${VARIANTS_SUBDIR}/${videoId}`
  const dirAbs = join(getUploadsBase(), dirRel)
  await mkdir(dirAbs, { recursive: true })
  const fileName = `${platform}_${paramsHash}.mp4`
  const fileRel = `${dirRel}/${fileName}`
  const fileAbs = join(dirAbs, fileName)

  // Если файл случайно остался без записи в БД — снесём перед re-encode
  if (existsSync(fileAbs)) {
    await unlink(fileAbs)
  }

  // ffmpeg (cleanup orphan-файла при ошибке)
  try {
    await uniqifyVideo({
      inputPath: sourceAbsPath,
      outputPath: fileAbs,
      params,
      preset: PLATFORM_PRESETS[platform],
    })
  } catch (err) {
    if (existsSync(fileAbs)) {
      await unlink(fileAbs).catch(() => undefined)
    }
    throw err
  }

  // Hash + duration + size
  const [fileHash, durationSec, st] = await Promise.all([
    computeFileHash(fileAbs),
    ffprobeDuration(fileAbs),
    stat(fileAbs),
  ])

  // Заливаем в storage (GCS в prod, FS в dev) и формируем legacy URL.
  const variantStorage = await uploadLocalAsset(
    fileAbs,
    StorageKeys.uniqueVariant(videoId, platform, paramsHash),
    "video/mp4",
  )
  const fileUrl = storageKeyToLegacyUrl(variantStorage.storageKey)

  // Запись в БД (upsert защищает от race condition при двух одновременных force=true)
  const created = await prisma.videoUniqueVariant.upsert({
    where: { videoId_platform_paramsHash: { videoId, platform, paramsHash } },
    create: {
      videoId,
      platform,
      paramsHash,
      paramsJson: params as unknown as object,
      filePath: fileRel,
      fileUrl,
      fileHash,
      durationSec,
      fileSize: Number(st.size),
      storageKey: variantStorage.storageKey,
    },
    update: {
      filePath: fileRel,
      fileUrl,
      fileHash,
      durationSec,
      fileSize: Number(st.size),
      paramsJson: params as unknown as object,
      storageKey: variantStorage.storageKey,
    },
  })

  return {
    filePath: created.filePath,
    fileUrl: created.fileUrl,
    fileHash: created.fileHash,
    fileSize: created.fileSize,
    durationSec: created.durationSec,
    paramsJson: params,
    paramsHash,
    cached: false,
  }
}
