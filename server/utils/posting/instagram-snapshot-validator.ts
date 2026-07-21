/**
 * Валидация Instagram-специфичного contentSnapshot.
 *
 * Используется на edge в POST /api/posting-jobs + bulk.post.ts — отсеивает
 * невалидные snapshot до создания job. Параллель youtube-snapshot-validator.ts.
 *
 * Особенности Instagram (vs YouTube):
 *   - НЕТ visibility / madeForKids (десктоп-веб публикует Reel без этих опций).
 *   - caption + хэштеги считаются как ОДНО поле (IG помещает теги в caption) →
 *     суммарная длина ≤ 2200 символов.
 *   - hashtags: ≤30 шт, каждый тег без пробелов (валидный тег).
 *   - instagram.shareAsReel — boolean (опц., дефолт true; мягкая валидация).
 */

import {
  INSTAGRAM_CAPTION_MAX,
  INSTAGRAM_HASHTAGS_MAX_COUNT,
  computeInstagramCaptionLength,
} from "../../../shared/types/posting-instagram"

// Единый источник лимитов — shared/types/posting-instagram.ts. Здесь НЕ
// реэкспортируем (раньше дублирующий export ловил nuxt auto-import WARN). Потребители
// (UI, тесты) импортируют константы напрямую из shared-типа.

export class InstagramSnapshotValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "InstagramSnapshotValidationError"
  }
}

export function validateInstagramSnapshot(
  snapshot: Record<string, unknown>,
): void {
  // caption опционален, но если есть — строка.
  const caption = snapshot.caption
  if (caption !== undefined && caption !== null && typeof caption !== "string") {
    throw new InstagramSnapshotValidationError(
      "Instagram: contentSnapshot.caption должен быть строкой",
    )
  }

  // hashtags опциональны: массив строк, ≤30, каждый без пробелов.
  const hashtags = snapshot.hashtags
  if (hashtags !== undefined && hashtags !== null) {
    if (!Array.isArray(hashtags)) {
      throw new InstagramSnapshotValidationError(
        "Instagram: contentSnapshot.hashtags должен быть массивом строк",
      )
    }
    if (hashtags.length > INSTAGRAM_HASHTAGS_MAX_COUNT) {
      throw new InstagramSnapshotValidationError(
        `Instagram: число хэштегов превышает лимит ${INSTAGRAM_HASHTAGS_MAX_COUNT} (${hashtags.length})`,
      )
    }
    for (const tag of hashtags) {
      if (typeof tag !== "string") {
        throw new InstagramSnapshotValidationError(
          "Instagram: contentSnapshot.hashtags должен содержать только строки",
        )
      }
      // Тег не должен содержать пробелов (пробел разбивает тег в IG).
      if (/\s/.test(tag)) {
        throw new InstagramSnapshotValidationError(
          `Instagram: хэштег "${tag}" содержит пробел — невалидный тег`,
        )
      }
    }
  }

  // caption + хэштеги (конкатенация) ≤ 2200 — IG считает их в одном поле.
  const totalLen = computeInstagramCaptionLength(
    typeof caption === "string" ? caption : undefined,
    Array.isArray(hashtags) ? (hashtags as string[]) : undefined,
  )
  if (totalLen > INSTAGRAM_CAPTION_MAX) {
    throw new InstagramSnapshotValidationError(
      `Instagram: caption вместе с хэштегами превышает лимит ${INSTAGRAM_CAPTION_MAX} символов (${totalLen})`,
    )
  }

  // instagram.shareAsReel — мягкая валидация (опц., если есть → boolean).
  const ig = snapshot.instagram
  if (ig !== undefined && ig !== null) {
    if (typeof ig !== "object" || Array.isArray(ig)) {
      throw new InstagramSnapshotValidationError(
        "Instagram: contentSnapshot.instagram должен быть объектом",
      )
    }
    const igObj = ig as Record<string, unknown>
    if (
      igObj.shareAsReel !== undefined &&
      typeof igObj.shareAsReel !== "boolean"
    ) {
      throw new InstagramSnapshotValidationError(
        "Instagram: contentSnapshot.instagram.shareAsReel должен быть boolean",
      )
    }
  }
}
