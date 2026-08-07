<script setup lang="ts">
/**
 * Шапка редактора конвейера. Источник: 04-pipeline-editor.dc.html.
 *
 * Правило платного действия здесь работает с той же оговоркой, что у монитора
 * запусков и включения устройства: «Запустить» — главное действие раздела и
 * остаётся видимой кнопкой, но с подтверждением, которое прямо говорит, что
 * запуск тратит деньги. Редкое и разрушающее — удаление конвейера — уехало в
 * меню «Ещё».
 */
interface ReadinessIssue {
  severity: 'error' | 'warning'
  message: string
}

interface Readiness {
  ready: boolean
  checklist: Record<string, boolean | null>
  issues: ReadinessIssue[]
}

const store = usePipelineEditorStore()
const { savePipeline, deletePipeline, isSaving, isDeleting } = usePipelineActions()
const toast = useToast()

const isRunning = ref(false)
const showScheduleModal = ref(false)
const showVersionsModal = ref(false)
const showWebhookModal = ref(false)
const showRunsModal = ref(false)

const deleteModalRef = ref<{ open: (name: string) => void } | null>(null)
const showReadiness = ref(false)
const runModalRef = ref<{ open: () => void, close: () => void, setBusy: (v: boolean) => void } | null>(null)

const readiness = ref<Readiness | null>(null)
const isValidating = ref(false)

const CHECKLIST_LABELS: Record<string, string> = {
  graphValid: 'Граф валиден',
  nodesConfigured: 'Блоки настроены',
  noCycles: 'Нет циклов',
  hasEntryNode: 'Есть входной блок',
  expressionsValid: 'Выражения корректны',
  scheduleReady: 'Расписание',
  webhookReady: 'Вебхук',
}

const checklistRows = computed(() => {
  const checklist = readiness.value?.checklist ?? {}
  return Object.entries(CHECKLIST_LABELS)
    .filter(([key]) => checklist[key] !== undefined && checklist[key] !== null)
    .map(([key, label]) => ({ key, label, passed: Boolean(checklist[key]) }))
})

async function checkReadiness() {
  if (!store.pipelineId) return
  isValidating.value = true
  try {
    const response = await $fetch<{ data: Readiness }>(`/api/pipelines/${store.pipelineId}/validate`)
    readiness.value = response.data
    showReadiness.value = true
  }
  catch {
    toast.error('Не удалось проверить готовность конвейера')
  }
  finally {
    isValidating.value = false
  }
}

const canRun = computed(() =>
  store.status === 'active' && store.nodes.length > 0 && !isRunning.value,
)

async function confirmRun() {
  if (!store.pipelineId || !canRun.value) return
  isRunning.value = true
  runModalRef.value?.setBusy(true)
  try {
    const result = await $fetch<{ data: { runId: number } }>(
      `/api/pipelines/${store.pipelineId}/run`,
      { method: 'POST' },
    )
    if (result?.data?.runId) {
      await navigateTo(`/pipeline/${store.pipelineId}/runs/${result.data.runId}`)
    }
  }
  catch (error: unknown) {
    const message = (error as { data?: { message?: string }, message?: string })
    toast.error(message?.data?.message ?? message?.message ?? 'Не удалось запустить конвейер')
  }
  finally {
    isRunning.value = false
    runModalRef.value?.setBusy(false)
    runModalRef.value?.close()
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
    tags: store.tags.map((tag: { name: string }) => tag.name),
    graphData: store.toGraphData(),
    status: store.status,
  })
  store.isDirty = false
}

async function toggleStatus() {
  if (!store.pipelineId) return
  const next = store.status === 'active' ? 'inactive' : 'active'
  await savePipeline(store.pipelineId, { status: next })
  store.status = next
}

async function handleDeleteConfirmed() {
  if (!store.pipelineId) return
  await deletePipeline(store.pipelineId)
  await navigateTo('/pipeline')
}

const menuItems = computed(() => [
  {
    key: 'validate',
    label: 'Проверить готовность',
    icon: 'mingcute:check-circle-line',
  },
  {
    key: 'status',
    label: store.status === 'active' ? 'Приостановить' : 'Активировать',
    icon: store.status === 'active' ? 'mingcute:pause-circle-line' : 'mingcute:play-circle-line',
  },
  {
    key: 'delete',
    label: 'Удалить конвейер',
    icon: 'mingcute:delete-2-line',
    danger: true,
  },
])

function onMenu(key: string) {
  if (key === 'validate') checkReadiness()
  if (key === 'status') toggleStatus()
  if (key === 'delete') deleteModalRef.value?.open(store.name)
}
</script>

<template>
  <ClientOnly>
    <div class="flex h-[46px] shrink-0 items-center gap-2 overflow-x-auto border-b border-border bg-panel px-3">
      <UiButton
        variant="ghost"
        icon-only
        title="К списку конвейеров"
        @click="navigateTo('/pipeline')"
      >
        <Icon name="mingcute:arrow-left-line" />
      </UiButton>

      <input
        v-model="store.name"
        type="text"
        class="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-sm font-semibold text-fg outline-none hover:border-border hover:bg-card focus:border-border focus:bg-card"
        placeholder="Название конвейера"
        @input="store.isDirty = true"
      >

      <span v-if="store.tags?.length" class="flex shrink-0 gap-1">
        <span
          v-for="tag in store.tags"
          :key="tag.name"
          class="inline-flex h-5 items-center rounded-full border border-border bg-card px-2 text-[11px] whitespace-nowrap text-muted"
        >{{ tag.name }}</span>
      </span>

      <PipelineStatusBadge :status="store.status" />

      <span
        v-if="store.isDirty"
        class="inline-flex h-5.5 shrink-0 items-center gap-1.5 rounded-sm border border-accent-border bg-accent-bg px-2 text-micro"
      >
        <span class="size-1.5 rounded-full bg-accent" />
        не сохранено
      </span>

      <span class="min-w-2 flex-1" />

      <div class="flex shrink-0 items-center gap-0.5 rounded-md border border-border bg-card p-0.5">
        <button
          type="button"
          class="flex h-5.5 w-6 cursor-pointer items-center justify-center rounded-sm text-muted hover:bg-raised hover:text-fg disabled:cursor-not-allowed disabled:text-subtle"
          title="Отменить · Ctrl+Z"
          :disabled="!store.canUndo"
          @click="store.undo()"
        >
          <Icon name="mingcute:back-line" />
        </button>
        <button
          type="button"
          class="flex h-5.5 w-6 cursor-pointer items-center justify-center rounded-sm text-muted hover:bg-raised hover:text-fg disabled:cursor-not-allowed disabled:text-subtle"
          title="Повторить · Ctrl+Shift+Z"
          :disabled="!store.canRedo"
          @click="store.redo()"
        >
          <Icon name="mingcute:forward-line" />
        </button>
      </div>

      <UiButton v-if="store.pipelineId" class="shrink-0" @click="showRunsModal = true">
        Запуски
      </UiButton>
      <UiButton v-if="store.pipelineId" class="shrink-0" @click="showScheduleModal = true">
        Расписание
      </UiButton>
      <UiButton v-if="store.pipelineId" class="shrink-0" @click="showVersionsModal = true">
        Версии
      </UiButton>
      <UiButton
        v-if="store.pipelineId"
        class="shrink-0"
        :class="store.webhookToken ? 'text-success' : ''"
        @click="showWebhookModal = true"
      >
        Вебхук
      </UiButton>

      <UiButton class="shrink-0" :loading="isSaving" :disabled="!store.isDirty" @click="handleSave">
        Сохранить
        <span class="ml-1 font-mono text-[10.5px] text-subtle">Ctrl+S</span>
      </UiButton>

      <UiButton
        variant="primary"
        class="shrink-0"
        :loading="isRunning"
        :disabled="!canRun"
        title="Запустить конвейер сейчас"
        @click="runModalRef?.open()"
      >
        <Icon v-if="!isRunning" name="mingcute:play-fill" />
        Запустить
      </UiButton>

      <UiActionMenu :items="menuItems" @select="onMenu" />

      <!-- Запуск тратит деньги провайдеров, поэтому спрашиваем прямо. -->
      <SharedConfirmModal
        ref="runModalRef"
        title="Запустить конвейер?"
        :message="`Конвейер «${store.name}» пойдёт по графу целиком. Платные блоки — генерация кадров, клипов и озвучки — потратят деньги провайдеров; остановка на середине уже списанное не вернёт.`"
        confirm-label="Запустить"
        @confirm="confirmRun"
      />

      <UiModal
        :open="showReadiness"
        :title="readiness?.ready ? 'Конвейер готов к запуску' : 'Есть проблемы'"
        size="md"
        @close="showReadiness = false"
      >
        <div v-if="readiness" class="flex flex-col gap-3">
          <ul class="flex flex-col gap-1.5">
            <li v-for="row in checklistRows" :key="row.key" class="flex items-center gap-2 text-sm">
              <Icon
                :name="row.passed ? 'mingcute:check-circle-fill' : 'mingcute:close-circle-fill'"
                :class="row.passed ? 'text-success' : 'text-danger'"
              />
              {{ row.label }}
            </li>
          </ul>

          <ul v-if="readiness.issues.length" class="flex max-h-56 flex-col gap-1 overflow-y-auto">
            <li
              v-for="(issue, index) in readiness.issues"
              :key="index"
              class="flex items-start gap-2 rounded-md border px-2.5 py-2 text-sm"
              :class="issue.severity === 'error'
                ? 'border-danger-border bg-danger-bg text-danger'
                : 'border-warning-border bg-warning-bg text-warning'"
            >
              <Icon
                :name="issue.severity === 'error' ? 'mingcute:close-circle-line' : 'mingcute:warning-line'"
                class="mt-0.5 shrink-0"
              />
              {{ issue.message }}
            </li>
          </ul>
        </div>

        <template #footer>
          <UiButton @click="showReadiness = false">Закрыть</UiButton>
        </template>
      </UiModal>

      <PipelineDeleteConfirmModal ref="deleteModalRef" @confirmed="handleDeleteConfirmed" />

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
        @token-updated="(token: string | null) => { store.webhookToken = token }"
      />
      <PipelineRunsModal
        v-if="store.pipelineId"
        :pipeline-id="store.pipelineId"
        :visible="showRunsModal"
        @close="showRunsModal = false"
      />
    </div>

    <template #fallback>
      <div class="flex h-[46px] shrink-0 items-center border-b border-border bg-panel px-3">
        <UiSkeleton variant="details" :count="1" />
      </div>
    </template>
  </ClientOnly>
</template>
