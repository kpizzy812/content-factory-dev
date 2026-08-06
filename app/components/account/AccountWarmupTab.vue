<script setup lang="ts">
import type { PreviewResult } from '~~/app/composables/useWarmupActions'
import type { WarmupSessionDto } from '~~/shared/types/warmup'

/**
 * Прогрев аккаунта: генерация плана на день и история сессий.
 * Отмена и удаление сессии спрашивали `confirm()` — заменено на модалку.
 */
const props = defineProps<{ accountId: number }>()

const emit = defineEmits<{ updated: [] }>()

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

const { sessions, pending: historyPending, refresh: refreshHistory }
  = useWarmupSessionsByAccount(accountIdRef, { limit: 10 })

const previewModalRef = ref<{ open: (payload: PreviewResult) => void, close: () => void }>()
const cancelRef = ref<{ open: () => void, close: () => void, setBusy: (v: boolean) => void }>()
const deleteRef = ref<{ open: () => void, close: () => void, setBusy: (v: boolean) => void }>()

const lastPreview = ref<PreviewResult | null>(null)
const targetMinutes = ref<number>(7)
const pendingSession = ref<WarmupSessionDto | null>(null)

async function generatePreview() {
  const result = await previewPlan(props.accountId, { targetDurationMinutes: targetMinutes.value })
  if (result) {
    lastPreview.value = result
    previewModalRef.value?.open(result)
  }
}

async function onScheduleFromPreview(opts: { replace: boolean }) {
  if (!lastPreview.value) return
  // scheduledAt не передаём: сервер подставит текущее время. `generatedAt` из
  // превью — момент генерации, а не момент запуска.
  const session = await schedulePlan(props.accountId, {
    targetDurationMinutes: targetMinutes.value,
    replace: opts.replace,
  })
  if (session) {
    previewModalRef.value?.close()
    await refreshHistory()
    emit('updated')
  }
}

function askCancel(session: WarmupSessionDto) {
  pendingSession.value = session
  cancelRef.value?.open()
}

async function confirmCancel() {
  const session = pendingSession.value
  if (!session) return
  cancelRef.value?.setBusy(true)
  const result = await cancelSession(session.id)
  cancelRef.value?.setBusy(false)
  cancelRef.value?.close()
  pendingSession.value = null
  if (result) {
    await refreshHistory()
    emit('updated')
  }
}

function askDelete(session: WarmupSessionDto) {
  pendingSession.value = session
  deleteRef.value?.open()
}

async function confirmDelete() {
  const session = pendingSession.value
  if (!session) return
  deleteRef.value?.setBusy(true)
  const ok = await deleteSession(session.id)
  deleteRef.value?.setBusy(false)
  deleteRef.value?.close()
  pendingSession.value = null
  if (ok) {
    await refreshHistory()
    emit('updated')
  }
}

function onViewSession(session: WarmupSessionDto) {
  previewModalRef.value?.open({
    plan: session.plan,
    dayKey: session.dayKey,
    seed: session.seed,
    ageBucket: session.ageBucket,
  })
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <p class="flex gap-2 rounded-md border border-info-border bg-info-bg p-2.5 text-sm">
      <Icon name="mingcute:bulb-line" class="mt-0.5 shrink-0 text-info" />
      <span>
        План активности собирается из возраста аккаунта и числа публикаций и не
        зависит от случая: один и тот же день даёт один и тот же план. На день — один план.
      </span>
    </p>

    <section class="flex flex-col gap-3 rounded-md border border-border bg-card p-3">
      <div class="flex flex-wrap items-end gap-3">
        <h4 class="flex flex-1 items-center gap-2 font-medium">
          <Icon name="mingcute:fire-line" class="text-accent-text" />
          План на сегодня
        </h4>
        <UiField label="Длительность, минут">
          <UiInput v-model="targetMinutes" type="number" class="w-24" />
        </UiField>
      </div>

      <p v-if="error" class="flex items-center gap-2 rounded-md border border-danger-border bg-danger-bg p-2 text-sm text-danger">
        <Icon name="mingcute:alert-line" class="shrink-0" />
        {{ error }}
      </p>

      <UiButton variant="primary" class="w-fit" :loading="isProcessing" @click="generatePreview">
        <Icon v-if="!isProcessing" name="mingcute:magic-2-line" />
        Сгенерировать план
      </UiButton>
    </section>

    <section class="flex flex-col gap-2">
      <div class="flex items-center gap-2">
        <h4 class="flex flex-1 items-center gap-2 font-medium">
          <Icon name="mingcute:history-line" />
          История сессий
        </h4>
        <UiButton icon-only variant="ghost" aria-label="Обновить" :loading="historyPending" @click="refreshHistory()">
          <Icon name="mingcute:refresh-3-line" />
        </UiButton>
      </div>

      <UiSkeleton v-if="historyPending && !sessions.length" variant="details" :count="3" />

      <UiEmptyState
        v-else-if="!sessions.length"
        variant="first"
        title="Сессий прогрева ещё не было"
        description="Сгенерируйте план — он появится в истории и уйдёт в работу."
      />

      <div v-else class="flex flex-col gap-2">
        <WarmupSessionCard
          v-for="session in sessions"
          :key="session.id"
          :session="session"
          @view="onViewSession"
          @cancel="askCancel"
          @delete="askDelete"
        />
      </div>
    </section>

    <WarmupPlanPreviewModal
      ref="previewModalRef"
      :is-scheduling="isProcessing"
      :error-message="error"
      :conflict-session-id="conflictSessionId"
      @schedule="onScheduleFromPreview"
      @close="error = null"
    />

    <SharedConfirmModal
      ref="cancelRef"
      title="Отменить сессию прогрева?"
      :message="pendingSession ? `Сессия ${pendingSession.id.slice(0, 8)} перестанет выполняться.` : ''"
      confirm-label="Отменить сессию"
      variant="warning"
      cancel-label="Оставить"
      @confirm="confirmCancel"
    />

    <SharedConfirmModal
      ref="deleteRef"
      title="Удалить сессию прогрева?"
      :message="pendingSession ? `Сессия ${pendingSession.id.slice(0, 8)} будет удалена без возможности вернуть.` : ''"
      confirm-label="Удалить"
      @confirm="confirmDelete"
    />
  </div>
</template>
