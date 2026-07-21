import type { Character, CharacterCreatePayload, CharacterUpdatePayload, CharacterReferenceKind } from '~~/shared/types/character'

/** List composable — реактивный list по фильтрам. server:false — appId часто undefined
 *  на старте, SSR-fetch без него падал бы 400 от endpoint.
 *
 *  Гард appId: пока query.appId пуст/undefined, useFetch НЕ выполняется (immediate:false).
 *  После того как appId появится в filtersStore, watcher триггерит execute(). Это убирает
 *  лишние /api/characters?... → 400 на старте загрузки страницы (до hydration filtersStore). */
export function useCharacters(query: MaybeRefOrGetter<Record<string, unknown>>) {
  const hasAppId = computed(() => {
    const v = (toValue(query) as Record<string, unknown> | undefined)?.appId
    return v !== undefined && v !== null && v !== ''
  })
  const fetcher = useFetch<{ data: Character[] }>('/api/characters', {
    query,
    watch: [query as any],
    server: false,
    immediate: false,
    default: () => ({ data: [] }) as any,
  })
  // Выполняем сразу как только appId стал valid; перезапускаем при смене appId.
  watch(hasAppId, (ok) => {
    if (ok) void fetcher.execute()
  }, { immediate: true })
  return fetcher
}

/** Detail composable. */
export function useCharacter(id: MaybeRefOrGetter<string>) {
  const idRef = computed(() => toValue(id))
  return useFetch<{ data: Character }>(() => `/api/characters/${idRef.value}`, {
    watch: [idRef],
    server: false,
  })
}

/** Actions (CRUD + references) — императивные вызовы, не реактивные. */
export function useCharacterActions() {
  async function create(payload: CharacterCreatePayload): Promise<Character> {
    const res = await $fetch<{ data: Character }>('/api/characters', {
      method: 'POST',
      body: payload,
    })
    return res.data
  }

  async function update(id: string, payload: CharacterUpdatePayload): Promise<Character> {
    const res = await $fetch<{ data: Character }>(`/api/characters/${id}`, {
      method: 'PUT',
      body: payload,
    })
    return res.data
  }

  async function archive(id: string): Promise<void> {
    await $fetch(`/api/characters/${id}`, { method: 'DELETE' })
  }

  async function uploadReferences(id: string, files: File[], kind: CharacterReferenceKind = 'face'): Promise<Character> {
    const fd = new FormData()
    fd.append('kind', kind)
    for (const f of files) fd.append('files', f)
    const res = await $fetch<{ data: { character: Character; createdIds: string[] } }>(`/api/characters/${id}/references`, {
      method: 'POST',
      body: fd,
    })
    return res.data.character
  }

  async function deleteReference(characterId: string, refId: string): Promise<Character> {
    const res = await $fetch<{ data: { character: Character } }>(`/api/characters/${characterId}/references/${refId}`, {
      method: 'DELETE',
    })
    return res.data.character
  }

  /**
   * AI-регенерация одного поля персонажа (description или visualPrompt).
   * Sonnet через character-block-regenerator agent + reason от оператора.
   */
  async function regenerateBlock(
    id: string,
    blockType: 'description' | 'visualPrompt',
    reason?: string,
  ): Promise<{ newValue: string; oldValue: string; blockType: 'description' | 'visualPrompt' }> {
    const res = await $fetch<{ data: { newValue: string; oldValue: string; blockType: 'description' | 'visualPrompt' } }>(
      `/api/characters/${id}/regenerate`,
      { method: 'POST', body: { blockType, reason } },
    )
    return res.data
  }

  return { create, update, archive, uploadReferences, deleteReference, regenerateBlock }
}
