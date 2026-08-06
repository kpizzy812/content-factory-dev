<script setup lang="ts">
/**
 * Готовые шаблоны конвейеров.
 *
 * Шаблон не запускает ничего платного — он создаёт конвейер с уже собранным
 * графом, поэтому выбор идёт по клику без подтверждения.
 */
import type { PipelinePreset } from '~~/shared/types/pipeline'
import { pipelineColor } from './PipelineColorMap'

const emit = defineEmits<{ select: [preset: PipelinePreset] }>()

const isOpen = ref(false)
const presets = ref<PipelinePreset[]>([])
const isLoading = ref(false)
const selectedCategory = ref<string | null>(null)
const search = ref('')

const DIFFICULTY: Record<string, { label: string; tone: string }> = {
  beginner: { label: 'Начальный', tone: 'border-success-border bg-success-bg text-success' },
  intermediate: { label: 'Средний', tone: 'border-warning-border bg-warning-bg text-warning' },
  advanced: { label: 'Продвинутый', tone: 'border-danger-border bg-danger-bg text-danger' },
}

const categories = computed(() => [...new Set(presets.value.map(p => p.category))])

const filtered = computed(() => {
  let result = presets.value
  if (selectedCategory.value) result = result.filter(p => p.category === selectedCategory.value)
  const q = search.value.trim().toLowerCase()
  if (q) {
    result = result.filter(p =>
      p.name.toLowerCase().includes(q)
      || p.description.toLowerCase().includes(q)
      || p.useCase.toLowerCase().includes(q))
  }
  return result
})

async function open() {
  isOpen.value = true
  selectedCategory.value = null
  search.value = ''
  if (presets.value.length) return

  isLoading.value = true
  try {
    const res = await $fetch<{ data: PipelinePreset[] }>('/api/pipelines/presets')
    presets.value = res.data
  }
  catch {
    // Пустой список объясняет себя сам — отдельная ошибка тут ничего не добавит.
  }
  finally {
    isLoading.value = false
  }
}

function selectPreset(preset: PipelinePreset) {
  isOpen.value = false
  emit('select', preset)
}

defineExpose({ open })
</script>

<template>
  <UiModal :open="isOpen" size="lg" title="Шаблоны конвейеров" @close="isOpen = false">
    <div class="flex flex-col gap-3">
      <p class="text-sm text-muted">
        Собранный граф, который можно править дальше в редакторе. Ничего не
        запускается — создаётся новый конвейер.
      </p>

      <UiInput v-model="search" placeholder="Поиск по названию и задаче" />

      <div class="flex flex-wrap items-center gap-1.5">
        <UiButton
          :variant="selectedCategory === null ? 'primary' : 'ghost'"
          @click="selectedCategory = null"
        >
          Все
        </UiButton>
        <UiButton
          v-for="cat in categories"
          :key="cat"
          :variant="selectedCategory === cat ? 'primary' : 'ghost'"
          @click="selectedCategory = cat"
        >
          {{ cat }}
        </UiButton>
      </div>

      <UiSkeleton v-if="isLoading" variant="details" :count="4" />

      <UiEmptyState
        v-else-if="!filtered.length"
        :variant="presets.length ? 'search' : 'first'"
        :title="presets.length ? 'Шаблонов по фильтру нет' : 'Шаблонов нет'"
        :description="presets.length
          ? 'Сбросьте поиск или выберите другую категорию.'
          : 'Список шаблонов пуст — соберите конвейер с нуля.'"
      />

      <div v-else class="grid gap-3 md:grid-cols-2">
        <button
          v-for="preset in filtered"
          :key="preset.id"
          type="button"
          class="flex cursor-pointer flex-col gap-2 rounded-md border border-border bg-card p-3 text-left hover:border-accent-border"
          @click="selectPreset(preset)"
        >
          <span class="flex items-center gap-2">
            <span
              class="flex size-8 shrink-0 items-center justify-center rounded-md"
              :class="pipelineColor(preset.color).bg"
            >
              <Icon :name="preset.icon" class="text-lg" :class="pipelineColor(preset.color).text" />
            </span>
            <span class="min-w-0 flex-1 truncate font-medium">{{ preset.name }}</span>
            <span
              v-if="DIFFICULTY[preset.difficulty]"
              class="inline-flex h-[18px] shrink-0 items-center rounded-sm border px-1.5 text-micro"
              :class="DIFFICULTY[preset.difficulty]!.tone"
            >{{ DIFFICULTY[preset.difficulty]!.label }}</span>
          </span>

          <span class="text-sm text-muted">{{ preset.description }}</span>

          <span class="flex flex-wrap items-center gap-2 text-micro text-subtle">
            <span class="inline-flex h-[18px] items-center rounded-sm border border-border bg-panel px-1.5">
              {{ preset.category }}
            </span>
            <span class="tnum font-mono">{{ preset.graphData.nodes.length }} блоков</span>
          </span>

          <span class="text-micro text-subtle">{{ preset.useCase }}</span>
        </button>
      </div>
    </div>

    <template #footer>
      <UiButton variant="ghost" @click="isOpen = false">Закрыть</UiButton>
    </template>
  </UiModal>
</template>
