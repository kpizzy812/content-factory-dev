/**
 * Чистое решение "похож ли кадр на что-то из истории" — задача 6b, Minor 6 из
 * ревью фикс-раунда 1.
 *
 * Вынесено из `recording-window-frame-guard.ts` в отдельный модуль намеренно:
 * тот файл статически тянет `../prisma` (создаёт `PrismaClient` на уровне
 * модуля) и `./ffmpeg-adapter` → `video-tools/ffmpeg.ts` (`setFfmpegPath` на
 * уровне модуля при заданном `FFMPEG_PATH`). DB-free unit-тест этой функции не
 * должен затягивать ни то, ни другое — ровно тот класс хрупкости, что уже
 * ронял lip-sync-тесты в задаче 6 (Important 1 её ревью). Прецедент такого
 * разделения в проекте есть: `findSimilarAvatarClip` в avatar-source.ts
 * решает ту же задачу для аватарных сцен, только тот файл ffmpeg не тянет —
 * здесь дублировать это не вышло, поэтому чистая часть уехала в свой файл.
 */

import { areFramesSimilar, DEFAULT_SIMILARITY_THRESHOLD } from "./perceptual-hash"

/**
 * Ищет в recentHashes хэш, похожий на hash. Битый хэш в истории (повреждённые
 * старые данные) пропускается, а не роняет сравнение целиком — как и в
 * аватарном аналоге `findSimilarAvatarClip`.
 */
export function findSimilarRecentFrame(
  hash: string,
  recentHashes: readonly string[],
  threshold: number = DEFAULT_SIMILARITY_THRESHOLD,
): string | null {
  for (const known of recentHashes) {
    try {
      if (areFramesSimilar(hash, known, threshold)) return known
    }
    catch {
      // Один негодный хеш в истории не отменяет проверку остальных.
      continue
    }
  }
  return null
}
