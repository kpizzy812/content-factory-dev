#!/usr/bin/env bun
/**
 * Сводка по состоянию storage: сколько видео мигрировано, сколько помечено
 * file_missing, какой driver активен. Опционально может реально проверить
 * существование каждого storageKey через HEAD (--check-existence) и найти
 * orphan-объекты в GCS (--orphan-scan).
 *
 * Запуск:
 *   bun run scripts/storage-health-check.ts
 *   bun run scripts/storage-health-check.ts --check-existence
 *   bun run scripts/storage-health-check.ts --orphan-scan
 *
 * Результат пишется в tmp/storage-health-{date}.json — это удобно для
 * долгих диагностик: можно прокрутить вручную через jq.
 */
import { writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"

import { prisma } from "../server/utils/prisma"
import { describeStorageDriver, getStorageDriver } from "../server/utils/storage"

const args = process.argv.slice(2)
const CHECK_EXISTENCE = args.includes("--check-existence")
const ORPHAN_SCAN = args.includes("--orphan-scan")

interface VideoStats {
  total: number
  hasStorageKey: number
  hasFilePath: number
  bothEmpty: number
  fileMissing: number
  byProvider: Record<string, number>
  byStatus: Record<string, number>
  totalSizeBytes: bigint
  existenceChecked?: { exists: number; notFound: number; errors: number }
}

async function checkVideos(): Promise<VideoStats> {
  const stats: VideoStats = {
    total: 0,
    hasStorageKey: 0,
    hasFilePath: 0,
    bothEmpty: 0,
    fileMissing: 0,
    byProvider: {},
    byStatus: {},
    totalSizeBytes: 0n,
  }

  const videos = await prisma.video.findMany({
    select: {
      id: true,
      status: true,
      storageKey: true,
      filePath: true,
      storageProvider: true,
      fileSizeBytes: true,
    },
  })

  stats.total = videos.length

  for (const v of videos) {
    if (v.storageKey) stats.hasStorageKey++
    if (v.filePath) stats.hasFilePath++
    if (!v.storageKey && !v.filePath) stats.bothEmpty++
    if (v.status === "file_missing") stats.fileMissing++
    stats.byProvider[v.storageProvider] = (stats.byProvider[v.storageProvider] ?? 0) + 1
    stats.byStatus[v.status] = (stats.byStatus[v.status] ?? 0) + 1
    if (v.fileSizeBytes) stats.totalSizeBytes += v.fileSizeBytes
  }

  if (CHECK_EXISTENCE) {
    stats.existenceChecked = { exists: 0, notFound: 0, errors: 0 }
    const storage = getStorageDriver()
    const withKey = videos.filter((v) => v.storageKey)
    console.log(`Checking existence for ${withKey.length} videos via driver HEAD...`)
    let i = 0
    for (const v of withKey) {
      try {
        const exists = await storage.exists(v.storageKey!)
        if (exists) stats.existenceChecked.exists++
        else stats.existenceChecked.notFound++
      } catch {
        stats.existenceChecked.errors++
      }
      i++
      if (i % 50 === 0) console.log(`  Checked ${i}/${withKey.length}`)
    }
  }

  return stats
}

async function findOrphans(): Promise<{ orphans: string[]; sizeBytes: bigint }> {
  const storage = getStorageDriver()
  const orphans: string[] = []
  let totalSize = 0n

  console.log("Listing zavodcamp/videos/ prefix in storage...")
  const objects = await storage.list("zavodcamp/videos/")
  console.log(`Found ${objects.length} objects under prefix`)

  const dbKeys = new Set<string>()
  const videos = await prisma.video.findMany({ select: { storageKey: true } })
  for (const v of videos) if (v.storageKey) dbKeys.add(v.storageKey)
  const assets = await prisma.videoAsset.findMany({ select: { storageKey: true } })
  for (const a of assets) if (a.storageKey) dbKeys.add(a.storageKey)
  console.log(`DB has ${dbKeys.size} known storage keys`)

  for (const obj of objects) {
    if (!dbKeys.has(obj.key)) {
      orphans.push(obj.key)
      totalSize += obj.sizeBytes
    }
  }
  return { orphans, sizeBytes: totalSize }
}

async function main() {
  console.log("=== Storage Health Check ===\n")
  console.log("Driver:", describeStorageDriver())

  const videoStats = await checkVideos()
  console.log("\n--- Videos ---")
  console.log(
    JSON.stringify(
      {
        ...videoStats,
        totalSizeBytes: videoStats.totalSizeBytes.toString(),
        totalSizeMB: Number(videoStats.totalSizeBytes) / 1024 / 1024,
      },
      null,
      2,
    ),
  )

  let orphans: { orphans: string[]; sizeBytes: bigint } | undefined
  if (ORPHAN_SCAN) {
    console.log("\n--- Orphan Scan ---")
    orphans = await findOrphans()
    console.log(
      `Found ${orphans.orphans.length} orphan objects (${(Number(orphans.sizeBytes) / 1024 / 1024).toFixed(2)} MB)`,
    )
    if (orphans.orphans.length > 0) {
      console.log("First 20 orphans:")
      orphans.orphans.slice(0, 20).forEach((k) => console.log("  " + k))
    }
  }

  mkdirSync("tmp", { recursive: true })
  const reportPath = path.resolve(`tmp/storage-health-${new Date().toISOString().slice(0, 10)}.json`)
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        driver: describeStorageDriver(),
        videos: {
          ...videoStats,
          totalSizeBytes: videoStats.totalSizeBytes.toString(),
        },
        orphans: orphans
          ? {
              count: orphans.orphans.length,
              sizeBytes: orphans.sizeBytes.toString(),
              keys: orphans.orphans,
            }
          : undefined,
      },
      null,
      2,
    ),
  )
  console.log(`\nReport saved: ${reportPath}`)

  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
