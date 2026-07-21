<script setup lang="ts">
import type { PipelineExport } from '~~/shared/types/pipeline'
import { getPipelineColorClasses } from '~~/shared/utils/pipeline-meta'

const KNOWN_NODE_TYPES = [
  'trendwatcher', 'scenario', 'video', 'upload', 'idea',
  'analytics', 'filter', 'notification', 'http_request',
  'code', 'set', 'if_switch', 'loop', 'wait', 'sub_pipeline',
  'note',
]

const emit = defineEmits<{
  imported: [id: number]
}>()

const modalRef = ref<HTMLDialogElement | null>(null)
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
  modalRef.value?.showModal()
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
    .filter((t: any) => t && !KNOWN_NODE_TYPES.includes(t))
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
    emit('imported', res.data.id)
    modalRef.value?.close()
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
  <dialog ref="modalRef" class="modal">
    <div class="modal-box max-w-lg">
      <h3 class="text-lg font-bold flex items-center gap-2">
        <Icon name="mingcute:upload-3-line" class="text-primary" />
        Импорт конвейера
      </h3>

      <p class="text-sm text-base-content/60 mt-1">
        Загрузите JSON-файл экспортированного конвейера. Формат: version 1.
      </p>

      <!-- File input -->
      <div class="mt-4">
        <input
          ref="fileInput"
          type="file"
          accept=".json"
          class="file-input w-full"
          @change="handleFileSelect"
        />
      </div>

      <!-- Validation error -->
      <div v-if="validationError" role="alert" class="alert alert-error mt-3">
        <Icon name="mingcute:warning-line" />
        <span>{{ validationError }}</span>
      </div>

      <!-- Preview -->
      <div v-if="importData" class="mt-4 space-y-3">
        <div class="bg-base-200/50 rounded-box p-4 space-y-2">
          <div class="flex items-center gap-2">
            <div
              class="w-8 h-8 rounded-lg flex items-center justify-center"
              :class="getPipelineColorClasses(importData.pipeline.color).bg20"
            >
              <Icon
                :name="importData.pipeline.icon || 'mingcute:git-merge-line'"
                class="text-lg"
                :class="getPipelineColorClasses(importData.pipeline.color).text"
              />
            </div>
            <div>
              <h4 class="font-semibold text-sm">{{ importData.pipeline.name }}</h4>
              <p v-if="importData.pipeline.description" class="text-xs text-base-content/60">
                {{ importData.pipeline.description }}
              </p>
            </div>
          </div>

          <!-- Tags and counts -->
          <div class="flex flex-wrap gap-2 text-xs">
            <span v-for="tag in (importData.pipeline.tags ?? [])" :key="tag" class="badge badge-outline badge-xs">
              {{ tag }}
            </span>
            <span class="badge badge-ghost badge-xs">
              {{ importData.pipeline.graphData.nodes.length }} блоков
            </span>
            <span class="badge badge-ghost badge-xs">
              {{ importData.pipeline.graphData.edges.length }} связей
            </span>
          </div>

          <!-- Node type summary -->
          <div v-if="nodeTypeSummary.length > 0" class="flex flex-wrap gap-1 pt-1 border-t border-base-300">
            <span
              v-for="[type, count] in nodeTypeSummary"
              :key="type"
              class="badge badge-xs"
              :class="KNOWN_NODE_TYPES.includes(type) ? 'badge-ghost' : 'badge-warning'"
            >
              {{ type }} &times;{{ count }}
            </span>
          </div>

          <p v-if="importData.exportedAt" class="text-[10px] text-base-content/40">
            Экспортировано: {{ new Date(importData.exportedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) }}
          </p>
        </div>

        <!-- Warnings -->
        <div v-if="importWarnings.length > 0" role="alert" class="alert alert-warning">
          <Icon name="mingcute:alert-line" />
          <div class="text-xs space-y-0.5">
            <p v-for="(w, i) in importWarnings" :key="i">{{ w }}</p>
          </div>
        </div>

        <!-- Credential warning detail -->
        <div v-if="hasCredentialWarning" class="rounded-box bg-info/10 border border-info/20 p-2 text-xs text-base-content/60">
          <Icon name="mingcute:key-2-line" class="inline mr-1 text-info" />
          Ссылки на учётные данные будут очищены при импорте. Перенастройте их в редакторе после импорта.
        </div>

        <button class="btn btn-ghost btn-xs" @click="resetFile">
          <Icon name="mingcute:close-line" />
          Выбрать другой файл
        </button>
      </div>

      <!-- Import error -->
      <div v-if="importError" role="alert" class="alert alert-error mt-3">
        <Icon name="mingcute:warning-line" />
        <span>{{ importError }}</span>
      </div>

      <div class="modal-action">
        <form method="dialog">
          <button class="btn">Отмена</button>
        </form>
        <button
          class="btn btn-primary"
          :disabled="!importData || isImporting"
          @click="handleImport"
        >
          <span v-if="isImporting" class="loading loading-spinner loading-sm" />
          <Icon v-else name="mingcute:upload-3-line" />
          Импортировать
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button>close</button>
    </form>
  </dialog>
</template>
