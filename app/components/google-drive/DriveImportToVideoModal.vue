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

const scenarioId = ref<number | null>(null)
const applicationId = ref<number | null>(null)
const format = ref<'portrait' | 'landscape'>('portrait')
const isSubmitting = ref(false)
const errorMessage = ref<string | null>(null)

const formatOptions = [
  { value: 'portrait', label: 'Вертикальное (9:16)' },
  { value: 'landscape', label: 'Горизонтальное (16:9)' },
]

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    scenarioId.value = null
    applicationId.value = null
    format.value = 'portrait'
    errorMessage.value = null
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
  <UiModal :open="modelValue" title="Импортировать в ролики" :persistent="isSubmitting" @close="handleClose">
    <div class="flex flex-col gap-3">
      <p v-if="file" class="truncate text-muted">
        Файл: <span class="font-mono text-fg">{{ file.name }}</span>
      </p>

      <UiField label="ID существующего сценария *" hint="Видео будет привязано к этому сценарию.">
        <UiInput
          v-model.number="scenarioId"
          type="number"
          min="1"
          placeholder="Например, 42"
          :disabled="isSubmitting"
        />
        <NuxtLink to="/scenarios" target="_blank" class="mt-1 inline-block text-micro text-accent-text">
          Перейти к сценариям →
        </NuxtLink>
      </UiField>

      <UiField label="ID приложения (опционально)">
        <UiInput v-model.number="applicationId" type="number" min="1" :disabled="isSubmitting" />
      </UiField>

      <UiField label="Формат">
        <UiSelect v-model="format" :options="formatOptions" :disabled="isSubmitting" />
      </UiField>

      <p
        v-if="errorMessage"
        class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-danger"
      >
        <Icon name="mingcute:warning-line" class="mt-0.5 shrink-0" />
        <span>{{ errorMessage }}</span>
      </p>
    </div>

    <template #footer>
      <UiButton variant="ghost" size="md" :disabled="isSubmitting" @click="handleClose">Отмена</UiButton>
      <UiButton variant="primary" size="md" :disabled="!canSubmit" :loading="isSubmitting" @click="handleSubmit">
        <Icon v-if="!isSubmitting" name="mingcute:check-line" />
        Импортировать
      </UiButton>
    </template>
  </UiModal>
</template>
