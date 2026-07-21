<script setup lang="ts">
import type { PreviewResult } from "~~/app/composables/useWarmupActions"
import type { WarmupPlan } from "~~/shared/types/warmup"

const emit = defineEmits<{
  schedule: [opts: { replace: boolean }]
  close: []
}>()

defineProps<{
  /** true когда выполняется schedule. */
  isScheduling?: boolean
  /** Сообщение об ошибке (например 409 conflict). */
  errorMessage?: string | null
  /** ID существующей сессии при 409, чтобы предложить replace. */
  conflictSessionId?: string | null
}>()

const dialogRef = ref<HTMLDialogElement>()
const result = ref<PreviewResult | null>(null)

function open(payload: PreviewResult) {
  result.value = payload
  dialogRef.value?.showModal()
}

function close() {
  dialogRef.value?.close()
  result.value = null
  emit("close")
}

const plan = computed<WarmupPlan | null>(() => result.value?.plan ?? null)

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec} сек`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return s > 0 ? `${m} мин ${s} сек` : `${m} мин`
}

defineExpose({ open, close })
</script>

<template>
  <dialog ref="dialogRef" class="modal">
    <div class="modal-box max-w-3xl max-h-[90vh] overflow-y-auto">
      <h3 class="font-bold text-lg flex items-center gap-2">
        <Icon name="mingcute:fire-line" class="text-primary" />
        Превью плана прогрева
      </h3>

      <div v-if="!plan || !result" class="py-8 text-center text-base-content/50">
        План не сгенерирован.
      </div>

      <template v-else>
        <!-- Meta block -->
        <div class="stats stats-horizontal w-full mt-3 bg-base-200">
          <div class="stat py-2 px-3">
            <div class="stat-title text-xs">Бакет</div>
            <div class="stat-value text-base">{{ result.ageBucket }}</div>
          </div>
          <div class="stat py-2 px-3">
            <div class="stat-title text-xs">Действий</div>
            <div class="stat-value text-base">{{ plan.meta.actionCount }}</div>
          </div>
          <div class="stat py-2 px-3">
            <div class="stat-title text-xs">Длительность</div>
            <div class="stat-value text-base">
              {{ formatDuration(plan.meta.totalDurationSec) }}
            </div>
          </div>
          <div class="stat py-2 px-3">
            <div class="stat-title text-xs">Цель</div>
            <div class="stat-value text-base">
              {{ formatDuration(plan.meta.targetDurationSec) }}
            </div>
          </div>
        </div>

        <div class="text-xs text-base-content/50 mt-2 flex flex-wrap gap-x-4">
          <span>Платформа: <strong>{{ plan.meta.platform }}</strong></span>
          <span>Язык: <strong>{{ plan.meta.commentLanguage }}</strong></span>
          <span>Seed: <code>{{ plan.meta.seed }}</code></span>
          <span>Pool: {{ plan.meta.keywordPoolSize }} kw</span>
        </div>

        <!-- Actions list -->
        <div class="divider my-3 text-xs">Сценарий действий</div>
        <WarmupActionList :actions="plan.actions" :limit="50" />

        <!-- Error / conflict -->
        <div v-if="errorMessage" class="alert alert-error mt-4">
          <Icon name="mingcute:alert-line" />
          <div class="text-sm">
            {{ errorMessage }}
            <p v-if="conflictSessionId" class="text-xs mt-1">
              Существующая сессия: <code>{{ conflictSessionId.slice(0, 8) }}</code>.
              Нажмите «Заменить», чтобы пересоздать.
            </p>
          </div>
        </div>
      </template>

      <div class="modal-action">
        <button class="btn btn-sm" :disabled="isScheduling" @click="close">
          Закрыть
        </button>
        <button
          v-if="conflictSessionId"
          class="btn btn-sm btn-warning"
          :disabled="isScheduling || !plan"
          @click="emit('schedule', { replace: true })"
        >
          <span v-if="isScheduling" class="loading loading-spinner loading-xs" />
          <Icon v-else name="mingcute:refresh-3-line" />
          Заменить
        </button>
        <button
          v-else
          class="btn btn-sm btn-primary"
          :disabled="isScheduling || !plan"
          @click="emit('schedule', { replace: false })"
        >
          <span v-if="isScheduling" class="loading loading-spinner loading-xs" />
          <Icon v-else name="mingcute:calendar-add-line" />
          Запланировать
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button @click="close">close</button>
    </form>
  </dialog>
</template>
