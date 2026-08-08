import type { LegacyModuleMap } from '~~/shared/utils/legacy-modules'
import { LEGACY_MODULE_IDS } from '~~/shared/utils/legacy-modules'

type AuthProvider = 'local' | 'marketingcamp'

const ALL_OFF = Object.fromEntries(LEGACY_MODULE_IDS.map(id => [id, false])) as LegacyModuleMap

/**
 * Карта унаследованных зон для интерфейса. Стартовое состояние — всё выключено,
 * поэтому запрещённые пункты меню не мигают до ответа сервера.
 *
 * Оттуда же приезжает провайдер авторизации: по умолчанию ContentFactory логинит
 * сам, и подписи про MarketingCamp показываются только там, где он действительно
 * подключён. Стартовое значение — `local` по той же причине, что и выключенные
 * зоны: до ответа сервера лучше не обещать чужую платформу.
 */
export function useLegacyModules() {
  const state = useState<LegacyModuleMap>('legacy-modules', () => ({ ...ALL_OFF }))
  const authProvider = useState<AuthProvider>('auth-provider', () => 'local')

  const load = async () => {
    try {
      const response = await $fetch<{ data: LegacyModuleMap, authProvider?: AuthProvider }>('/api/product-modules')
      state.value = response.data
      authProvider.value = response.authProvider ?? 'local'
    } catch {
      state.value = { ...ALL_OFF }
      authProvider.value = 'local'
    }
  }

  return { legacyModules: state, authProvider, loadLegacyModules: load }
}
