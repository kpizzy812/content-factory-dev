/**
 * Subtitle style helpers — единая точка нормализации SubtitleStyleProfile.
 *
 * Финальное значение wordsPerLine хранится в Video.subtitlesStyle.typography.wordsPerLine.
 * Bounds 3..6, default 4. Все источники (subtitle-director-agent, scenario-pipeline,
 * editor, render) проходят через normalizeSubtitleStyle перед записью в БД, чтобы
 * структура была единой и не возникало undefined / out-of-range.
 */

import type { SubtitleStyleProfile } from '~~/shared/types/story'
import {
  SUBTITLE_WORDS_PER_LINE_MIN,
  SUBTITLE_WORDS_PER_LINE_MAX,
  SUBTITLE_WORDS_PER_LINE_DEFAULT,
} from '~~/shared/types/story'

/** Clamp wordsPerLine в bounds 3..6 c fallback на default 4. */
export function clampWordsPerLine(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return SUBTITLE_WORDS_PER_LINE_DEFAULT
  }
  return Math.max(
    SUBTITLE_WORDS_PER_LINE_MIN,
    Math.min(SUBTITLE_WORDS_PER_LINE_MAX, Math.round(value)),
  )
}

/**
 * Нормализует произвольный SubtitleStyleProfile-like объект к каноническому виду.
 * Поддерживает ключи snake_case / wordsPerLineDefault как fallback и преобразует их
 * в camelCase wordsPerLine (compat для старых записей / AI выходов).
 */
export function normalizeSubtitleStyle(input: unknown): SubtitleStyleProfile {
  const src = (input ?? {}) as Record<string, unknown>
  const typographyRaw = (src.typography ?? {}) as Record<string, unknown>
  const visualRaw = (src.visual ?? {}) as Record<string, unknown>
  const animationRaw = (src.animation ?? {}) as Record<string, unknown>
  const consistencyRaw = (src.consistency ?? {}) as Record<string, unknown>

  const wordsRaw = typographyRaw.wordsPerLine
    ?? typographyRaw.words_per_line
    ?? typographyRaw.wordsPerLineDefault

  const casing = typographyRaw.casing
  const allowedCasing: SubtitleStyleProfile['typography']['casing'][] = [
    'uppercase', 'lowercase', 'sentence', 'mixed',
  ]
  const safeCasing = allowedCasing.includes(casing as never)
    ? casing as SubtitleStyleProfile['typography']['casing']
    : 'sentence'

  const entrance = animationRaw.entrance
  const allowedEntrance: SubtitleStyleProfile['animation']['entrance'][] = [
    'fade', 'slide_up', 'typewriter', 'pop', 'none',
  ]
  const safeEntrance = allowedEntrance.includes(entrance as never)
    ? entrance as SubtitleStyleProfile['animation']['entrance']
    : 'fade'

  return {
    typography: {
      fontIntent: typeof typographyRaw.fontIntent === 'string'
        ? typographyRaw.fontIntent
        : 'bold sans-serif',
      casing: safeCasing,
      maxLineLength: typeof typographyRaw.maxLineLength === 'number'
        ? typographyRaw.maxLineLength
        : 40,
      wordsPerLine: clampWordsPerLine(wordsRaw),
      maxLines: typeof typographyRaw.maxLines === 'number'
        ? Math.max(1, Math.min(3, Math.round(typographyRaw.maxLines)))
        : 2,
    },
    visual: {
      primaryColor: typeof visualRaw.primaryColor === 'string'
        ? visualRaw.primaryColor
        : '#FFFFFF',
      outlineColor: typeof visualRaw.outlineColor === 'string'
        ? visualRaw.outlineColor
        : '#000000',
      shadowEnabled: visualRaw.shadowEnabled !== false,
      backgroundColor: typeof visualRaw.backgroundColor === 'string'
        ? visualRaw.backgroundColor
        : null,
    },
    animation: {
      entrance: safeEntrance,
      exit: animationRaw.exit === 'slide_down' || animationRaw.exit === 'none'
        ? animationRaw.exit
        : 'fade',
      emphasis: animationRaw.emphasis === 'highlight'
        || animationRaw.emphasis === 'scale'
        || animationRaw.emphasis === 'color_shift'
        ? animationRaw.emphasis
        : 'none',
    },
    consistency: {
      maintainStyleAcrossScenes: consistencyRaw.maintainStyleAcrossScenes !== false,
      sceneOverrideAllowed: consistencyRaw.sceneOverrideAllowed === true,
    },
  }
}

/**
 * Deep-merge patch поверх existing SubtitleStyleProfile с финальной нормализацией.
 * Используется в edit-subtitles endpoint когда оператор присылает partial body.
 */
export function mergeSubtitleStyle(
  base: unknown,
  patch: Partial<SubtitleStyleProfile> | undefined | null,
): SubtitleStyleProfile {
  const normalizedBase = normalizeSubtitleStyle(base)
  if (!patch) return normalizedBase

  const merged: SubtitleStyleProfile = {
    typography: {
      ...normalizedBase.typography,
      ...(patch.typography ?? {}),
    },
    visual: {
      ...normalizedBase.visual,
      ...(patch.visual ?? {}),
    },
    animation: {
      ...normalizedBase.animation,
      ...(patch.animation ?? {}),
    },
    consistency: {
      ...normalizedBase.consistency,
      ...(patch.consistency ?? {}),
    },
  }
  return normalizeSubtitleStyle(merged)
}
