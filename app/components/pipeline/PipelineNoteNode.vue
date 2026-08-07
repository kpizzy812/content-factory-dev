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

// Цвета заметки — из словаря состояний, а не отдельная палитра: заметка живёт
// на том же канвасе, что и блоки, и второй набор оттенков спорил бы с ними.
const noteColors: Record<string, string> = {
  yellow: 'bg-warning-bg border-warning-border',
  blue: 'bg-info-bg border-info-border',
  green: 'bg-success-bg border-success-border',
  red: 'bg-danger-bg border-danger-border',
  purple: 'bg-accent-bg border-accent-border',
  neutral: 'bg-neutral-bg border-neutral-border',
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
    class="cursor-default rounded-lg border-2 border-dashed p-3 transition-shadow duration-(--duration-fast) ease-out"
    :class="[colorClass, sizeClass, selected ? 'border-solid border-accent shadow-lg' : 'hover:shadow-sm']"
  >
    <!-- Шапка -->
    <div class="mb-1 flex items-center gap-1.5">
      <Icon name="mingcute:notebook-line" class="shrink-0 text-subtle" />
      <span class="flex-1 text-micro font-semibold tracking-wider text-subtle uppercase">
        Заметка
      </span>

      <div v-if="selected" class="flex gap-0.5">
        <UiTooltip text="Сменить цвет заметки">
          <UiButton variant="ghost" icon-only @click.stop="cycleColor">
            <Icon name="mingcute:palette-line" />
          </UiButton>
        </UiTooltip>
        <UiTooltip text="Редактировать текст">
          <UiButton variant="ghost" icon-only @click.stop="startEdit">
            <Icon name="mingcute:edit-line" />
          </UiButton>
        </UiTooltip>
        <UiTooltip text="Удалить заметку">
          <UiButton variant="ghost" icon-only @click.stop="deleteNote">
            <Icon name="mingcute:delete-2-line" class="text-danger" />
          </UiButton>
        </UiTooltip>
      </div>
    </div>

    <!-- Правка -->
    <div v-if="isEditing" class="flex flex-col gap-2">
      <UiTextarea
        v-model="editText"
        :rows="3"
        placeholder="Текст заметки…"
        @keydown.ctrl.enter="saveEdit"
        @keydown.escape="isEditing = false"
      />
      <div class="flex gap-1.5">
        <UiButton variant="primary" @click.stop="saveEdit">Сохранить</UiButton>
        <UiButton variant="ghost" @click.stop="isEditing = false">Отмена</UiButton>
      </div>
    </div>

    <!-- Просмотр -->
    <div v-else class="break-words whitespace-pre-wrap text-muted" @dblclick.stop="startEdit">
      {{ displayText }}
    </div>
  </div>
</template>
