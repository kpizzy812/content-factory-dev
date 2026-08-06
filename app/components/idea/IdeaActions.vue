<script setup lang="ts">
const { can } = usePermissions()

const props = defineProps<{
  ideaId: number
  currentStatus: string
  analysisStatus: string
  referenceStatus?: string | null
  hasReferenceBreakdown?: boolean
}>()

const emit = defineEmits<{
  updated: []
  edit: []
  deleted: []
}>()

const { deleteIdea, toScenario, reanalyze, analyzeReference } = useIdeaActions()

const isDeleting = ref(false)
const isGenerating = ref(false)
const isReanalyzing = ref(false)
const isAnalyzingRef = ref(false)
const showDeleteConfirm = ref(false)
const errorMessage = ref('')

function fail(message: string) {
  errorMessage.value = message
  setTimeout(() => { errorMessage.value = '' }, 5000)
}

async function handleDelete() {
  isDeleting.value = true
  errorMessage.value = ''
  try {
    await deleteIdea(props.ideaId)
    emit('deleted')
  }
  catch {
    fail('Не удалось удалить идею.')
  }
  finally {
    isDeleting.value = false
    showDeleteConfirm.value = false
  }
}

async function handleToScenario() {
  isGenerating.value = true
  errorMessage.value = ''
  try {
    await toScenario(props.ideaId)
    emit('updated')
  }
  catch {
    fail('Не удалось создать сценарий из идеи.')
  }
  finally {
    isGenerating.value = false
  }
}

async function handleReanalyze() {
  isReanalyzing.value = true
  errorMessage.value = ''
  try {
    await reanalyze(props.ideaId)
    emit('updated')
  }
  catch {
    fail('Не удалось запустить повторный разбор.')
  }
  finally {
    isReanalyzing.value = false
  }
}

async function handleAnalyzeReference() {
  isAnalyzingRef.value = true
  errorMessage.value = ''
  try {
    await analyzeReference(props.ideaId)
    emit('updated')
  }
  catch {
    fail('Не удалось разобрать референс.')
  }
  finally {
    isAnalyzingRef.value = false
  }
}

const canGenerateScenario = computed(() => props.currentStatus === 'ready')
const canEdit = computed(() => ['ready', 'pending', 'failed'].includes(props.currentStatus))
const canReanalyze = computed(() => props.currentStatus === 'ready' && props.analysisStatus !== 'running')
const canAnalyzeReference = computed(() =>
  ['ready', 'in_work', 'completed'].includes(props.currentStatus) && props.referenceStatus !== 'running')

const isBusy = computed(() =>
  isDeleting.value || isGenerating.value || isReanalyzing.value || isAnalyzingRef.value)

// Платное и разрушающее — в меню с ценой, частое — в строке.
const menuItems = computed(() => {
  const items: Array<{ key: string, label: string, icon?: string, cost?: string, danger?: boolean, disabled?: boolean }> = []
  if (canAnalyzeReference.value && can('canRunAgent')) {
    items.push({
      key: 'reference',
      label: props.hasReferenceBreakdown ? 'Обновить разбор референса' : 'Разобрать референс',
      icon: 'mingcute:search-line',
      cost: 'платно',
      disabled: isBusy.value,
    })
  }
  if (canReanalyze.value && can('canRunAgent')) {
    items.push({
      key: 'reanalyze',
      label: 'Разобрать заново',
      icon: 'mingcute:refresh-2-line',
      cost: 'платно',
      disabled: isBusy.value,
    })
  }
  if (can('canDelete')) {
    items.push({ key: 'delete', label: 'Удалить идею', icon: 'mingcute:delete-2-line', danger: true, disabled: isBusy.value })
  }
  return items
})

function onMenu(key: string) {
  if (key === 'reference') void handleAnalyzeReference()
  else if (key === 'reanalyze') void handleReanalyze()
  else if (key === 'delete') showDeleteConfirm.value = true
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex flex-wrap items-center gap-1.5">
      <UiButton
        v-if="canGenerateScenario && can('canCreate') && can('canRunAgent')"
        variant="primary"
        :loading="isGenerating"
        :disabled="isBusy && !isGenerating"
        @click="handleToScenario"
      >
        <Icon v-if="!isGenerating" name="mingcute:star-line" />
        Создать сценарий
      </UiButton>

      <UiButton v-if="canEdit && can('canWrite')" :disabled="isBusy" @click="emit('edit')">
        <Icon name="mingcute:edit-line" />
        Редактировать
      </UiButton>

      <UiButton v-if="isReanalyzing || isAnalyzingRef" loading>
        {{ isAnalyzingRef ? 'Разбираем референс' : 'Разбираем' }}
      </UiButton>

      <UiActionMenu v-if="menuItems.length" :items="menuItems" @select="onMenu" />
    </div>

    <div
      v-if="errorMessage"
      role="alert"
      class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
    >
      <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
      <span>{{ errorMessage }}</span>
    </div>

    <UiModal :open="showDeleteConfirm" title="Удалить идею?" size="sm" @close="showDeleteConfirm = false">
      <p class="text-sm text-muted">
        Идея пропадёт из списка. Созданные из неё сценарии останутся.
      </p>
      <template #footer>
        <UiButton variant="ghost" @click="showDeleteConfirm = false">Отмена</UiButton>
        <UiButton variant="danger" :loading="isDeleting" @click="handleDelete">Удалить</UiButton>
      </template>
    </UiModal>
  </div>
</template>
