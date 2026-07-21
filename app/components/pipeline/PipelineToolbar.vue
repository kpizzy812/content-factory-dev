<script setup lang="ts">
const store = usePipelineEditorStore()
const { savePipeline, deletePipeline, isSaving, isDeleting } = usePipelineActions()
const isRunning = ref(false)
const showScheduleModal = ref(false)
const showVersionsModal = ref(false)
const showWebhookModal = ref(false)
const showRunsModal = ref(false)
const showReadiness = ref(false)

const deleteModalRef = ref<{ open: (name: string) => void } | null>(null)
const runError = ref<string | null>(null)

// Readiness check
const readiness = ref<any>(null)
const isValidating = ref(false)
const readinessModalRef = ref<HTMLDialogElement | null>(null)

async function checkReadiness() {
  if (!store.pipelineId) return
  isValidating.value = true
  try {
    const res = await $fetch<{ data: any }>(`/api/pipelines/${store.pipelineId}/validate`)
    readiness.value = res.data
    showReadiness.value = true
    nextTick(() => readinessModalRef.value?.showModal())
  } catch {
    readiness.value = null
  } finally {
    isValidating.value = false
  }
}

function closeReadiness() {
  showReadiness.value = false
  readinessModalRef.value?.close()
}

const readinessColor = computed(() => {
  if (!readiness.value) return ''
  if (readiness.value.ready) return 'text-success'
  return 'text-error'
})

const canRun = computed(() =>
  store.status === 'active' && store.nodes.length > 0 && !isRunning.value,
)

async function handleRun() {
  if (!store.pipelineId || !canRun.value) return

  isRunning.value = true
  runError.value = null
  try {
    const result = await $fetch<{ data: { runId: number } }>(
      `/api/pipelines/${store.pipelineId}/run`,
      { method: 'POST' },
    )

    if (result?.data?.runId) {
      await navigateTo(`/pipeline/${store.pipelineId}/runs/${result.data.runId}`)
    }
  } catch (e: any) {
    runError.value = e?.data?.message || e?.message || 'Ошибка запуска'
    setTimeout(() => { runError.value = null }, 5000)
  } finally {
    isRunning.value = false
  }
}

async function handleSave() {
  if (!store.pipelineId) return

  await savePipeline(store.pipelineId, {
    name: store.name,
    description: store.description,
    markdownDescription: store.markdownDescription,
    icon: store.icon,
    color: store.color,
    tags: store.tags.map(t => t.name),
    graphData: store.toGraphData(),
    status: store.status,
  })

  store.isDirty = false
}

async function toggleStatus() {
  if (!store.pipelineId) return

  const newStatus = store.status === 'active' ? 'inactive' : 'active'

  await savePipeline(store.pipelineId, { status: newStatus })
  store.status = newStatus
}

function handleDeleteClick() {
  deleteModalRef.value?.open(store.name)
}

async function handleDeleteConfirmed() {
  if (!store.pipelineId) return
  await deletePipeline(store.pipelineId)
  await navigateTo('/pipeline')
}
</script>

<template>
  <ClientOnly>
    <div class="flex items-center gap-1.5 px-3 py-1.5 bg-base-100 border-b border-base-300 shrink-0">
      <div class="tooltip tooltip-right" data-tip="Назад к списку конвейеров">
        <button class="btn btn-ghost btn-sm btn-square" @click="navigateTo('/pipeline')">
          <Icon name="mingcute:arrow-left-line" />
        </button>
      </div>

      <input
        v-model="store.name"
        type="text"
        class="input input-sm input-ghost font-semibold flex-1 max-w-xs"
        placeholder="Название конвейера"
        @input="store.isDirty = true"
      />

      <PipelineStatusBadge :status="store.status" />

      <span
        v-if="store.isDirty"
        class="badge badge-sm badge-warning gap-1"
      >
        <Icon name="mingcute:edit-line" class="text-xs" />
        Не сохранено
      </span>

      <div class="flex-1" />

      <!-- Readiness check -->
      <div class="tooltip tooltip-bottom" data-tip="Проверить готовность к запуску — найти ошибки конфигурации">
        <button
          v-if="store.pipelineId"
          class="btn btn-sm btn-ghost"
          :class="readinessColor"
          :disabled="isValidating"
          @click="checkReadiness"
        >
          <span v-if="isValidating" class="loading loading-spinner loading-xs" />
          <Icon v-else name="mingcute:check-circle-line" />
          <span class="hidden lg:inline">Проверить</span>
        </button>
      </div>

      <div class="tooltip tooltip-bottom" data-tip="Настроить автоматический запуск по расписанию">
        <button
          v-if="store.pipelineId"
          class="btn btn-sm btn-ghost"
          @click="showScheduleModal = true"
        >
          <Icon name="mingcute:calendar-time-add-line" />
          <span class="hidden lg:inline">Расписание</span>
        </button>
      </div>

      <div class="tooltip tooltip-bottom" data-tip="Сохранённые версии — откат к предыдущему состоянию">
        <button
          v-if="store.pipelineId"
          class="btn btn-sm btn-ghost"
          @click="showVersionsModal = true"
        >
          <Icon name="mingcute:git-branch-line" />
          <span class="hidden lg:inline">Версии</span>
        </button>
      </div>

      <div class="tooltip tooltip-bottom" data-tip="Webhook — запуск конвейера через HTTP-запрос из внешних сервисов">
        <button
          v-if="store.pipelineId"
          class="btn btn-sm btn-ghost"
          :class="{ 'text-success': store.webhookToken }"
          @click="showWebhookModal = true"
        >
          <Icon name="mingcute:link-line" />
          <span class="hidden lg:inline">Webhook</span>
        </button>
      </div>

      <div class="tooltip tooltip-bottom" data-tip="Все запуски — результаты, ошибки, длительность">
        <button
          v-if="store.pipelineId"
          class="btn btn-sm btn-ghost"
          @click="showRunsModal = true"
        >
          <Icon name="mingcute:time-line" />
          <span class="hidden lg:inline">Запуски</span>
        </button>
      </div>

      <!-- Run error toast -->
      <div v-if="runError" role="alert" class="alert alert-error text-xs py-1 px-3 max-w-xs">
        <Icon name="mingcute:warning-line" class="text-sm" />
        <span class="truncate">{{ runError }}</span>
        <button class="btn btn-ghost btn-xs btn-square" @click="runError = null">
          <Icon name="mingcute:close-line" />
        </button>
      </div>

      <div class="divider divider-horizontal mx-0.5 h-5 self-center" />

      <div class="tooltip tooltip-bottom" data-tip="Запустить конвейер сейчас">
        <button
          class="btn btn-sm btn-success"
          :disabled="!canRun"
          @click="handleRun"
        >
          <span v-if="isRunning" class="loading loading-spinner loading-sm" />
          <Icon v-else name="mingcute:rocket-line" />
          <span class="hidden lg:inline">Запустить</span>
        </button>
      </div>

      <div class="tooltip tooltip-bottom" :data-tip="store.status === 'active' ? 'Приостановить — запуски по расписанию и webhook будут отключены' : 'Активировать — разрешить запуски по расписанию и webhook'">
        <button
          class="btn btn-sm btn-ghost"
          :class="store.status === 'active' ? 'text-success' : 'text-base-content/50'"
          @click="toggleStatus"
        >
          <Icon :name="store.status === 'active' ? 'mingcute:pause-circle-line' : 'mingcute:play-circle-line'" />
        </button>
      </div>

      <div class="tooltip tooltip-left" data-tip="Сохранить изменения (Ctrl+S)">
        <button
          class="btn btn-sm btn-primary"
          :disabled="isSaving || !store.isDirty"
          @click="handleSave"
        >
          <span v-if="isSaving" class="loading loading-spinner loading-sm" />
          <Icon v-else name="mingcute:save-line" />
        </button>
      </div>

      <div class="tooltip tooltip-left" data-tip="Отменить последнее действие (Ctrl+Z)">
        <button
          class="btn btn-ghost btn-sm btn-square"
          :disabled="!store.canUndo"
          @click="store.undo()"
        >
          <Icon name="mingcute:arrow-left-line" />
        </button>
      </div>

      <div class="tooltip tooltip-left" data-tip="Вернуть отменённое действие (Ctrl+Shift+Z)">
        <button
          class="btn btn-ghost btn-sm btn-square"
          :disabled="!store.canRedo"
          @click="store.redo()"
        >
          <Icon name="mingcute:arrow-right-line" />
        </button>
      </div>

      <div class="tooltip tooltip-left" data-tip="Удалить конвейер безвозвратно">
        <button
          class="btn btn-sm btn-ghost text-error btn-square"
          :disabled="isDeleting"
          @click="handleDeleteClick"
        >
          <span v-if="isDeleting" class="loading loading-spinner loading-sm" />
          <Icon v-else name="mingcute:delete-2-line" />
        </button>
      </div>

      <!-- Readiness panel -->
      <dialog ref="readinessModalRef" class="modal">
        <div v-if="readiness" class="modal-box max-w-lg">
          <h3 class="text-lg font-bold flex items-center gap-2">
            <Icon
              :name="readiness.ready ? 'mingcute:check-circle-fill' : 'mingcute:warning-fill'"
              :class="readiness.ready ? 'text-success' : 'text-error'"
            />
            {{ readiness.ready ? 'Конвейер готов к запуску' : 'Есть проблемы' }}
          </h3>

          <!-- Checklist -->
          <div class="mt-3 space-y-1.5">
            <div
              v-for="(label, key) in {
                graphValid: 'Граф валиден',
                nodesConfigured: 'Блоки настроены',
                noCycles: 'Нет циклов',
                hasEntryNode: 'Есть входной блок',
                expressionsValid: 'Выражения корректны',
              } as Record<string, string>"
              :key="key"
              class="flex items-center gap-2 text-sm"
            >
              <Icon
                :name="readiness.checklist[key] ? 'mingcute:check-circle-fill' : 'mingcute:close-circle-fill'"
                :class="readiness.checklist[key] ? 'text-success' : 'text-error'"
              />
              {{ label }}
            </div>
            <div
              v-if="readiness.checklist.scheduleReady !== null"
              class="flex items-center gap-2 text-sm"
            >
              <Icon
                :name="readiness.checklist.scheduleReady ? 'mingcute:check-circle-fill' : 'mingcute:information-fill'"
                :class="readiness.checklist.scheduleReady ? 'text-success' : 'text-warning'"
              />
              Расписание
            </div>
            <div
              v-if="readiness.checklist.webhookReady !== null"
              class="flex items-center gap-2 text-sm"
            >
              <Icon
                :name="readiness.checklist.webhookReady ? 'mingcute:check-circle-fill' : 'mingcute:information-fill'"
                :class="readiness.checklist.webhookReady ? 'text-success' : 'text-warning'"
              />
              Webhook
            </div>
          </div>

          <!-- Issues list -->
          <div v-if="readiness.issues.length > 0" class="mt-3 space-y-1 max-h-48 overflow-y-auto">
            <div
              v-for="(issue, i) in readiness.issues"
              :key="i"
              class="text-xs rounded-box p-2"
              :class="issue.severity === 'error' ? 'bg-error/10 text-error' : 'bg-warning/10 text-warning'"
            >
              <Icon :name="issue.severity === 'error' ? 'mingcute:close-circle-line' : 'mingcute:warning-line'" class="inline mr-1" />
              {{ issue.message }}
            </div>
          </div>

          <div class="modal-action">
            <button class="btn btn-sm" @click="closeReadiness">Закрыть</button>
          </div>
        </div>
        <form method="dialog" class="modal-backdrop">
          <button @click="closeReadiness">close</button>
        </form>
      </dialog>

      <!-- Delete confirm modal -->
      <PipelineDeleteConfirmModal
        ref="deleteModalRef"
        @confirmed="handleDeleteConfirmed"
      />

      <!-- Modals -->
      <PipelineScheduleModal
        v-if="store.pipelineId"
        :pipeline-id="store.pipelineId"
        :visible="showScheduleModal"
        @close="showScheduleModal = false"
      />

      <PipelineVersionsModal
        v-if="store.pipelineId"
        :pipeline-id="store.pipelineId"
        :visible="showVersionsModal"
        @close="showVersionsModal = false"
      />

      <PipelineWebhookModal
        v-if="store.pipelineId"
        :pipeline-id="store.pipelineId"
        :visible="showWebhookModal"
        :current-token="store.webhookToken"
        @close="showWebhookModal = false"
        @token-updated="(t) => { store.webhookToken = t }"
      />

      <PipelineRunsModal
        v-if="store.pipelineId"
        :pipeline-id="store.pipelineId"
        :visible="showRunsModal"
        @close="showRunsModal = false"
      />
    </div>

    <template #fallback>
      <div class="flex items-center gap-1.5 px-3 py-1.5 bg-base-100 border-b border-base-300 shrink-0">
        <span class="loading loading-spinner loading-sm" />
      </div>
    </template>
  </ClientOnly>
</template>
