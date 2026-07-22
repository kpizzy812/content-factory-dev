import type { PresenterSourceClip } from "~~/app/generated/prisma/client"
import { prisma } from "./prisma"

interface ReservePresenterSourceClipInput {
  characterId: string
  durationSec: number
}

const MAX_RESERVATION_ATTEMPTS = 3

/**
 * Атомарно резервирует наименее использованный presenter source clip подходящей длины.
 * Serializable transaction не даёт параллельным renders постоянно забирать один clip.
 */
export async function reservePresenterSourceClip(
  input: ReservePresenterSourceClipInput,
): Promise<PresenterSourceClip | null> {
  const target = Math.max(2, Math.min(10, input.durationSec))

  for (let attempt = 1; attempt <= MAX_RESERVATION_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const commonWhere = {
          characterId: input.characterId,
          isActive: true,
        }
        const orderBy = [
          { usageCount: "asc" as const },
          { lastUsedAt: "asc" as const },
          { createdAt: "asc" as const },
        ]

        const exact = await tx.presenterSourceClip.findFirst({
          where: {
            ...commonWhere,
            durationSec: { gte: target - 0.35, lte: target + 0.35 },
          },
          orderBy,
        })
        const candidate = exact ?? await tx.presenterSourceClip.findFirst({
          where: commonWhere,
          orderBy,
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
