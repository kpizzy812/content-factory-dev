/**
 * Public API ASS-генератора. Композирует header + dialogue lines в .ass файл, пишет на
 * диск, возвращает абсолютный путь.
 *
 * Идемпотентность: hash от input → имя файла. При повторной сборке тех же субтитров файл
 * переиспользуется (не перезаписывается, libass возьмёт уже готовый).
 */

import { createHash } from 'node:crypto'
import { writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { FullSubtitlePreset } from '../preset-registry'
import type { SubtitleStyleProfile } from '~~/shared/types/story'
import { buildAssHeader, type VideoFormat } from './header'
import { buildDialogueLines, type AssSegmentInput } from './dialogue'
import { getFontForPreset } from '../font-resolver'
import { getSubtitlesBase } from '../../storage-paths'

export interface AssGenInput {
  videoId: number
  format: VideoFormat
  preset: FullSubtitlePreset
  styleOverrides: SubtitleStyleProfile
  segments: AssSegmentInput[]
}

export interface AssGenResult {
  filePath: string
  bytesWritten: number
  segmentsRendered: number
  fontsDir: string | null
  warnings: string[]
}

export class AssGenerationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AssGenerationError'
  }
}


export async function generateAssFile(input: AssGenInput): Promise<AssGenResult> {
  if (!input.preset) {
    throw new AssGenerationError('Preset не задан')
  }
  if (!Array.isArray(input.segments) || input.segments.length === 0) {
    throw new AssGenerationError('Нет сегментов для рендера')
  }

  const warnings: string[] = []

  // Не пускаем segments с пустым text — они ничего не сделают, только засорят файл.
  const validSegments = input.segments.filter(s => s.text && s.text.trim().length > 0)
  if (validSegments.length === 0) {
    throw new AssGenerationError('Все сегменты пусты — нечего рендерить')
  }
  if (validSegments.length !== input.segments.length) {
    warnings.push(`пропущено ${input.segments.length - validSegments.length} пустых сегментов`)
  }

  const { family, fontsDir } = getFontForPreset(input.preset)
  if (!fontsDir && input.preset.fontFamily !== 'system') {
    warnings.push(`storage/fonts недоступен — пресет ${input.preset.key} запросит шрифт ${input.preset.fontFamily} из системы`)
  }

  const headerStr = buildAssHeader({
    format: input.format,
    preset: input.preset,
    fontFamily: family,
  })

  const dialogueLines = buildDialogueLines(validSegments, {
    preset: input.preset,
    styleOverrides: input.styleOverrides,
    format: input.format,
  })

  if (dialogueLines.length === 0) {
    throw new AssGenerationError('Все Dialogue-строки пусты после построения')
  }

  const fullContent = headerStr + dialogueLines.join('\n') + '\n'

  // Hash-based filename. Hash от полного content + key пресета — изменение любого поля
  // приводит к новому файлу, поэтому stale-кэш невозможен.
  const hash = createHash('sha256').update(fullContent).digest('hex').slice(0, 12)
  const dir = join(getSubtitlesBase(), String(input.videoId))
  await mkdir(dir, { recursive: true })
  const filePath = join(dir, `${input.preset.key}-${hash}.ass`)

  // Идемпотентность: если файл уже есть и совпадает по hash — переиспользуем.
  let bytesWritten = 0
  if (!existsSync(filePath)) {
    // Без BOM (libass требует UTF-8 без BOM). writeFile с 'utf-8' по умолчанию без BOM.
    await writeFile(filePath, fullContent, 'utf-8')
    bytesWritten = Buffer.byteLength(fullContent, 'utf-8')
  }

  return {
    filePath,
    bytesWritten,
    segmentsRendered: validSegments.length,
    fontsDir,
    warnings,
  }
}
