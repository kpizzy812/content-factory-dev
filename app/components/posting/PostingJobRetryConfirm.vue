<script setup lang="ts">
import type { PostingJobDto } from "~~/shared/types/posting-job"

const emit = defineEmits<{
  retried: [job: PostingJobDto]
  close: []
}>()

const modalRef = ref<HTMLDialogElement>()
const currentJob = ref<PostingJobDto | null>(null)
const localError = ref<string | null>(null)

const { retryJob, isProcessing, error } = usePostingJobActions()

function open(job: PostingJobDto) {
  currentJob.value = job
  localError.value = null
  modalRef.value?.showModal()
}

function close() {
  modalRef.value?.close()
  currentJob.value = null
  localError.value = null
  emit("close")
}

async function submit() {
  if (!currentJob.value) return
  const updated = await retryJob(currentJob.value.id)
  if (updated) {
    emit("retried", updated)
    close()
  } else {
    localError.value = error.value ?? "Не удалось запустить retry"
  }
}

defineExpose({ open, close })
</script>

<template>
  <dialog ref="modalRef" class="modal">
    <div class="modal-box max-w-md">
      <h3 class="text-lg font-bold mb-2">Повторить публикацию?</h3>
      <p v-if="currentJob" class="text-sm text-base-content/70 mb-3">
        Job <code class="bg-base-200 px-1.5 py-0.5 rounded">
          {{ currentJob.id.slice(0, 8) }}
        </code>
        будет переведён из <code>failed</code> в <code>retry_queued</code>,
        счётчик попыток сброшен.
      </p>

      <div
        v-if="currentJob?.lastError"
        class="alert alert-warning alert-soft text-sm mb-2"
      >
        <Icon name="mingcute:warning-line" />
        <span class="text-xs">
          Последняя ошибка: <span class="font-mono">{{ currentJob.lastError }}</span>
        </span>
      </div>

      <div
        v-if="localError"
        role="alert"
        class="alert alert-error alert-soft text-sm mt-3"
      >
        <Icon name="mingcute:warning-line" />
        <span>{{ localError }}</span>
      </div>

      <div class="modal-action">
        <button class="btn btn-sm" :disabled="isProcessing" @click="close">
          Отмена
        </button>
        <button
          class="btn btn-sm btn-warning"
          :disabled="isProcessing"
          @click="submit"
        >
          <span v-if="isProcessing" class="loading loading-spinner loading-xs" />
          <Icon v-else name="mingcute:refresh-3-line" />
          Запустить retry
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button @click="close">close</button>
    </form>
  </dialog>
</template>
