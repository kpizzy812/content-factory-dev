import type { PresenterSourceClip } from "~~/app/generated/prisma/client"
import { prisma } from "./prisma"
import {
  DEFAULT_PRESENTER_MAX_DELTA_SEC,
  pickClosestPresenterCandidate,
} from "./presenter/scene-clip-mapping"
import { buildPresenterDurationWindow } from "./presenter/duration-window"

interface ReservePresenterSourceClipInput {
  characterId: string
  durationSec: number
  /**
   * Границы длительности lip-sync модели (kling-lip-sync — 2-10 с).
   * Источник вне диапазона модель либо отвергнет, либо обрежет — в обоих случаях
   * сцена получит видео чужой длины и хронометраж ролика уедет от плановых 70-90 с.
   */
  minDurationSec?: number
  maxDurationSec?: number
  /** Предел расхождения с плановой длиной сцены (по умолчанию 1 с). */
  maxDeltaSec?: number
}

const MAX_RESERVATION_ATTEMPTS = 3
/** Дефолт под kling-lip-sync — на случай, если вызывающий границы не передал. */
const DEFAULT_MIN_DURATION_SEC = 2
const DEFAULT_MAX_DURATION_SEC = 10
/**
 * Сколько кандидатов тянем в память. Выборка уже сужена окном ±maxDeltaSec вокруг
 * плановой длины сцены, поэтому внутри пула все кандидаты по длительности почти
 * равнозначны и least-used — правильный порядок для усечения.
 */
const CANDIDATE_POOL_SIZE = 50

/**
 * Атомарно резервирует presenter source clip, подходящий сцене по длительности.
 * Serializable transaction не даёт параллельным renders постоянно забирать один clip.
 *
 * Кандидаты ограничены пересечением диапазона модели и окна ±maxDeltaSec вокруг
 * плановой длины сцены. Так узкое окно попадает прямо в SQL: сортировка по
 * usageCount с усечением пула отсекала бы клипы нужной длины у персонажа с сотней
 * нарезанных сегментов (ingest режет записи на куски 2-10 с), и сцена на 9 с могла
 * получить 3-секундный исходник просто потому, что тот реже использовался.
 * Если подходящего по длине исходника нет — честно возвращаем null, и вызывающий
 * остаётся на сгенерированном клипе.
 */
export async function reservePresenterSourceClip(
  input: ReservePresenterSourceClipInput,
): Promise<PresenterSourceClip | null> {
  const window = buildPresenterDurationWindow({
    sceneDurationSec: input.durationSec,
    minDurationSec: input.minDurationSec ?? DEFAULT_MIN_DURATION_SEC,
    maxDurationSec: input.maxDurationSec ?? DEFAULT_MAX_DURATION_SEC,
    maxDeltaSec: input.maxDeltaSec ?? DEFAULT_PRESENTER_MAX_DELTA_SEC,
  })
  // Сцена, которую модель физически не покрывает (например 30 с при пределе 10 с),
  // исходника ведущего не получает: любой клип укоротил бы её на месте.
  if (!window) return null

  for (let attempt = 1; attempt <= MAX_RESERVATION_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const candidates = await tx.presenterSourceClip.findMany({
          where: {
            characterId: input.characterId,
            isActive: true,
            durationSec: { gte: window.minSec, lte: window.maxSec },
          },
          // Порядок «наименее использованный» остаётся вторичным критерием:
          // pickClosestPresenterCandidate сохраняет его при равной близости длин.
          orderBy: [
            { usageCount: "asc" as const },
            { lastUsedAt: "asc" as const },
            { createdAt: "asc" as const },
          ],
          take: CANDIDATE_POOL_SIZE,
        })

        const candidate = pickClosestPresenterCandidate(candidates, window.targetSec, {
          maxDeltaSec: window.maxDeltaSec,
        })
        if (!candidate) return null

        return await tx.presenterSourceClip.update({
          where: { id: candidate.id },
          data: {
            usageCount: { increment: 1 },
            lastUsedAt: new Date(),
          },
        })
      }, { isolationLevel: "Serializable" })
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : ""
      if (code !== "P2034" || attempt === MAX_RESERVATION_ATTEMPTS) throw error
    }
  }

  return null
}
