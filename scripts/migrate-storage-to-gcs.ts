#!/usr/bin/env bun
/**
 * Одноразовая миграция БД-записей storage из эфемерного `./storage/uploads/...`
 * в GCS bucket. Заливает существующие файлы под детерминированные ключи
 * `zavodcamp/...` и записывает storageKey в БД. Если файл отсутствует на
 * диске — помечает Video.status='file_missing' (visible через
 * /admin/storage-health после восстановления из backup).
 *
 * Запуск:
 *   bun run scripts/migrate-storage-to-gcs.ts --dry-run         # анализ
 *   bun run scripts/migrate-storage-to-gcs.ts --apply           # реально
 *   bun run scripts/migrate-storage-to-gcs.ts --apply --only=videos
 *
 * Перед --apply убедись: STORAGE_DRIVER=gcs + GCS_* env vars выставлены.
 * Скрипт сам делает PrefixGuard sanity check, что target driver — GCS.
 */
import { existsSync } from "node:fs"
import { stat } from "node:fs/promises"
import path from "node:path"

import {
  getStorageDriver,
  LocalDriver,
  resetStorageDriver,
  StorageKeys,
} from "../server/utils/storage"
import { prisma } from "../server/utils/prisma"

const args = process.argv.slice(2)
const DRY_RUN = !args.includes("--apply")
const ONLY = args.find((a) => a.startsWith("--only="))?.split("=")[1]

const LOCAL_STORAGE_ROOT =
  process.env.STORAGE_LOCAL_ROOT?.trim() ||
  process.env.UPLOADS_STORAGE_PATH?.trim() ||
  "./storage"

interface Stats {
  total: number
  uploaded: number
  alreadyMigrated: number
  fileMissing: number
  errors: number
}

function emptyStats(): Stats {
  return { total: 0, uploaded: 0, alreadyMigrated: 0, fileMissing: 0, errors: 0 }
}

// Source — LocalDriver всегда читает из старой структуры (./storage/uploads/...).
// Указываем rootDir на корень БЕЗ префикса `zavodcamp/` потому что legacy ключи
// не имеют этого префикса. Mimics resolveLocalPath ниже.
const legacyRoot = path.resolve(LOCAL_STORAGE_ROOT, "uploads")
console.log(`[migration] Mode: ${DRY_RUN ? "DRY RUN" : "APPLY"}`)
console.log(`[migration] Legacy uploads root: ${legacyRoot}`)

if (!DRY_RUN) {
  process.env.STORAGE_DRIVER = "gcs"
  resetStorageDriver()
}
const targetDriver = DRY_RUN ? new LocalDriver({ rootDir: LOCAL_STORAGE_ROOT }) : getStorageDriver()
console.log(`[migration] Target driver: ${targetDriver.providerName}`)

if (!DRY_RUN && targetDriver.providerName !== "gcs") {
  console.error(
    `[migration] FATAL: --apply requires STORAGE_DRIVER=gcs (got ${targetDriver.providerName})`,
  )
  process.exit(1)
}

function resolveLegacyLocalPath(filePathOrUrl: string): string | null {
  let rel = filePathOrUrl
  if (rel.startsWith("/api/files/")) rel = rel.slice("/api/files/".length)
  if (rel.startsWith("./storage/uploads/")) rel = rel.slice("./storage/uploads/".length)
  else if (rel.startsWith("storage/uploads/")) rel = rel.slice("storage/uploads/".length)
  else if (rel.startsWith("./storage/")) rel = rel.slice("./storage/".length)
  else if (rel.startsWith("storage/")) rel = rel.slice("storage/".length)
  if (rel.startsWith("/")) {
    // Абсолютный путь — используем как есть, без legacyRoot.
    return rel
  }
  return path.resolve(legacyRoot, rel)
}

async function migrateVideos(): Promise<Stats> {
  const stats = emptyStats()
  const videos = await prisma.video.findMany({
    where: { filePath: { not: null }, storageKey: null },
    select: { id: true, filePath: true, fileUrl: true, status: true },
    take: 10000,
  })
  stats.total = videos.length
  console.log(`[migration] Videos: ${videos.length} to check`)

  for (const video of videos) {
    try {
      const localPath = resolveLegacyLocalPath(video.filePath!)
      if (!localPath || !existsSync(localPath)) {
        if (!DRY_RUN) {
          await prisma.video.update({
            where: { id: video.id },
            data: { status: "file_missing", storageProvider: "missing" },
          })
        }
        stats.fileMissing++
        console.log(`  [missing] Video ${video.id}: ${localPath}`)
        continue
      }

      const storageKey = StorageKeys.videoFinal(video.id)
      const st = await stat(localPath)

      if (!DRY_RUN) {
        const obj = await targetDriver.uploadFile(storageKey, localPath, {
          contentType: "video/mp4",
        })
        await prisma.video.update({
          where: { id: video.id },
          data: {
            storageKey,
            storageProvider: "gcs",
            fileSizeBytes: obj.sizeBytes,
            fileSha256: obj.sha256,
          },
        })
      }
      stats.uploaded++
      console.log(
        `  [uploaded] Video ${video.id} (${(Number(st.size) / 1024 / 1024).toFixed(2)} MB)`,
      )
    } catch (err) {
      stats.errors++
      console.error(`  [error] Video ${video.id}:`, err)
    }
  }
  return stats
}

async function migrateVideoAssets(): Promise<Stats> {
  const stats = emptyStats()
  const assets = await prisma.videoAsset.findMany({
    where: { filePath: { not: null }, storageKey: null },
    select: { id: true, videoId: true, type: true, order: true, filePath: true },
    take: 50000,
  })
  stats.total = assets.length
  console.log(`[migration] VideoAssets: ${assets.length} to check`)

  for (const a of assets) {
    try {
      const localPath = resolveLegacyLocalPath(a.filePath!)
      if (!localPath || !existsSync(localPath)) {
        stats.fileMissing++
        continue
      }

      // Маппинг asset type → storage key + content-type
      let storageKey: string
      let contentType: string
      switch (a.type) {
        case "image":
          storageKey = StorageKeys.videoSceneImage(a.videoId, a.order)
          contentType = "image/png"
          break
        case "clip":
          storageKey = StorageKeys.videoSceneClip(a.videoId, a.order)
          contentType = "video/mp4"
          break
        case "voiceover":
          storageKey = StorageKeys.videoVoiceoverLine(a.videoId, String(a.order))
          contentType = "audio/mpeg"
          break
        case "voiceover_mix":
          storageKey = StorageKeys.videoVoiceoverMix(a.videoId)
          contentType = "audio/mpeg"
          break
        case "music":
          storageKey = StorageKeys.videoMusic(a.videoId)
          contentType = "audio/mpeg"
          break
        case "thumbnail":
          storageKey = StorageKeys.videoThumbnail(a.videoId)
          contentType = "image/jpeg"
          break
        case "preview":
          storageKey = StorageKeys.videoPreview(a.videoId)
          contentType = "video/mp4"
          break
        default: {
          // Тип, не покрытый storage keys (новый enum value добавлен после
          // этой миграции, или левая запись). Пропускаем — не теряем данные.
          stats.errors++
          continue
        }
      }

      if (!DRY_RUN) {
        const obj = await targetDriver.uploadFile(storageKey, localPath, { contentType })
        await prisma.videoAsset.update({
          where: { id: a.id },
          data: {
            storageKey,
            storageProvider: "gcs",
            fileSizeBytes: obj.sizeBytes,
            fileSha256: obj.sha256,
            contentType,
          },
        })
      }
      stats.uploaded++
    } catch (err) {
      stats.errors++
      console.error(`  [error] VideoAsset ${a.id}:`, err)
    }
  }
  return stats
}

async function migrateAppReferences(): Promise<Stats> {
  const stats = emptyStats()
  const refs = await prisma.appReferenceImage.findMany({
    where: { storageKey: null },
    select: { id: true, appId: true, sha1: true, fileUrl: true, mimeType: true },
    take: 50000,
  })
  stats.total = refs.length
  console.log(`[migration] AppReferenceImages: ${refs.length} to check`)

  for (const ref of refs) {
    try {
      const localPath = resolveLegacyLocalPath(ref.fileUrl)
      if (!localPath || !existsSync(localPath)) {
        stats.fileMissing++
        continue
      }
      const ext = path.extname(localPath).slice(1) || "png"
      const storageKey = StorageKeys.appReferenceImage(ref.appId, ref.sha1, ext)
      if (!DRY_RUN) {
        const obj = await targetDriver.uploadFile(storageKey, localPath, {
          contentType: ref.mimeType ?? "image/png",
        })
        await prisma.appReferenceImage.update({
          where: { id: ref.id },
          data: {
            storageKey,
            storageProvider: "gcs",
            bytes: Number(obj.sizeBytes),
          },
        })
      }
      stats.uploaded++
    } catch (err) {
      stats.errors++
      console.error(`  [error] AppRef ${ref.id}:`, err)
    }
  }
  return stats
}

async function migrateUniqueVariants(): Promise<Stats> {
  const stats = emptyStats()
  const variants = await prisma.videoUniqueVariant.findMany({
    where: { storageKey: null },
    select: { id: true, videoId: true, platform: true, paramsHash: true, filePath: true },
    take: 50000,
  })
  stats.total = variants.length
  console.log(`[migration] VideoUniqueVariants: ${variants.length} to check`)

  for (const v of variants) {
    try {
      const localPath = resolveLegacyLocalPath(v.filePath)
      if (!localPath || !existsSync(localPath)) {
        stats.fileMissing++
        continue
      }
      const storageKey = StorageKeys.uniqueVariant(v.videoId, v.platform, v.paramsHash)
      if (!DRY_RUN) {
        await targetDriver.uploadFile(storageKey, localPath, { contentType: "video/mp4" })
        await prisma.videoUniqueVariant.update({
          where: { id: v.id },
          data: { storageKey },
        })
      }
      stats.uploaded++
    } catch (err) {
      stats.errors++
      console.error(`  [error] Variant ${v.id}:`, err)
    }
  }
  return stats
}

async function main() {
  console.log("\n=== Migration Started ===\n")

  const sections: Record<string, () => Promise<Stats>> = {
    videos: migrateVideos,
    videoAssets: migrateVideoAssets,
    appReferences: migrateAppReferences,
    uniqueVariants: migrateUniqueVariants,
  }

  const allStats: Record<string, Stats> = {}
  for (const [name, fn] of Object.entries(sections)) {
    if (ONLY && ONLY !== name) continue
    console.log(`\n--- ${name} ---`)
    allStats[name] = await fn()
    console.log(`  Stats: ${JSON.stringify(allStats[name])}`)
  }

  console.log("\n=== Migration Summary ===")
  console.log(JSON.stringify(allStats, null, 2))

  if (DRY_RUN) {
    console.log("\n⚠️  DRY RUN — no changes applied. Re-run with --apply to commit.")
  }

  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error("Migration failed:", err)
  await prisma.$disconnect()
  process.exit(1)
})
