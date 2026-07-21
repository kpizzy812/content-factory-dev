<script setup lang="ts">
import {
  POSTING_JOB_FREELY_DELETABLE,
  type DeletePostingJobResponse,
  type PostingJobDto,
} from "~~/shared/types/posting-job"

const emit = defineEmits<{
  deleted: [result: DeletePostingJobResponse]
  close: []
}>()

const { can } = usePermissions()
const canAdmin = computed(() => can("canAdmin"))

const modalRef = ref<HTMLDialogElement>()
const currentJob = ref<PostingJobDto | null>(null)
const localError = ref<string | null>(null)
const forceChecked = ref(false)

const { deleteJob, isProcessing, error } = usePostingJobActions()

const shortId = computed(() => currentJob.value?.id.slice(0, 8) ?? "")

const accountLabel = computed(
  () =>
    currentJob.value?.socialAccount?.displayName
    ?? `#${currentJob.value?.socialAccountId}`,
)

const isPublished = computed(() => currentJob.value?.status === "published")

/**
 * Свежая in-flight (preparing/uploading со startedAt < 3 мин назад). Точную
 * проверку делает сервер; здесь — UI-предупреждение/гейт force.
 */
const isFreshInFlight = computed(() => {
  const job = currentJob.value
  if (!job) return false
  if (job.status !== "preparing" && job.status !== "uploading") return false
  if (!job.startedAt) return false
  const startedMs = new Date(job.startedAt).getTime()
  return startedMs > Date.now() - 3 * 60 * 1000
})

/** Свободно удаляется без confirm/force. */
const isFreelyDeletable = computed(() => {
  const job = currentJob.value
  if (!job) return false
  if (POSTING_JOB_FREELY_DELETABLE.includes(job.status)) return true
  // preparing/uploading STALE — свободно (труп).
  if (
    (job.status === "preparing" || job.status === "uploading")
    && !isFreshInFlight.value
  ) {
    return true
  }
  return false
})

function open(job: PostingJobDto) {
  currentJob.value = job
  localError.value = null
  forceChecked.value = false
  modalRef.value?.showModal()
}

function close() {
  modalRef.value?.close()
  currentJob.value = null
  localError.value = null
  forceChecked.value = false
  emit("close")
}

async function submit() {
  if (!currentJob.value) return
  localError.value = null

  const result = await deleteJob(currentJob.value.id, {
    // published всегда подтверждаем явно при удалении из этой модалки.
    confirm: isPublished.value,
    // force нужен только для свежей in-flight и только если админ его включил.
    force: isFreshInFlight.value && forceChecked.value && canAdmin.value,
  })

  if (result) {
    emit("deleted", result)
    close()
  } else {
    localError.value = error.value ?? "Не удалось удалить задачу"
  }
}

/** Кнопка удаления блокируется, если свежая in-flight и (нет admin или force не отмечен). */
const submitDisabled = computed(() => {
  if (isProcessing.value) return true
  if (isFreshInFlight.value) {
    return !(canAdmin.value && forceChecked.value)
  }
  return false
})

defineExpose({ open, close })
</script>

<template>
  <dialog ref="modalRef" class="modal">
    <div class="modal-box max-w-lg">
      <h3 class="text-lg font-bold mb-2 flex items-center gap-2">
        <Icon name="mingcute:delete-2-line" class="text-error" />
        Удалить задачу?
      </h3>

      <p v-if="currentJob" class="text-sm text-base-content/70 mb-3">
        Задача
        <code class="bg-base-200 px-1.5 py-0.5 rounded">{{ shortId }}</code>
        для аккаунта <strong>{{ accountLabel }}</strong>
        ({{ currentJob.platform }}) будет удалена без возможности восстановления.
      </p>

      <!-- Предупреждение: published (re-post дубль) -->
      <div
        v-if="isPublished"
        role="alert"
        class="alert alert-warning alert-soft text-sm mb-3"
      >
        <Icon name="mingcute:alert-line" class="shrink-0" />
        <span>
          Это запись об <strong>опубликованном</strong> посте. Повторный постинг
          той же пары видео+аккаунт создаст <strong>ДУБЛЬ</strong> на платформе.
          Удаляйте только если уверены.
        </span>
      </div>

      <!-- Предупреждение: свежая in-flight (прерывание) -->
      <div
        v-else-if="isFreshInFlight"
        role="alert"
        class="alert alert-error alert-soft text-sm mb-3"
      >
        <Icon name="mingcute:alert-line" class="shrink-0" />
        <span>
          Задача сейчас <strong>выполняется</strong> (свежая сессия). Рекомендуется
          сначала <strong>отменить</strong> её (кнопка «Отменить»), затем удалить.
          Принудительное удаление прервёт работу и доступно только администратору.
        </span>
      </div>

      <!-- Force-чекбокс: только для свежей in-flight и только admin -->
      <fieldset
        v-if="isFreshInFlight && canAdmin"
        class="fieldset mb-2"
      >
        <label class="label cursor-pointer justify-start gap-2">
          <input
            v-model="forceChecked"
            type="checkbox"
            class="checkbox checkbox-error checkbox-sm"
            :disabled="isProcessing"
          />
          <span class="label-text text-sm">
            Принудительно удалить выполняющуюся задачу (force)
          </span>
        </label>
      </fieldset>

      <p
        v-if="isFreshInFlight && !canAdmin"
        class="text-xs text-base-content/60 mb-2"
      >
        Принудительное удаление недоступно — сначала отмените задачу.
      </p>

      <div
        v-if="localError"
        role="alert"
        class="alert alert-error alert-soft text-sm mt-2"
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
          :disabled="submitDisabled"
          @click="submit"
        >
          <span v-if="isProcessing" class="loading loading-spinner loading-xs" />
          <Icon v-else name="mingcute:delete-2-line" />
          {{ isPublished ? "Удалить опубликованную" : "Удалить" }}
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button @click="close">close</button>
    </form>
  </dialog>
</template>
