/**
 * Перцептивный контроль похожести окна речи ведущего (задача 6b, spec §6.2).
 *
 * Учёт интервалов (`presenter-recording-selector.ts`) ловит повторную выдачу
 * ТОГО ЖЕ участка записи, но не видит, что два РАЗНЫХ участка длинной статичной
 * записи (тот же кадр, тот же фон, та же поза) визуально неотличимы. Без этой
 * проверки нарезка по требованию защищена от дублей строго слабее старой
 * нарезки клипов, у которой такой отбор уже есть (`presenter/ingest-runner.ts`).
 *
 * Порядок (см. докстринг задачи): снять первый кадр вырезанного окна, сравнить
 * с frameHash недавних использований ЭТОГО персонажа (по всем его записям), при
 * похожести — освободить текущее использование и зарезервировать окно заново
 * ОДИН раз, исключив отвергнутый участок, и перерезать; если и второй кадр
 * похож — оставить его (ронять оплаченную сцену из-за похожести кадрирования
 * нельзя, ровно как и на ingest) и сообщить об этом вызывающему для WARN в лог
 * шага. Хэш всегда сохраняется в usage — иначе следующей сцене не с чем будет
 * сравнивать.
 *
 * Ffmpeg-зависимость (`./ffmpeg-adapter`) тянет `video-tools/ffmpeg.ts`, который
 * на уровне модуля зовёт `setFfmpegPath()` при заданном `FFMPEG_PATH` — поэтому
 * этот модуль, как и `cutRecordingWindow`, обязан импортироваться из
 * `lip-sync-runner.ts` ТОЛЬКО динамически, внутри ветки `if (recordingWindow)`.
 */

import { prisma } from "../prisma"
import { areFramesSimilar, dHashFromGrayscale, DEFAULT_SIMILARITY_THRESHOLD } from "./perceptual-hash"
import { cutRecordingWindow, ffmpegIngestDependencies } from "./ffmpeg-adapter"
import { reserveRecordingWindow, type ReservedRecordingWindow } from "../presenter-recording-selector"

const RECENT_HASH_LIMIT = 50

/**
 * Чистое решение "похож ли hash на что-то из recentHashes" — без ffmpeg и без
 * БД, только сравнение строк. Битый хэш в истории (повреждённые старые данные)
 * пропускается, а не роняет сравнение целиком — как и в аватарном аналоге
 * `findSimilarAvatarClip` (avatar-source.ts).
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

async function recentCharacterHashes(characterId: string, excludeUsageId: string): Promise<string[]> {
  const rows = await prisma.presenterRecordingUsage.findMany({
    where: {
      id: { not: excludeUsageId },
      frameHash: { not: null },
      recording: { characterId },
    },
    orderBy: { usedAt: "desc" },
    take: RECENT_HASH_LIMIT,
    select: { frameHash: true },
  })
  return rows
    .map(row => row.frameHash)
    .filter((hash): hash is string => hash !== null)
}

async function hashFirstFrame(windowPath: string): Promise<string> {
  const pixels = await ffmpegIngestDependencies.grayscaleThumbnail(windowPath)
  return dHashFromGrayscale(pixels)
}

export interface GuardRecordingWindowFrameInput {
  characterId: string
  videoId: number
  sceneIndex: number
  requiredSec: number
  fps: number
  /** Окно, уже вырезанное вызывающим (первая попытка). */
  window: ReservedRecordingWindow
  /** Файл первой попытки — уже на диске. */
  windowPath: string
  /** Путь для файла ВТОРОЙ попытки, если первый кадр окажется похож на чужой. */
  retryWindowPath: string
  /** Локальный файл записи для window.recordingId — переиспользуется без повторной закачки. */
  recordingPath: string
  /**
   * Скачивает (или отдаёт уже скачанный) локальный файл ЛЮБОЙ записи
   * персонажа. Нужен, только если повторное резервирование выбрало ДРУГУЮ
   * запись того же персонажа — редкий случай, но `reserveRecordingWindow`
   * перебирает все завершённые записи, а не только текущую.
   */
  ensureRecordingDownloaded: (recording: { recordingId: string, storageKey: string }) => Promise<string>
}

export interface GuardRecordingWindowFrameResult {
  /** Итоговое окно: то же самое или новое, если пришлось перерезервировать. */
  window: ReservedRecordingWindow
  /** Итоговый файл: тот же самый или windowPath ВТОРОЙ попытки. */
  windowPath: string
  /** Перерезервировали и перерезали (первое окно отвергнуто по похожести). */
  reReserved: boolean
  /** Итоговый (возможно уже второй) кадр всё ещё похож на недавний — WARN в лог шага. */
  stillSimilar: boolean
}

export async function guardRecordingWindowFrame(
  input: GuardRecordingWindowFrameInput,
): Promise<GuardRecordingWindowFrameResult> {
  const hash = await hashFirstFrame(input.windowPath)
  const recent = await recentCharacterHashes(input.characterId, input.window.usageId)
  const match = findSimilarRecentFrame(hash, recent)

  if (!match) {
    await prisma.presenterRecordingUsage.update({
      where: { id: input.window.usageId },
      data: { frameHash: hash },
    })
    return { window: input.window, windowPath: input.windowPath, reReserved: false, stillSimilar: false }
  }

  // Похоже на недавний кадр этого персонажа — освобождаем текущее
  // использование и пробуем ОДИН раз заново, исключая уже отвергнутый участок.
  await prisma.presenterRecordingUsage.delete({ where: { id: input.window.usageId } }).catch(() => {
    // Строка уже могла исчезнуть (гонка с идентичным повторным прогоном той же
    // сцены) — не критично, ниже всё равно резервируем заново.
  })

  try {
    const retried = await reserveRecordingWindow({
      characterId: input.characterId,
      requiredSec: input.requiredSec,
      fps: input.fps,
      videoId: input.videoId,
      sceneIndex: input.sceneIndex,
      excludeInterval: {
        recordingId: input.window.recordingId,
        startSec: input.window.startSec,
        endSec: input.window.endSec,
      },
    })

    if (!retried) {
      // Резервировать было не из чего (например, запись стала недоступна
      // между первым и вторым резервированием). Использование уже удалено —
      // интервал первого окна больше не защищён от повторной выдачи, но это
      // та же деградация, что и при штатном отказе провайдера lip-sync (см.
      // докстринг ReservedRecordingWindow), а не новый класс дефекта. Сцену
      // не роняем — работаем с уже вырезанным первым файлом.
      return { window: input.window, windowPath: input.windowPath, reReserved: false, stillSimilar: true }
    }

    const recordingPath = retried.recordingId === input.window.recordingId
      ? input.recordingPath
      : await input.ensureRecordingDownloaded({ recordingId: retried.recordingId, storageKey: retried.storageKey })

    await cutRecordingWindow({
      recordingPath,
      startSec: retried.startSec,
      durationSec: retried.durationSec,
      outputPath: input.retryWindowPath,
    })

    const retriedHash = await hashFirstFrame(input.retryWindowPath)
    const retriedMatch = findSimilarRecentFrame(retriedHash, recent)

    await prisma.presenterRecordingUsage.update({
      where: { id: retried.usageId },
      data: { frameHash: retriedHash },
    })

    return {
      window: retried,
      windowPath: input.retryWindowPath,
      reReserved: true,
      // Второй попытке достаточно; дальше не гоняемся — оставляем и говорим
      // вслух, как ingest.
      stillSimilar: retriedMatch !== null,
    }
  }
  catch (err) {
    // Повторное резервирование/нарезка не удались УЖЕ ПОСЛЕ удаления первого
    // использования — интервал первого окна остался бы без защиты в БД.
    // Восстанавливаем эквивалентную строку (под новым usageId — старый уже не
    // существует), чтобы интервал не потерял учёт, и пробрасываем ошибку:
    // вызывающий продолжит со старым (первым) окном и файлом, которые уже
    // валидны и никуда не делись.
    await prisma.presenterRecordingUsage.create({
      data: {
        recordingId: input.window.recordingId,
        startSec: input.window.startSec,
        endSec: input.window.endSec,
        videoId: input.videoId,
        sceneIndex: input.sceneIndex,
      },
    }).catch(() => {})
    throw err
  }
}
