<script setup lang="ts">
import type { PostingJobDto } from '~~/shared/types/posting-job'

/** Снятие публикации из очереди. Причина обязательна — она остаётся в задаче. */
const emit = defineEmits<{
  cancelled: [job: PostingJobDto]
  close: []
}>()

const isOpen = ref(false)
const currentJob = ref<PostingJobDto | null>(null)
const reason = ref('')
const localError = ref<string | null>(null)

const { cancelJob, isProcessing, error } = usePostingJobActions()

const reasonTrimmed = computed(() => reason.value.trim())
const isValid = computed(() => reasonTrimmed.value.length > 0)

function open(job: PostingJobDto) {
  currentJob.value = job
  reason.value = ''
  localError.value = null
  isOpen.value = true
}

function close() {
  isOpen.value = false
  currentJob.value = null
  reason.value = ''
  localError.value = null
  emit('close')
}

async function submit() {
  if (!currentJob.value) return
  if (!isValid.value) {
    localError.value = 'Причина обязательна — она остаётся в задаче'
    return
  }
  const updated = await cancelJob(currentJob.value.id, reasonTrimmed.value)
  if (updated) {
    emit('cancelled', updated)
    close()
  }
  else {
    localError.value = error.value ?? 'Не удалось снять задачу'
  }
}

defineExpose({ open, close })
</script>

<template>
  <UiModal :open="isOpen" title="Снять публикацию из очереди?" size="md" :persistent="isProcessing" @close="close">
    <div class="flex flex-col gap-3">
      <p v-if="currentJob" class="text-sm text-muted">
        Задача <span class="font-mono">{{ currentJob.id.slice(0, 8) }}</span>
        для аккаунта
        <span class="font-mono">{{ currentJob.socialAccount?.displayName ?? `#${currentJob.socialAccountId}` }}</span>
        больше не будет опубликована.
      </p>

      <UiField label="Причина" :hint="`${reasonTrimmed.length} из 500 символов`">
        <UiTextarea
          v-model="reason"
          :rows="3"
          :disabled="isProcessing"
          placeholder="Например: ролик заменили на новый вариант"
        />
      </UiField>

      <p v-if="localError" class="flex items-center gap-2 rounded-md border border-danger-border bg-danger-bg p-2.5 text-sm text-danger">
        <Icon name="mingcute:warning-line" class="shrink-0" />
        {{ localError }}
      </p>
    </div>

    <template #footer>
      <UiButton variant="ghost" :disabled="isProcessing" @click="close">Назад</UiButton>
      <UiButton variant="danger" :loading="isProcessing" :disabled="!isValid" @click="submit">
        Снять из очереди
      </UiButton>
    </template>
  </UiModal>
</template>
