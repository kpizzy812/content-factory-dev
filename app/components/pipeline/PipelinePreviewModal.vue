<script setup lang="ts">
import type { Pipeline } from '~~/shared/types/pipeline'
import { pipelineColors as availableColors, pipelineIcons as availableIcons, getPipelineColorClasses } from '~~/shared/utils/pipeline-meta'
import { formatDateFull } from '~~/shared/utils/pipeline-format'

const emit = defineEmits<{
  deleted: [id: number]
  duplicated: [id: number]
  updated: []
}>()

const modalRef = ref<HTMLDialogElement | null>(null)
const deleteModalRef = ref<{ open: (name: string) => void } | null>(null)
const pipeline = ref<(Pipeline & { nodesCount?: number }) | null>(null)
const isExporting = ref(false)
const isDuplicating = ref(false)
const isDeleting = ref(false)
const isSaving = ref(false)

// Edit mode
const isEditing = ref(false)
const editName = ref('')
const editDescription = ref('')
const editMarkdownDescription = ref('')
const editIcon = ref('')
const editColor = ref('')
const editTags = ref<string[]>([])

const { createPipeline, deletePipeline } = usePipelineActions()

const safeMarkdownHtml = useMarkdownSafe(computed(() => pipeline.value?.markdownDescription))

const nodeCount = computed(() => {
  if (pipeline.value?.nodesCount != null) return pipeline.value.nodesCount
  return pipeline.value?.graphData?.nodes?.length ?? 0
})

const edgeCount = computed(() => pipeline.value?.graphData?.edges?.length ?? 0)

const nodeTypes = computed(() => {
  if (!pipeline.value?.graphData?.nodes) return []
  return [...new Set(pipeline.value.graphData.nodes.map((n: any) => n.data?.type as string).filter(Boolean))]
})

const viewColorClasses = computed(() => getPipelineColorClasses(pipeline.value?.color))
const editColorClasses = computed(() => getPipelineColorClasses(editColor.value))

function open(p: Pipeline & { nodesCount?: number }) {
  pipeline.value = p
  isEditing.value = false
  modalRef.value?.showModal()
}

function startEditing() {
  if (!pipeline.value) return
  editName.value = pipeline.value.name
  editDescription.value = pipeline.value.description ?? ''
  editMarkdownDescription.value = pipeline.value.markdownDescription ?? ''
  editIcon.value = pipeline.value.icon ?? ''
  editColor.value = pipeline.value.color ?? ''
  editTags.value = (pipeline.value.tags ?? []).map(t => t.name)
  isEditing.value = true
}

function cancelEditing() {
  isEditing.value = false
}

async function saveMetadata() {
  if (!pipeline.value || !editName.value.trim()) return
  isSaving.value = true
  try {
    const res = await $fetch<{ data: Pipeline }>(`/api/pipelines/${pipeline.value.id}`, {
      method: 'PUT',
      body: {
        name: editName.value.trim(),
        description: editDescription.value.trim() || null,
        markdownDescription: editMarkdownDescription.value.trim() || null,
        icon: editIcon.value || null,
        color: editColor.value || null,
        tags: editTags.value,
      },
    })
    // Update local state
    pipeline.value = { ...pipeline.value, ...res.data }
    isEditing.value = false
    emit('updated')
  }
  catch { /* silent */ }
  finally {
    isSaving.value = false
  }
}

function goToEditor() {
  if (pipeline.value) {
    modalRef.value?.close()
    navigateTo(`/pipeline/${pipeline.value.id}`)
  }
}

async function handleExport() {
  if (!pipeline.value) return
  isExporting.value = true
  try {
    const res = await $fetch<{ data: any }>(`/api/pipelines/${pipeline.value.id}/export`)
    const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `pipeline-${pipeline.value.name.replace(/[^a-zA-Zа-яА-Я0-9-_]/g, '_')}.json`
    a.click()
    URL.revokeObjectURL(url)
  }
  catch { /* silent */ }
  finally {
    isExporting.value = false
  }
}

async function handleDuplicate() {
  if (!pipeline.value) return
  isDuplicating.value = true
  try {
    const source = pipeline.value
    const result = await createPipeline(
      `${source.name} (копия)`,
      source.description ?? undefined,
    )
    if (result?.data?.id) {
      await $fetch(`/api/pipelines/${result.data.id}`, {
        method: 'PUT',
        body: {
          graphData: source.graphData,
          markdownDescription: source.markdownDescription,
          icon: source.icon,
          color: source.color,
          tags: (source.tags ?? []).map(t => t.name),
        },
      })
      emit('duplicated', result.data.id)
      modalRef.value?.close()
    }
  }
  catch { /* silent */ }
  finally {
    isDuplicating.value = false
  }
}

function handleDeleteClick() {
  if (!pipeline.value) return
  deleteModalRef.value?.open(pipeline.value.name)
}

async function handleDeleteConfirmed() {
  if (!pipeline.value) return
  isDeleting.value = true
  try {
    await deletePipeline(pipeline.value.id)
    emit('deleted', pipeline.value.id)
    modalRef.value?.close()
  }
  catch { /* silent */ }
  finally {
    isDeleting.value = false
  }
}


defineExpose({ open })
</script>

<template>
  <dialog ref="modalRef" class="modal">
    <div v-if="pipeline" class="modal-box max-w-3xl max-h-[85vh]">
      <!-- View mode -->
      <template v-if="!isEditing">
        <!-- Header -->
        <div class="flex items-start gap-3">
          <div
            class="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
            :class="viewColorClasses.bg20"
          >
            <Icon
              :name="pipeline.icon || 'mingcute:git-merge-line'"
              class="text-xl"
              :class="viewColorClasses.text"
            />
          </div>

          <div class="flex-1 min-w-0">
            <h3 class="text-lg font-bold flex items-center gap-2">
              {{ pipeline.name }}
              <PipelineStatusBadge :status="pipeline.status" />
            </h3>
            <p v-if="pipeline.description" class="text-sm text-base-content/60 mt-0.5">
              {{ pipeline.description }}
            </p>
          </div>

          <div class="tooltip tooltip-left" data-tip="Редактировать метаданные">
            <button class="btn btn-ghost btn-sm btn-square" @click="startEditing">
              <Icon name="mingcute:edit-line" />
            </button>
          </div>
        </div>

        <!-- Metadata + dates — unified compact row -->
        <div class="flex items-center flex-wrap gap-x-3 gap-y-1.5 mt-3 text-xs text-base-content/50">
          <span class="flex items-center gap-1">
            <Icon name="mingcute:box-line" class="text-sm" />
            {{ nodeCount }} блоков
          </span>
          <span class="flex items-center gap-1">
            <Icon name="mingcute:link-line" class="text-sm" />
            {{ edgeCount }} связей
          </span>
          <span class="flex items-center gap-1">
            <Icon name="mingcute:calendar-line" class="text-sm" />
            {{ formatDateFull(pipeline.lastEditedAt || pipeline.updatedAt) }}
          </span>
          <span
            v-for="tag in (pipeline.tags ?? [])"
            :key="tag.id"
            class="badge badge-outline badge-xs"
          >
            {{ tag.name }}
          </span>
        </div>

        <!-- Markdown description (sanitized) -->
        <div
          v-if="pipeline.markdownDescription"
          class="mt-4 prose prose-sm max-w-none bg-base-200/50 rounded-box p-4 max-h-[250px] overflow-y-auto"
        >
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div v-html="safeMarkdownHtml" />
        </div>

        <!-- Graph structure — compact inline -->
        <div v-if="nodeTypes.length > 0" class="flex flex-wrap gap-1 mt-3">
          <span
            v-for="(nodeType, ntIdx) in nodeTypes"
            :key="ntIdx"
            class="badge badge-xs badge-ghost"
          >
            {{ nodeType }}
          </span>
        </div>

        <!-- Actions row -->
        <div class="modal-action flex-wrap gap-2">
          <div class="tooltip" data-tip="Удалить конвейер">
            <button
              class="btn btn-error btn-sm btn-outline"
              :disabled="isDeleting"
              @click="handleDeleteClick"
            >
              <span v-if="isDeleting" class="loading loading-spinner loading-xs" />
              <Icon v-else name="mingcute:delete-2-line" />
              Удалить
            </button>
          </div>

          <div class="tooltip" data-tip="Создать копию конвейера">
            <button
              class="btn btn-sm btn-ghost"
              :disabled="isDuplicating"
              @click="handleDuplicate"
            >
              <span v-if="isDuplicating" class="loading loading-spinner loading-xs" />
              <Icon v-else name="mingcute:copy-2-line" />
              Дублировать
            </button>
          </div>

          <div class="tooltip" data-tip="Скачать как JSON">
            <button
              class="btn btn-sm btn-ghost"
              :disabled="isExporting"
              @click="handleExport"
            >
              <span v-if="isExporting" class="loading loading-spinner loading-xs" />
              <Icon v-else name="mingcute:download-2-line" />
              Экспорт
            </button>
          </div>

          <div class="flex-1" />

          <form method="dialog">
            <button class="btn btn-sm">Закрыть</button>
          </form>

          <button class="btn btn-primary btn-sm" @click="goToEditor">
            <Icon name="mingcute:edit-line" />
            Открыть редактор
          </button>
        </div>
      </template>

      <!-- Edit mode -->
      <template v-else>
        <h3 class="text-lg font-bold flex items-center gap-2">
          <Icon name="mingcute:edit-line" class="text-primary" />
          Редактирование метаданных
        </h3>

        <div class="mt-4 space-y-3">
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Название</legend>
            <input
              v-model="editName"
              type="text"
              class="input w-full"
              placeholder="Название конвейера"
              maxlength="255"
            />
          </fieldset>

          <fieldset class="fieldset">
            <legend class="fieldset-legend">Краткое описание</legend>
            <textarea
              v-model="editDescription"
              class="textarea w-full"
              placeholder="Краткое описание"
              rows="2"
            />
          </fieldset>

          <fieldset class="fieldset">
            <legend class="fieldset-legend">Подробное описание (Markdown)</legend>
            <textarea
              v-model="editMarkdownDescription"
              class="textarea w-full font-mono text-sm"
              placeholder="Поддерживается Markdown..."
              rows="4"
            />
          </fieldset>

          <!-- Icon picker -->
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Иконка</legend>
            <div class="flex flex-wrap gap-1.5">
              <div
                v-for="icon in availableIcons"
                :key="icon.value"
                class="tooltip tooltip-top"
                :data-tip="icon.label"
              >
                <button
                  type="button"
                  class="btn btn-sm btn-square transition-all"
                  :class="editIcon === icon.value ? 'btn-primary' : 'btn-ghost'"
                  @click="editIcon = icon.value"
                >
                  <Icon :name="icon.icon" class="text-lg" />
                </button>
              </div>
            </div>
          </fieldset>

          <!-- Color picker -->
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Цвет</legend>
            <div class="flex flex-wrap gap-1.5">
              <div
                v-for="color in availableColors"
                :key="color.value"
                class="tooltip tooltip-top"
                :data-tip="color.label"
              >
                <button
                  type="button"
                  class="w-8 h-8 rounded-lg border-2 transition-all flex items-center justify-center"
                  :class="[
                    color.css,
                    editColor === color.value
                      ? 'border-base-content scale-110 ring-2 ring-base-content/20'
                      : 'border-base-300 hover:border-base-content/30',
                  ]"
                  @click="editColor = color.value"
                >
                <Icon
                  v-if="editColor === color.value"
                  name="mingcute:check-line"
                  class="text-sm"
                  :class="color.textContent"
                />
              </button>
              </div>
            </div>
          </fieldset>

          <!-- Tags -->
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Теги</legend>
            <PipelineTagPicker v-model="editTags" />
          </fieldset>

          <!-- Live preview -->
          <div v-if="editName.trim()" class="flex items-center gap-2.5 p-2.5 bg-base-200/50 rounded-box">
            <div
              class="w-8 h-8 rounded-lg flex items-center justify-center"
              :class="editColorClasses.bg20"
            >
              <Icon
                :name="editIcon || 'mingcute:git-merge-line'"
                class="text-lg"
                :class="editColorClasses.text"
              />
            </div>
            <div>
              <div class="font-semibold text-sm">{{ editName }}</div>
              <div v-if="editTags.length > 0" class="flex flex-wrap gap-1 mt-0.5">
                <span v-for="tag in editTags" :key="tag" class="text-xs text-base-content/50">{{ tag }}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="modal-action">
          <button class="btn btn-ghost" @click="cancelEditing">
            Отмена
          </button>
          <button
            class="btn btn-primary"
            :disabled="!editName.trim() || isSaving"
            @click="saveMetadata"
          >
            <span v-if="isSaving" class="loading loading-spinner loading-sm" />
            <Icon v-else name="mingcute:save-line" />
            Сохранить
          </button>
        </div>
      </template>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button>close</button>
    </form>
  </dialog>

  <PipelineDeleteConfirmModal
    ref="deleteModalRef"
    @confirmed="handleDeleteConfirmed"
  />
</template>
