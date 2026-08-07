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

const { filtered, categories, loading, searchQuery, selectedCategory, load } = useTaxonomy(() => props.type)

const showManager = ref(false)
const expandedSlug = ref<string | null>(null)

const categoryOptions = computed(() => [
  { value: '', label: 'Все' },
  ...categories.value.map(cat => ({ value: cat, label: cat })),
])

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
  <div class="flex w-full min-w-0 flex-col gap-2">
    <!-- Поиск и фильтр -->
    <div class="flex items-center gap-1.5">
      <UiInput v-model="searchQuery" class="min-w-0 flex-1" placeholder="Поиск…" />
      <UiSelect
        v-if="categories.length > 0"
        :model-value="selectedCategory ?? ''"
        :options="categoryOptions"
        class="w-28 shrink-0"
        @update:model-value="(v) => selectedCategory = (v as string) || null"
      />
      <UiButton variant="ghost" icon-only title="Управление" @click="showManager = true">
        <Icon name="mingcute:settings-3-line" />
      </UiButton>
    </div>

    <div v-if="loading" class="flex justify-center py-2 text-muted">
      <Icon name="mingcute:loading-line" class="animate-spin" />
    </div>

    <!-- Список -->
    <div v-else-if="filtered.length" class="flex max-h-48 min-w-0 flex-col gap-1 overflow-y-auto">
      <div
        v-for="item in filtered"
        :key="item.slug"
        class="min-w-0 overflow-hidden rounded-md border transition-colors duration-(--duration-fast) ease-out"
        :class="isSelected(item.slug)
          ? 'border-accent-border bg-accent-bg'
          : 'border-border bg-card hover:border-subtle'"
      >
        <div class="flex min-w-0 cursor-pointer items-center gap-2 px-2.5 py-1.5" @click="toggle(item.slug)">
          <div class="min-w-0 flex-1 overflow-hidden">
            <div class="flex flex-wrap items-center gap-1">
              <span
                class="truncate font-medium"
                :class="isSelected(item.slug) ? 'text-accent-text' : 'text-fg'"
              >{{ item.name }}</span>
              <span
                v-if="item.isSystem"
                class="shrink-0 rounded-sm border border-neutral-border bg-neutral-bg px-1 text-micro text-neutral"
              >системный</span>
              <span
                v-if="item.category"
                class="shrink-0 rounded-sm border border-border px-1 text-micro text-subtle"
              >{{ item.category }}</span>
            </div>
            <div class="truncate text-micro text-subtle">{{ item.shortDescription }}</div>
          </div>

          <div class="flex shrink-0 items-center gap-1">
            <UiButton variant="ghost" icon-only title="Подробнее" @click.stop="toggleExpand(item.slug)">
              <Icon :name="expandedSlug === item.slug ? 'mingcute:up-line' : 'mingcute:down-line'" />
            </UiButton>
            <span
              class="flex size-4 shrink-0 items-center justify-center rounded-full border-2"
              :class="isSelected(item.slug) ? 'border-accent bg-accent' : 'border-border'"
            >
              <Icon v-if="isSelected(item.slug)" name="mingcute:check-line" class="text-[8px] text-on-accent" />
            </span>
          </div>
        </div>

        <!-- Подробности -->
        <div
          v-if="expandedSlug === item.slug"
          class="flex flex-col gap-1.5 overflow-hidden border-t border-divider px-2.5 pt-2 pb-2.5"
        >
          <p v-if="item.fullExplanation" class="text-micro break-words text-muted">
            {{ item.fullExplanation }}
          </p>

          <div v-if="item.examples.length" class="flex flex-col gap-0.5">
            <div class="text-micro font-semibold text-subtle">Примеры:</div>
            <ul class="list-disc space-y-0.5 pl-3 text-micro text-muted">
              <li v-for="(ex, i) in item.examples" :key="i">{{ ex }}</li>
            </ul>
          </div>

          <div v-if="item.useCases.length">
            <div class="mb-0.5 text-micro font-semibold text-subtle">Подходит для:</div>
            <div class="flex flex-wrap gap-1">
              <span
                v-for="uc in item.useCases"
                :key="uc"
                class="rounded-sm border border-neutral-border bg-neutral-bg px-1 text-left text-micro text-neutral"
              >{{ uc }}</span>
            </div>
          </div>

          <div v-if="item.tags.length" class="flex flex-wrap gap-0.5">
            <span v-for="tag in item.tags" :key="tag" class="text-micro text-subtle">#{{ tag }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Пусто -->
    <div v-else class="flex flex-col items-center gap-1 py-3">
      <div class="text-sm text-subtle">
        {{ searchQuery || selectedCategory ? 'Ничего не найдено' : 'Нет доступных элементов' }}
      </div>
      <UiButton variant="ghost" @click="showManager = true">
        <Icon name="mingcute:add-line" />
        Создать
      </UiButton>
    </div>

    <SharedTaxonomyManager v-if="showManager" :type="type" @close="onManagerClose" />
  </div>
</template>
