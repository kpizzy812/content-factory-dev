<script setup lang="ts">
import type { PipelinePreset } from '~~/shared/types/pipeline'
import type { PipelineMonitorItem } from '~~/shared/types/workflow'

definePageMeta({ layout: 'default', middleware: 'module-access', moduleSlug: 'pipeline' })
useHead({ title: 'Конвейер' })

const store = usePipelineMonitorStore()

// URL ↔ state-синк выполняем ДО вызова usePipelineMonitor(), чтобы первый
// useFetch сразу ушёл с корректными параметрами из query.
usePipelineMonitorUrlSync()

const { data, pending, error, refresh } = usePipelineMonitor()

// Чтение localStorage вынесено из setup store'a в onMounted,
// чтобы SSR и первый клиентский рендер давали одинаковое состояние
// viewMode/catalogBlockExpanded/monitorBlockExpanded — иначе hydration mismatch.
onMounted(() => {
  store.hydrateFromStorage()
})

const pipelines = computed<PipelineMonitorItem[]>(() => data.value?.data ?? [])
const meta = computed(() => data.value?.meta ?? null)

function onPageUpdate(p: number) {
  store.catalogPage = p
}

const createModalRef = ref<{ open: () => void } | null>(null)
const presetsModalRef = ref<{ open: () => void } | null>(null)
const importModalRef = ref<{ open: () => void } | null>(null)
const previewModalRef = ref<{ open: (p: any) => void } | null>(null)

async function handlePresetSelect(preset: PipelinePreset) {
  try {
    const result = await $fetch<{ data: { id: number } }>('/api/pipelines', {
      method: 'POST',
      body: {
        name: preset.name,
        description: preset.description,
        icon: preset.icon,
        color: preset.color,
        tags: [preset.category],
        graphData: preset.graphData,
      },
    })
    await navigateTo(`/pipeline/${result.data.id}`)
  }
  catch {
    // silent
  }
}

async function handleCardClick(pipeline: PipelineMonitorItem) {
  // Monitor endpoint не возвращает полный graphData/markdownDescription —
  // подгружаем pipeline целиком перед открытием превью.
  try {
    const res = await $fetch<{ data: any }>(`/api/pipelines/${pipeline.id}`)
    previewModalRef.value?.open(res.data)
  }
  catch {
    previewModalRef.value?.open(pipeline as any)
  }
}

function handleRefresh() {
  refresh()
}

function handleImported(id: number) {
  refresh()
  navigateTo(`/pipeline/${id}`)
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between flex-wrap gap-2">
      <h1 class="text-2xl font-bold text-base-content">
        Конвейер
      </h1>
      <div class="flex items-center gap-2">
        <div class="tooltip tooltip-bottom" data-tip="Загрузить конвейер из файла">
          <button class="btn btn-ghost btn-sm" @click="importModalRef?.open()">
            <Icon name="mingcute:upload-3-line" />
            Импорт
          </button>
        </div>
        <div class="tooltip tooltip-bottom" data-tip="Готовые шаблоны конвейеров для быстрого старта">
          <button class="btn btn-ghost btn-sm" @click="presetsModalRef?.open()">
            <Icon name="mingcute:layout-11-line" />
            Шаблоны
          </button>
        </div>
        <button class="btn btn-primary btn-sm" @click="createModalRef?.open()">
          <Icon name="mingcute:add-line" />
          Создать конвейер
        </button>
      </div>
    </div>

    <SharedPageGuide
      guide-key="pipeline"
      :title="pageGuides.pipeline.title"
      :steps="pageGuides.pipeline.steps"
      :tips="pageGuides.pipeline.tips"
    />

    <div v-if="error" role="alert" class="alert alert-error">
      <Icon name="mingcute:warning-line" />
      <span>Ошибка загрузки: {{ error.message }}</span>
    </div>

    <PipelineMonitorDirectoryBlock
      :pipelines="pipelines"
      :meta="meta"
      :pending="pending"
      @click="handleCardClick"
      @update:page="onPageUpdate"
    />

    <PipelineMonitorBlock
      :items="pipelines"
      :meta="meta"
      :pending="pending"
      @refresh="handleRefresh"
    />

    <PipelineCreateModal ref="createModalRef" />
    <PipelinePresetsModal ref="presetsModalRef" @select="handlePresetSelect" />
    <PipelineImportModal ref="importModalRef" @imported="handleImported" />
    <PipelinePreviewModal
      ref="previewModalRef"
      @deleted="handleRefresh"
      @duplicated="handleRefresh"
      @updated="handleRefresh"
    />
  </div>
</template>
