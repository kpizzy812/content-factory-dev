<script setup lang="ts">
/**
 * Предпросмотр конвейера с карточки каталога.
 *
 * Дублирование и экспорт — бесплатные и частые, поэтому в строке. Удаление
 * необратимо и уходит в отдельное подтверждение со словом.
 */
import type { Pipeline } from '~~/shared/types/pipeline'
import type { PipelineMetaDraft } from './PipelineMetaForm.vue'
import { formatDateFull } from '~~/shared/utils/pipeline-format'
import { pipelineColor } from './PipelineColorMap'
import { pipelineNodeMeta } from './PipelineNodeMeta'

const emit = defineEmits<{
  deleted: [id: number]
  duplicated: [id: number]
  updated: []
}>()

const toast = useToast()
const { createPipeline, deletePipeline } = usePipelineActions()

const isOpen = ref(false)
const deleteModalRef = ref<{ open: (name: string) => void } | null>(null)
const pipeline = ref<(Pipeline & { nodesCount?: number }) | null>(null)

const isExporting = ref(false)
const isDuplicating = ref(false)
const isDeleting = ref(false)
const isSaving = ref(false)
const isEditing = ref(false)

const draft = ref<PipelineMetaDraft>({
  name: '',
  description: '',
  markdownDescription: '',
  icon: '',
  color: '',
  tags: [],
})

const safeMarkdownHtml = useMarkdownSafe(computed(() => pipeline.value?.markdownDescription))

const color = computed(() => pipelineColor(pipeline.value?.color))

const nodeCount = computed(() =>
  pipeline.value?.nodesCount ?? pipeline.value?.graphData?.nodes?.length ?? 0,
)
const edgeCount = computed(() => pipeline.value?.graphData?.edges?.length ?? 0)

const nodeTypes = computed(() => {
  const nodes = pipeline.value?.graphData?.nodes
  if (!Array.isArray(nodes)) return []
  return [...new Set(nodes.map((n: any) => n.data?.type as string).filter(Boolean))]
})

function open(p: Pipeline & { nodesCount?: number }) {
  pipeline.value = p
  isEditing.value = false
  isOpen.value = true
}

function close() {
  if (!isSaving.value) isOpen.value = false
}

function startEditing() {
  const p = pipeline.value
  if (!p) return
  draft.value = {
    name: p.name,
    description: p.description ?? '',
    markdownDescription: p.markdownDescription ?? '',
    icon: p.icon ?? '',
    color: p.color ?? '',
    tags: (p.tags ?? []).map(t => t.name),
  }
  isEditing.value = true
}

async function saveMetadata() {
  const p = pipeline.value
  if (!p || !draft.value.name.trim()) return
  isSaving.value = true
  try {
    const res = await $fetch<{ data: Pipeline }>(`/api/pipelines/${p.id}`, {
      method: 'PUT',
      body: {
        name: draft.value.name.trim(),
        description: draft.value.description.trim() || null,
        markdownDescription: draft.value.markdownDescription.trim() || null,
        icon: draft.value.icon || null,
        color: draft.value.color || null,
        tags: draft.value.tags,
      },
    })
    pipeline.value = { ...p, ...res.data }
    isEditing.value = false
    emit('updated')
  }
  catch (e: any) {
    toast.error(e?.data?.message || 'Не удалось сохранить')
  }
  finally {
    isSaving.value = false
  }
}

function goToEditor() {
  if (!pipeline.value) return
  isOpen.value = false
  navigateTo(`/pipeline/${pipeline.value.id}`)
}

async function handleExport() {
  const p = pipeline.value
  if (!p) return
  isExporting.value = true
  try {
    const res = await $fetch<{ data: unknown }>(`/api/pipelines/${p.id}/export`)
    const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `pipeline-${p.name.replace(/[^a-zA-Zа-яА-Я0-9-_]/g, '_')}.json`
    a.click()
    URL.revokeObjectURL(url)
  }
  catch (e: any) {
    toast.error(e?.data?.message || 'Не удалось выгрузить конвейер')
  }
  finally {
    isExporting.value = false
  }
}

async function handleDuplicate() {
  const source = pipeline.value
  if (!source) return
  isDuplicating.value = true
  try {
    const result = await createPipeline(`${source.name} (копия)`, source.description ?? undefined)
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
      isOpen.value = false
      emit('duplicated', result.data.id)
    }
  }
  catch (e: any) {
    toast.error(e?.data?.message || 'Не удалось создать копию')
  }
  finally {
    isDuplicating.value = false
  }
}

async function handleDeleteConfirmed() {
  const p = pipeline.value
  if (!p) return
  isDeleting.value = true
  try {
    await deletePipeline(p.id)
    isOpen.value = false
    emit('deleted', p.id)
  }
  catch (e: any) {
    toast.error(e?.data?.message || 'Не удалось удалить конвейер')
  }
  finally {
    isDeleting.value = false
  }
}

defineExpose({ open })
</script>

<template>
  <UiModal
    :open="isOpen"
    size="lg"
    :title="isEditing ? 'Оформление конвейера' : (pipeline?.name ?? 'Конвейер')"
    @close="close"
  >
    <template v-if="pipeline && !isEditing">
      <div class="flex flex-col gap-3">
        <div class="flex items-start gap-3">
          <span class="flex size-10 shrink-0 items-center justify-center rounded-md" :class="color.bg">
            <Icon :name="pipeline.icon || 'mingcute:git-merge-line'" class="text-xl" :class="color.text" />
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <PipelineStatusBadge :status="pipeline.status" />
              <span
                v-for="tag in (pipeline.tags ?? [])"
                :key="tag.id"
                class="inline-flex h-[18px] items-center rounded-sm border border-border bg-card px-1.5 text-micro text-muted"
              >{{ tag.name }}</span>
            </div>
            <p v-if="pipeline.description" class="mt-1 text-sm text-muted">{{ pipeline.description }}</p>
          </div>
          <UiButton icon-only variant="ghost" title="Править оформление" @click="startEditing">
            <Icon name="mingcute:edit-line" />
          </UiButton>
        </div>

        <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-subtle">
          <span class="tnum flex items-center gap-1">
            <Icon name="mingcute:box-line" />{{ nodeCount }} блоков
          </span>
          <span class="tnum flex items-center gap-1">
            <Icon name="mingcute:link-line" />{{ edgeCount }} связей
          </span>
          <ClientOnly>
            <span class="tnum flex items-center gap-1">
              <Icon name="mingcute:calendar-line" />
              {{ formatDateFull(pipeline.lastEditedAt || pipeline.updatedAt) }}
            </span>
          </ClientOnly>
        </div>

        <div
          v-if="pipeline.markdownDescription"
          class="max-h-64 overflow-y-auto rounded-md border border-border bg-card p-3 text-sm"
        >
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div v-html="safeMarkdownHtml" />
        </div>

        <div v-if="nodeTypes.length" class="flex flex-wrap gap-1">
          <span
            v-for="type in nodeTypes"
            :key="type"
            class="inline-flex h-[18px] items-center rounded-sm border border-border bg-card px-1.5 text-micro text-muted"
          >{{ pipelineNodeMeta(type).label }}</span>
        </div>
      </div>
    </template>

    <PipelineMetaForm v-else-if="pipeline" v-model="draft" />

    <template #footer>
      <template v-if="isEditing">
        <UiButton variant="ghost" :disabled="isSaving" @click="isEditing = false">Отмена</UiButton>
        <UiButton variant="primary" :disabled="!draft.name.trim()" :loading="isSaving" @click="saveMetadata">
          Сохранить
        </UiButton>
      </template>

      <template v-else>
        <UiButton variant="danger" :loading="isDeleting" @click="deleteModalRef?.open(pipeline!.name)">
          <Icon v-if="!isDeleting" name="mingcute:delete-2-line" />
          Удалить
        </UiButton>
        <UiButton variant="ghost" :loading="isDuplicating" @click="handleDuplicate">
          <Icon v-if="!isDuplicating" name="mingcute:copy-2-line" />
          Дублировать
        </UiButton>
        <UiButton variant="ghost" :loading="isExporting" @click="handleExport">
          <Icon v-if="!isExporting" name="mingcute:download-2-line" />
          Экспорт
        </UiButton>
        <span class="flex-1" />
        <UiButton variant="ghost" @click="close">Закрыть</UiButton>
        <UiButton variant="primary" @click="goToEditor">
          <Icon name="mingcute:edit-line" />
          Открыть редактор
        </UiButton>
      </template>
    </template>
  </UiModal>

  <PipelineDeleteConfirmModal ref="deleteModalRef" @confirmed="handleDeleteConfirmed" />
</template>
