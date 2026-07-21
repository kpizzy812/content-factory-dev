<script setup lang="ts">
const { can } = usePermissions()

const props = defineProps<{
  scenarioId: number
  scenarioStatus: string
  variantId: number
  variantStatus: string
  isDeleted?: boolean
}>()

const emit = defineEmits<{
  updated: []
  edit: []
}>()

const { selectVariant, rejectVariant, reworkVariant, reworkRegenerate, deleteScenario } = useScenarioActions()

const isUpdating = ref(false)
const errorMessage = ref('')
const showReasonModal = ref(false)
const reasonAction = ref<'reject' | 'rework'>('reject')
const reasonText = ref('')

function clearError() {
  setTimeout(() => { errorMessage.value = '' }, 5000)
}

function extractErrorMessage(err: unknown, fallback: string): string {
  const e = err as { data?: { message?: string }, message?: string } | undefined
  return e?.data?.message || e?.message || fallback
}

async function handleSelect() {
  isUpdating.value = true
  errorMessage.value = ''
  try {
    await selectVariant(props.scenarioId, props.variantId)
    emit('updated')
  } catch (err) {
    errorMessage.value = extractErrorMessage(err, 'Не удалось выбрать вариант')
    clearError()
  } finally {
    isUpdating.value = false
  }
}

function openReasonModal(action: 'reject' | 'rework') {
  reasonAction.value = action
  reasonText.value = ''
  showReasonModal.value = true
}

async function submitReasonAction() {
  isUpdating.value = true
  errorMessage.value = ''
  showReasonModal.value = false

  try {
    if (reasonAction.value === 'reject') {
      await rejectVariant(props.scenarioId, props.variantId, reasonText.value || undefined)
    } else {
      await reworkVariant(props.scenarioId, props.variantId, reasonText.value || undefined)
    }
    emit('updated')
  } catch (err) {
    errorMessage.value = extractErrorMessage(
      err,
      `Не удалось ${reasonAction.value === 'reject' ? 'отклонить' : 'отправить на доработку'}`,
    )
    clearError()
  } finally {
    isUpdating.value = false
  }
}

const showDeleteModal = ref(false)

function openDeleteModal() {
  showDeleteModal.value = true
}

async function handleDelete() {
  showDeleteModal.value = false
  isUpdating.value = true
  errorMessage.value = ''
  try {
    await deleteScenario(props.scenarioId)
    navigateTo('/scenarios')
  } catch (err) {
    errorMessage.value = extractErrorMessage(err, 'Не удалось удалить сценарий')
    clearError()
  } finally {
    isUpdating.value = false
  }
}

const isRegenerating = ref(false)

async function handleReworkRegenerate() {
  isRegenerating.value = true
  errorMessage.value = ''
  try {
    await reworkRegenerate(props.scenarioId, props.variantId)
    emit('updated')
  } catch (err) {
    errorMessage.value = extractErrorMessage(err, 'Не удалось запустить переработку')
    clearError()
  } finally {
    isRegenerating.value = false
  }
}

const canSelect = computed(() =>
  props.variantStatus === 'draft'
  && !props.isDeleted
  && props.scenarioStatus !== 'selected',
)

const canReject = computed(() =>
  ['draft', 'needs_rework'].includes(props.variantStatus)
  && !props.isDeleted,
)

const canRework = computed(() =>
  ['draft', 'accepted'].includes(props.variantStatus)
  && !props.isDeleted,
)

const canEdit = computed(() =>
  !['rejected', 'superseded'].includes(props.variantStatus)
  && !props.isDeleted,
)

const canDeleteScenario = computed(() => !props.isDeleted)
</script>

<template>
  <div class="flex flex-wrap gap-2">
    <!-- Принять -->
    <button
      v-if="canSelect && can('canApprove')"
      class="btn btn-sm btn-primary gap-1"
      :disabled="isUpdating"
      @click="handleSelect"
    >
      <span v-if="isUpdating" class="loading loading-spinner loading-xs" />
      <Icon v-else name="mingcute:check-line" />
      Принять
    </button>

    <!-- Отклонить -->
    <button
      v-if="canReject && can('canApprove')"
      class="btn btn-sm btn-error btn-outline gap-1"
      :disabled="isUpdating"
      @click="openReasonModal('reject')"
    >
      <Icon name="mingcute:close-line" />
      Отклонить
    </button>

    <!-- На доработку -->
    <button
      v-if="canRework && can('canApprove')"
      class="btn btn-sm btn-warning btn-outline gap-1"
      :disabled="isUpdating"
      @click="openReasonModal('rework')"
    >
      <Icon name="mingcute:refresh-2-line" />
      Переработать
    </button>

    <!-- Запустить AI-переработку (для вариантов в needs_rework) -->
    <button
      v-if="variantStatus === 'needs_rework' && !isDeleted && can('canRunAgent')"
      class="btn btn-sm btn-warning gap-1"
      :disabled="isUpdating || isRegenerating"
      @click="handleReworkRegenerate"
    >
      <span v-if="isRegenerating" class="loading loading-spinner loading-xs" />
      <Icon v-else name="mingcute:ai-line" />
      {{ isRegenerating ? 'Переработка...' : 'Запустить AI-переработку' }}
    </button>

    <!-- Редактировать -->
    <button
      v-if="canEdit"
      class="btn btn-sm btn-outline gap-1"
      @click="emit('edit')"
    >
      <Icon name="mingcute:edit-line" />
      Редактировать
    </button>

    <!-- Удалить -->
    <button
      v-if="canDeleteScenario && can('canDelete')"
      class="btn btn-sm btn-ghost text-error gap-1"
      :disabled="isUpdating"
      @click="openDeleteModal"
    >
      <Icon name="mingcute:delete-2-line" />
      Удалить
    </button>

    <!-- Модалка подтверждения удаления -->
    <dialog class="modal" :class="{ 'modal-open': showDeleteModal }">
      <div class="modal-box max-w-lg">
        <h3 class="font-bold text-lg mb-1">Удалить сценарий?</h3>
        <p class="text-xs text-base-content/60 mb-4">
          Все варианты будут архивированы. Сценарий можно восстановить только через бэкенд.
        </p>
        <div class="modal-action">
          <button class="btn btn-sm btn-ghost" @click="showDeleteModal = false">
            Отмена
          </button>
          <button
            class="btn btn-sm btn-error"
            :disabled="isUpdating"
            @click="handleDelete"
          >
            <span v-if="isUpdating" class="loading loading-spinner loading-xs" />
            Удалить
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button @click="showDeleteModal = false">close</button>
      </form>
    </dialog>

    <!-- Ошибка -->
    <div v-if="errorMessage" role="alert" class="alert alert-error alert-soft mt-2 text-sm w-full">
      <Icon name="mingcute:warning-line" />
      <span>{{ errorMessage }}</span>
    </div>

    <!-- Модалка причины reject/rework -->
    <dialog v-if="showReasonModal" class="modal modal-open">
      <div class="modal-box max-w-lg">
        <h3 class="font-bold text-lg mb-1">
          {{ reasonAction === 'reject' ? 'Причина отклонения' : 'Причина доработки' }}
        </h3>
        <p class="text-xs text-base-content/60 mb-4">
          Комментарий сохранится в истории варианта и поможет AI учесть фидбек.
        </p>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Комментарий</legend>
          <textarea
            v-model="reasonText"
            class="textarea textarea-sm w-full"
            rows="3"
            :placeholder="reasonAction === 'reject' ? 'Почему этот вариант не подходит?' : 'Что нужно доработать?'"
          />
        </fieldset>
        <div class="modal-action">
          <button class="btn btn-sm btn-ghost" @click="showReasonModal = false">
            Отмена
          </button>
          <button
            class="btn btn-sm"
            :class="reasonAction === 'reject' ? 'btn-error' : 'btn-warning'"
            :disabled="isUpdating"
            @click="submitReasonAction"
          >
            {{ reasonAction === 'reject' ? 'Отклонить' : 'Отправить на доработку' }}
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button @click="showReasonModal = false">close</button>
      </form>
    </dialog>
  </div>
</template>
