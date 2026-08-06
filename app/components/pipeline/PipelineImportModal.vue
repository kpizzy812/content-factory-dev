<script setup lang="ts">
import type { PipelineExport } from '~~/shared/types/pipeline'
// Единственный источник правды по типам блоков — реестр, а не локальная копия списка.
import { isKnownNodeType } from '~~/shared/utils/pipeline-node-registry'
import { pipelineColor } from './PipelineColorMap'
import { pipelineNodeMeta } from './PipelineNodeMeta'

const emit = defineEmits<{
  imported: [id: number]
}>()

const isOpen = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const importData = ref<PipelineExport | null>(null)
const validationError = ref<string | null>(null)
const isImporting = ref(false)
const importError = ref<string | null>(null)
const importWarnings = ref<string[]>([])

function open() {
  importData.value = null
  validationError.value = null
  importError.value = null
  importWarnings.value = []
  isOpen.value = true
}

function handleFileSelect(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return

  validationError.value = null
  importError.value = null
  importWarnings.value = []

  if (file.size > 5 * 1024 * 1024) {
    validationError.value = 'Файл слишком большой (максимум 5 МБ)'
    return
  }

  const reader = new FileReader()
  reader.onload = (e) => {
    try {
      const parsed = JSON.parse(e.target?.result as string)
      if (!validateExport(parsed)) return
      importData.value = parsed
    }
    catch {
      validationError.value = 'Файл не является валидным JSON'
    }
  }
  reader.readAsText(file)
}

function validateExport(data: any): data is PipelineExport {
  if (!data || typeof data !== 'object') {
    validationError.value = 'Некорректный формат файла'
    return false
  }
  if (data.version !== 1) {
    validationError.value = `Неподдерживаемая версия формата: ${data.version}. Поддерживается: 1`
    return false
  }
  if (!data.pipeline || typeof data.pipeline !== 'object') {
    validationError.value = 'Отсутствует блок pipeline'
    return false
  }
  if (!data.pipeline.name || typeof data.pipeline.name !== 'string') {
    validationError.value = 'Отсутствует название конвейера'
    return false
  }
  const gd = data.pipeline.graphData
  if (!gd || !Array.isArray(gd.nodes) || !Array.isArray(gd.edges)) {
    validationError.value = 'Некорректный формат graphData'
    return false
  }

  // Client-side warnings
  const warnings: string[] = []
  const unknownTypes = gd.nodes
    .map((n: any) => n?.data?.type)
    .filter((t: any) => t && !isKnownNodeType(String(t)))
  if (unknownTypes.length > 0) {
    warnings.push(`Неизвестные типы блоков: ${[...new Set(unknownTypes)].join(', ')}`)
  }

  const credNodes = gd.nodes.filter((n: any) => {
    const config = n?.data?.config
    if (!config) return false
    return Object.keys(config).some(k => k.endsWith('CredentialId') && config[k])
  })
  if (credNodes.length > 0) {
    warnings.push(`${credNodes.length} блок(ов) с привязкой к учётным данным — потребуется перенастройка`)
  }

  if (gd.nodes.length > 100) {
    warnings.push(`Большой конвейер: ${gd.nodes.length} блоков`)
  }

  importWarnings.value = warnings
  return true
}

// Подсчёт типов нод для preview
const nodeTypeSummary = computed(() => {
  if (!importData.value) return []
  const counts = new Map<string, number>()
  for (const node of importData.value.pipeline.graphData.nodes) {
    const type = node?.data?.type || 'unknown'
    counts.set(type, (counts.get(type) || 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
})

const hasCredentialWarning = computed(() =>
  importWarnings.value.some(w => w.includes('учётным данным')),
)

async function handleImport() {
  if (!importData.value) return

  isImporting.value = true
  importError.value = null

  try {
    const res = await $fetch<{ data: { id: number }; warnings?: string[] }>('/api/pipelines/import', {
      method: 'POST',
      body: importData.value,
    })
    // Показываем серверные warnings если есть
    if (res.warnings?.length) {
      importWarnings.value = [...importWarnings.value, ...res.warnings]
    }
    isOpen.value = false
    emit('imported', res.data.id)
  }
  catch (e: any) {
    importError.value = e?.data?.message || 'Ошибка импорта'
  }
  finally {
    isImporting.value = false
  }
}

function resetFile() {
  importData.value = null
  validationError.value = null
  importError.value = null
  importWarnings.value = []
  if (fileInput.value) fileInput.value.value = ''
}

defineExpose({ open })
</script>

<template>
  <UiModal :open="isOpen" title="Импорт конвейера" @close="isOpen = false">
    <div class="flex flex-col gap-3">
      <p class="text-sm text-muted">
        JSON-файл экспортированного конвейера, формат версии 1. Ссылки на учётные
        данные при импорте очищаются — их придётся привязать заново.
      </p>

      <input
        ref="fileInput"
        type="file"
        accept=".json"
        class="w-full cursor-pointer rounded-md border border-border bg-card px-2.5 py-2 text-base text-muted file:mr-3 file:cursor-pointer file:rounded-sm file:border-0 file:bg-raised file:px-2.5 file:py-1 file:text-base file:text-fg"
        @change="handleFileSelect"
      >

      <p
        v-if="validationError"
        role="alert"
        class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
      >
        <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
        <span class="min-w-0 flex-1">{{ validationError }}</span>
      </p>

      <template v-if="importData">
        <div class="flex flex-col gap-2 rounded-md border border-border bg-card p-3">
          <div class="flex items-center gap-2">
            <span
              class="flex size-8 shrink-0 items-center justify-center rounded-md"
              :class="pipelineColor(importData.pipeline.color).bg"
            >
              <Icon
                :name="importData.pipeline.icon || 'mingcute:git-merge-line'"
                class="text-lg"
                :class="pipelineColor(importData.pipeline.color).text"
              />
            </span>
            <span class="min-w-0">
              <span class="block truncate font-medium">{{ importData.pipeline.name }}</span>
              <span v-if="importData.pipeline.description" class="block truncate text-sm text-muted">
                {{ importData.pipeline.description }}
              </span>
            </span>
          </div>

          <div class="flex flex-wrap items-center gap-1.5 text-micro">
            <span
              v-for="tag in (importData.pipeline.tags ?? [])"
              :key="tag"
              class="inline-flex h-[18px] items-center rounded-sm border border-border bg-panel px-1.5 text-muted"
            >{{ tag }}</span>
            <span class="tnum font-mono text-subtle">
              {{ importData.pipeline.graphData.nodes.length }} блоков ·
              {{ importData.pipeline.graphData.edges.length }} связей
            </span>
          </div>

          <div v-if="nodeTypeSummary.length" class="flex flex-wrap gap-1 border-t border-divider pt-2">
            <span
              v-for="[type, count] in nodeTypeSummary"
              :key="type"
              class="inline-flex h-[18px] items-center rounded-sm border px-1.5 text-micro"
              :class="isKnownNodeType(String(type))
                ? 'border-border bg-panel text-muted'
                : 'border-warning-border bg-warning-bg text-warning'"
              :title="isKnownNodeType(String(type)) ? undefined : 'Такого типа блока в системе нет'"
            >{{ pipelineNodeMeta(String(type)).label }} ×{{ count }}</span>
          </div>

          <ClientOnly>
            <p v-if="importData.exportedAt" class="text-micro text-subtle">
              Экспортировано {{ new Date(importData.exportedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) }}
            </p>
          </ClientOnly>
        </div>

        <p
          v-if="importWarnings.length"
          role="alert"
          class="flex items-start gap-2 rounded-md border border-warning-border bg-warning-bg px-2.5 py-2 text-sm text-fg"
        >
          <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0 text-warning" />
          <span class="min-w-0 flex-1">
            <span v-for="(w, i) in importWarnings" :key="i" class="block">{{ w }}</span>
          </span>
        </p>

        <p
          v-if="hasCredentialWarning"
          class="flex items-start gap-2 rounded-md border border-info-border bg-info-bg px-2.5 py-2 text-sm text-fg"
        >
          <Icon name="mingcute:key-2-line" class="mt-0.5 shrink-0 text-info" />
          <span>Привязки к учётным данным будут очищены — задайте их в редакторе после импорта.</span>
        </p>

        <UiButton variant="ghost" class="self-start" @click="resetFile">
          <Icon name="mingcute:close-line" />
          Выбрать другой файл
        </UiButton>
      </template>

      <p
        v-if="importError"
        role="alert"
        class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
      >
        <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
        <span class="min-w-0 flex-1">{{ importError }}</span>
      </p>
    </div>

    <template #footer>
      <UiButton variant="ghost" :disabled="isImporting" @click="isOpen = false">Отмена</UiButton>
      <UiButton variant="primary" :disabled="!importData" :loading="isImporting" @click="handleImport">
        Импортировать
      </UiButton>
    </template>
  </UiModal>
</template>
