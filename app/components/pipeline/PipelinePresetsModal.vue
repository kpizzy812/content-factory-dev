<script setup lang="ts">
import type { PipelinePreset } from '~~/shared/types/pipeline'
import { getPipelineColorClasses } from '~~/shared/utils/pipeline-meta'

const emit = defineEmits<{
  select: [preset: PipelinePreset]
}>()

const modalRef = ref<HTMLDialogElement | null>(null)
const presets = ref<PipelinePreset[]>([])
const isLoading = ref(false)
const selectedCategory = ref<string | null>(null)
const searchQuery = ref('')

const difficultyLabels: Record<string, { label: string; class: string }> = {
  beginner: { label: 'Начальный', class: 'badge-success' },
  intermediate: { label: 'Средний', class: 'badge-warning' },
  advanced: { label: 'Продвинутый', class: 'badge-error' },
}

const categories = computed<string[]>(() => {
  const cats = new Set(presets.value.map((p: PipelinePreset) => p.category))
  return [...cats]
})

const filteredPresets = computed<PipelinePreset[]>(() => {
  let result = presets.value
  if (selectedCategory.value) {
    result = result.filter((p: PipelinePreset) => p.category === selectedCategory.value)
  }
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.trim().toLowerCase()
    result = result.filter((p: PipelinePreset) =>
      p.name.toLowerCase().includes(q)
      || p.description.toLowerCase().includes(q)
      || p.useCase.toLowerCase().includes(q),
    )
  }
  return result
})

async function open() {
  modalRef.value?.showModal()
  selectedCategory.value = null
  searchQuery.value = ''

  if (presets.value.length === 0) {
    isLoading.value = true
    try {
      const res = await $fetch<{ data: PipelinePreset[] }>('/api/pipelines/presets')
      presets.value = res.data
    }
    catch {
      // silent
    }
    finally {
      isLoading.value = false
    }
  }
}

function selectPreset(preset: PipelinePreset) {
  emit('select', preset)
  modalRef.value?.close()
}

defineExpose({ open })
</script>

<template>
  <dialog ref="modalRef" class="modal">
    <div class="modal-box max-w-4xl max-h-[85vh]">
      <h3 class="text-lg font-bold flex items-center gap-2">
        <Icon name="mingcute:layout-11-line" class="text-primary" />
        Пресеты конвейеров
      </h3>

      <p class="text-sm text-base-content/60 mt-1">
        Готовые шаблоны для быстрого старта. Выберите пресет и он будет создан как новый конвейер.
      </p>

      <!-- Search & Filters -->
      <div class="flex flex-wrap gap-2 mt-4">
        <input
          v-model="searchQuery"
          type="text"
          class="input input-sm flex-1 min-w-[200px]"
          placeholder="Поиск пресетов..."
        />
        <button
          class="btn btn-sm"
          :class="selectedCategory === null ? 'btn-primary' : 'btn-ghost'"
          @click="selectedCategory = null"
        >
          Все
        </button>
        <button
          v-for="(cat, catIdx) in categories"
          :key="catIdx"
          class="btn btn-sm"
          :class="selectedCategory === cat ? 'btn-primary' : 'btn-ghost'"
          @click="selectedCategory = cat"
        >
          {{ cat }}
        </button>
      </div>

      <!-- Loading -->
      <div v-if="isLoading" class="flex justify-center py-12">
        <span class="loading loading-spinner loading-lg" />
      </div>

      <!-- Presets grid -->
      <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4 max-h-[55vh] overflow-y-auto pr-1">
        <div
          v-for="preset in filteredPresets"
          :key="preset.id"
          class="card bg-base-200/50 hover:bg-base-200 transition-colors cursor-pointer border border-base-300 hover:border-primary/30"
          @click="selectPreset(preset)"
        >
          <div class="card-body p-4 gap-2">
            <div class="flex items-center gap-2">
              <div
                class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                :class="getPipelineColorClasses(preset.color).bg20"
              >
                <Icon :name="preset.icon" class="text-lg" :class="getPipelineColorClasses(preset.color).text" />
              </div>
              <h4 class="font-semibold text-sm flex-1">{{ preset.name }}</h4>
              <span class="badge badge-xs" :class="difficultyLabels[preset.difficulty]?.class">
                {{ difficultyLabels[preset.difficulty]?.label }}
              </span>
            </div>

            <p class="text-xs text-base-content/60">{{ preset.description }}</p>

            <div class="flex items-center gap-2 mt-1">
              <span class="badge badge-ghost badge-xs">{{ preset.category }}</span>
              <span class="text-[10px] text-base-content/40">
                {{ preset.graphData.nodes.length }} блоков
              </span>
            </div>

            <p class="text-[11px] text-base-content/50 italic mt-0.5">
              {{ preset.useCase }}
            </p>
          </div>
        </div>
      </div>

      <!-- Empty -->
      <div v-if="!isLoading && filteredPresets.length === 0" class="text-center py-8 text-base-content/40">
        <Icon name="mingcute:search-line" class="text-3xl" />
        <p class="text-sm mt-2">Пресеты не найдены</p>
      </div>

      <div class="modal-action">
        <form method="dialog">
          <button class="btn">Закрыть</button>
        </form>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button>close</button>
    </form>
  </dialog>
</template>
