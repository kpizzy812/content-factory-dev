/**
 * Платформо-специфичные лимиты для captions и валидация.
 *
 * TikTok: caption (title) ≤ 150 символов в подписи под видео.
 *         Хэштеги учитываются в общей длине → жёсткий бюджет 100 символов
 *         (включая # и пробелы) и 5 тегов как практический максимум.
 *
 * YouTube Shorts: title ≤ 100 в самом видео-карточке.
 *                 description ≤ 5000 (в нашей модели не лимитим).
 *                 Поле tags ≤ 500 символов общей длины (через запятую).
 *
 * Instagram Reels: caption ≤ 2200, но preview обрезается на ~125.
 *                  До 30 хэштегов, бюджет 100 символов как practical TikTok-style cap.
 */

import type {
  PlatformCaption,
  PlatformLimits,
  SocialPlatform,
} from '~~/shared/types/caption'

export const PLATFORM_LIMITS: Record<SocialPlatform, PlatformLimits> = {
  tiktok: {
    titleMaxChars: 150,
    hashtagsMaxBudget: 100,
    hashtagsMaxCount: 5,
  },
  youtube: {
    titleMaxChars: 100,
    hashtagsMaxBudget: 500,
    hashtagsMaxCount: 15,
  },
  instagram: {
    titleMaxChars: 125,
    hashtagsMaxBudget: 100,
    hashtagsMaxCount: 30,
  },
}

/**
 * Длина hashtags-блока с префиксом # и пробелами между.
 * Пример: ['fyp', 'viral'] → '#fyp #viral' (11 chars).
 */
export function calculateHashtagsLength(hashtags: string[]): number {
  if (hashtags.length === 0) return 0
  return hashtags.map((h) => `#${h.trim()}`).join(' ').length
}

export interface ValidateCaptionResult {
  valid: boolean
  errors: string[]
}

/**
 * Валидация одной caption по лимитам платформы.
 * Не модифицирует объект — только сообщает что не так.
 */
export function validateCaption(c: PlatformCaption): ValidateCaptionResult {
  const errors: string[] = []
  const limits = PLATFORM_LIMITS[c.platform]

  if (!limits) {
    return { valid: false, errors: [`Неизвестная платформа: ${c.platform}`] }
  }

  if (typeof c.title !== 'string' || c.title.trim().length === 0) {
    errors.push('Title пустой')
  } else if (c.title.length > limits.titleMaxChars) {
    errors.push(
      `Title ${c.title.length} символов превышает лимит ${limits.titleMaxChars} для ${c.platform}`,
    )
  }

  if (!Array.isArray(c.hashtags)) {
    errors.push('Hashtags не массив')
  } else {
    if (
      typeof limits.hashtagsMaxCount === 'number'
      && c.hashtags.length > limits.hashtagsMaxCount
    ) {
      errors.push(
        `Hashtags: ${c.hashtags.length} тегов больше лимита ${limits.hashtagsMaxCount} для ${c.platform}`,
      )
    }
    const totalLen = calculateHashtagsLength(c.hashtags)
    if (totalLen > limits.hashtagsMaxBudget) {
      errors.push(
        `Hashtags бюджет ${totalLen}/${limits.hashtagsMaxBudget} символов превышен для ${c.platform}`,
      )
    }
    for (const h of c.hashtags) {
      if (typeof h !== 'string') {
        errors.push('Hashtag должен быть строкой')
        break
      }
      if (h.startsWith('#')) {
        errors.push(`Hashtag "${h}" содержит # — должен быть без префикса`)
      }
      if (h.includes(' ')) {
        errors.push(`Hashtag "${h}" содержит пробел`)
      }
    }
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Возвращает limits для платформы — utility для UI.
 */
export function getLimitsFor(platform: SocialPlatform): PlatformLimits {
  return PLATFORM_LIMITS[platform]
}
