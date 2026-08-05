type ToastVariant = 'success' | 'error' | 'info' | 'warning'

/**
 * Действие в тосте. Дизайн-система строит на нём отмену обратимых операций:
 * вместо модалки «вы уверены?» операция выполняется сразу, а тост даёт откат.
 */
export interface ToastAction {
  label: string
  handler: () => void | Promise<void>
}

interface ToastItem {
  id: number
  text: string
  variant: ToastVariant
  action: ToastAction | null
  timeoutId: ReturnType<typeof setTimeout> | null
}

const items = ref<ToastItem[]>([])
let nextId = 1

const DEFAULT_TIMEOUT_MS = 4000
/** У тоста с действием времени больше: человек должен успеть прочитать и нажать. */
const ACTION_TIMEOUT_MS = 8000

function dismiss(id: number) {
  const idx = items.value.findIndex(t => t.id === id)
  if (idx === -1) return
  const item = items.value[idx]
  if (item?.timeoutId) clearTimeout(item.timeoutId)
  items.value.splice(idx, 1)
}

function push(text: string, variant: ToastVariant, timeoutMs?: number, action?: ToastAction) {
  const id = nextId++
  const item: ToastItem = { id, text, variant, action: action ?? null, timeoutId: null }
  const ms = timeoutMs ?? (action ? ACTION_TIMEOUT_MS : DEFAULT_TIMEOUT_MS)
  item.timeoutId = setTimeout(() => dismiss(id), ms)
  items.value.push(item)
  return id
}

async function runAction(id: number) {
  const item = items.value.find(t => t.id === id)
  if (!item?.action) return
  dismiss(id)
  await item.action.handler()
}

export function useToast() {
  return {
    items: readonly(items),
    success(text: string, timeoutMs?: number, action?: ToastAction) {
      return push(text, 'success', timeoutMs, action)
    },
    error(text: string, timeoutMs?: number, action?: ToastAction) {
      return push(text, 'error', timeoutMs ?? 6000, action)
    },
    info(text: string, timeoutMs?: number, action?: ToastAction) {
      return push(text, 'info', timeoutMs, action)
    },
    warning(text: string, timeoutMs?: number, action?: ToastAction) {
      return push(text, 'warning', timeoutMs, action)
    },
    /** Выполненное обратимое действие: показать результат и дать откат. */
    undoable(text: string, undo: () => void | Promise<void>, label = 'Отменить') {
      return push(text, 'success', undefined, { label, handler: undo })
    },
    runAction,
    dismiss,
  }
}
