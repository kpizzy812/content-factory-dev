<script setup lang="ts">
/**
 * TaxonomyPicker — компонент выбора taxonomy items в node config формах.
 *
 * Поддерживает:
 * - single select (для strategy) и multi select (для hook styles)
 * - поиск и фильтр по категории
 * - preview с описанием, примерами и use cases
 * - кнопку для открытия TaxonomyManager
 */

const props = defineProps<{
  /** Тип taxonomy: 'strategy' | 'hook_style' | 'prompt_pattern' */
  type: string
  /** Текущее значение: slug (single) или slug[] (multi) */
  modelValue: string | string[] | null
  /** Режим множественного выбора */
  multiple?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string | string[] | null]
}>()

const { items, filtered, categories, loading, searchQuery, selectedCategory, load } = useTaxonomy(() => props.type)

const showManager = ref(false)
const expandedSlug = ref<string | null>(null)

const selectedSlugs = computed<string[]>(() => {
  if (!props.modelValue) return []
  if (Array.isArray(props.modelValue)) return props.modelValue
  return [props.modelValue]
})

function isSelected(slug: string): boolean {
  return selectedSlugs.value.includes(slug)
}

function toggle(slug: string) {
  if (props.multiple) {
    const current = [...selectedSlugs.value]
    const idx = current.indexOf(slug)
    if (idx >= 0) current.splice(idx, 1)
    else current.push(slug)
    emit('update:modelValue', current)
  } else {
    emit('update:modelValue', isSelected(slug) ? null : slug)
  }
}

function toggleExpand(slug: string) {
  expandedSlug.value = expandedSlug.value === slug ? null : slug
}

function onManagerClose() {
  showManager.value = false
  load()
}
</script>

<template>
  <div class="space-y-2 min-w-0 w-full">
    <!-- Search + filter bar -->
    <div class="flex gap-1.5 items-center">
      <input
        v-model="searchQuery"
        type="text"
        class="input input-xs flex-1"
        placeholder="Поиск..."
      />
      <select
        v-if="categories.length > 0"
        class="select select-xs"
        :value="selectedCategory ?? ''"
        @change="selectedCategory = ($event.target as HTMLSelectElement).value || null"
      >
        <option value="">Все</option>
        <option v-for="cat in categories" :key="cat" :value="cat">{{ cat }}</option>
      </select>
      <button
        class="btn btn-ghost btn-xs btn-square"
        title="Управление"
        @click="showManager = true"
      >
        <Icon name="mingcute:settings-3-line" />
      </button>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex justify-center py-2">
      <span class="loading loading-spinner loading-xs" />
    </div>

    <!-- Items list -->
    <div v-else-if="filtered.length" class="space-y-1 max-h-48 overflow-y-auto">
      <div
        v-for="item in filtered"
        :key="item.slug"
        class="rounded-box border transition-all overflow-hidden min-w-0"
        :class="isSelected(item.slug)
          ? 'border-primary/40 bg-primary/5'
          : 'border-base-300 bg-base-100 hover:border-base-content/20'"
      >
        <!-- Item header (clickable) -->
        <div class="flex items-center gap-2 px-2.5 py-1.5 cursor-pointer min-w-0" @click="toggle(item.slug)">
          <div class="flex-1 min-w-0 overflow-hidden">
            <div class="flex items-center gap-1 flex-wrap">
              <span class="text-xs font-medium truncate" :class="isSelected(item.slug) ? 'text-primary' : 'text-base-content'">
                {{ item.name }}
              </span>
              <span v-if="item.isSystem" class="badge badge-ghost badge-xs shrink-0">системный</span>
              <span v-if="item.category" class="badge badge-outline badge-xs shrink-0">{{ item.category }}</span>
            </div>
            <div class="text-[10px] text-base-content/50 truncate">{{ item.shortDescription }}</div>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <button
              class="btn btn-ghost btn-xs btn-square"
              title="Подробнее"
              @click.stop="toggleExpand(item.slug)"
            >
              <Icon
                :name="expandedSlug === item.slug ? 'mingcute:up-line' : 'mingcute:down-line'"
                class="text-xs"
              />
            </button>
            <div class="w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0"
              :class="isSelected(item.slug) ? 'border-primary bg-primary' : 'border-base-300'"
            >
              <Icon v-if="isSelected(item.slug)" name="mingcute:check-line" class="text-[8px] text-primary-content" />
            </div>
          </div>
        </div>

        <!-- Expanded details -->
        <div v-if="expandedSlug === item.slug" class="px-2.5 pb-2.5 border-t border-base-200 pt-2 space-y-1.5 overflow-hidden">
          <p v-if="item.fullExplanation" class="text-[11px] text-base-content/70 break-words">
            {{ item.fullExplanation }}
          </p>

          <div v-if="item.examples.length" class="space-y-0.5">
            <div class="text-[10px] font-semibold text-base-content/50">Примеры:</div>
            <ul class="text-[10px] text-base-content/60 space-y-0.5 pl-3 list-disc">
              <li v-for="(ex, i) in item.examples" :key="i">{{ ex }}</li>
            </ul>
          </div>

          <div v-if="item.useCases.length">
            <div class="text-[10px] font-semibold text-base-content/50 mb-0.5">Подходит для:</div>
            <div class="flex flex-wrap gap-1">
              <span v-for="uc in item.useCases" :key="uc" class="badge badge-ghost badge-xs whitespace-normal h-auto text-left">{{ uc }}</span>
            </div>
          </div>

          <div v-if="item.tags.length">
            <div class="flex flex-wrap gap-0.5">
              <span v-for="tag in item.tags" :key="tag" class="text-[9px] text-base-content/40">#{{ tag }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-else class="text-center py-3">
      <div class="text-xs text-base-content/40">
        {{ searchQuery || selectedCategory ? 'Ничего не найдено' : 'Нет доступных элементов' }}
      </div>
      <button class="btn btn-ghost btn-xs mt-1" @click="showManager = true">
        <Icon name="mingcute:add-line" class="text-xs" />
        Создать
      </button>
    </div>

    <!-- Manager modal -->
    <SharedTaxonomyManager
      v-if="showManager"
      :type="type"
      @close="onManagerClose"
    />
  </div>
</template>
