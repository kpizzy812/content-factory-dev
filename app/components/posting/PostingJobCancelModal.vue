<script setup lang="ts">
import type { PostingJobDto } from "~~/shared/types/posting-job"

const emit = defineEmits<{
  cancelled: [job: PostingJobDto]
  close: []
}>()

const modalRef = ref<HTMLDialogElement>()
const currentJob = ref<PostingJobDto | null>(null)
const reason = ref("")
const localError = ref<string | null>(null)

const { cancelJob, isProcessing, error } = usePostingJobActions()

const reasonTrimmed = computed(() => reason.value.trim())
const isValid = computed(() => reasonTrimmed.value.length > 0)

function open(job: PostingJobDto) {
  currentJob.value = job
  reason.value = ""
  localError.value = null
  modalRef.value?.showModal()
}

function close() {
  modalRef.value?.close()
  currentJob.value = null
  reason.value = ""
  localError.value = null
  emit("close")
}

async function submit() {
  if (!currentJob.value) return
  if (!isValid.value) {
    localError.value = "Укажите причину отмены"
    return
  }
  const updated = await cancelJob(currentJob.value.id, reasonTrimmed.value)
  if (updated) {
    emit("cancelled", updated)
    close()
  } else {
    localError.value = error.value ?? "Не удалось отменить job"
  }
}

defineExpose({ open, close })
</script>

<template>
  <dialog ref="modalRef" class="modal">
    <div class="modal-box max-w-lg">
      <h3 class="text-lg font-bold mb-2">Отменить публикацию?</h3>
      <p v-if="currentJob" class="text-sm text-base-content/70 mb-4">
        Job <code class="bg-base-200 px-1.5 py-0.5 rounded">
          {{ currentJob.id.slice(0, 8) }}
        </code>
        для аккаунта
        <strong>{{ currentJob.socialAccount?.displayName ?? `#${currentJob.socialAccountId}` }}</strong>
        ({{ currentJob.platform }}) будет переведён в статус <code>cancelled</code>.
      </p>

      <fieldset class="fieldset">
        <legend class="fieldset-legend">Причина отмены *</legend>
        <textarea
          v-model="reason"
          class="textarea w-full"
          rows="3"
          maxlength="500"
          placeholder="Например: дубликат контента, изменили план публикаций"
          :disabled="isProcessing"
        />
        <p class="label text-xs text-base-content/60">
          {{ reasonTrimmed.length }}/500
        </p>
      </fieldset>

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
          Назад
        </button>
        <button
          class="btn btn-sm btn-error"
          :disabled="isProcessing || !isValid"
          @click="submit"
        >
          <span v-if="isProcessing" class="loading loading-spinner loading-xs" />
          <Icon v-else name="mingcute:forbid-circle-line" />
          Отменить job
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button @click="close">close</button>
    </form>
  </dialog>
</template>
