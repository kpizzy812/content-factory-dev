/**
 * One-off скрипт: нормализует Video.subtitlesStyle для существующих записей.
 *
 * Запуск: bunx tsx scripts/normalize-video-subtitles-style.ts
 *
 * Что делает:
 * - Идёт по всем Video с непустым subtitlesStyle
 * - Прогоняет через normalizeSubtitleStyle (добавляет wordsPerLine=4 если отсутствует,
 *   clamp в 3..6, snake_case → camelCase)
 * - Записывает обратно
 *
 * Это безопасно: normalizeSubtitleStyle — pure функция, выходное значение всегда
 * валидный SubtitleStyleProfile с дефолтами для отсутствующих полей.
 */

import { PrismaClient } from '@prisma/client'
import { normalizeSubtitleStyle } from '../server/utils/subtitle-style'

const prisma = new PrismaClient()

async function main() {
  const videos = await prisma.video.findMany({
    where: { subtitlesStyle: { not: undefined } },
    select: { id: true, subtitlesStyle: true },
  })

  console.log(`Найдено ${videos.length} видео с subtitlesStyle для нормализации`)

  let updated = 0
  let unchanged = 0

  for (const video of videos) {
    if (!video.subtitlesStyle) continue
    const normalized = normalizeSubtitleStyle(video.subtitlesStyle)
    const before = JSON.stringify(video.subtitlesStyle)
    const after = JSON.stringify(normalized)
    if (before === after) {
      unchanged++
      continue
    }
    await prisma.video.update({
      where: { id: video.id },
      data: { subtitlesStyle: normalized as unknown as object },
    })
    updated++
    console.log(`  Video ${video.id}: нормализован (wordsPerLine=${normalized.typography.wordsPerLine})`)
  }

  console.log(`\nГотово. Обновлено: ${updated}, без изменений: ${unchanged}`)
}

main()
  .catch((e) => {
    console.error('Ошибка:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
