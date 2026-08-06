/**
 * Подпись и фирменный цвет платформы.
 *
 * Единственное место в системе, где допустимы небрендовые фирменные цвета —
 * так записано в `UiPlatformBadge`. Вынесено в отдельный модуль, чтобы строки
 * списков могли показать ту же цветную метку, не заводя вторую копию значений.
 */
export interface PlatformMeta {
  label: string
  color: string
}

export const PLATFORM_META: Record<string, PlatformMeta> = {
  instagram: { label: 'Instagram', color: '#d6337f' },
  tiktok: { label: 'TikTok', color: '#25d8d0' },
  youtube: { label: 'YouTube', color: '#e34b4b' },
}

export function platformMeta(platform: string | null | undefined): PlatformMeta {
  const key = (platform ?? '').toLowerCase()
  return PLATFORM_META[key] ?? { label: platform ?? '—', color: 'var(--color-text-subtle)' }
}
