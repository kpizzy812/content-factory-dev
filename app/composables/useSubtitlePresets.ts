import type { SubtitlePresetMeta, SubtitlePresetKey } from '~~/shared/types/subtitle-preset'

/**
 * Список пресетов субтитров — статика, кэшируется на сессию через useFetch с фиксированным
 * key. Помогает компонентам (Picker / Editor) переиспользовать один запрос.
 */
export function useSubtitlePresets() {
  const { data, pending, error, refresh } = useFetch<{ data: SubtitlePresetMeta[] }>(
    '/api/subtitles/presets',
    {
      key: 'subtitle-presets',
      default: () => ({ data: [] }),
    },
  )

  const presets = computed<SubtitlePresetMeta[]>(() => data.value?.data ?? [])

  function getPreset(key: SubtitlePresetKey | string | null | undefined): SubtitlePresetMeta | null {
    if (!key) return null
    return presets.value.find(p => p.key === key) ?? null
  }

  return {
    presets,
    loading: pending,
    error,
    refresh,
    getPreset,
  }
}
