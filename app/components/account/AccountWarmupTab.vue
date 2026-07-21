<script setup lang="ts">
import type { PreviewResult } from "~~/app/composables/useWarmupActions"
import type { WarmupSessionDto } from "~~/shared/types/warmup"

const props = defineProps<{
  accountId: number
}>()

const emit = defineEmits<{
  updated: []
}>()

const accountIdRef = computed(() => props.accountId)

const {
  previewPlan,
  schedulePlan,
  cancelSession,
  deleteSession,
  isProcessing,
  error,
  conflictSessionId,
} = useWarmupActions()

const {
  sessions,
  pending: historyPending,
  refresh: refreshHistory,
} = useWarmupSessionsByAccount(accountIdRef, { limit: 10 })

const previewModalRef = ref<{
  open: (payload: PreviewResult) => void
  close: () => void
}>()

const lastPreview = ref<PreviewResult | null>(null)
const targetMinutes = ref<number>(7)

async function generatePreview() {
  const result = await previewPlan(props.accountId, {
    targetDurationMinutes: targetMinutes.value,
  })
  if (result) {
    lastPreview.value = result
    previewModalRef.value?.open(result)
  }
}

async function onScheduleFromPreview(opts: { replace: boolean }) {
  if (!lastPreview.value) return
  // scheduledAt не передаём — сервер подставит new Date() через resolveScheduledAt().
  // plan.meta.generatedAt — это момент генерации превью, а не реальное время запуска.
  const session = await schedulePlan(props.accountId, {
    targetDurationMinutes: targetMinutes.value,
    replace: opts.replace,
  })
  if (session) {
    previewModalRef.value?.close()
    await refreshHistory()
    emit("updated")
  }
  // если ошибка — модал останется открытым, conflict/error отобразятся
}

async function onCancelSession(session: WarmupSessionDto) {
  if (!confirm(`Отменить сессию #${session.id.slice(0, 8)}?`)) return
  const result = await cancelSession(session.id)
  if (result) {
    await refreshHistory()
    emit("updated")
  }
}

async function onDeleteSession(session: WarmupSessionDto) {
  if (!confirm(`Удалить сессию #${session.id.slice(0, 8)} безвозвратно?`)) return
  const ok = await deleteSession(session.id)
  if (ok) {
    await refreshHistory()
    emit("updated")
  }
}

function onViewSession(session: WarmupSessionDto) {
  // Показываем тот же preview-модал, но из существующей сессии (без replace)
  previewModalRef.value?.open({
    plan: session.plan,
    dayKey: session.dayKey,
    seed: session.seed,
    ageBucket: session.ageBucket,
  })
}
</script>

<template>
  <div class="space-y-4">
    <div class="alert alert-info text-sm">
      <Icon name="mingcute:bulb-line" />
      <div>
        <p class="font-medium">Прогрев аккаунта</p>
        <p class="text-xs">
          Детерминистический план активности (просмотры, скролл, лайки и т.п.) на основе возраста аккаунта и количества публикаций. Один план на день.
        </p>
      </div>
    </div>

    <!-- Generator block -->
    <div class="card bg-base-100 card-border">
      <div class="card-body p-4 gap-3">
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <h4 class="font-semibold flex items-center gap-2">
            <Icon name="mingcute:fire-line" class="text-primary" />
            Генерация плана
          </h4>
          <fieldset class="fieldset">
            <label class="floating-label">
              <input
                v-model.number="targetMinutes"
                type="number"
                min="1"
                max="120"
                class="input input-sm w-24"
              />
              <span>Минут</span>
            </label>
          </fieldset>
        </div>

        <div v-if="error" class="alert alert-error text-xs">
          <Icon name="mingcute:alert-line" />
          {{ error }}
        </div>

        <button
          class="btn btn-primary btn-sm"
          :disabled="isProcessing"
          @click="generatePreview"
        >
          <span v-if="isProcessing" class="loading loading-spinner loading-xs" />
          <Icon v-else name="mingcute:magic-2-line" />
          Сгенерировать план на сегодня
        </button>
      </div>
    </div>

    <!-- History -->
    <div>
      <div class="flex items-center justify-between mb-2">
        <h4 class="font-semibold flex items-center gap-2">
          <Icon name="mingcute:history-line" />
          История сессий
        </h4>
        <button
          class="btn btn-ghost btn-xs"
          :disabled="historyPending"
          @click="refreshHistory()"
        >
          <Icon name="mingcute:refresh-3-line" :class="{ 'animate-spin': historyPending }" />
        </button>
      </div>

      <div v-if="historyPending && sessions.length === 0" class="flex justify-center py-8">
        <span class="loading loading-spinner loading-md" />
      </div>

      <div
        v-else-if="sessions.length === 0"
        class="text-center text-base-content/50 py-8 text-sm"
      >
        Сессий ещё нет. Сгенерируйте план выше.
      </div>

      <div v-else class="space-y-2">
        <WarmupSessionCard
          v-for="session in sessions"
          :key="session.id"
          :session="session"
          @view="onViewSession"
          @cancel="onCancelSession"
          @delete="onDeleteSession"
        />
      </div>
    </div>

    <WarmupPlanPreviewModal
      ref="previewModalRef"
      :is-scheduling="isProcessing"
      :error-message="error"
      :conflict-session-id="conflictSessionId"
      @schedule="onScheduleFromPreview"
      @close="error = null"
    />
  </div>
</template>
