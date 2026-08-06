<script setup lang="ts">
import type { PostingJobDto } from '~~/shared/types/posting-job'
import { POSTING_ERROR_LABELS } from './PostingStatusMap'

/** Ручной повтор упавшей задачи: счётчик попыток сбрасывается. */
const emit = defineEmits<{
  retried: [job: PostingJobDto]
  close: []
}>()

const isOpen = ref(false)
const currentJob = ref<PostingJobDto | null>(null)
const localError = ref<string | null>(null)

const { retryJob, isProcessing, error } = usePostingJobActions()

function open(job: PostingJobDto) {
  currentJob.value = job
  localError.value = null
  isOpen.value = true
}

function close() {
  isOpen.value = false
  currentJob.value = null
  localError.value = null
  emit('close')
}

async function submit() {
  if (!currentJob.value) return
  const updated = await retryJob(currentJob.value.id)
  if (updated) {
    emit('retried', updated)
    close()
  }
  else {
    localError.value = error.value ?? 'Не удалось поставить повтор'
  }
}

const errorLabel = computed(() =>
  currentJob.value?.errorCategory
    ? POSTING_ERROR_LABELS[currentJob.value.errorCategory] ?? currentJob.value.errorCategory
    : null,
)

defineExpose({ open, close })
</script>

<template>
  <UiModal :open="isOpen" title="Повторить публикацию?" size="md" :persistent="isProcessing" @close="close">
    <div class="flex flex-col gap-3">
      <p v-if="currentJob" class="text-sm text-muted">
        Задача <span class="font-mono">{{ currentJob.id.slice(0, 8) }}</span>
        вернётся в очередь, счётчик попыток обнулится.
      </p>

      <div
        v-if="currentJob?.lastError"
        class="flex gap-2 rounded-md border border-warning-border bg-warning-bg p-2.5 text-sm"
      >
        <Icon name="mingcute:warning-line" class="mt-0.5 shrink-0 text-warning" />
        <span class="min-w-0">
          <span v-if="errorLabel" class="block font-medium">В прошлый раз: {{ errorLabel }}</span>
          <span class="block break-words text-muted">{{ currentJob.lastError }}</span>
        </span>
      </div>

      <p v-if="localError" class="flex items-center gap-2 rounded-md border border-danger-border bg-danger-bg p-2.5 text-sm text-danger">
        <Icon name="mingcute:warning-line" class="shrink-0" />
        {{ localError }}
      </p>
    </div>

    <template #footer>
      <UiButton variant="ghost" :disabled="isProcessing" @click="close">Отмена</UiButton>
      <UiButton variant="primary" :loading="isProcessing" @click="submit">
        <Icon v-if="!isProcessing" name="mingcute:refresh-3-line" />
        Повторить
      </UiButton>
    </template>
  </UiModal>
</template>
