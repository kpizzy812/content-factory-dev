<script setup lang="ts">
import type { BulkDeleteResponse } from '~~/shared/types/posting-job'

/**
 * Массовые действия над задачами постинга: удалить выбранные и вычистить
 * завалы из упавших и снятых.
 *
 * Отчёт о пропущенных задачах остаётся на экране, пока его не прочитают:
 * «удалено 12 из 15» без объяснения, что стало с тремя, — бесполезное сообщение.
 */
const props = defineProps<{
  selectedIds: string[]
  /** Всего задач в текущей выборке — для подписи «выбрано N из M». */
  total?: number
}>()

const emit = defineEmits<{
  'clear-selection': []
  done: [result: BulkDeleteResponse]
}>()

const { can } = usePermissions()
const canDelete = computed(() => can('canDelete'))

const { bulkDelete, isProcessing, error } = usePostingJobActions()

const isOpen = ref(false)
const mode = ref<'selected' | 'cleanup'>('selected')
const localError = ref<string | null>(null)
const resultSummary = ref<BulkDeleteResponse | null>(null)

const selectedCount = computed(() => props.selectedIds.length)

const confirmTitle = computed(() =>
  mode.value === 'selected'
    ? `Удалить выбранные задачи · ${selectedCount.value}`
    : 'Вычистить упавшие и снятые?',
)

const confirmText = computed(() =>
  mode.value === 'selected'
    ? `Удалим до ${selectedCount.value} задач. Опубликованные и выполняющиеся пропустим — `
      + 'их удаляют по одной, чтобы не создать дубль на платформе. Вернуть нельзя.'
    : 'Удалим все задачи в состояниях «Упала» и «Снята», до пятисот за раз. '
      + 'Опубликованные не трогаем. Вернуть нельзя.',
)

function ask(next: 'selected' | 'cleanup') {
  if (next === 'selected' && !selectedCount.value) return
  mode.value = next
  localError.value = null
  resultSummary.value = null
  isOpen.value = true
}

function closeConfirm() {
  isOpen.value = false
}

async function confirmDelete() {
  localError.value = null
  const result = mode.value === 'selected'
    ? await bulkDelete({ ids: props.selectedIds })
    : await bulkDelete({ filter: { status: ['failed', 'cancelled'] } })

  if (!result) {
    localError.value = error.value ?? 'Массовое удаление не выполнилось'
    return
  }

  resultSummary.value = result
  if (!result.skipped.length) {
    closeConfirm()
    emit('clear-selection')
    emit('done', result)
  }
}

function acknowledgeAndClose() {
  const r = resultSummary.value
  closeConfirm()
  emit('clear-selection')
  if (r) emit('done', r)
}
</script>

<template>
  <!--
    Панель и модалка — соседи, а не потомки общей обёртки: `sticky bottom-0`
    работает только когда у элемента есть куда двигаться внутри своего блока,
    и лишний div ростом в одну панель эту возможность отбирает.
  -->
  <UiBulkActionBar
    v-if="canDelete"
    :selected="selectedCount"
    :total="total ?? selectedCount"
    @clear="emit('clear-selection')"
  >
    <UiButton variant="danger" :disabled="isProcessing" @click="ask('selected')">
      <Icon name="mingcute:delete-2-line" />
      Удалить выбранные
    </UiButton>
    <UiButton :disabled="isProcessing" @click="ask('cleanup')">
      <Icon name="mingcute:broom-line" />
      Вычистить завалы
    </UiButton>
  </UiBulkActionBar>

  <UiModal v-if="canDelete" :open="isOpen" :title="confirmTitle" size="md" :persistent="isProcessing" @close="closeConfirm">
      <div class="flex flex-col gap-3">
        <p class="text-sm text-muted">{{ confirmText }}</p>

        <p
          v-if="resultSummary"
          class="tnum flex items-center gap-2 rounded-md border border-success-border bg-success-bg p-2.5 text-sm text-success"
        >
          <Icon name="mingcute:check-circle-line" class="shrink-0" />
          Удалено {{ resultSummary.deleted }}
        </p>

        <div
          v-if="resultSummary && resultSummary.skipped.length"
          class="flex flex-col gap-1.5 rounded-md border border-warning-border bg-warning-bg p-2.5 text-sm"
        >
          <div class="tnum flex items-center gap-2 font-medium">
            <Icon name="mingcute:alert-line" class="shrink-0 text-warning" />
            Пропущено {{ resultSummary.skipped.length }}
          </div>
          <ul class="max-h-32 overflow-y-auto">
            <li v-for="s in resultSummary.skipped" :key="s.id" class="text-micro text-muted">
              <span class="font-mono">{{ s.id.slice(0, 8) }}</span> — {{ s.reason }}
            </li>
          </ul>
        </div>

        <p v-if="localError" class="flex items-center gap-2 rounded-md border border-danger-border bg-danger-bg p-2.5 text-sm text-danger">
          <Icon name="mingcute:warning-line" class="shrink-0" />
          {{ localError }}
        </p>
      </div>

      <template #footer>
        <template v-if="resultSummary && resultSummary.skipped.length">
          <UiButton variant="primary" @click="acknowledgeAndClose">Понятно</UiButton>
        </template>
        <template v-else>
          <UiButton variant="ghost" :disabled="isProcessing" @click="closeConfirm">Назад</UiButton>
          <UiButton variant="danger" :loading="isProcessing" @click="confirmDelete">
            <Icon v-if="!isProcessing" name="mingcute:delete-2-line" />
            Удалить
          </UiButton>
        </template>
      </template>
  </UiModal>
</template>
