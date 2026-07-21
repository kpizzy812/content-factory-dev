/**
 * One-off скрипт: генерирует MP4-превью каждого пресета субтитров.
 *
 * Запуск: bun run scripts/generate-subtitle-samples.ts
 *
 * Что делает:
 *   1. Берёт фиксированную фразу-образец ("Это секрет миллионеров")
 *   2. Создаёт 3-секундный testsrc-видеоисточник через FFmpeg lavfi
 *   3. Генерирует .ass файл через ass-builder для каждого пресета
 *   4. Накладывает через `subtitles=` filter, пишет в public/subtitle-presets/{key}.mp4
 *
 * Превью используется в VideoSubtitlePresetCard.vue — без них показывается CSS-имитация.
 *
 * Если FFmpeg / шрифты недоступны — пресет пропускается с warning, скрипт не падает.
 */

import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { listPresets } from '../server/utils/subtitles/preset-registry'
import { getPresetByKey } from '../server/utils/subtitles/preset-registry'
import { generateAssFile } from '../server/utils/subtitles/ass-builder'
import { normalizeSubtitleStyle } from '../server/utils/subtitle-style'

const SAMPLE_TEXT = 'Это секрет миллионеров'
const SAMPLE_DURATION_SEC = 3
const OUT_DIR = join(process.cwd(), 'public', 'subtitle-presets')

async function generateOnePreset(key: string): Promise<void> {
  const preset = getPresetByKey(key)
  const outputPath = join(OUT_DIR, `${key}.mp4`)

  if (preset.renderer === 'drawtext') {
    // Drawtext-пресет (classic) — генерируем simple-овeрлей через ffmpeg drawtext.
    await runFfmpegDrawtext(outputPath)
    return
  }

  // ASS pipeline.
  const styleOverrides = normalizeSubtitleStyle(null)
  const ass = await generateAssFile({
    videoId: 0,
    format: 'portrait',
    preset,
    styleOverrides,
    segments: [{
      startSec: 0.1,
      endSec: SAMPLE_DURATION_SEC - 0.1,
      text: SAMPLE_TEXT,
      placement: { position: 'bottom', alignment: 'center', avoidZones: [] },
    }],
  })

  const escapedAss = escapeForFilter(ass.filePath)
  const fontsPart = ass.fontsDir
    ? `:fontsdir=${escapeForFilter(ass.fontsDir)}`
    : ''
  const filter = `subtitles=${escapedAss}${fontsPart}`

  await runFfmpeg([
    '-y',
    '-f', 'lavfi',
    '-i', `color=c=#1a1a2e:s=1080x1920:d=${SAMPLE_DURATION_SEC}:r=30`,
    '-vf', filter,
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '28',
    '-pix_fmt', 'yuv420p',
    '-an',
    outputPath,
  ])
}

async function runFfmpegDrawtext(outputPath: string): Promise<void> {
  const filter = `drawtext=text='${SAMPLE_TEXT}':fontcolor=white:fontsize=62:borderw=7:bordercolor=black:x=(w-text_w)/2:y=h-200`
  await runFfmpeg([
    '-y',
    '-f', 'lavfi',
    '-i', `color=c=#1a1a2e:s=1080x1920:d=${SAMPLE_DURATION_SEC}:r=30`,
    '-vf', filter,
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '28',
    '-pix_fmt', 'yuv420p',
    '-an',
    outputPath,
  ])
}

function escapeForFilter(path: string): string {
  return `'${path.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\\\'")}'`
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    ffmpeg.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    ffmpeg.on('error', err => reject(err))
    ffmpeg.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exit ${code}\n${stderr.slice(-500)}`))
    })
  })
}

async function main() {
  if (!existsSync(OUT_DIR)) {
    await mkdir(OUT_DIR, { recursive: true })
  }

  const presets = listPresets()
  process.stderr.write(`Генерирую превью для ${presets.length} пресетов в ${OUT_DIR}\n`)

  let success = 0
  let skipped = 0
  for (const meta of presets) {
    try {
      await generateOnePreset(meta.key)
      success += 1
      process.stderr.write(`  [ok] ${meta.key}\n`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      skipped += 1
      process.stderr.write(`  [skip] ${meta.key}: ${msg.slice(0, 200)}\n`)
    }
  }

  process.stderr.write(`\nГотово. Успешно: ${success}, пропущено: ${skipped}\n`)
}

main().catch((err) => {
  process.stderr.write(`Скрипт упал: ${err}\n`)
  process.exit(1)
})
