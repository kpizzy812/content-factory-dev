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

async function handleDelete() {
  isDeleting.value = true
  errorMessage.value = ''

  try {
    await deleteIdea(props.ideaId)
    emit('deleted')
  } catch {
    errorMessage.value = 'Не удалось удалить идею.'
    setTimeout(() => { errorMessage.value = '' }, 5000)
  } finally {
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
  } catch {
    errorMessage.value = 'Не удалось создать сценарии из идеи.'
    setTimeout(() => { errorMessage.value = '' }, 5000)
  } finally {
    isGenerating.value = false
  }
}

async function handleReanalyze() {
  isReanalyzing.value = true
  errorMessage.value = ''

  try {
    await reanalyze(props.ideaId)
    emit('updated')
  } catch {
    errorMessage.value = 'Не удалось запустить повторный анализ.'
    setTimeout(() => { errorMessage.value = '' }, 5000)
  } finally {
    isReanalyzing.value = false
  }
}

async function handleAnalyzeReference() {
  isAnalyzingRef.value = true
  errorMessage.value = ''

  try {
    await analyzeReference(props.ideaId)
    emit('updated')
  } catch {
    errorMessage.value = 'Не удалось выполнить reference analysis.'
    setTimeout(() => { errorMessage.value = '' }, 5000)
  } finally {
    isAnalyzingRef.value = false
  }
}

const canGenerateScenario = computed(() => props.currentStatus === 'ready')
const canEdit = computed(() => ['ready', 'pending', 'failed'].includes(props.currentStatus))
const canReanalyze = computed(() =>
  props.currentStatus === 'ready'
  && props.analysisStatus !== 'running',
)
const canAnalyzeReference = computed(() =>
  ['ready', 'in_work', 'completed'].includes(props.currentStatus)
  && props.referenceStatus !== 'running',
)
const isLoading = computed(() => isDeleting.value || isGenerating.value || isReanalyzing.value || isAnalyzingRef.value)
</script>

<template>
  <div class="flex flex-wrap gap-2">
    <button
      v-if="canGenerateScenario && can('canCreate') && can('canRunAgent')"
      class="btn btn-sm btn-primary gap-1"
      :disabled="isLoading"
      @click="handleToScenario"
    >
      <span v-if="isGenerating" class="loading loading-spinner loading-xs" />
      <Icon v-else name="mingcute:star-line" />
      Создать сценарий
    </button>

    <button
      v-if="canAnalyzeReference && can('canRunAgent')"
      class="btn btn-sm btn-outline btn-secondary gap-1"
      :disabled="isLoading"
      @click="handleAnalyzeReference"
    >
      <span v-if="isAnalyzingRef" class="loading loading-spinner loading-xs" />
      <Icon v-else name="mingcute:search-line" />
      {{ hasReferenceBreakdown ? 'Обновить референс' : 'Анализ референса' }}
    </button>

    <button
      v-if="canReanalyze && can('canRunAgent')"
      class="btn btn-sm btn-outline btn-info gap-1"
      :disabled="isLoading"
      @click="handleReanalyze"
    >
      <span v-if="isReanalyzing" class="loading loading-spinner loading-xs" />
      <Icon v-else name="mingcute:refresh-2-line" />
      Переанализировать
    </button>

    <button
      v-if="canEdit && can('canWrite')"
      class="btn btn-sm btn-outline gap-1"
      :disabled="isLoading"
      @click="emit('edit')"
    >
      <Icon name="mingcute:edit-line" />
      Редактировать
    </button>

    <template v-if="can('canDelete')">
      <button
        v-if="!showDeleteConfirm"
        class="btn btn-sm btn-error btn-outline gap-1"
        :disabled="isLoading"
        @click="showDeleteConfirm = true"
      >
        <Icon name="mingcute:delete-line" />
        Удалить
      </button>
      <div v-else class="flex items-center gap-1">
        <span class="text-sm text-error">Точно удалить?</span>
        <button
          class="btn btn-xs btn-error gap-1"
          :disabled="isLoading"
          @click="handleDelete"
        >
          <span v-if="isDeleting" class="loading loading-spinner loading-xs" />
          Да
        </button>
        <button
          class="btn btn-xs btn-ghost"
          :disabled="isLoading"
          @click="showDeleteConfirm = false"
        >
          Нет
        </button>
      </div>
    </template>

    <div v-if="errorMessage" role="alert" class="alert alert-error alert-soft mt-2 text-sm w-full">
      <Icon name="mingcute:warning-line" />
      <span>{{ errorMessage }}</span>
    </div>
  </div>
</template>
