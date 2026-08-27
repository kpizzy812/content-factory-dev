import type { EditProfile } from '~~/shared/types/edit-console'

/**
 * Монтажный профиль ролика.
 *
 * Ручки «отдай профиль по id» на сервере нет: профили читаются списком по
 * приложению (`GET /api/edit-profiles?appId=N`), а `appId` у ролика напрямую
 * не лежит — он живёт на сценарии. Поэтому цепочка из двух запросов, и оба
 * необязательные: у оператора может не быть доступа к модулю сценариев, и
 * тогда консоль просто не покажет потолки, а не свалится.
 */
export function useVideoEditProfile() {
  const profile = ref<EditProfile | null>(null)
  const pending = ref(false)
  /** Профиль недоступен по правам или его нет — это не ошибка экрана. */
  const unavailable = ref(false)

  async function load(scenarioId: number | null, editProfileId: number | null | undefined) {
    if (!scenarioId) {
      unavailable.value = true
      return
    }
    pending.value = true
    unavailable.value = false
    try {
      const scenario = await $fetch<{ data?: { appId?: number | null } }>(`/api/scenarios/${scenarioId}`)
      const appId = scenario?.data?.appId ?? null
      if (!appId) {
        unavailable.value = true
        return
      }

      const list = await $fetch<{ data?: EditProfile[] }>('/api/edit-profiles', { query: { appId } })
      const profiles = list?.data ?? []
      profile.value = profiles.find(p => p.id === editProfileId)
        ?? profiles.find(p => p.isDefault)
        ?? null
      unavailable.value = profile.value === null
    }
    catch {
      // Нет прав на модуль сценариев или профилей у приложения нет —
      // консоль работает без потолков, а не показывает ошибку.
      unavailable.value = true
    }
    finally {
      pending.value = false
    }
  }

  return { profile, pending, unavailable, load }
}
