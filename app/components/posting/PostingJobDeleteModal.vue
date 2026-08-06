<script setup lang="ts">
import type { DeletePostingJobResponse, PostingJobDto } from '~~/shared/types/posting-job'

/**
 * Удаление задачи постинга. Два опасных случая объясняются прямо:
 * запись об опубликованном посте (повтор создаст дубль на платформе) и
 * задача, которая прямо сейчас выполняется.
 */
const emit = defineEmits<{
  deleted: [result: DeletePostingJobResponse]
  close: []
}>()

const { can } = usePermissions()
const canAdmin = computed(() => can('canAdmin'))

const isOpen = ref(false)
const currentJob = ref<PostingJobDto | null>(null)
const localError = ref<string | null>(null)
const forceChecked = ref(false)

const { deleteJob, isProcessing, error } = usePostingJobActions()

const shortId = computed(() => currentJob.value?.id.slice(0, 8) ?? '')
const accountLabel = computed(
  () => currentJob.value?.socialAccount?.displayName ?? `#${currentJob.value?.socialAccountId}`,
)

const isPublished = computed(() => currentJob.value?.status === 'published')

/**
 * Задача считается живой, если её начали меньше трёх минут назад. Точную
 * проверку делает сервер — здесь предупреждение и гейт принудительного удаления.
 */
const isFreshInFlight = computed(() => {
  const job = currentJob.value
  if (!job) return false
  if (job.status !== 'preparing' && job.status !== 'uploading') return false
  if (!job.startedAt) return false
  return new Date(job.startedAt).getTime() > Date.now() - 3 * 60 * 1000
})

function open(job: PostingJobDto) {
  currentJob.value = job
  localError.value = null
  forceChecked.value = false
  isOpen.value = true
}

function close() {
  isOpen.value = false
  currentJob.value = null
  localError.value = null
  forceChecked.value = false
  emit('close')
}

async function submit() {
  if (!currentJob.value) return
  localError.value = null

  const result = await deleteJob(currentJob.value.id, {
    confirm: isPublished.value,
    force: isFreshInFlight.value && forceChecked.value && canAdmin.value,
  })

  if (result) {
    emit('deleted', result)
    close()
  }
  else {
    localError.value = error.value ?? 'Не удалось удалить задачу'
  }
}

const submitDisabled = computed(() => {
  if (isFreshInFlight.value) return !(canAdmin.value && forceChecked.value)
  return false
})

defineExpose({ open, close })
</script>

<template>
  <UiModal :open="isOpen" title="Удалить задачу?" size="md" :persistent="isProcessing" @close="close">
    <div class="flex flex-col gap-3">
      <p v-if="currentJob" class="text-sm text-muted">
        Задача <span class="font-mono">{{ shortId }}</span> для аккаунта
        <span class="font-mono">{{ accountLabel }}</span> исчезнет без возможности вернуть.
      </p>

      <p v-if="isPublished" class="flex gap-2 rounded-md border border-warning-border bg-warning-bg p-2.5 text-sm">
        <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0 text-warning" />
        <span>
          Это запись об <b>уже опубликованном</b> посте. После удаления та же пара
          «ролик + аккаунт» может уйти на платформу второй раз — получится дубль.
        </span>
      </p>

      <p v-else-if="isFreshInFlight" class="flex gap-2 rounded-md border border-danger-border bg-danger-bg p-2.5 text-sm">
        <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0 text-danger" />
        <span>
          Задача <b>выполняется прямо сейчас</b>. Правильный порядок — сначала снять
          её из очереди, потом удалить. Принудительное удаление обрывает работу
          и доступно только администратору.
        </span>
      </p>

      <label
        v-if="isFreshInFlight && canAdmin"
        class="flex cursor-pointer items-center gap-2.5 text-sm"
      >
        <input
          v-model="forceChecked"
          type="checkbox"
          class="size-3.5 cursor-pointer accent-(--color-danger)"
          :disabled="isProcessing"
        >
        Оборвать выполнение и удалить
      </label>

      <p v-if="isFreshInFlight && !canAdmin" class="text-micro text-subtle">
        Принудительное удаление недоступно — сначала снимите задачу из очереди.
      </p>

      <p v-if="localError" class="flex items-center gap-2 rounded-md border border-danger-border bg-danger-bg p-2.5 text-sm text-danger">
        <Icon name="mingcute:warning-line" class="shrink-0" />
        {{ localError }}
      </p>
    </div>

    <template #footer>
      <UiButton variant="ghost" :disabled="isProcessing" @click="close">Назад</UiButton>
      <UiButton variant="danger" :loading="isProcessing" :disabled="submitDisabled" @click="submit">
        <Icon v-if="!isProcessing" name="mingcute:delete-2-line" />
        {{ isPublished ? 'Удалить запись о публикации' : 'Удалить' }}
      </UiButton>
    </template>
  </UiModal>
</template>
