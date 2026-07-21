<script setup lang="ts">
import type { DriveFile } from '~/composables/useGoogleDrive'

const props = defineProps<{
  modelValue: boolean
  file: DriveFile | null
}>()
const emit = defineEmits<{
  'update:modelValue': [v: boolean]
  'imported': [payload: { videoId: number, fileId: number }]
}>()

const { importToVideo } = useGoogleDrive()

const dialogRef = ref<HTMLDialogElement | null>(null)
const scenarioId = ref<number | null>(null)
const applicationId = ref<number | null>(null)
const format = ref<'portrait' | 'landscape'>('portrait')
const isSubmitting = ref(false)
const errorMessage = ref<string | null>(null)

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      scenarioId.value = null
      applicationId.value = null
      format.value = 'portrait'
      errorMessage.value = null
      nextTick(() => dialogRef.value?.showModal())
    } else {
      dialogRef.value?.close()
    }
  },
)

const canSubmit = computed(
  () => scenarioId.value !== null && scenarioId.value > 0 && !isSubmitting.value,
)

async function handleSubmit() {
  if (!canSubmit.value || !props.file) return
  isSubmitting.value = true
  errorMessage.value = null
  try {
    const res = await importToVideo(props.file.id, {
      scenarioId: scenarioId.value as number,
      applicationId: applicationId.value ?? undefined,
      format: format.value,
    })
    emit('imported', { videoId: res.videoId, fileId: props.file.id })
    emit('update:modelValue', false)
  } catch (err: unknown) {
    const data = err as { data?: { message?: string }, message?: string }
    errorMessage.value = data?.data?.message || data?.message || 'Не удалось импортировать'
  } finally {
    isSubmitting.value = false
  }
}

function handleClose() {
  emit('update:modelValue', false)
}
</script>

<template>
  <dialog ref="dialogRef" class="modal" @close="handleClose">
    <div class="modal-box">
      <h3 class="text-lg font-bold mb-4">Импортировать в Video</h3>
      <p v-if="file" class="text-sm text-base-content/70 mb-3 truncate">
        Файл: <span class="font-mono">{{ file.name }}</span>
      </p>

      <div class="form-control mb-3">
        <label class="label">
          <span class="label-text">ID существующего сценария <span class="text-error">*</span></span>
          <span class="label-text-alt">
            <a href="/scenarios" target="_blank" class="link link-primary">Перейти к сценариям</a>
          </span>
        </label>
        <input
          v-model.number="scenarioId"
          type="number"
          min="1"
          placeholder="Например, 42"
          class="input w-full"
          required
          :disabled="isSubmitting"
        >
        <label class="label">
          <span class="label-text-alt">Видео будет привязано к этому сценарию</span>
        </label>
        <!-- TODO Этап 3: заменить на ScenarioComboBox с автодополнением (требует /api/scenarios?ownership=user) -->
      </div>

      <div class="form-control mb-3">
        <label class="label">
          <span class="label-text">ID приложения (опционально)</span>
        </label>
        <input
          v-model.number="applicationId"
          type="number"
          min="1"
          class="input w-full"
          :disabled="isSubmitting"
        >
      </div>

      <div class="form-control mb-3">
        <label class="label">
          <span class="label-text">Формат</span>
        </label>
        <select v-model="format" class="select w-full" :disabled="isSubmitting">
          <option value="portrait">Вертикальное (portrait)</option>
          <option value="landscape">Горизонтальное (landscape)</option>
        </select>
      </div>

      <div v-if="errorMessage" class="alert alert-error mb-3 text-sm">
        <Icon name="mingcute:warning-line" class="h-5 w-5" />
        <span>{{ errorMessage }}</span>
      </div>

      <div class="modal-action">
        <button class="btn btn-ghost" :disabled="isSubmitting" @click="handleClose">
          Отмена
        </button>
        <button class="btn btn-primary" :disabled="!canSubmit" @click="handleSubmit">
          <span v-if="isSubmitting" class="loading loading-spinner loading-sm" />
          <Icon v-else name="mingcute:check-line" class="h-4 w-4" />
          Импортировать
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button @click="handleClose">close</button>
    </form>
  </dialog>
</template>
