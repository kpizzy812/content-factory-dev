import type { FavoritePrompt } from '~~/shared/types/favorite-prompt'

/**
 * Детальная карточка избранного промта (включая app и sourceVideoAsset).
 */
export function useFavoritePromptDetail(id: Ref<number | null> | ComputedRef<number | null>) {
  return useFetch<{ data: FavoritePrompt }>(
    () => `/api/favorite-prompts/${id.value ?? 0}`,
    {
      immediate: false,
      watch: [id],
    },
  )
}
