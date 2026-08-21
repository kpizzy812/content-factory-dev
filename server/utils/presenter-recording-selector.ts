/**
 * Атомарный выбор окна записи ведущего под кадр заданной длины.
 *
 * Устроено так же, как `reservePresenterSourceClip` (тот же файл-сосед):
 * `Serializable` транзакция и три попытки на `P2034`. Причина та же — два
 * параллельных прогона не должны получить один участок: это два одинаковых
 * кадра в двух роликах, то есть дубль по docs/PROJECT_CONTEXT.md §7.
 *
 * Отличие от выбора клипа: единица не строка, а интервал, поэтому «занятость»
 * фиксируется вставкой `PresenterRecordingUsage` внутри той же транзакции.
 * Именно вставка, а не инкремент счётчика, делает резервирование видимым
 * второму прогону.
 */

import { prisma } from "./prisma"
import { planRecordingWindow, RECORDING_WINDOW_COOLDOWN_MS } from "./presenter/recording-window"

const MAX_RESERVATION_ATTEMPTS = 3

/**
 * Насколько глубоко тянуть историю использований записи для планировщика.
 *
 * `planRecordingWindow` рассчитан на то, что ему приносят ВСЕ использования —
 * он сам делит их на горячие и остывшие (`recording-window.ts:98`) и считает
 * по ним два разных ключа ранжирования (там же, ~152-159). Предфильтр по
 * cooldown здесь стирал бы вторую половину контракта: usage старше суток
 * выпадал бы из выборки целиком, `reused` вырождался бы в `overlapSec > 0` и
 * окно поверх вчера уже отснятого куска возвращалось бы неотличимым от
 * нетронутого материала — Important из ревью, ровно тот дубль по
 * docs/PROJECT_CONTEXT.md §7, только отложенный на сутки. Берём окно заметно
 * шире cooldown, а не всю историю без границ: у много раз использованной
 * записи выборка иначе росла бы неограниченно.
 */
const USAGE_HISTORY_WINDOW_MS = 30 * RECORDING_WINDOW_COOLDOWN_MS

export interface ReserveRecordingWindowInput {
  characterId: string
  /** Длина кадра — обычно длина вырезанного куска трека. */
  requiredSec: number
  fps: number
  /** Ролик, за которым закрепляется интервал. null — служебный прогон. */
  videoId: number | null
  now?: number
}

export interface ReservedRecordingWindow {
  recordingId: string
  storageKey: string
  startSec: number
  endSec: number
  durationSec: number
  usageId: string
  /** true — нетронутого места не осталось, взят остывший участок. */
  reused: boolean
  /**
   * Секунды пересечения с ещё не остывшими интервалами (0 в норме).
   * Ненулевое значение — сигнал деградации: интервалы, занятые резервированием,
   * освобождать некому (см. комментарий у reserveRecordingWindow), и в
   * крэш-петле на одной записи библиотека свободных слотов выедается быстро.
   * Единственное место, где это видно, — это поле в логе шага.
   */
  overlapSec: number
}

export async function reserveRecordingWindow(
  input: ReserveRecordingWindowInput,
): Promise<ReservedRecordingWindow | null> {
  const now = input.now ?? Date.now()

  for (let attempt = 1; attempt <= MAX_RESERVATION_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        // Только завершённые записи: у падавшего ingest файл может быть
        // недокачан, и резать из него — это кадр из ниоткуда.
        const recordings = await tx.presenterRecording.findMany({
          where: {
            characterId: input.characterId,
            ingestStatus: "completed",
            durationSec: { gte: input.requiredSec },
          },
          orderBy: [{ createdAt: "asc" }],
          include: {
            usages: {
              // Не cooldown — см. USAGE_HISTORY_WINDOW_MS: planRecordingWindow
              // обязан увидеть и остывшие интервалы тоже, иначе он не сможет
              // отличить их от нетронутого места.
              where: { usedAt: { gte: new Date(now - USAGE_HISTORY_WINDOW_MS) } },
              select: { startSec: true, endSec: true, usedAt: true },
            },
          },
        })
        if (recordings.length === 0) return null

        // Выбор МЕЖДУ записями — тоже двухключевой, а не по одному overlapSec:
        // сначала минимальный overlapSec (перекрытие с горячими интервалами),
        // при равенстве — кандидат с reused === false. Одного overlapSec мало:
        // у остывшего участка overlapSec тоже 0 — он неотличим от нетронутого
        // по этому ключу, а без второго на уровне выбора записи вернулся бы
        // ровно тот дефект, который уже починен внутри planRecordingWindow
        // (решение задачи, п.2).
        let best: ReservedRecordingWindow | null = null
        for (const recording of recordings) {
          const window = planRecordingWindow({
            recordingDurationSec: recording.durationSec,
            requiredSec: input.requiredSec,
            fps: input.fps,
            usedIntervals: recording.usages.map(usage => ({
              startSec: usage.startSec,
              endSec: usage.endSec,
              usedAtMs: usage.usedAt.getTime(),
            })),
            now,
          })
          if (!window) continue

          const candidate = {
            recordingId: recording.id,
            storageKey: recording.storageKey,
            startSec: window.startSec,
            endSec: window.endSec,
            durationSec: window.durationSec,
            usageId: "",
            reused: window.reused,
            overlapSec: window.overlapSec,
          }

          const isBetter = best === null
            || candidate.overlapSec < best.overlapSec
            || (candidate.overlapSec === best.overlapSec && !candidate.reused && best.reused)

          if (isBetter) {
            best = candidate
            // Полностью нетронутый участок найден — лучше не будет, дальше
            // искать нечего.
            if (best.overlapSec === 0 && !best.reused) break
          }
        }
        if (!best) return null

        const usage = await tx.presenterRecordingUsage.create({
          data: {
            recordingId: best.recordingId,
            startSec: best.startSec,
            endSec: best.endSec,
            videoId: input.videoId,
          },
        })

        return { ...best, usageId: usage.id }
      }, { isolationLevel: "Serializable" })
    }
    catch (error) {
      const code = error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : ""
      if (code !== "P2034" || attempt === MAX_RESERVATION_ATTEMPTS) throw error
    }
  }

  return null
}
