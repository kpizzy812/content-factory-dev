import type { FavoritePrompt, FavoritePromptListMeta, FavoritePromptListQuery } from '~~/shared/types/favorite-prompt'

/**
 * Список избранных промтов с реактивным query (appId/tags/search/page/perPage).
 * Используется в библиотеке и picker'е пайплайна.
 */
export function useFavoritePrompts(
  query: Ref<FavoritePromptListQuery> | ComputedRef<FavoritePromptListQuery>,
) {
  return useFetch<{ data: FavoritePrompt[], meta: FavoritePromptListMeta }>(
    '/api/favorite-prompts',
    {
      query,
      default: () => ({
        data: [],
        meta: { total: 0, page: 1, perPage: 20, totalPages: 1 },
      }),
    },
  )
}
