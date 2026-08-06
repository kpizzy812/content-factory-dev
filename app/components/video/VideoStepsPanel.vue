<script setup lang="ts">
import { formatMoney } from '~~/shared/utils/money'
import type { VideoGenerationStep, VideoStepKey } from '~~/shared/types/video'
import { STEP_ORDER } from '~~/shared/types/video'
import { VIDEO_STEP_LABELS, VIDEO_STEP_IS_CHEAP, videoStepStatus } from './VideoStatusMap'

/**
 * Шаги генерации ролика. Источник: design-preview/catalog/03-detail-video.dc.html
 *
 * Строки рисует общий DetailStepRow; здесь живёт только доменная часть:
 * какие шаги бывают, какие из них бесплатные, какие можно пропустить и что
 * происходит при повторе.
 *
 * Повтор платного шага спрашивает подтверждение с суммой, бесплатный —
 * выполняется сразу: цена решения должна быть видна до нажатия, а не после.
 */
const props = defineProps<{
  videoId: number
  steps: VideoGenerationStep[]
  /** Пока генерация идёт, повторять и пропускать нечего. */
  active?: boolean
}>()

const emit = defineEmits<{ changed: [] }>()

/** Пропуск отключает соответствующий флаг ролика, поэтому доступен не везде. */
const SKIPPABLE_STEPS: readonly string[] = ['voiceover_generation', 'music_generation']

const { rerunStep, skipStep, isRerunning, isSkipping } = useVideoActions()

const rows = computed(() => STEP_ORDER.map((key, i) => {
  const backend = props.steps.find(s => s.stepKey === key) ?? null
  const durationMs = backend?.startedAt && backend?.finishedAt
    ? new Date(backend.finishedAt).getTime() - new Date(backend.startedAt).getTime()
    : null

  return {
    key,
    index: i + 1,
    label: VIDEO_STEP_LABELS[key] ?? key,
    backend,
    status: videoStepStatus(backend?.status),
    durationMs,
    cheap: VIDEO_STEP_IS_CHEAP[key] === true,
    // Повторить можно только то, что уже запускалось: у нетронутого шага
    // «повтор» означал бы обычный запуск, и кнопка врала бы про суть действия.
    canRetry: !props.active && backend != null && backend.status !== 'pending',
    canSkip: !props.active && SKIPPABLE_STEPS.includes(key)
      && backend != null && !['completed', 'skipped'].includes(backend.status),
  }
}))

const doneCount = computed(() => rows.value.filter(r => r.status === 'done').length)

/** Сумма пройденного, а не «сейчас минус старт»: при повторах они расходятся. */
const totalDuration = computed(() => {
  const ms = rows.value.reduce((sum, r) => sum + (r.durationMs ?? 0), 0)
  if (!ms) return null
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s} с` : `${Math.floor(s / 60)} м ${s % 60} с`
})

const confirmKey = ref<VideoStepKey | null>(null)
const logsKey = ref<VideoStepKey | null>(null)

const confirmRow = computed(() => rows.value.find(r => r.key === confirmKey.value) ?? null)
const logsRow = computed(() => rows.value.find(r => r.key === logsKey.value) ?? null)

const logLines = computed(() => {
  const logs = logsRow.value?.backend?.logs
  if (!Array.isArray(logs)) return []
  return logs.map(line => ({
    time: new Date(line.ts).toLocaleTimeString('ru-RU'),
    message: line.msg,
  }))
})

async function onRetry(key: VideoStepKey, cheap: boolean) {
  // Бесплатное выполняется сразу, за платное сначала спрашиваем.
  if (!cheap) {
    confirmKey.value = key
    return
  }
  await runRetry(key)
}

async function runRetry(key: VideoStepKey) {
  confirmKey.value = null
  await rerunStep(props.videoId, key)
  emit('changed')
}

async function onSkip(key: VideoStepKey) {
  await skipStep(props.videoId, key)
  emit('changed')
}

function costHint(estimated: number | null | undefined) {
  const money = formatMoney(estimated)
  return money ? `~${money}` : undefined
}
</script>

<template>
  <section class="overflow-hidden rounded-lg border border-border bg-panel">
    <header class="flex items-center gap-2.5 border-b border-border px-3 py-2.5">
      <h2 class="text-base font-semibold">Шаги генерации</h2>
      <span
        class="tnum inline-flex h-5 items-center rounded-sm border px-1.5 font-mono text-micro"
        :class="doneCount === rows.length
          ? 'border-success-border bg-success-bg text-success'
          : 'border-border bg-card text-muted'"
      >
        {{ doneCount }} из {{ rows.length }}
      </span>
      <span class="flex-1" />
      <span v-if="totalDuration" class="tnum font-mono text-sm text-muted">{{ totalDuration }}</span>
    </header>

    <div class="flex flex-col gap-1.5 p-2">
      <DetailStepRow
        v-for="row in rows"
        :key="row.key"
        :index="row.index"
        :label="row.label"
        :status="row.status"
        :duration-ms="row.durationMs"
        :estimated-cost="row.backend?.estimatedCost"
        :actual-cost="row.backend?.actualCost"
        :attempt="row.backend?.attemptCount"
        :max-attempts="3"
        :model="row.backend?.falEndpoint"
        :error-message="row.backend?.errorMessage"
        :cheap="row.cheap"
        :can-retry="row.canRetry"
        :can-skip="row.canSkip"
        :retry-cost="costHint(row.backend?.estimatedCost)"
        @retry="onRetry(row.key, row.cheap)"
        @skip="onSkip(row.key)"
        @logs="logsKey = row.key"
      />
    </div>

    <footer class="border-t border-divider bg-card px-3 py-2 text-micro leading-relaxed text-subtle">
      Бесплатное и локальное — кнопкой в строке. Оплачиваемое — через меню шага с суммой.
      Повтор шага перезапускает его и все следующие.
    </footer>

    <UiModal
      :open="confirmKey !== null"
      title="Повторить платный шаг?"
      size="sm"
      @close="confirmKey = null"
    >
      <p class="text-sm text-muted">
        Шаг «{{ confirmRow?.label }}» обращается к платной модели. Повтор перезапустит его
        и все следующие шаги.
      </p>
      <p v-if="confirmRow?.backend?.estimatedCost != null" class="tnum mt-2 font-mono text-base">
        оценка ~{{ formatMoney(confirmRow.backend.estimatedCost) }}
      </p>
      <template #footer>
        <UiButton variant="ghost" @click="confirmKey = null">Отмена</UiButton>
        <UiButton
          variant="primary"
          :loading="isRerunning"
          @click="confirmKey && runRetry(confirmKey)"
        >
          Повторить
        </UiButton>
      </template>
    </UiModal>

    <UiModal
      :open="logsKey !== null"
      :title="`Логи · ${logsRow?.label ?? ''}`"
      size="lg"
      @close="logsKey = null"
    >
      <div v-if="logLines.length" class="flex flex-col gap-0.5">
        <UiLogRow
          v-for="(line, i) in logLines"
          :key="i"
          :time="line.time"
          :message="line.message"
        />
      </div>
      <UiEmptyState
        v-else
        icon="mingcute:file-line"
        title="Логов нет"
        description="Шаг не оставил записей — либо ещё не запускался, либо отработал без сообщений."
      />
    </UiModal>

    <span v-if="isSkipping" class="sr-only">Пропуск шага…</span>
  </section>
</template>
