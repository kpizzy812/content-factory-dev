/**
 * Валидация YouTube-специфичного contentSnapshot.
 *
 * Используется на edge в POST /api/posting-jobs — отсеивает невалидные snapshot
 * до создания job (fail-safe). Никаких дефолтов для visibility/madeForKids —
 * UI обязан прислать осознанные значения. Это защита постинг-фермы от
 * случайной публичной публикации.
 *
 * Лимиты согласованы с YouTube Studio 2026:
 *   - title: ≤100 chars
 *   - description: ≤5000 chars
 *   - hashtags total: ≤500 chars (мягкий guard, чтобы description не вылетал
 *     за 5000 после конкатенации хэштегов внутри poster).
 */

import {
  YOUTUBE_LIMITS,
  YOUTUBE_VISIBILITY_VALUES,
  type YoutubeVisibility,
} from "../../../shared/types/posting-youtube"

export { YOUTUBE_VISIBILITY_VALUES, type YoutubeVisibility }

export const YOUTUBE_TITLE_MAX = YOUTUBE_LIMITS.TITLE_MAX
export const YOUTUBE_DESCRIPTION_MAX = YOUTUBE_LIMITS.DESCRIPTION_MAX
export const YOUTUBE_HASHTAGS_TOTAL_MAX = YOUTUBE_LIMITS.HASHTAGS_TOTAL_MAX

export class YoutubeSnapshotValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "YoutubeSnapshotValidationError"
  }
}

export function validateYoutubeSnapshot(snapshot: Record<string, unknown>): void {
  const title = snapshot.title
  if (typeof title !== "string" || !title.trim()) {
    throw new YoutubeSnapshotValidationError(
      "YouTube: contentSnapshot.title обязателен (непустая строка)",
    )
  }
  if (title.length > YOUTUBE_TITLE_MAX) {
    throw new YoutubeSnapshotValidationError(
      `YouTube: contentSnapshot.title превышает лимит ${YOUTUBE_TITLE_MAX} chars (${title.length})`,
    )
  }

  const description = snapshot.description
  if (description !== undefined && description !== null) {
    if (typeof description !== "string") {
      throw new YoutubeSnapshotValidationError(
        "YouTube: contentSnapshot.description должен быть строкой",
      )
    }
    if (description.length > YOUTUBE_DESCRIPTION_MAX) {
      throw new YoutubeSnapshotValidationError(
        `YouTube: contentSnapshot.description превышает лимит ${YOUTUBE_DESCRIPTION_MAX} chars (${description.length})`,
      )
    }
  }

  const hashtags = snapshot.hashtags
  if (hashtags !== undefined && hashtags !== null) {
    if (!Array.isArray(hashtags)) {
      throw new YoutubeSnapshotValidationError(
        "YouTube: contentSnapshot.hashtags должен быть массивом строк",
      )
    }
    let totalLen = 0
    for (const tag of hashtags) {
      if (typeof tag !== "string") {
        throw new YoutubeSnapshotValidationError(
          "YouTube: contentSnapshot.hashtags должен содержать только строки",
        )
      }
      totalLen += tag.length + 1
    }
    if (totalLen > YOUTUBE_HASHTAGS_TOTAL_MAX) {
      throw new YoutubeSnapshotValidationError(
        `YouTube: суммарная длина hashtags превышает ${YOUTUBE_HASHTAGS_TOTAL_MAX} chars (${totalLen})`,
      )
    }
  }

  const yt = snapshot.youtube
  if (!yt || typeof yt !== "object" || Array.isArray(yt)) {
    throw new YoutubeSnapshotValidationError(
      "YouTube: contentSnapshot.youtube обязателен (объект с visibility и madeForKids)",
    )
  }
  const ytObj = yt as Record<string, unknown>

  const visibility = ytObj.visibility
  if (
    typeof visibility !== "string" ||
    !(YOUTUBE_VISIBILITY_VALUES as readonly string[]).includes(visibility)
  ) {
    throw new YoutubeSnapshotValidationError(
      `YouTube: contentSnapshot.youtube.visibility обязателен (${YOUTUBE_VISIBILITY_VALUES.join("|")})`,
    )
  }

  const madeForKids = ytObj.madeForKids
  if (typeof madeForKids !== "boolean") {
    throw new YoutubeSnapshotValidationError(
      "YouTube: contentSnapshot.youtube.madeForKids обязателен (boolean — YouTube требует явный выбор)",
    )
  }
}
