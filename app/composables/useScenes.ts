import type { Scene, SceneCreatePayload, SceneUpdatePayload, SceneBlock } from '~~/shared/types/scene'
import type { Character, CharacterReferenceImage } from '~~/shared/types/character'
import type { AppReferenceImage } from '~~/shared/types/app'

export interface SceneDetailResponse {
  scene: Scene
  blocks: SceneBlock[]
  characters: (Character & { referenceImages: CharacterReferenceImage[] })[]
  appScreens: AppReferenceImage[]
  compiled: {
    prompt: string
    negativePrompt: string
    referenceImageUrls: string[]
    referenceImages: Array<{ source: 'character' | 'app_screen'; sourceId: string; url: string; kind?: string }>
    characterIds: string[]
  }
}

/**
 * List composable — реактивный list сцен по фильтрам.
 *
 * Гард appId: useFetch с immediate:false + watch на hasAppId. Пока appId
 * undefined/null/'' — запрос не уходит, что убирает /api/scenes?... → 400 на старте.
 */
export function useScenes(query: MaybeRefOrGetter<Record<string, unknown>>) {
  const hasAppId = computed(() => {
    const v = (toValue(query) as Record<string, unknown> | undefined)?.appId
    return v !== undefined && v !== null && v !== ''
  })
  const fetcher = useFetch<{ data: Scene[] }>('/api/scenes', {
    query,
    watch: [query as any],
    server: false,
    immediate: false,
    default: () => ({ data: [] }) as any,
  })
  watch(hasAppId, (ok) => {
    if (ok) void fetcher.execute()
  }, { immediate: true })
  return fetcher
}

export function useScene(id: MaybeRefOrGetter<string>) {
  const idRef = computed(() => toValue(id))
  return useFetch<{ data: SceneDetailResponse }>(() => `/api/scenes/${idRef.value}`, {
    watch: [idRef],
    server: false,
  })
}

export function useSceneActions() {
  async function create(payload: SceneCreatePayload): Promise<Scene> {
    const res = await $fetch<{ data: Scene }>('/api/scenes', {
      method: 'POST',
      body: payload,
    })
    return res.data
  }

  async function update(id: string, payload: SceneUpdatePayload): Promise<Scene> {
    const res = await $fetch<{ data: Scene }>(`/api/scenes/${id}`, {
      method: 'PUT',
      body: payload,
    })
    return res.data
  }

  async function archive(id: string): Promise<void> {
    await $fetch(`/api/scenes/${id}`, { method: 'DELETE' })
  }

  async function generate(id: string): Promise<{ scenarioId: number; variantId: number; compiledPrompt: string; referenceImages: SceneDetailResponse['compiled']['referenceImages'] }> {
    const res = await $fetch<{ data: { scenarioId: number; variantId: number; compiledPrompt: string; referenceImages: SceneDetailResponse['compiled']['referenceImages'] } }>(`/api/scenes/${id}/generate`, {
      method: 'POST',
    })
    return res.data
  }

  /**
   * Регенерация одного блока сцены через AI (Sonnet).
   * Поддерживаются только kind ∈ {action, style, environment}.
   * Сервер сохраняет блок в Scene.blocks и возвращает свежий compiledPrompt.
   */
  async function regenerateBlock(sceneId: string, blockId: string, reason?: string): Promise<{ updatedBlock: SceneBlock; sceneCompiledPrompt: string | null }> {
    const res = await $fetch<{ data: { updatedBlock: SceneBlock; sceneCompiledPrompt: string | null } }>(
      `/api/scenes/${sceneId}/blocks/${blockId}/regenerate`,
      { method: 'POST', body: { reason } },
    )
    return res.data
  }

  return { create, update, archive, generate, regenerateBlock }
}
