/**
 * Сериализация AccountMetricsSnapshot из Prisma в DTO для HTTP-ответа.
 *
 * Главная задача — преобразовать BigInt-поля (followers/views/likes/...)
 * в string, чтобы JSON.stringify не падал. JSON стандарт не поддерживает
 * BigInt напрямую, поэтому frontend получает строки и форматирует их через
 * app/utils/format-bigint.ts при отображении.
 */
import type { AccountMetricsSnapshot } from "../../app/generated/prisma/client"
import type {
  AccountMetricsSnapshotDTO,
  NormalizedPost,
} from "../../shared/types/account-metrics"

function bigIntToString(v: bigint | null | undefined): string | null {
  if (v === null || v === undefined) return null
  return v.toString()
}

export function serializeSnapshot(
  s: AccountMetricsSnapshot,
  opts: { includeRaw: boolean },
): AccountMetricsSnapshotDTO {
  return {
    id: s.id,
    fetchedAt: s.fetchedAt.toISOString(),
    followers: bigIntToString(s.followers),
    following: bigIntToString(s.following),
    totalViews: bigIntToString(s.totalViews),
    totalLikes: bigIntToString(s.totalLikes),
    totalComments: bigIntToString(s.totalComments),
    postsCount: s.postsCount,
    avgViewsPer30d: bigIntToString(s.avgViewsPer30d),
    engagementRate: s.engagementRate,
    bio: s.bio,
    avatarUrl: s.avatarUrl,
    isVerified: s.isVerified,
    status: (s.status === "error" ? "error" : "ok"),
    errorMessage: s.errorMessage,
    rawData:
      opts.includeRaw && s.rawData
        ? (s.rawData as unknown as { sampleSize: number; posts: NormalizedPost[] })
        : null,
  }
}
