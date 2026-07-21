/**
 * useSceneReferences — загрузка/удаление эталонных кадров сцены + повторный
 * AI vision запуск. По UX зеркалит useAppReferenceImages.
 */
import type { SceneReferenceImage, SceneReferenceKind } from '~~/shared/types/scene'

interface UploadOptions {
  sceneId: MaybeRefOrGetter<string>
  initial?: SceneReferenceImage[]
}

interface ListResponse {
  data: { referenceImages: SceneReferenceImage[] }
}
interface UploadResponse {
  data: { referenceImages: SceneReferenceImage[]; createdIds: string[] }
}

export function useSceneReferences(opts: UploadOptions) {
  const sceneIdRef = computed(() => toValue(opts.sceneId))
  const references = ref<SceneReferenceImage[]>(opts.initial ?? [])
  const uploading = ref(false)
  const deletingId = ref<string | null>(null)
  const analyzingId = ref<string | null>(null)
  const error = ref('')

  function endpoint(): string {
    return `/api/scenes/${sceneIdRef.value}/references`
  }

  async function refresh(): Promise<void> {
    try {
      const res = await $fetch<ListResponse>(endpoint(), { method: 'GET' })
      references.value = res.data.referenceImages
    } catch (e: any) {
      error.value = e?.data?.message || e?.message || 'Не удалось загрузить референсы'
    }
  }

  async function upload(files: File[], kind: SceneReferenceKind = 'mood'): Promise<void> {
    if (!files.length) return
    const images = files.filter(f => f.type.startsWith('image/'))
    if (!images.length) {
      error.value = 'Нужны файлы-изображения'
      return
    }
    uploading.value = true
    error.value = ''
    try {
      const fd = new FormData()
      fd.append('kind', kind)
      for (const f of images) fd.append('files', f)
      const res = await $fetch<UploadResponse>(endpoint(), { method: 'POST', body: fd })
      references.value = res.data.referenceImages
    } catch (e: any) {
      error.value = e?.data?.message || e?.message || 'Ошибка загрузки'
    } finally {
      uploading.value = false
    }
  }

  async function remove(refId: string): Promise<void> {
    deletingId.value = refId
    error.value = ''
    try {
      const res = await $fetch<ListResponse>(`${endpoint()}/${refId}`, { method: 'DELETE' })
      references.value = res.data.referenceImages
    } catch (e: any) {
      error.value = e?.data?.message || e?.message || 'Ошибка удаления'
    } finally {
      deletingId.value = null
    }
  }

  async function reanalyze(refId: string): Promise<void> {
    analyzingId.value = refId
    error.value = ''
    try {
      const res = await $fetch<{ data: { reference: SceneReferenceImage } }>(`${endpoint()}/${refId}/analyze`, {
        method: 'POST',
      })
      const idx = references.value.findIndex(r => r.id === refId)
      if (idx >= 0 && res.data?.reference) references.value.splice(idx, 1, res.data.reference)
    } catch (e: any) {
      error.value = e?.data?.message || e?.message || 'Ошибка AI-анализа'
    } finally {
      analyzingId.value = null
    }
  }

  async function handlePaste(event: ClipboardEvent, kind: SceneReferenceKind = 'mood'): Promise<void> {
    const items = event.clipboardData?.items
    if (!items) return
    const files: File[] = []
    for (const item of Array.from(items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile()
        if (f) files.push(f)
      }
    }
    if (files.length === 0) return
    event.preventDefault()
    await upload(files, kind)
  }

  return {
    references,
    uploading: readonly(uploading),
    deletingId: readonly(deletingId),
    analyzingId: readonly(analyzingId),
    error: readonly(error),
    refresh,
    upload,
    remove,
    reanalyze,
    handlePaste,
  }
}
