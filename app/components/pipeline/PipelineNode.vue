<script setup lang="ts">
/**
 * Блок на канвасе редактора. Источник: 04-pipeline-editor.dc.html.
 *
 * Категория — тонкая полоска слева (`--color-cat-*`), а не заливка всей
 * карточки: цветом залитый блок спорит с состоянием, которое показывает
 * рамка и отметка справа.
 *
 * Подпись под именем — краткое содержание настроек самого блока. Это не
 * выдумка: значения берутся из его же `config`, и если настроек нет, строка
 * прямо говорит «не настроен».
 */
import { Handle, Position } from '@vue-flow/core'
import { pipelineNodeMeta } from './PipelineNodeMeta'
import { nodeConfigSummary } from './PipelineNodeSummary'

const props = defineProps<{
  id: string
  data: {
    label: string
    type: string
    config?: Record<string, unknown>
    pinnedOutput?: Record<string, unknown>
    disabled?: boolean
  }
  selected?: boolean
}>()

const store = usePipelineEditorStore()
const isHovered = ref(false)

/**
 * Входящие несовместимые рёбра — их считает канвас и кладёт в provide:
 * блок не знает про граф, а показать предупреждение обязан.
 */
const nodeWarningCounts = inject<ComputedRef<Map<string, number>> | null>(
  'pipelineNodeWarningCounts',
  null,
)
const incomingPortWarnings = computed(() => nodeWarningCounts?.value.get(props.id) ?? 0)

const meta = computed(() => pipelineNodeMeta(props.data.type))
const summary = computed(() => nodeConfigSummary(props.data.config))
const isConfigured = computed(() => summary.value !== null)
const isPinned = computed(() => Boolean(props.data.pinnedOutput))

const CATEGORY_COLOR: Record<string, string> = {
  src: 'var(--color-cat-src)',
  prod: 'var(--color-cat-prod)',
  ctrl: 'var(--color-cat-ctrl)',
  out: 'var(--color-cat-out)',
  util: 'var(--color-cat-util)',
}

function handleDuplicate(event: Event) {
  event.stopPropagation()
  store.duplicateNode(props.id)
}

function handleDelete(event: Event) {
  event.stopPropagation()
  store.removeNode(props.id)
}
</script>

<template>
  <div
    class="group relative w-[176px] overflow-hidden rounded-md border bg-panel shadow-sm transition-colors"
    :class="[
      selected ? 'border-accent' : 'border-border hover:border-subtle',
      data.disabled ? 'opacity-60' : '',
    ]"
    @mouseenter="isHovered = true"
    @mouseleave="isHovered = false"
  >
    <span
      class="absolute inset-y-0 left-0 w-[3px]"
      :style="{ background: CATEGORY_COLOR[meta.category] }"
    />

    <Handle
      type="target"
      :position="Position.Left"
      class="!size-2.5 !border-[1.5px] !border-subtle !bg-raised hover:!border-accent"
    />

    <div class="flex flex-col gap-1 py-2 pr-2.5 pl-3">
      <div class="flex items-center gap-1.5">
        <Icon :name="meta.icon" class="shrink-0 text-muted" />
        <span class="min-w-0 flex-1 truncate text-[12.5px] font-medium">{{ data.label }}</span>

        <UiTooltip v-if="isPinned" text="Данные закреплены для проверки">
          <Icon name="mingcute:pin-fill" class="text-warning" />
        </UiTooltip>
        <UiTooltip
          v-if="incomingPortWarnings > 0"
          :text="`Входящих связей с несовместимыми портами: ${incomingPortWarnings}`"
        >
          <Icon name="mingcute:alert-line" class="text-warning" />
        </UiTooltip>
        <UiTooltip v-if="!isConfigured" text="Блок не настроен — откройте и заполните">
          <span
            class="flex size-3.5 items-center justify-center rounded-full border border-warning-border bg-warning-bg text-[9px] font-bold text-warning"
          >!</span>
        </UiTooltip>
      </div>

      <div class="truncate font-mono text-[11px]" :class="isConfigured ? 'text-muted' : 'text-subtle'">
        {{ summary ?? 'не настроен' }}
      </div>
    </div>

    <!-- Быстрые действия появляются по наведению: в строке они отбирали бы
         место у имени блока, а нужны редко. -->
    <div
      v-show="isHovered && !selected"
      class="absolute top-1 right-1 z-10 flex gap-0.5 rounded-md border border-border bg-raised px-0.5 py-0.5 shadow-md"
    >
      <button
        type="button"
        class="flex size-5 cursor-pointer items-center justify-center rounded-sm text-muted hover:bg-card hover:text-fg"
        title="Дублировать блок"
        @click="handleDuplicate"
      >
        <Icon name="mingcute:copy-2-line" class="text-xs" />
      </button>
      <button
        type="button"
        class="flex size-5 cursor-pointer items-center justify-center rounded-sm text-muted hover:bg-card hover:text-danger"
        title="Удалить блок"
        @click="handleDelete"
      >
        <Icon name="mingcute:delete-2-line" class="text-xs" />
      </button>
    </div>

    <Handle
      type="source"
      :position="Position.Right"
      class="!size-2.5 !border-[1.5px] !border-subtle !bg-raised hover:!border-success"
    />

    <!-- Нижний выход — ветка ошибки. Он тоньше основного и красный: их нельзя
         путать при протягивании связи. -->
    <Handle
      id="error"
      type="source"
      :position="Position.Bottom"
      class="!size-2 !border-[1.5px] !border-danger-border !bg-danger-bg hover:!border-danger"
    />
  </div>
</template>
