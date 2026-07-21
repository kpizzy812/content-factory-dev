<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'

const props = defineProps<{
  id: string
  data: {
    label: string
    type: string
    config?: Record<string, any>
    pinnedOutput?: Record<string, any>
  }
  icon: string
  color: string
  selected?: boolean
}>()

const store = usePipelineEditorStore()
const isHovered = ref(false)

// Этап 3: входящие несовместимые рёбра (предоставляется PipelineCanvas).
// Если на ноду пришло warning-ребро (mismatch портов) — показываем индикатор.
const nodeWarningCounts = inject<ComputedRef<Map<string, number>> | null>(
  'pipelineNodeWarningCounts',
  null,
)
const incomingPortWarnings = computed(() => nodeWarningCounts?.value.get(props.id) ?? 0)

const isConfigured = computed(() => {
  const cfg = props.data.config
  if (!cfg || typeof cfg !== 'object') return false
  return Object.values(cfg).some(v => v !== '' && v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0))
})

const isPinned = computed(() => !!props.data.pinnedOutput)

function handleDuplicate(e: Event) {
  e.stopPropagation()
  store.duplicateNode(props.id)
}

function handleDelete(e: Event) {
  e.stopPropagation()
  store.removeNode(props.id)
}
</script>

<template>
  <div
    class="px-4 py-3 rounded-xl border-2 min-w-[180px] max-w-[240px] transition-all relative group"
    :class="[color, selected ? 'ring-2 ring-primary ring-offset-1 ring-offset-base-100 shadow-lg scale-[1.02]' : 'hover:shadow-md']"
    @mouseenter="isHovered = true"
    @mouseleave="isHovered = false"
  >
    <!-- Target handle (input, left) -->
    <Handle
      type="target"
      :position="Position.Left"
      class="!w-4 !h-4 !bg-base-content/30 !border-2 !border-base-100 hover:!bg-primary hover:!scale-125 !transition-all"
    />

    <!-- Content -->
    <div class="flex items-center gap-2.5">
      <div class="w-8 h-8 rounded-lg flex items-center justify-center bg-base-100/50 shrink-0">
        <Icon :name="icon" class="text-xl" />
      </div>
      <div class="flex-1 min-w-0">
        <span class="text-sm font-semibold text-base-content truncate block leading-tight">
          {{ data.label }}
        </span>
        <span class="text-[10px] text-base-content/40 leading-tight">
          {{ data.type.replace('_', ' ') }}
        </span>
      </div>
    </div>

    <!-- Status indicators -->
    <div class="absolute -top-2 -left-2 flex gap-1">
      <!-- Pinned indicator -->
      <div v-if="isPinned" class="tooltip tooltip-top" data-tip="Данные закреплены для тестирования">
        <div class="w-5 h-5 rounded-full bg-warning flex items-center justify-center shadow-sm">
          <Icon name="mingcute:pin-fill" class="text-[10px] text-warning-content" />
        </div>
      </div>
      <!-- Port compatibility warning (incoming edges with mismatch) -->
      <div
        v-if="incomingPortWarnings > 0"
        class="tooltip tooltip-top"
        :data-tip="`${incomingPortWarnings} вход. связь(и) с несовместимыми портами`"
      >
        <div class="w-5 h-5 rounded-full bg-warning flex items-center justify-center shadow-sm">
          <Icon name="mingcute:alert-line" class="text-[10px] text-warning-content" />
        </div>
      </div>
    </div>

    <!-- Warning: not configured -->
    <div v-if="!isConfigured" class="tooltip tooltip-left" data-tip="Блок не настроен — кликните чтобы заполнить">
      <div class="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-warning flex items-center justify-center shadow-sm">
        <span class="text-[10px] font-bold text-warning-content">!</span>
      </div>
    </div>

    <!-- Hover quick actions -->
    <div
      v-show="isHovered && !selected"
      class="absolute -top-8 right-0 flex gap-0.5 bg-base-100 rounded-lg shadow-md border border-base-300 px-1 py-0.5 z-10"
    >
      <div class="tooltip tooltip-top" data-tip="Дублировать блок">
        <button
          class="btn btn-ghost btn-xs btn-square"
          @click="handleDuplicate"
        >
          <Icon name="mingcute:copy-2-line" class="text-xs" />
        </button>
      </div>
      <div class="tooltip tooltip-top" data-tip="Удалить блок">
        <button
          class="btn btn-ghost btn-xs btn-square text-error"
          @click="handleDelete"
        >
          <Icon name="mingcute:delete-2-line" class="text-xs" />
        </button>
      </div>
    </div>

    <!-- Main output handle (right) -->
    <Handle
      type="source"
      :position="Position.Right"
      class="!w-4 !h-4 !bg-base-content/30 !border-2 !border-base-100 hover:!bg-success hover:!scale-125 !transition-all"
    />

    <!-- Error output handle (bottom) -->
    <Handle
      type="source"
      :position="Position.Bottom"
      id="error"
      class="!w-3 !h-3 !bg-error/50 !border-2 !border-base-100 hover:!bg-error hover:!scale-125 !transition-all"
    />
  </div>
</template>
