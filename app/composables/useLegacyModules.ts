import type { LegacyModuleMap } from '~~/shared/utils/legacy-modules'
import { LEGACY_MODULE_IDS } from '~~/shared/utils/legacy-modules'

const ALL_OFF = Object.fromEntries(LEGACY_MODULE_IDS.map(id => [id, false])) as LegacyModuleMap

/**
 * Карта унаследованных зон для интерфейса. Стартовое состояние — всё выключено,
 * поэтому запрещённые пункты меню не мигают до ответа сервера.
 */
export function useLegacyModules() {
  const state = useState<LegacyModuleMap>('legacy-modules', () => ({ ...ALL_OFF }))

  const load = async () => {
    try {
      const response = await $fetch<{ data: LegacyModuleMap }>('/api/product-modules')
      state.value = response.data
    } catch {
      state.value = { ...ALL_OFF }
    }
  }

  return { legacyModules: state, loadLegacyModules: load }
}
