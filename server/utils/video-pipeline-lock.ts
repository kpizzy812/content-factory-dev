/**
 * Владение блокировкой видео-пайплайна (память процесса).
 *
 * Штамп владения обязан быть per-run, а не per-videoId. Карта «videoId → штамп»
 * закрывала гонку только между процессами: внутри одного оператор жал «отменить»
 * (force-release срывал блокировку живого прогона A), тут же «запустить» —
 * прогон B клал в ту же ячейку СВОЙ штамп, а опоздавший finally прогона A читал
 * оттуда штамп B, совпадал с lockedAt в БД и разлочивал живой прогон B. Дальше
 * по одному ролику стартовал третий пайплайн: два прогона писали в те же
 * VideoGenerationStep/VideoAsset и оба сабмитили клипы в fal — двойная оплата.
 *
 * Здесь только чистая арифметика владения; сверка штампа с lockedAt в БД —
 * в video-pipeline-db.ts.
 */

/** Токен владения блокировкой. Выдаётся КОНКРЕТНОМУ прогону, живёт в его локальной переменной. */
export interface PipelineLockHandle {
  videoId: number
  /** Момент захвата (ms). Он же lockedAt в БД — по нему прогон опознаёт свою запись. */
  stampMs: number
}

/**
 * Следующий штамп владения.
 *
 * Обязан строго расти: отмена и повторный запуск укладываются в одну
 * миллисекунду, а одинаковый штамп у двух прогонов вернул бы ровно ту гонку,
 * ради которой штамп и заводился.
 */
export function nextLockStamp(lastIssuedMs: number, nowMs: number): number {
  if (!Number.isFinite(nowMs)) return lastIssuedMs + 1
  const now = Math.floor(nowMs)
  return now > lastIssuedMs ? now : lastIssuedMs + 1
}

export interface LockRegistry {
  /** Захват. null — по ролику уже крутится прогон этого процесса. */
  claim(videoId: number, nowMs: number): PipelineLockHandle | null
  /** Снятие своей блокировки. false — владелец уже другой (или блокировку сорвали отменой). */
  release(handle: PipelineLockHandle): boolean
  /** Осознанный срыв чужой блокировки — путь отмены. */
  forceRelease(videoId: number): void
  isBusy(videoId: number): boolean
  /** Штамп текущего владельца — для диагностики и тестов. */
  ownerStamp(videoId: number): number | null
}

export function createLockRegistry(): LockRegistry {
  const owners = new Map<number, number>()
  // Один счётчик на все ролики: штампы сравниваются только сами с собой,
  // глобальная монотонность лишь усиливает уникальность.
  let lastIssuedMs = 0

  return {
    claim(videoId, nowMs) {
      if (owners.has(videoId)) return null
      lastIssuedMs = nextLockStamp(lastIssuedMs, nowMs)
      owners.set(videoId, lastIssuedMs)
      return { videoId, stampMs: lastIssuedMs }
    },
    release(handle) {
      if (owners.get(handle.videoId) !== handle.stampMs) return false
      owners.delete(handle.videoId)
      return true
    },
    forceRelease(videoId) {
      owners.delete(videoId)
    },
    isBusy(videoId) {
      return owners.has(videoId)
    },
    ownerStamp(videoId) {
      return owners.get(videoId) ?? null
    },
  }
}
