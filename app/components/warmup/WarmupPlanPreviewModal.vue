<script setup lang="ts">
import type { PreviewResult } from '~~/app/composables/useWarmupActions'
import type { WarmupPlan } from '~~/shared/types/warmup'

const emit = defineEmits<{
  schedule: [opts: { replace: boolean }]
  close: []
}>()

defineProps<{
  isScheduling?: boolean
  errorMessage?: string | null
  /** Идентификатор уже существующей сессии на этот день — тогда предлагаем замену. */
  conflictSessionId?: string | null
}>()

const isOpen = ref(false)
const result = ref<PreviewResult | null>(null)

function open(payload: PreviewResult) {
  result.value = payload
  isOpen.value = true
}

function close() {
  isOpen.value = false
  result.value = null
  emit('close')
}

const plan = computed<WarmupPlan | null>(() => result.value?.plan ?? null)

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec} с`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return s > 0 ? `${m} мин ${s} с` : `${m} мин`
}

const AGE_BUCKETS: Record<string, string> = {
  new: 'Новый',
  warming: 'На прогреве',
  mature: 'Зрелый',
}

defineExpose({ open, close })
</script>

<template>
  <UiModal :open="isOpen" title="План прогрева" size="lg" :persistent="isScheduling" @close="close">
    <p v-if="!plan || !result" class="py-8 text-center text-subtle">План не сгенерирован.</p>

    <div v-else class="flex flex-col gap-4">
      <div class="grid grid-cols-2 overflow-hidden rounded-lg border border-border bg-panel sm:grid-cols-4">
        <div class="flex flex-col gap-1 border-r border-divider p-2.5 px-3.5">
          <span class="text-micro tracking-[.06em] text-subtle uppercase">Возраст</span>
          <span class="text-lg font-semibold">{{ AGE_BUCKETS[result.ageBucket] ?? result.ageBucket }}</span>
        </div>
        <div class="flex flex-col gap-1 border-divider p-2.5 px-3.5 sm:border-r">
          <span class="text-micro tracking-[.06em] text-subtle uppercase">Действий</span>
          <span class="tnum text-lg font-semibold">{{ plan.meta.actionCount }}</span>
        </div>
        <div class="flex flex-col gap-1 border-t border-r border-divider p-2.5 px-3.5 sm:border-t-0">
          <span class="text-micro tracking-[.06em] text-subtle uppercase">Длительность</span>
          <span class="tnum text-lg font-semibold">{{ formatDuration(plan.meta.totalDurationSec) }}</span>
        </div>
        <div class="flex flex-col gap-1 border-t border-divider p-2.5 px-3.5 sm:border-t-0">
          <span class="text-micro tracking-[.06em] text-subtle uppercase">Цель</span>
          <span class="tnum text-lg font-semibold">{{ formatDuration(plan.meta.targetDurationSec) }}</span>
        </div>
      </div>

      <UiKeyValue
        :items="[
          { label: 'Платформа', value: plan.meta.platform, mono: false },
          { label: 'Язык комментариев', value: plan.meta.commentLanguage, mono: false },
          { label: 'Seed', value: plan.meta.seed },
          { label: 'Ключевых слов', value: plan.meta.keywordPoolSize },
        ]"
        label-width="170px"
      />

      <section>
        <h3 class="mb-2 text-micro tracking-[.06em] text-subtle uppercase">Сценарий действий</h3>
        <WarmupActionList :actions="plan.actions" :limit="50" />
      </section>

      <div
        v-if="errorMessage"
        class="flex gap-2 rounded-md border border-danger-border bg-danger-bg p-2.5 text-sm"
      >
        <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0 text-danger" />
        <div>
          {{ errorMessage }}
          <p v-if="conflictSessionId" class="mt-1 text-micro text-muted">
            Уже есть сессия <code class="font-mono">{{ conflictSessionId.slice(0, 8) }}</code> —
            «Заменить» пересоздаст её.
          </p>
        </div>
      </div>
    </div>

    <template #footer>
      <UiButton variant="ghost" :disabled="isScheduling" @click="close">Закрыть</UiButton>
      <UiButton
        v-if="conflictSessionId"
        :loading="isScheduling"
        :disabled="!plan"
        @click="emit('schedule', { replace: true })"
      >
        <Icon v-if="!isScheduling" name="mingcute:refresh-3-line" />
        Заменить
      </UiButton>
      <UiButton
        v-else
        variant="primary"
        :loading="isScheduling"
        :disabled="!plan"
        @click="emit('schedule', { replace: false })"
      >
        <Icon v-if="!isScheduling" name="mingcute:calendar-add-line" />
        Запланировать
      </UiButton>
    </template>
  </UiModal>
</template>
