import type {
  FavoritePrompt,
  FavoritePromptCreateInput,
  FavoritePromptUpdateInput,
} from '~~/shared/types/favorite-prompt'

/**
 * CRUD-действия над избранными промтами.
 * Возвращают сырые данные — уведомления и refresh делает caller.
 */
export function useFavoritePromptActions() {
  async function createFavoritePrompt(input: FavoritePromptCreateInput) {
    const res = await $fetch<{ data: FavoritePrompt }>('/api/favorite-prompts', {
      method: 'POST',
      body: input,
    })
    return res.data
  }

  async function updateFavoritePrompt(id: number, input: FavoritePromptUpdateInput) {
    const res = await $fetch<{ data: FavoritePrompt }>(`/api/favorite-prompts/${id}`, {
      method: 'PUT',
      body: input,
    })
    return res.data
  }

  async function removeFavoritePrompt(id: number) {
    return $fetch<{ data: { id: number }, meta: { deleted: true } }>(
      `/api/favorite-prompts/${id}`,
      { method: 'DELETE' },
    )
  }

  async function reanalyzeFavoritePrompt(id: number) {
    const res = await $fetch<{ data: FavoritePrompt }>(
      `/api/favorite-prompts/${id}/reanalyze`,
      { method: 'POST' },
    )
    return res.data
  }

  return {
    createFavoritePrompt,
    updateFavoritePrompt,
    removeFavoritePrompt,
    reanalyzeFavoritePrompt,
  }
}
