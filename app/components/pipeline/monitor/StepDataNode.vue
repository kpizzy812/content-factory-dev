<script setup lang="ts">
/**
 * Узел дерева данных шага. Источник: design-preview/catalog/05-run-monitor.dc.html
 *
 * Ветки сворачиваются, у массивов и объектов виден счётчик элементов, длинные
 * строки свёрнуты до кнопки «развернуть N симв.». Иначе один шаг с четырнадцатью
 * сценариями занимает экран целиком, и найти в нём нужное поле нельзя.
 *
 * Имя в auto-import Nuxt: PipelineMonitorStepDataNode.
 */
import { humanizeKey, humanizeValue, detectKind } from '~~/shared/utils/pipeline-humanize'

const props = withDefaults(defineProps<{
  value: unknown
  /** Имя поля, в котором лежит value — нужно для перевода enum-значений. */
  fieldKey?: string
  depth?: number
  /** Читаемый режим переводит ключи; сырой оставляет как в ответе. */
  humanize?: boolean
}>(), { depth: 0, humanize: true })

/** Порог, после которого строка сворачивается. */
const LONG_STRING = 140
/** Сколько элементов массива показываем до «показать ещё». */
const CHUNK = 3

const kind = computed(() => detectKind(props.value))

// Корень и его первый уровень открыты, глубже — свёрнуто.
const open = ref(props.depth < 1)
const showAll = ref(false)
const stringExpanded = ref(false)

const entries = computed(() => {
  if (kind.value === 'object') {
    return Object.entries(props.value as Record<string, unknown>).map(([k, v]) => ({
      key: k,
      label: props.humanize ? humanizeKey(k) : k,
      value: v,
    }))
  }
  if (kind.value === 'array') {
    return (props.value as unknown[]).map((v, i) => ({
      key: String(i),
      label: `[${i}]`,
      value: v,
    }))
  }
  return []
})

const visibleEntries = computed(() =>
  showAll.value ? entries.value : entries.value.slice(0, CHUNK * 5),
)

const summary = computed(() => {
  if (kind.value === 'array') return `${entries.value.length} элем.`
  return `${entries.value.length} полей`
})

const rawString = computed(() => typeof props.value === 'string' ? props.value : '')
const isLongString = computed(() => rawString.value.length > LONG_STRING)
const shownString = computed(() => {
  const text = props.humanize ? String(humanizeValue(props.value, props.fieldKey)) : rawString.value
  if (!isLongString.value || stringExpanded.value) return text
  return `${text.slice(0, LONG_STRING)}…`
})
</script>

<template>
  <span v-if="kind === 'empty'" class="text-subtle">—</span>

  <span v-else-if="kind === 'primitive' && isLongString" class="min-w-0">
    <span class="break-words text-fg">{{ shownString }}</span>
    <button
      type="button"
      class="ml-1.5 cursor-pointer text-accent-text"
      @click="stringExpanded = !stringExpanded"
    >
      {{ stringExpanded ? 'свернуть' : `развернуть ${rawString.length} симв.` }}
    </button>
  </span>

  <span
    v-else-if="kind === 'primitive'"
    class="break-words"
    :class="typeof value === 'number' ? 'text-info' : typeof value === 'boolean' ? (value ? 'text-success' : 'text-danger') : 'text-fg'"
  >{{ shownString }}</span>

  <div v-else class="min-w-0">
    <button
      type="button"
      class="flex cursor-pointer items-center gap-1.5 text-muted hover:text-fg"
      :aria-expanded="open"
      @click="open = !open"
    >
      <Icon
        name="mingcute:right-line"
        class="shrink-0 text-micro transition-transform duration-(--duration-fast)"
        :class="open && 'rotate-90'"
      />
      <span>{{ kind === 'array' ? 'массив' : 'объект' }}</span>
      <span class="tnum text-subtle">{{ summary }}</span>
    </button>

    <ul v-if="open" class="ml-[7px] flex flex-col gap-0.5 border-l border-divider pl-2.5">
      <li v-for="entry in visibleEntries" :key="entry.key" class="flex min-w-0 flex-wrap gap-x-1.5">
        <span class="shrink-0 text-subtle">{{ entry.label }}:</span>
        <PipelineMonitorStepDataNode
          :value="entry.value"
          :field-key="entry.key"
          :depth="depth + 1"
          :humanize="humanize"
        />
      </li>
      <li v-if="entries.length > visibleEntries.length">
        <button
          type="button"
          class="cursor-pointer text-accent-text"
          @click="showAll = true"
        >
          …ещё {{ entries.length - visibleEntries.length }}, показать
        </button>
      </li>
    </ul>
  </div>
</template>
