type ToastVariant = 'success' | 'error' | 'info' | 'warning'

interface ToastItem {
  id: number
  text: string
  variant: ToastVariant
  timeoutId: ReturnType<typeof setTimeout> | null
}

const items = ref<ToastItem[]>([])
let nextId = 1

const DEFAULT_TIMEOUT_MS = 4000

function dismiss(id: number) {
  const idx = items.value.findIndex(t => t.id === id)
  if (idx === -1) return
  const item = items.value[idx]
  if (item?.timeoutId) clearTimeout(item.timeoutId)
  items.value.splice(idx, 1)
}

function push(text: string, variant: ToastVariant, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const id = nextId++
  const item: ToastItem = { id, text, variant, timeoutId: null }
  item.timeoutId = setTimeout(() => dismiss(id), timeoutMs)
  items.value.push(item)
  return id
}

export function useToast() {
  return {
    items: readonly(items),
    success(text: string, timeoutMs?: number) {
      return push(text, 'success', timeoutMs)
    },
    error(text: string, timeoutMs?: number) {
      return push(text, 'error', timeoutMs ?? 6000)
    },
    info(text: string, timeoutMs?: number) {
      return push(text, 'info', timeoutMs)
    },
    warning(text: string, timeoutMs?: number) {
      return push(text, 'warning', timeoutMs)
    },
    dismiss,
  }
}
