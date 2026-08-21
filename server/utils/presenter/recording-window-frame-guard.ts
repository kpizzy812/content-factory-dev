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
 * Чистая часть сравнения (`findSimilarRecentFrame`) — в соседнем
 * `recording-window-frame-similarity.ts`, без prisma и без ffmpeg (Minor 6 из
 * ревью фикс-раунда 1: этот файл статически тянет обе тяжёлые зависимости, и
 * DB-free unit-тест сравнения не должен их затягивать).
 *
 * Ffmpeg-зависимость (`./ffmpeg-adapter`) тянет `video-tools/ffmpeg.ts`, который
 * на уровне модуля зовёт `setFfmpegPath()` при заданном `FFMPEG_PATH` — поэтому
 * этот модуль, как и `cutRecordingWindow`, обязан импортироваться из
 * `lip-sync-runner.ts` ТОЛЬКО динамически, внутри ветки `if (recordingWindow)`.
 */

import { prisma } from "../prisma"
import { dHashFromGrayscale } from "./perceptual-hash"
import { findSimilarRecentFrame } from "./recording-window-frame-similarity"
import { cutRecordingWindow, ffmpegIngestDependencies } from "./ffmpeg-adapter"
import { prismaErrorCode, reserveRecordingWindow, type ReservedRecordingWindow } from "../presenter-recording-selector"

const RECENT_HASH_LIMIT = 50

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

/**
 * Восстанавливает защиту интервала ПЕРВОГО (исходного) окна в БД после отказа
 * на пути перерезервирования — Important 2 из ревью фикс-раунда 1.
 *
 * Уникальность `@@unique([videoId, sceneIndex])` не даёт существовать двум
 * строкам на одну сцену одновременно, поэтому способ восстановления зависит от
 * того, что уже успело произойти:
 * - `replacedUsageId === null` — `reserveRecordingWindow` для второй попытки
 *   ещё не создал новую строку (сам упал или вернул null); строки на эту пару
 *   вообще нет — нужен `create`.
 * - `replacedUsageId` задан — вторая попытка успела создать СВОЮ строку
 *   (`retried.usageId`), но дальше (закачка другой записи / нарезка / хэш)
 *   не задалось, а ролик фактически получит ПЕРВОЕ окно. `create` здесь
 *   упал бы P2002 поверх уже существующей строки — нужен `update` этой же
 *   строки обратно на границы первого окна.
 *
 * Восстановление тоже может не задаться (БД недоступна) — тогда это не
 * повод завершиться молча (было раньше): пишем в консоль, у guard нет доступа
 * к логу шага (это знает только вызывающий), это единственный канал.
 */
async function restoreOriginalUsage(
  input: GuardRecordingWindowFrameInput,
  frameHash: string,
  replacedUsageId: string | null,
): Promise<void> {
  try {
    if (replacedUsageId) {
      await prisma.presenterRecordingUsage.update({
        where: { id: replacedUsageId },
        data: {
          recordingId: input.window.recordingId,
          startSec: input.window.startSec,
          endSec: input.window.endSec,
          frameHash,
        },
      })
    }
    else {
      await prisma.presenterRecordingUsage.create({
        data: {
          recordingId: input.window.recordingId,
          startSec: input.window.startSec,
          endSec: input.window.endSec,
          videoId: input.videoId,
          sceneIndex: input.sceneIndex,
          frameHash,
        },
      })
    }
  }
  catch (restoreErr) {
    const msg = restoreErr instanceof Error ? restoreErr.message : String(restoreErr)
    console.error(
      `[recording-window-frame-guard] не удалось восстановить защиту интервала первого окна `
      + `(videoId=${input.videoId}, sceneIndex=${input.sceneIndex}, usageId=${input.window.usageId}): ${msg}`,
    )
  }
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
  // P2025 (строки уже нет — гонка с идентичным повторным прогоном той же
  // сцены) пропускаем, всё остальное пробрасываем: настоящий отказ БД здесь
  // означает, что удаление НЕ прошло — исходная строка цела, защита интервала
  // не потеряна, и восстанавливать нечего (тот же принцип, что в селекторе).
  await prisma.presenterRecordingUsage.delete({ where: { id: input.window.usageId } }).catch((err) => {
    if (prismaErrorCode(err) !== "P2025") throw err
  })

  // usageId второй попытки — если она успела создать свою строку, restoreOriginalUsage
  // ниже обязан UPDATE'ить именно её, а не пытаться create() поверх (Important 2).
  let retriedUsageId: string | null = null

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
      // между первым и вторым резервированием). Строки на эту пару больше
      // нет вовсе (удалена выше) — восстанавливаем её на границы первого
      // окна, иначе интервал остаётся без защиты в БД, хотя в ролик пойдёт
      // именно он.
      await restoreOriginalUsage(input, hash, null)
      return { window: input.window, windowPath: input.windowPath, reReserved: false, stillSimilar: true }
    }
    retriedUsageId = retried.usageId

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
    // Что-то после успешного reserveRecordingWindow (закачка другой записи,
    // нарезка, снятие/запись хэша) не задалось — ролик фактически получит
    // ПЕРВОЕ окно (см. catch в lip-sync-runner.ts вокруг всего вызова guard),
    // а в БД либо нет строки вовсе (reserveRecordingWindow сам бросил, ниже
    // retriedUsageId === null), либо есть строка ВТОРОГО окна (retriedUsageId
    // задан) — её нужно откатить на границы первого, а не плодить рядом новую.
    await restoreOriginalUsage(input, hash, retriedUsageId)
    throw err
  }
}
