/**
 * Account Style Context Helper
 * Загружает, резолвит и форматирует account style profile для использования
 * в scenario-pipeline, video-pipeline, subtitle generation и промптах.
 *
 * Иерархия: Account profile → Group base style → App defaults → fallback пустой.
 */

import type {
  AccountStyleProfileData,
  GroupStylePolicy,
  StyleProfileStatus,
} from '~~/shared/types/account-style'
import { defaultAccountStyleProfileData } from '~~/shared/types/account-style'

export interface ResolvedAccountStyle {
  /** Итоговый стиль после merge account + group */
  data: AccountStyleProfileData
  /** Источник: account | group | fallback */
  source: 'account' | 'group' | 'fallback'
  /** Статус профиля */
  status: StyleProfileStatus
  /** ID профиля (если есть) */
  profileId: number | null
  /** Версия профиля */
  version: number
}

/**
 * Загружает style profile для конкретного аккаунта.
 * Учитывает group policy если аккаунт входит в группу.
 */
export async function getAccountStyleContext(socialAccountId: number): Promise<ResolvedAccountStyle> {
  // Загружаем профиль аккаунта
  const profile = await prisma.accountStyleProfile.findUnique({
    where: { socialAccountId },
  })

  // Загружаем группу аккаунта с policy
  const membership = await prisma.accountGroupMember.findFirst({
    where: { socialAccountId },
    include: {
      group: {
        select: {
          id: true,
          styleMode: true,
          stylePolicy: true,
        },
      },
    },
  })

  const groupPolicy = (membership?.group?.stylePolicy ?? null) as GroupStylePolicy | null
  const groupStyleMode = membership?.group?.styleMode ?? 'independent'

  // Если есть профиль аккаунта
  if (profile) {
    const accountData = profile.data as unknown as AccountStyleProfileData

    // Если группа в режиме unified — игнорируем аккаунтный профиль, берём групповой
    if (groupStyleMode === 'unified' && groupPolicy?.baseStyle) {
      const mergedData = mergeStyleData(defaultAccountStyleProfileData, groupPolicy.baseStyle)
      return {
        data: mergedData,
        source: 'group',
        status: computeStyleStatus(mergedData),
        profileId: profile.id,
        version: profile.version,
      }
    }

    // Если base_with_overrides — мержим группу + аккаунт
    if (groupStyleMode === 'base_with_overrides' && groupPolicy?.baseStyle) {
      const baseData = mergeStyleData(defaultAccountStyleProfileData, groupPolicy.baseStyle)
      // Накладываем только разрешённые секции из аккаунта
      const overridable = groupPolicy.overridableSections ?? []
      const finalData = structuredClone(baseData)
      const finalAny = finalData as unknown as Record<string, unknown>
      const accountAny = accountData as unknown as Record<string, unknown>
      for (const section of overridable) {
        if (section in accountData) {
          finalAny[section] = accountAny[section]
        }
      }
      return {
        data: finalData,
        source: 'account',
        status: computeStyleStatus(finalData as AccountStyleProfileData),
        profileId: profile.id,
        version: profile.version,
      }
    }

    // Independent или нет группы — просто аккаунтный профиль
    return {
      data: accountData,
      source: 'account',
      status: profile.status as StyleProfileStatus,
      profileId: profile.id,
      version: profile.version,
    }
  }

  // Нет профиля у аккаунта — пробуем group base style
  if (groupStyleMode !== 'independent' && groupPolicy?.baseStyle) {
    const groupData = mergeStyleData(defaultAccountStyleProfileData, groupPolicy.baseStyle)
    return {
      data: groupData,
      source: 'group',
      status: computeStyleStatus(groupData),
      profileId: null,
      version: 0,
    }
  }

  // Полный fallback
  return {
    data: defaultAccountStyleProfileData,
    source: 'fallback',
    status: 'not_set',
    profileId: null,
    version: 0,
  }
}

/**
 * Форматирует account style для вставки в промпт AI-агента.
 * Возвращает пустую строку если стиль не задан.
 */
export function formatAccountStyleForPrompt(style: ResolvedAccountStyle): string {
  if (style.status === 'not_set') return ''

  const { data } = style
  const lines: string[] = ['## Account Style Identity']

  // Tone
  if (data.tone.voice) {
    lines.push(`### Tone of Voice`)
    lines.push(`- Голос: ${data.tone.voice}`)
    if (data.tone.narratorPersona) lines.push(`- Персона: ${data.tone.narratorPersona}`)
    lines.push(`- Формальность: ${data.tone.formality}`)
    if (data.tone.emotionalRange.length > 0) {
      lines.push(`- Эмоциональный диапазон: ${data.tone.emotionalRange.join(', ')}`)
    }
    if (data.tone.forbiddenPhrases.length > 0) {
      lines.push(`- ЗАПРЕЩЁННЫЕ фразы: ${data.tone.forbiddenPhrases.join('; ')}`)
    }
  }

  // Visual language
  if (data.visual.aesthetic || data.visual.colorPalette.length > 0) {
    lines.push(`### Visual Language`)
    if (data.visual.colorPalette.length > 0) lines.push(`- Палитра: ${data.visual.colorPalette.join(', ')}`)
    if (data.visual.aesthetic) lines.push(`- Эстетика: ${data.visual.aesthetic}`)
    if (data.visual.lighting) lines.push(`- Освещение: ${data.visual.lighting}`)
    if (data.visual.cameraStyle) lines.push(`- Камера: ${data.visual.cameraStyle}`)
    if (data.visual.forbiddenVisuals.length > 0) {
      lines.push(`- Запрещённые визуалы: ${data.visual.forbiddenVisuals.join('; ')}`)
    }
  }

  // Subtitle style
  if (data.subtitles.fontIntent) {
    lines.push(`### Subtitle Style`)
    lines.push(`- Шрифт: ${data.subtitles.fontIntent}, ${data.subtitles.casing}`)
    lines.push(`- Цвет: ${data.subtitles.primaryColor}${data.subtitles.outlineColor ? `, обводка: ${data.subtitles.outlineColor}` : ''}`)
    lines.push(`- Анимация: ${data.subtitles.entrance}`)
    lines.push(`- Позиция: ${data.subtitles.defaultPosition}`)
  }

  // Protagonist
  if (data.protagonist.visualStyle || data.protagonist.preferredType !== 'any') {
    lines.push(`### Protagonist Conventions`)
    lines.push(`- Тип: ${data.protagonist.preferredType}`)
    if (data.protagonist.visualStyle) lines.push(`- Визуальный стиль: ${data.protagonist.visualStyle}`)
    if (data.protagonist.recurringMarkers.length > 0) {
      lines.push(`- Повторяющиеся маркеры: ${data.protagonist.recurringMarkers.join(', ')}`)
    }
    if (data.protagonist.restrictions.length > 0) {
      lines.push(`- Ограничения: ${data.protagonist.restrictions.join('; ')}`)
    }
  }

  // CTA
  if (data.cta.examples.length > 0 || data.cta.forbidden.length > 0) {
    lines.push(`### CTA Behavior`)
    lines.push(`- Стиль: ${data.cta.style}`)
    if (data.cta.examples.length > 0) lines.push(`- Хорошие примеры: ${data.cta.examples.join('; ')}`)
    if (data.cta.forbidden.length > 0) lines.push(`- Запрещённые: ${data.cta.forbidden.join('; ')}`)
  }

  // Editing rhythm
  if (data.editing.pacing || data.editing.preferredDuration) {
    lines.push(`### Editing Rhythm`)
    lines.push(`- Темп: ${data.editing.pacing}, ~${data.editing.preferredDuration}с`)
    lines.push(`- Сцен: ~${data.editing.preferredSceneCount}`)
    if (data.editing.transitionStyle) lines.push(`- Переходы: ${data.editing.transitionStyle}`)
  }

  // Experimentation constraints
  lines.push(`### Constraints`)
  lines.push(`- Допустимость эксперимента: ${data.experimentationDegree}/100`)
  lines.push(`- Строгость стиля: ${data.consistencyStrictness}/100`)

  if (lines.length <= 1) return '' // only header, nothing filled
  return lines.join('\n')
}

/**
 * Мержит partial data в полный профиль.
 */
function mergeStyleData(
  base: AccountStyleProfileData,
  partial: Partial<AccountStyleProfileData>,
): AccountStyleProfileData {
  const result = structuredClone(base)
  const resultAny = result as unknown as Record<string, unknown>
  const baseAny = base as unknown as Record<string, unknown>

  for (const key of Object.keys(partial)) {
    const val = (partial as unknown as Record<string, unknown>)[key]
    if (val !== undefined && val !== null) {
      if (typeof val === 'object' && !Array.isArray(val)) {
        resultAny[key] = {
          ...(baseAny[key] as Record<string, unknown>),
          ...(val as Record<string, unknown>),
        }
      }
      else {
        resultAny[key] = val
      }
    }
  }
  return result
}

/**
 * Вычисляет статус профиля на основе заполненности данных.
 */
export function computeStyleStatus(data: AccountStyleProfileData): StyleProfileStatus {
  let filledSections = 0
  const totalSections = 7 // tone, visual, subtitles, protagonist, cta, editing, preview

  if (data.tone.voice) filledSections++
  if (data.visual.aesthetic || data.visual.colorPalette.length > 0) filledSections++
  if (data.subtitles.primaryColor !== '#FFFFFF' || data.subtitles.fontIntent !== 'bold sans-serif') filledSections++
  if (data.protagonist.visualStyle || data.protagonist.preferredType !== 'any') filledSections++
  if (data.cta.examples.length > 0) filledSections++
  if (data.editing.transitionStyle || data.editing.pacing !== 'moderate') filledSections++
  if (data.preview.thumbnailApproach) filledSections++

  if (filledSections === 0) return 'not_set'
  if (filledSections >= 4) return 'complete'
  return 'partial'
}
