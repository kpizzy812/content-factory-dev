<script setup lang="ts">
import type { PipelinePreset } from '~~/shared/types/pipeline'
import type { PipelineMonitorItem } from '~~/shared/types/workflow'

definePageMeta({ layout: 'default', middleware: 'module-access', moduleSlug: 'pipeline' })
useHead({ title: 'Конвейер' })

const store = usePipelineMonitorStore()

// Синхронизация с адресом делается до первого запроса, иначе он уйдёт без
// параметров из ссылки.
usePipelineMonitorUrlSync()

const { data, pending, error, refresh } = usePipelineMonitor()

// Чтение localStorage вынесено из стора в onMounted: иначе сервер и первый
// клиентский рендер расходятся по свёрнутости блоков.
onMounted(() => {
  store.hydrateFromStorage()
})

const pipelines = computed<PipelineMonitorItem[]>(() => data.value?.data ?? [])
const meta = computed(() => data.value?.meta ?? null)

const createModalRef = ref<{ open: () => void } | null>(null)
const presetsModalRef = ref<{ open: () => void } | null>(null)
const importModalRef = ref<{ open: () => void } | null>(null)
const previewModalRef = ref<{ open: (p: unknown) => void } | null>(null)

const presetError = ref('')

async function handlePresetSelect(preset: PipelinePreset) {
  presetError.value = ''
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
  catch (e) {
    presetError.value = (e as { data?: { message?: string }, message?: string })?.data?.message
      || (e as Error)?.message
      || 'Не удалось создать конвейер из шаблона'
  }
}

async function handleCardClick(pipeline: PipelineMonitorItem) {
  // Список монитора не несёт граф и описание целиком — подгружаем конвейер
  // перед открытием превью.
  try {
    const res = await $fetch<{ data: unknown }>(`/api/pipelines/${pipeline.id}`)
    previewModalRef.value?.open(res.data)
  }
  catch {
    previewModalRef.value?.open(pipeline)
  }
}

function handleImported(id: number) {
  refresh()
  navigateTo(`/pipeline/${id}`)
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-xl font-semibold">Конвейер</h1>
      <span v-if="meta" class="tnum text-sm text-subtle">{{ meta.total }}</span>
      <span class="flex-1" />
      <UiButton title="Загрузить конвейер из файла" @click="importModalRef?.open()">
        <Icon name="mingcute:upload-line" />
        Импорт
      </UiButton>
      <UiButton title="Готовые шаблоны для быстрого старта" @click="presetsModalRef?.open()">
        <Icon name="mingcute:layout-line" />
        Шаблоны
      </UiButton>
      <UiButton variant="primary" @click="createModalRef?.open()">
        <Icon name="mingcute:add-line" />
        Создать конвейер
      </UiButton>
    </div>

    <p class="text-sm text-muted">
      Конвейер собирает шаги производства в один граф — от поиска трендов до публикации.
    </p>

    <UiErrorState
      v-if="error"
      message="Не удалось загрузить конвейеры."
      :details="error.message"
      @retry="refresh()"
    />

    <p
      v-if="presetError"
      role="alert"
      class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
    >
      <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
      <span class="min-w-0 flex-1">{{ presetError }}</span>
      <UiButton variant="ghost" @click="presetError = ''">Закрыть</UiButton>
    </p>

    <PipelineMonitorDirectoryBlock
      :pipelines="pipelines"
      :meta="meta"
      :pending="pending"
      @click="handleCardClick"
      @update:page="(p) => store.catalogPage = p"
    />

    <PipelineMonitorBlock
      :items="pipelines"
      :meta="meta"
      :pending="pending"
      @refresh="refresh()"
    />

    <PipelineCreateModal ref="createModalRef" />
    <PipelinePresetsModal ref="presetsModalRef" @select="handlePresetSelect" />
    <PipelineImportModal ref="importModalRef" @imported="handleImported" />
    <PipelinePreviewModal
      ref="previewModalRef"
      @deleted="refresh()"
      @duplicated="refresh()"
      @updated="refresh()"
    />
  </div>
</template>
