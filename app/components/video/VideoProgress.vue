<script setup lang="ts">
import { STEP_LABELS, STEP_ORDER, type VideoStepKey, type VideoGenerationStep } from '~~/shared/types/video'
import { onAssetMissing } from '~/utils/image-fallback'

const props = defineProps<{
  videoId: number
  /** Если true — не polling'ить, только загрузить данные один раз */
  static?: boolean
}>()

const emit = defineEmits<{
  completed: []
  retry: []
}>()

const { progress, isCompleted, isFailed, isCanceled, startPolling, poll } = useVideoProgress(
  computed(() => props.videoId),
)
const { cancelVideo, resumeVideo, rerunStep, skipStep, isCanceling, isResuming, isRerunning, isSkipping, error: actionError } = useVideoActions()

const SKIPPABLE_STEPS = ['voiceover_generation', 'music_generation'] as const

// Когда rerun запущен из static-режима, ожидаем completion
const awaitingRerun = ref(false)

onMounted(() => {
  if (props.static) {
    poll()
  } else {
    startPolling()
  }
})

watch(isCompleted, (val) => {
  if (val && (awaitingRerun.value || !props.static)) {
    awaitingRerun.value = false
    emit('completed')
  }
})

// Шаги из backend
const stepsFromBackend = computed(() => progress.value?.steps ?? [])

// Создать полный список шагов (даже если backend ещё не создал все)
const allSteps = computed(() => {
  return STEP_ORDER.map((key, index) => {
    const backendStep = stepsFromBackend.value.find((s: VideoGenerationStep) => s.stepKey === key)
    return {
      key,
      index,
      label: STEP_LABELS[key],
      backend: backendStep || null,
      status: backendStep?.status ?? 'pending',
    }
  })
})

const isActive = computed(() => {
  const s = progress.value?.status
  return s && !['completed', 'failed', 'canceled'].includes(s)
})

// Ассеты по типу
const imageAssets = computed(() => {
  return progress.value?.assets?.filter(a => a.type === 'image' && a.fileUrl) ?? []
})

const clipAssets = computed(() => {
  return progress.value?.assets?.filter(a => a.type === 'clip') ?? []
})

const musicAssets = computed(() => {
  return progress.value?.assets?.filter(a => a.type === 'music') ?? []
})

const prompts = computed(() => {
  return progress.value?.assets
    ?.filter(a => a.type === 'image' && a.prompt)
    .map(a => ({ order: a.order, prompt: a.prompt! })) ?? []
})

// Confirmation state для rerun
const confirmRerun = ref<string | null>(null)
// Confirmation state для skip
const confirmSkip = ref<string | null>(null)

function getStepStatusClass(status: string): string {
  switch (status) {
    case 'completed': return 'step-success'
    case 'running':
    case 'queued': return 'step-primary'
    case 'failed': return 'step-error'
    case 'canceled': return 'step-warning'
    case 'skipped': return 'step-neutral'
    default: return ''
  }
}

function getStepBadgeClass(status: string): string {
  switch (status) {
    case 'completed': return 'badge-success'
    case 'running': return 'badge-primary'
    case 'queued': return 'badge-info'
    case 'failed': return 'badge-error'
    case 'canceled': return 'badge-warning'
    case 'skipped': return 'badge-ghost'
    default: return 'badge-ghost'
  }
}

function getStepStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: 'Ожидает',
    queued: 'В очереди',
    running: 'Выполняется',
    completed: 'Готово',
    failed: 'Ошибка',
    canceled: 'Отменено',
    skipped: 'Пропущено',
  }
  return labels[status] || status
}

function getFalStatusLabel(status: string | null): string {
  if (!status) return ''
  const labels: Record<string, string> = {
    IN_QUEUE: 'В очереди fal.ai',
    IN_PROGRESS: 'Обработка на GPU',
    COMPLETED: 'Завершено',
    FAILED: 'Ошибка fal.ai',
  }
  return labels[status] || status
}

async function handleCancel() {
  await cancelVideo(props.videoId)
  await poll()
}

async function handleResume() {
  await resumeVideo(props.videoId)
  startPolling()
}

async function handleRerunStep(stepKey: string) {
  if (confirmRerun.value !== stepKey) {
    confirmRerun.value = stepKey
    return
  }
  confirmRerun.value = null
  awaitingRerun.value = true
  await rerunStep(props.videoId, stepKey)
  startPolling()
}

function cancelRerunConfirm() {
  confirmRerun.value = null
}

function isSkippable(stepKey: string): boolean {
  return (SKIPPABLE_STEPS as readonly string[]).includes(stepKey)
}

async function handleSkipStep(stepKey: string) {
  if (confirmSkip.value !== stepKey) {
    confirmSkip.value = stepKey
    return
  }
  confirmSkip.value = null
  await skipStep(props.videoId, stepKey)
  await poll()
}

function cancelSkipConfirm() {
  confirmSkip.value = null
}

// Collapse state
const openSteps = ref<Record<string, boolean>>({})

// Lightbox state
const showLightbox = ref(false)
const lightboxInitialIndex = ref(0)

function openLightbox(index: number) {
  lightboxInitialIndex.value = index
  showLightbox.value = true
}
</script>

<template>
  <div class="space-y-4">
    <!-- Top status bar -->
    <div v-if="progress" class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <span v-if="isActive" class="loading loading-spinner loading-sm text-primary" />
        <span class="text-sm font-medium">
          <template v-if="isActive">Генерация...</template>
          <template v-else-if="isCompleted">Генерация завершена</template>
          <template v-else-if="isFailed">Генерация провалилась</template>
          <template v-else-if="isCanceled">Генерация отменена</template>
        </span>
        <span v-if="progress.isLocked" class="badge badge-warning badge-xs">locked</span>
      </div>
      <div class="flex items-center gap-2">
        <!-- Cancel -->
        <button
          v-if="isActive"
          class="btn btn-sm btn-outline btn-warning"
          :disabled="isCanceling"
          @click="handleCancel"
        >
          <span v-if="isCanceling" class="loading loading-spinner loading-xs" />
          Отменить
        </button>
        <!-- Resume -->
        <button
          v-if="isFailed || isCanceled"
          class="btn btn-sm btn-primary"
          :disabled="isResuming"
          @click="handleResume"
        >
          <span v-if="isResuming" class="loading loading-spinner loading-xs" />
          Возобновить
        </button>
      </div>
    </div>

    <!-- Config summary -->
    <div v-if="progress" class="flex flex-wrap gap-2 text-xs">
      <span class="badge badge-outline badge-sm">{{ progress.format === 'portrait' ? '9:16' : '16:9' }}</span>
      <span v-if="progress.targetPlatform" class="badge badge-outline badge-sm">{{ progress.targetPlatform }}</span>
      <span class="badge badge-outline badge-sm">
        Субтитры: {{ progress.subtitlesEnabled ? 'вкл' : 'выкл' }}
      </span>
      <span class="badge badge-outline badge-sm">
        Музыка: {{ progress.musicEnabled ? (progress.musicMood || 'вкл') : 'выкл' }}
      </span>
      <span class="badge badge-outline badge-sm">Качество: {{ progress.renderQuality }}</span>
    </div>

    <!-- Step timeline -->
    <ul class="steps steps-horizontal w-full">
      <li
        v-for="step in allSteps"
        :key="step.key"
        class="step"
        :class="getStepStatusClass(step.status)"
      >
        <span class="flex items-center gap-1 text-xs">
          <span
            v-if="step.status === 'running' || step.status === 'queued'"
            class="loading loading-spinner loading-xs"
          />
          {{ step.label }}
        </span>
      </li>
    </ul>

    <!-- Error display -->
    <div v-if="actionError" class="alert alert-error text-sm">
      {{ actionError }}
    </div>

    <!-- Step details (collapse containers) -->
    <div class="space-y-2">
      <div
        v-for="step in allSteps"
        :key="`detail-${step.key}`"
        class="collapse collapse-arrow bg-base-100 border border-base-300 rounded-lg"
        :class="{
          'border-error': step.status === 'failed',
          'border-primary': step.status === 'running',
          'border-success': step.status === 'completed',
        }"
      >
        <input v-model="openSteps[step.key]" type="checkbox" />
        <div class="collapse-title text-sm font-medium flex items-center gap-2">
          <!-- Status icon -->
          <Icon v-if="step.status === 'completed'" name="mingcute:check-circle-fill" class="text-success" />
          <Icon v-else-if="step.status === 'failed'" name="mingcute:close-circle-fill" class="text-error" />
          <Icon v-else-if="step.status === 'canceled'" name="mingcute:forbid-circle-line" class="text-warning" />
          <Icon v-else-if="step.status === 'skipped'" name="mingcute:skip-forward-fill" class="text-base-content/30" />
          <Icon v-else-if="step.status === 'running' || step.status === 'queued'" name="mingcute:time-line" class="text-primary" />
          <Icon v-else name="mingcute:more-1-line" class="text-base-content/30" />

          {{ step.label }}

          <span class="badge badge-xs" :class="getStepBadgeClass(step.status)">
            {{ getStepStatusLabel(step.status) }}
          </span>

          <!-- fal queue status -->
          <span
            v-if="step.backend?.falQueueStatus && step.status === 'running'"
            class="badge badge-xs badge-info"
          >
            {{ getFalStatusLabel(step.backend.falQueueStatus) }}
          </span>

          <!-- Attempt count -->
          <span v-if="step.backend && step.backend.attemptCount > 1" class="badge badge-xs badge-warning">
            попытка {{ step.backend.attemptCount }}
          </span>
        </div>
        <div class="collapse-content">
          <div v-if="step.backend" class="space-y-3 pt-2">
            <!-- Timing -->
            <div v-if="step.backend.startedAt || step.backend.finishedAt" class="flex gap-4 text-xs text-base-content/60">
              <span v-if="step.backend.startedAt">Начало: {{ new Date(step.backend.startedAt).toLocaleTimeString() }}</span>
              <span v-if="step.backend.finishedAt">Конец: {{ new Date(step.backend.finishedAt).toLocaleTimeString() }}</span>
            </div>

            <!-- fal.ai details -->
            <div v-if="step.backend.falRequestId" class="text-xs bg-base-200 rounded p-2 space-y-1">
              <div class="flex gap-2">
                <span class="font-medium">fal.ai</span>
                <span class="font-mono text-base-content/60">{{ step.backend.falEndpoint }}</span>
              </div>
              <div class="text-base-content/60">
                Request: {{ step.backend.falRequestId.slice(0, 16) }}...
              </div>
              <div v-if="step.backend.falQueueStatus" class="flex gap-2">
                <span>Status: {{ getFalStatusLabel(step.backend.falQueueStatus) }}</span>
              </div>
            </div>

            <!-- Error -->
            <div v-if="step.backend.errorMessage" class="alert alert-error text-xs">
              <Icon name="mingcute:warning-line" />
              {{ step.backend.errorMessage }}
            </div>

            <!-- Logs -->
            <div v-if="step.backend.logs && (step.backend.logs as Array<{ts: string; msg: string}>).length > 0" class="space-y-1">
              <p class="text-xs font-medium text-base-content/60">Логи:</p>
              <div class="bg-base-200 rounded p-2 max-h-40 overflow-auto">
                <div
                  v-for="(log, li) in (step.backend.logs as Array<{ts: string; msg: string}>)"
                  :key="li"
                  class="text-xs font-mono flex gap-2"
                >
                  <span class="text-base-content/40 whitespace-nowrap">{{ new Date(log.ts).toLocaleTimeString() }}</span>
                  <span>{{ log.msg }}</span>
                </div>
              </div>
            </div>

            <!-- Step-specific results -->
            <!-- Prompts -->
            <template v-if="step.key === 'prompt_generation' && step.status === 'completed'">
              <div v-if="prompts.length > 0" class="space-y-2">
                <div
                  v-for="item in prompts"
                  :key="item.order"
                  class="bg-base-200 rounded-lg p-3"
                >
                  <p class="text-xs font-semibold text-base-content/50 mb-1">Сцена {{ item.order + 1 }}</p>
                  <p class="text-sm whitespace-pre-line">{{ item.prompt }}</p>
                </div>
              </div>
            </template>

            <!-- Images -->
            <template v-if="step.key === 'image_generation' && step.status === 'completed'">
              <div v-if="imageAssets.length > 0" class="grid grid-cols-3 gap-2">
                <figure
                  v-for="(asset, idx) in imageAssets"
                  :key="asset.id"
                  class="aspect-square rounded-lg overflow-hidden bg-base-200 cursor-pointer"
                  @click="openLightbox(idx)"
                >
                  <img
                    :src="`/api/files/${asset.fileUrl}`"
                    alt="Сгенерированное изображение"
                    class="w-full h-full object-cover"
                    @error="onAssetMissing"
                  />
                </figure>
              </div>
            </template>

            <!-- Clips -->
            <template v-if="step.key === 'clip_generation' && step.status === 'completed'">
              <div class="flex flex-wrap gap-2">
                <span
                  v-for="asset in clipAssets"
                  :key="asset.id"
                  class="badge badge-outline gap-1"
                >
                  <Icon name="mingcute:film-line" class="text-xs" />
                  Клип {{ asset.order + 1 }}
                </span>
              </div>
            </template>

            <!-- Music -->
            <template v-if="step.key === 'music_generation'">
              <div v-if="musicAssets.length > 0" class="flex flex-wrap gap-2">
                <span
                  v-for="asset in musicAssets"
                  :key="asset.id"
                  class="badge badge-outline gap-1"
                >
                  <Icon name="mingcute:music-2-line" class="text-xs" />
                  Музыка
                </span>
              </div>
              <p v-else-if="step.status === 'skipped'" class="text-xs text-base-content/50">Музыка отключена в настройках</p>
            </template>

            <!-- Assembly -->
            <template v-if="step.key === 'assembly' && step.status === 'completed'">
              <p class="text-sm text-success">Видео собрано успешно</p>
            </template>
          </div>

          <!-- No backend data yet -->
          <p v-else class="text-sm text-base-content/40 pt-2">Ожидает выполнения</p>

          <!-- Rerun + Skip buttons — inside collapse-content to avoid checkbox toggle -->
          <div v-if="(isFailed || isCanceled || isCompleted) && step.status !== 'pending'" class="pt-3 border-t border-base-300 mt-3 flex items-center gap-2 flex-wrap">
            <template v-if="confirmRerun !== step.key && confirmSkip !== step.key">
              <button
                class="btn btn-xs btn-outline btn-warning"
                :disabled="isRerunning || isSkipping"
                @click="handleRerunStep(step.key)"
              >
                <Icon name="mingcute:refresh-2-line" class="text-xs" />
                Перезапустить этот шаг
              </button>
              <button
                v-if="isSkippable(step.key) && step.status !== 'completed' && step.status !== 'skipped'"
                class="btn btn-xs btn-outline btn-neutral"
                :disabled="isRerunning || isSkipping"
                @click="handleSkipStep(step.key)"
              >
                <Icon name="mingcute:skip-forward-line" class="text-xs" />
                Пропустить шаг
              </button>
            </template>
            <div v-else-if="confirmRerun === step.key" class="flex items-center gap-2 flex-wrap">
              <span class="text-xs text-warning">Перезапустит этот и все следующие шаги. Продолжить?</span>
              <button class="btn btn-xs btn-warning" :disabled="isRerunning" @click="handleRerunStep(step.key)">
                <span v-if="isRerunning" class="loading loading-spinner loading-xs" />
                Да, перезапустить
              </button>
              <button class="btn btn-xs btn-ghost" @click="cancelRerunConfirm">Отмена</button>
            </div>
            <div v-else class="flex items-center gap-2 flex-wrap">
              <span class="text-xs text-base-content/70">Шаг будет помечен как пропущенный, флаг отключится. Подтвердить?</span>
              <button class="btn btn-xs btn-neutral" :disabled="isSkipping" @click="handleSkipStep(step.key)">
                <span v-if="isSkipping" class="loading loading-spinner loading-xs" />
                Да, пропустить
              </button>
              <button class="btn btn-xs btn-ghost" @click="cancelSkipConfirm">Отмена</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Image lightbox -->
    <VideoImageLightbox
      v-if="showLightbox && imageAssets.length > 0"
      :images="imageAssets"
      :initial-index="lightboxInitialIndex"
      @close="showLightbox = false"
    />
  </div>
</template>
