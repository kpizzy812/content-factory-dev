/**
 * useAppReferenceImages — загрузка/удаление reference-картинок приложения и
 * перезапуск AI-анализа скриншотов через screen-tagger-agent.
 *
 * Composable хранит ДВА связанных состояния:
 *  - urls: string[] — для backward compat и legacy потребителей.
 *  - references: AppReferenceImage[] — богатые записи с aiTags / aiCaption / aiAnalyzedAt.
 *
 * Полное обновление обоих идёт через GET /api/admin/apps/:id/reference-images
 * (новый endpoint), POST/DELETE возвращают оба массива в одном ответе.
 */
import type { AppReferenceImage } from '~~/shared/types/app'

export interface UseAppReferenceImagesOptions {
  /** ID приложения */
  appId: number | Ref<number>
  /** Стартовый массив URL — чтобы не ждать первый refresh */
  initial?: string[]
  /** Стартовый массив богатых записей — то же самое, но с метаданными */
  initialReferences?: AppReferenceImage[]
}

interface BulkResponse {
  data: {
    referenceImageUrls: string[]
    referenceImages: AppReferenceImage[]
  }
}

interface UploadResponse {
  data: {
    added: string[]
    referenceImageUrls: string[]
    referenceImages: AppReferenceImage[]
  }
}

export function useAppReferenceImages(opts: UseAppReferenceImagesOptions) {
  const appId = computed(() => unref(opts.appId))
  const urls = ref<string[]>(opts.initial ?? [])
  const references = ref<AppReferenceImage[]>(opts.initialReferences ?? [])
  const uploading = ref(false)
  const deletingUrl = ref<string | null>(null)
  const analyzingRefId = ref<string | null>(null)
  const error = ref('')

  function endpoint(): string {
    return `/api/admin/apps/${appId.value}/reference-images`
  }

  function applyBulk(payload: BulkResponse['data']): void {
    urls.value = payload.referenceImageUrls ?? []
    references.value = payload.referenceImages ?? []
  }

  async function refresh(): Promise<void> {
    try {
      const res = await $fetch<BulkResponse>(endpoint(), { method: 'GET' })
      applyBulk(res.data)
    }
    catch (e: any) {
      error.value = e?.data?.message || e?.message || 'Не удалось загрузить референсы'
    }
  }

  /**
   * Загружает массив File → отправляет multipart на upload endpoint.
   * Возвращает актуальный массив URL.
   */
  async function upload(files: File[]): Promise<string[]> {
    if (!files.length) return urls.value
    const imageFiles = files.filter(f => f.type.startsWith('image/'))
    if (!imageFiles.length) {
      error.value = 'Нужны файлы-изображения'
      return urls.value
    }

    uploading.value = true
    error.value = ''

    const formData = new FormData()
    for (const f of imageFiles) {
      formData.append('files', f)
    }

    try {
      const res = await $fetch<UploadResponse>(endpoint(), { method: 'POST', body: formData })
      applyBulk({
        referenceImageUrls: res.data.referenceImageUrls,
        referenceImages: res.data.referenceImages,
      })
      return urls.value
    }
    catch (e: any) {
      error.value = e?.data?.message || e?.message || 'Ошибка загрузки'
      return urls.value
    }
    finally {
      uploading.value = false
    }
  }

  async function remove(target: string | { id: string; url?: string }): Promise<void> {
    const isObj = typeof target === 'object' && target !== null
    const removeUrl = isObj ? target.url : target
    const removeId = isObj ? target.id : undefined

    deletingUrl.value = removeUrl ?? null
    error.value = ''
    try {
      const res = await $fetch<BulkResponse>(endpoint(), {
        method: 'DELETE',
        body: removeId ? { id: removeId } : { url: removeUrl },
      })
      applyBulk(res.data)
    }
    catch (e: any) {
      error.value = e?.data?.message || e?.message || 'Ошибка удаления'
    }
    finally {
      deletingUrl.value = null
    }
  }

  /**
   * Запускает повторный AI-анализ скриншота. Используется когда aiAnalyzedAt=null
   * (фоновый запуск завис) или aiError != null (предыдущий анализ упал).
   * Endpoint синхронный — ждём итог, чтобы UI сразу подтянул свежие aiTags/aiCaption.
   */
  async function reanalyze(refId: string): Promise<void> {
    analyzingRefId.value = refId
    error.value = ''
    try {
      const res = await $fetch<{ data: { reference: AppReferenceImage } }>(
        `${endpoint()}/${refId}/analyze`,
        { method: 'POST' },
      )
      const updated = res.data?.reference
      if (updated) {
        const idx = references.value.findIndex(r => r.id === refId)
        if (idx >= 0) {
          references.value.splice(idx, 1, updated)
        }
      }
    }
    catch (e: any) {
      error.value = e?.data?.message || e?.message || 'Не удалось перезапустить AI-анализ'
    }
    finally {
      analyzingRefId.value = null
    }
  }

  /**
   * Обрабатывает событие paste — ищет image-элементы в clipboardData.items,
   * извлекает File и отправляет на upload. Удобно биндить на модалку/textarea.
   * Работает только при активном фокусе на editable-элементе.
   */
  async function handlePaste(event: ClipboardEvent): Promise<void> {
    const items = event.clipboardData?.items
    if (!items) return

    const files: File[] = []
    for (const item of Array.from(items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) files.push(file)
      }
    }

    if (files.length === 0) return
    event.preventDefault()
    await upload(files)
  }

  /**
   * Явный pull картинки из clipboard через Clipboard API. Вызывается из обработчика
   * клика (user gesture). Кроме самого read() проверяет permission state и гарантирует
   * что документ в фокусе — именно потеря фокуса была причиной NotAllowedError у
   * пользователей, когда после клика открывался browser permission prompt и document
   * становился not-focused.
   */
  async function pasteFromClipboard(): Promise<{ count: number; message?: string; fallbackToPaste?: boolean }> {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.read) {
      error.value = 'Clipboard API недоступен в этом браузере'
      return { count: 0, message: error.value }
    }

    if ('permissions' in navigator) {
      try {
        const perm = await (navigator.permissions.query as any)({ name: 'clipboard-read' })
        if (perm.state === 'denied') {
          const msg = 'Доступ к буферу запрещён в настройках браузера. Разрешите clipboard-read в адресной строке (иконка замка) и попробуйте снова.'
          error.value = msg
          return { count: 0, message: msg }
        }
      }
      catch {
        // Safari/старый Firefox не поддерживают permissions.query для clipboard-read — идём дальше
      }
    }

    if (typeof document !== 'undefined' && !document.hasFocus()) {
      try { window.focus() } catch { /* ignore */ }
    }

    const tryRead = async (): Promise<ClipboardItems> => {
      try {
        return await navigator.clipboard.read()
      }
      catch (err: any) {
        if (err?.name === 'NotAllowedError' && typeof document !== 'undefined' && !document.hasFocus()) {
          window.focus()
          await new Promise(r => setTimeout(r, 120))
          return navigator.clipboard.read()
        }
        throw err
      }
    }

    try {
      const items = await tryRead()
      const files: File[] = []

      for (const item of items) {
        const imageType = item.types.find(t => t.startsWith('image/'))
        if (!imageType) continue
        const blob = await item.getType(imageType)
        const ext = imageType.split('/')[1] || 'png'
        files.push(new File([blob], `clipboard-${Date.now()}.${ext}`, { type: imageType }))
      }

      if (files.length === 0) {
        const msg = 'В буфере обмена нет изображения. Скопируйте картинку и попробуйте снова.'
        error.value = msg
        return { count: 0, message: msg }
      }

      await upload(files)
      return { count: files.length }
    }
    catch (e: any) {
      const isFirefox = typeof navigator !== 'undefined'
        && /firefox|zen/i.test(navigator.userAgent)
      let msg = e?.message || 'Не удалось прочитать буфер обмена'
      if (e?.name === 'NotAllowedError' || e?.name === 'NotSupportedError') {
        msg = isFirefox
          ? 'Firefox/другой браузер блокирует чтение буфера. Используйте Ctrl+V (фокус уже на зоне вставки) или включите dom.events.asyncClipboard.clipboardItem в about:config.'
          : 'Браузер заблокировал чтение буфера. Проверьте разрешение clipboard-read в настройках сайта или используйте Ctrl+V.'
      }
      error.value = msg
      return { count: 0, message: msg, fallbackToPaste: true }
    }
  }

  async function copyUrl(url: string): Promise<boolean> {
    try {
      const absolute = url.startsWith('http') ? url : (typeof window !== 'undefined' ? new URL(url, window.location.origin).href : url)
      await navigator.clipboard.writeText(absolute)
      return true
    }
    catch {
      return false
    }
  }

  return {
    urls,
    references,
    uploading: readonly(uploading),
    deletingUrl: readonly(deletingUrl),
    analyzingRefId: readonly(analyzingRefId),
    error: readonly(error),
    refresh,
    upload,
    remove,
    reanalyze,
    handlePaste,
    pasteFromClipboard,
    copyUrl,
  }
}

// Экспорт типа для template-refs в компонентах, которые используют Manager через ref().
export type UseAppReferenceImagesReturn = ReturnType<typeof useAppReferenceImages>
