<script setup lang="ts">
const props = defineProps<{
  data: {
    label: string
    type: 'note'
    config: {
      text?: string
      noteColor?: string
      noteSize?: 'sm' | 'md' | 'lg'
    }
  }
  selected?: boolean
}>()

const store = usePipelineEditorStore()
const isEditing = ref(false)
const editText = ref('')

const noteColors: Record<string, string> = {
  yellow: 'bg-warning/15 border-warning/40',
  blue: 'bg-info/15 border-info/40',
  green: 'bg-success/15 border-success/40',
  red: 'bg-error/15 border-error/40',
  purple: 'bg-secondary/15 border-secondary/40',
  neutral: 'bg-base-200 border-base-300',
}

const sizeClasses: Record<string, string> = {
  sm: 'min-w-[160px] max-w-[200px]',
  md: 'min-w-[220px] max-w-[300px]',
  lg: 'min-w-[300px] max-w-[420px]',
}

const colorClass = computed(() => noteColors[props.data.config?.noteColor ?? 'yellow'] ?? noteColors.yellow)
const sizeClass = computed(() => sizeClasses[props.data.config?.noteSize ?? 'md'] ?? sizeClasses.md)
const displayText = computed(() => props.data.config?.text || props.data.label || 'Заметка')

const nodeId = computed(() => {
  return store.nodes.find((n: any) => n.data === props.data)?.id ?? null
})

function startEdit() {
  editText.value = props.data.config?.text || ''
  isEditing.value = true
}

function saveEdit() {
  if (nodeId.value) {
    store.updateNodeData(nodeId.value, {
      config: { ...props.data.config, text: editText.value },
    })
  }
  isEditing.value = false
}

function cycleColor() {
  const colors = Object.keys(noteColors)
  const current = props.data.config?.noteColor ?? 'yellow'
  const idx = colors.indexOf(current)
  const next = colors[(idx + 1) % colors.length]!
  if (nodeId.value) {
    store.updateNodeData(nodeId.value, {
      config: { ...props.data.config, noteColor: next },
    })
  }
}

function deleteNote() {
  if (nodeId.value) store.removeNode(nodeId.value)
}
</script>

<template>
  <div
    class="rounded-lg border-2 border-dashed p-3 transition-all cursor-default"
    :class="[colorClass, sizeClass, selected ? 'ring-2 ring-primary ring-offset-1 ring-offset-base-100 shadow-lg' : 'hover:shadow-sm']"
  >
    <!-- Header -->
    <div class="flex items-center gap-1.5 mb-1">
      <Icon name="mingcute:notebook-line" class="text-sm text-base-content/50" />
      <span class="text-[10px] font-semibold text-base-content/50 uppercase tracking-wider flex-1">
        Заметка
      </span>

      <!-- Quick actions -->
      <div v-if="selected" class="flex gap-0.5">
        <div class="tooltip tooltip-top" data-tip="Сменить цвет заметки">
          <button class="btn btn-ghost btn-xs btn-square" @click.stop="cycleColor">
            <Icon name="mingcute:palette-line" class="text-xs" />
          </button>
        </div>
        <div class="tooltip tooltip-top" data-tip="Редактировать текст">
          <button class="btn btn-ghost btn-xs btn-square" @click.stop="startEdit">
            <Icon name="mingcute:edit-line" class="text-xs" />
          </button>
        </div>
        <div class="tooltip tooltip-top" data-tip="Удалить заметку">
          <button class="btn btn-ghost btn-xs btn-square text-error" @click.stop="deleteNote">
            <Icon name="mingcute:delete-2-line" class="text-xs" />
          </button>
        </div>
      </div>
    </div>

    <!-- Edit mode -->
    <div v-if="isEditing" class="space-y-2">
      <textarea
        v-model="editText"
        class="textarea textarea-sm w-full min-h-[60px] bg-base-100/50"
        placeholder="Текст заметки..."
        rows="3"
        @keydown.ctrl.enter="saveEdit"
        @keydown.escape="isEditing = false"
      />
      <div class="flex gap-1">
        <button class="btn btn-primary btn-xs" @click.stop="saveEdit">
          Сохранить
        </button>
        <button class="btn btn-ghost btn-xs" @click.stop="isEditing = false">
          Отмена
        </button>
      </div>
    </div>

    <!-- Display mode -->
    <div v-else class="text-xs text-base-content/70 whitespace-pre-wrap break-words" @dblclick.stop="startEdit">
      {{ displayText }}
    </div>
  </div>
</template>
