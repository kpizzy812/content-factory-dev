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
  }
  catch (err) {
    errorMessage.value = extractErrorMessage(err, 'Не удалось выбрать вариант')
    clearError()
  }
  finally {
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
    }
    else {
      await reworkVariant(props.scenarioId, props.variantId, reasonText.value || undefined)
    }
    emit('updated')
  }
  catch (err) {
    errorMessage.value = extractErrorMessage(
      err,
      `Не удалось ${reasonAction.value === 'reject' ? 'отклонить' : 'отправить на доработку'}`,
    )
    clearError()
  }
  finally {
    isUpdating.value = false
  }
}

const showDeleteModal = ref(false)

async function handleDelete() {
  showDeleteModal.value = false
  isUpdating.value = true
  errorMessage.value = ''
  try {
    await deleteScenario(props.scenarioId)
    await navigateTo('/scenarios')
  }
  catch (err) {
    errorMessage.value = extractErrorMessage(err, 'Не удалось удалить сценарий')
    clearError()
  }
  finally {
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
  }
  catch (err) {
    errorMessage.value = extractErrorMessage(err, 'Не удалось запустить переработку')
    clearError()
  }
  finally {
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

// Редкое и разрушающее живёт в меню, частое — в строке.
const menuItems = computed(() => {
  const items: Array<{ key: string, label: string, icon?: string, cost?: string, danger?: boolean }> = []
  if (canRework.value && can('canApprove')) {
    items.push({ key: 'rework', label: 'Отправить на доработку', icon: 'mingcute:refresh-2-line' })
  }
  if (props.variantStatus === 'needs_rework' && !props.isDeleted && can('canRunAgent')) {
    items.push({ key: 'ai-rework', label: 'AI-переработка варианта', icon: 'mingcute:ai-line', cost: 'платно' })
  }
  if (!props.isDeleted && can('canDelete')) {
    items.push({ key: 'delete', label: 'Удалить сценарий', icon: 'mingcute:delete-2-line', danger: true })
  }
  return items
})

function onMenu(key: string) {
  if (key === 'rework') openReasonModal('rework')
  else if (key === 'ai-rework') void handleReworkRegenerate()
  else if (key === 'delete') showDeleteModal.value = true
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex flex-wrap items-center gap-1.5">
      <UiButton
        v-if="canSelect && can('canApprove')"
        variant="primary"
        :loading="isUpdating"
        @click="handleSelect"
      >
        <Icon v-if="!isUpdating" name="mingcute:check-line" />
        Принять
      </UiButton>

      <UiButton
        v-if="canReject && can('canApprove')"
        variant="danger"
        :disabled="isUpdating"
        @click="openReasonModal('reject')"
      >
        <Icon name="mingcute:close-line" />
        Отклонить
      </UiButton>

      <UiButton v-if="canEdit" @click="emit('edit')">
        <Icon name="mingcute:edit-line" />
        Редактировать
      </UiButton>

      <UiButton v-if="isRegenerating" loading>AI-переработка</UiButton>

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

    <UiModal :open="showDeleteModal" title="Удалить сценарий?" size="sm" @close="showDeleteModal = false">
      <p class="text-sm text-muted">
        Все варианты будут архивированы. Вернуть сценарий можно только через бэкенд.
      </p>
      <template #footer>
        <UiButton variant="ghost" @click="showDeleteModal = false">Отмена</UiButton>
        <UiButton variant="danger" :loading="isUpdating" @click="handleDelete">Удалить</UiButton>
      </template>
    </UiModal>

    <UiModal
      :open="showReasonModal"
      :title="reasonAction === 'reject' ? 'Причина отклонения' : 'Причина доработки'"
      @close="showReasonModal = false"
    >
      <UiField
        label="Комментарий"
        hint="Сохранится в истории варианта и попадёт в контекст AI при переработке."
      >
        <UiTextarea
          v-model="reasonText"
          :rows="3"
          :placeholder="reasonAction === 'reject' ? 'Почему вариант не подходит?' : 'Что нужно доработать?'"
        />
      </UiField>
      <template #footer>
        <UiButton variant="ghost" @click="showReasonModal = false">Отмена</UiButton>
        <UiButton
          :variant="reasonAction === 'reject' ? 'danger' : 'primary'"
          :loading="isUpdating"
          @click="submitReasonAction"
        >
          {{ reasonAction === 'reject' ? 'Отклонить' : 'Отправить на доработку' }}
        </UiButton>
      </template>
    </UiModal>
  </div>
</template>
