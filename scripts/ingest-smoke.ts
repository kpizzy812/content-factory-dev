/**
 * Ручная проверка нарезки на реальном ffmpeg.
 * Запуск: bun run scripts/ingest-smoke.ts <путь-к-записи>
 */
import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { ffmpegIngestDependencies } from "../server/utils/presenter/ffmpeg-adapter"
import { ingestPresenterRecording } from "../server/utils/presenter/ingest-runner"

const recordingPath = process.argv[2]
if (!recordingPath) {
  console.error("Usage: bun run scripts/ingest-smoke.ts <recording>")
  process.exit(1)
}

const outputDir = await mkdtemp(join(tmpdir(), "ingest-smoke-"))

try {
  const result = await ingestPresenterRecording({ recordingPath, outputDir }, ffmpegIngestDependencies)

  console.log(`длительность: ${result.durationSec.toFixed(2)}s`)
  console.log(`scene detection упал: ${result.sceneDetectionFailed}`)
  console.log(`принято клипов: ${result.clips.length}, отброшено: ${result.skipped.length}`)

  for (const clip of result.clips) {
    const info = await stat(clip.filePath)
    console.log(
      `  ${clip.startSec.toFixed(2)}-${clip.endSec.toFixed(2)}s `
      + `(${clip.durationSec.toFixed(2)}s) hash=${clip.perceptualHash} bytes=${info.size}`,
    )
  }
  for (const skip of result.skipped) {
    console.log(`  SKIP ${skip.startSec}-${skip.endSec}: ${skip.reason} ${skip.message ?? ""}`)
  }
}
finally {
  await rm(outputDir, { recursive: true, force: true }).catch(() => {})
}
