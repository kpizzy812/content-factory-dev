<script setup lang="ts">
import type { BulkDeleteResponse } from "~~/shared/types/posting-job"

const props = defineProps<{
  /** Выбранные id карточек. */
  selectedIds: string[]
}>()

const emit = defineEmits<{
  /** Очистить выбор. */
  "clear-selection": []
  /** Удаление завершилось — родитель перезагружает список. */
  done: [result: BulkDeleteResponse]
}>()

const { can } = usePermissions()
const canDelete = computed(() => can("canDelete"))

const { bulkDelete, isProcessing, error } = usePostingJobActions()

const confirmModalRef = ref<HTMLDialogElement>()
// Режим текущего подтверждения: удаление выбранных или очистка завалов.
const mode = ref<"selected" | "cleanup">("selected")
const localError = ref<string | null>(null)
const resultSummary = ref<BulkDeleteResponse | null>(null)

const selectedCount = computed(() => props.selectedIds.length)

const confirmTitle = computed(() =>
  mode.value === "selected"
    ? `Удалить выбранные (${selectedCount.value})?`
    : "Очистить завалы (failed + cancelled)?",
)

const confirmText = computed(() =>
  mode.value === "selected"
    ? `Будет удалено до ${selectedCount.value} задач. Опубликованные и выполняющиеся `
      + "задачи будут пропущены (их нужно удалять по одной). Действие необратимо."
    : "Будут удалены ВСЕ задачи в статусах «Ошибка» и «Отменён» (до 500 за раз). "
      + "Опубликованные не затрагиваются. Действие необратимо.",
)

function askSelected() {
  if (selectedCount.value === 0) return
  mode.value = "selected"
  localError.value = null
  resultSummary.value = null
  confirmModalRef.value?.showModal()
}

function askCleanup() {
  mode.value = "cleanup"
  localError.value = null
  resultSummary.value = null
  confirmModalRef.value?.showModal()
}

function closeConfirm() {
  confirmModalRef.value?.close()
}

async function confirmDelete() {
  localError.value = null
  let result: BulkDeleteResponse | null
  if (mode.value === "selected") {
    result = await bulkDelete({ ids: props.selectedIds })
  } else {
    result = await bulkDelete({ filter: { status: ["failed", "cancelled"] } })
  }

  if (result) {
    resultSummary.value = result
    if (result.skipped.length === 0) {
      closeConfirm()
      emit("clear-selection")
      emit("done", result)
    }
    // Если есть skipped — оставляем модалку открытой с отчётом, родителю всё равно
    // сообщаем done (часть удалена) после закрытия пользователем.
  } else {
    localError.value = error.value ?? "Не удалось выполнить массовое удаление"
  }
}

function acknowledgeAndClose() {
  const r = resultSummary.value
  closeConfirm()
  emit("clear-selection")
  if (r) emit("done", r)
}
</script>

<template>
  <div
    v-if="canDelete"
    class="card bg-base-200 shadow-sm sticky top-2 z-10"
  >
    <div class="card-body p-3 flex-row items-center justify-between flex-wrap gap-2">
      <div class="flex items-center gap-2 text-sm">
        <Icon name="mingcute:checkbox-line" class="text-base" />
        <span v-if="selectedCount > 0">
          Выбрано: <strong>{{ selectedCount }}</strong>
        </span>
        <span v-else class="text-base-content/60">
          Отметьте задачи для массового удаления
        </span>
      </div>

      <div class="flex items-center gap-2 flex-wrap">
        <button
          v-if="selectedCount > 0"
          class="btn btn-xs btn-ghost gap-1"
          @click="emit('clear-selection')"
        >
          <Icon name="mingcute:close-line" />
          Снять выбор
        </button>
        <button
          class="btn btn-xs btn-error gap-1"
          :disabled="selectedCount === 0 || isProcessing"
          @click="askSelected"
        >
          <Icon name="mingcute:delete-2-line" />
          Удалить выбранные ({{ selectedCount }})
        </button>
        <button
          class="btn btn-xs btn-warning btn-soft gap-1"
          :disabled="isProcessing"
          @click="askCleanup"
        >
          <Icon name="mingcute:broom-line" />
          Очистить завалы
        </button>
      </div>
    </div>
  </div>

  <!--
    Confirm-модалка вынесена на верхний уровень template (вне .card): DaisyUI modal =
    position:fixed, но будущий transform/filter на родительской .card создал бы containing
    block и обрезал бы backdrop. Top-level размещение защищает от этого.
  -->
  <dialog v-if="canDelete" ref="confirmModalRef" class="modal">
      <div class="modal-box max-w-lg">
        <h3 class="text-lg font-bold mb-2 flex items-center gap-2">
          <Icon name="mingcute:delete-2-line" class="text-error" />
          {{ confirmTitle }}
        </h3>

        <p class="text-sm text-base-content/70 mb-3">{{ confirmText }}</p>

        <!-- Отчёт об удалённых -->
        <div
          v-if="resultSummary"
          class="alert alert-info alert-soft text-sm mb-3"
        >
          <Icon name="mingcute:check-circle-line" />
          <span>Удалено: <strong>{{ resultSummary.deleted }}</strong></span>
        </div>

        <!-- Пропущенные — отдельный warning-блок (гарантированный контраст во всех темах) -->
        <div
          v-if="resultSummary && resultSummary.skipped.length > 0"
          class="alert alert-warning alert-soft text-sm mb-3 flex-col items-start gap-1"
        >
          <div class="flex items-center gap-2">
            <Icon name="mingcute:alert-line" />
            <span>Пропущено: <strong>{{ resultSummary.skipped.length }}</strong></span>
          </div>
          <ul class="mt-1 text-xs space-y-0.5 max-h-32 overflow-y-auto w-full">
            <li
              v-for="s in resultSummary.skipped"
              :key="s.id"
              class="text-base-content/70"
            >
              <code>{{ s.id.slice(0, 8) }}</code> ({{ s.status }}): {{ s.reason }}
            </li>
          </ul>
        </div>

        <div
          v-if="localError"
          role="alert"
          class="alert alert-error alert-soft text-sm mb-2"
        >
          <Icon name="mingcute:warning-line" />
          <span>{{ localError }}</span>
        </div>

        <div class="modal-action">
          <template v-if="resultSummary && resultSummary.skipped.length > 0">
            <button class="btn btn-sm btn-primary" @click="acknowledgeAndClose">
              Понятно
            </button>
          </template>
          <template v-else>
            <button class="btn btn-sm" :disabled="isProcessing" @click="closeConfirm">
              Назад
            </button>
            <button
              class="btn btn-sm btn-error"
              :disabled="isProcessing"
              @click="confirmDelete"
            >
              <span v-if="isProcessing" class="loading loading-spinner loading-xs" />
              <Icon v-else name="mingcute:delete-2-line" />
              Удалить
            </button>
          </template>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button @click="closeConfirm">close</button>
      </form>
    </dialog>
</template>
