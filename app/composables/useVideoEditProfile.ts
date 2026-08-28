import type { EditProfile } from '~~/shared/types/edit-console'
import { fetchEditProfile } from '~/components/video/edit-console-api'

/**
 * Монтажный профиль ролика.
 *
 * Короткий путь — `GET /api/edit-profiles/:id`, одна ручка своего же модуля.
 * Он работает, когда профиль на ролике проставлен явно (`Video.editProfileId`).
 *
 * Длинный путь остаётся запасным и нужен ровно для роликов БЕЗ явного профиля:
 * такой ролик собирается по дефолтному профилю приложения, а `appId` у ролика
 * напрямую не лежит — он живёт на сценарии. Цена длинного пути в том, что он
 * идёт через ЧУЖОЙ модуль (`script-generator`): у оператора без доступа к
 * сценариям он не сработает, и консоль просто не покажет потолки, а не
 * свалится.
 */
export function useVideoEditProfile() {
  const profile = ref<EditProfile | null>(null)
  const pending = ref(false)
  /** Профиль недоступен по правам или его нет — это не ошибка экрана. */
  const unavailable = ref(false)

  async function load(scenarioId: number | null, editProfileId: number | null | undefined) {
    if (editProfileId) {
      pending.value = true
      unavailable.value = false
      try {
        profile.value = await fetchEditProfile($fetch, editProfileId)
        if (profile.value) return
      }
      catch {
        // Профиль удалён или недоступен — пробуем дефолтный профиль приложения
        // ниже, вместо того чтобы объявить консоль сломанной.
      }
      finally {
        pending.value = false
      }
    }

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
