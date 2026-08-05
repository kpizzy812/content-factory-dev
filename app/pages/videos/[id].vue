<script setup lang="ts">
import type { VideoGenerationStep } from '~~/shared/types/video'
import { videoStatus, VIDEO_STEP_LABELS } from '~/components/video/VideoStatusMap'

definePageMeta({ layout: 'default', middleware: 'module-access', moduleSlug: 'video-generator' })

const route = useRoute()
const videoId = computed(() => route.params.id as string)

const { data, pending, error, refresh } = useVideoDetail(videoId)
const video = computed(() => data.value?.data ?? null)

const { can } = usePermissions()
const toast = useToast()

const title = computed(() => video.value?.scenario?.variants?.[0]?.title ?? 'Видео')

useHead({ title: computed(() => `${title.value} — видео`) })

const ACTIVE_STATUSES = [
  'pending', 'configuring', 'generating_prompts', 'generating_images',
  'generating_clips', 'generating_voiceover', 'generating_music', 'assembling',
]

const isActive = computed(() => !!video.value && ACTIVE_STATUSES.includes(video.value.status))
const isCompleted = computed(() => video.value?.status === 'completed')
const isFailed = computed(() => video.value?.status === 'failed')

// ─── Живое обновление ────────────────────────────────────────────────────────
// Прогресс опрашивается отдельным endpoint'ом: он отдаёт шаги и ассеты без
// сценария и настроек, поэтому опрос раз в 4 секунды не тянет всю карточку.
const { progress, startPolling, poll } = useVideoProgress(computed(() => Number(videoId.value)))

const steps = computed<VideoGenerationStep[]>(() => progress.value?.steps ?? video.value?.steps ?? [])
const assets = computed(() => progress.value?.assets ?? video.value?.assets ?? [])

onMounted(() => {
  if (isActive.value) startPolling()
  else poll()
})

// Генерация закончилась — карточку надо перечитать целиком: файл, стоимость и
// длительность лежат в ней, а не в прогрессе.
watch(() => progress.value?.status, async (next, prev) => {
  if (!next || !prev || next === prev) return
  await refresh()
  if (!ACTIVE_STATUSES.includes(next)) storageProbed.value = false
})

async function afterStepAction() {
  await refresh()
  startPolling()
}

// ─── Навигация по соседям ────────────────────────────────────────────────────
// Соседи берутся из того же списка, который оператор смотрел до захода внутрь:
// фильтры и страница лежат в сторе раздела.
const filters = useVideoFiltersStore()
const { data: listData } = useVideos(computed(() => filters.query))

const siblings = computed(() => listData.value?.data?.map(v => v.id) ?? [])
const currentIndex = computed(() => siblings.value.indexOf(Number(videoId.value)))
const listMeta = computed(() => listData.value?.meta ?? null)

// Ролика может не быть в загруженной странице списка — например, при заходе
// по прямой ссылке. Тогда соседей мы не знаем и не притворяемся, что знаем:
// стрелки отключены, позиция не показывается.
const inList = computed(() => currentIndex.value >= 0)

const hasPrev = computed(() => inList.value && (currentIndex.value > 0 || filters.page > 1))
const hasNext = computed(() => inList.value && (
  currentIndex.value < siblings.value.length - 1
  || (!!listMeta.value && filters.page < listMeta.value.totalPages)))

const position = computed(() => {
  if (!inList.value || !listMeta.value) return undefined
  const absolute = (filters.page - 1) * filters.perPage + currentIndex.value + 1
  return `${absolute} из ${listMeta.value.total}`
})

/** На краю страницы переходим к соседней и берём её крайний элемент. */
async function goSibling(delta: -1 | 1) {
  const next = siblings.value[currentIndex.value + delta]
  if (next != null) {
    await navigateTo(`/videos/${next}`)
    return
  }
  const targetPage = filters.page + delta
  if (targetPage < 1 || (listMeta.value && targetPage > listMeta.value.totalPages)) return

  filters.page = targetPage
  await nextTick()
  const edge = delta === 1 ? siblings.value[0] : siblings.value[siblings.value.length - 1]
  if (edge != null) await navigateTo(`/videos/${edge}`)
}

// ─── Свойства и связи ────────────────────────────────────────────────────────
const properties = computed(() => {
  const v = video.value
  if (!v) return []
  return [
    { label: 'Формат', value: v.format === 'portrait' ? '9:16 · вертикальное' : '16:9 · горизонтальное' },
    { label: 'Длительность', value: v.duration ? `${v.duration} с` : null },
    { label: 'Качество', value: v.renderQuality },
    { label: 'Платформа', value: v.targetPlatform },
    { label: 'Субтитры', value: v.subtitlesEnabled ? (v.subtitlePreset ?? 'включены') : 'выключены', mono: false },
    { label: 'Музыка', value: v.musicEnabled ? (v.musicMood ?? 'включена') : 'выключена', mono: false },
    { label: 'Модель кадров', value: v.imageModelId },
    { label: 'Модель клипов', value: v.videoModelId },
  ]
})

const relations = computed(() => {
  const v = video.value
  if (!v) return []
  const chain = []
  if (v.scenario?.trendId) {
    chain.push({ label: 'Тренд', title: `#${v.scenario.trendId}`, to: `/trends/${v.scenario.trendId}` })
  }
  if (v.scenario) {
    chain.push({ label: 'Сценарий', title: `#${v.scenario.id}`, to: `/scenarios/${v.scenario.id}` })
  }
  chain.push({ label: 'Ролик', title: `vid_${v.id}`, current: true })
  return chain
})

// ─── Стоимость ───────────────────────────────────────────────────────────────
// Разбивка собирается из шагов: отдельного endpoint'а с фактической стоимостью
// по провайдерам нет, а факт шага — это ровно то, что за него списали.
const costItems = computed(() =>
  steps.value
    .map(s => ({
      label: VIDEO_STEP_LABELS[s.stepKey] ?? s.stepKey,
      amount: s.actualCost ?? 0,
      wasted: s.status === 'failed' || s.status === 'timeout',
    }))
    .filter(i => i.amount > 0))

const spent = computed(() => video.value?.totalCostActual ?? costItems.value.reduce((s, i) => s + i.amount, 0))

// ─── Ошибка генерации ────────────────────────────────────────────────────────
const failedStep = computed(() => steps.value.find(s => s.status === 'failed' || s.status === 'timeout') ?? null)
const isRetrying = ref(false)

const { rerunStep, cancelVideo, resumeVideo, deleteVideo, generateVideo, isCanceling, isResuming } = useVideoActions()

async function retryFromFailed() {
  if (!failedStep.value || !video.value) return
  isRetrying.value = true
  try {
    await rerunStep(video.value.id, failedStep.value.stepKey)
    await afterStepAction()
  } finally {
    isRetrying.value = false
  }
}

/** «Повторить всё» — это новая генерация из того же сценария, отдельная запись. */
async function regenerateAll() {
  if (!video.value?.scenario) return
  isRetrying.value = true
  try {
    const result = await generateVideo(video.value.scenario.id, { format: video.value.format })
    if (result) await navigateTo(`/videos/${(result as { data: { id: number } }).data.id}`)
  } finally {
    isRetrying.value = false
  }
}

async function onCancel() {
  if (!video.value) return
  await cancelVideo(video.value.id)
  await poll()
}

async function onResume() {
  if (!video.value) return
  await resumeVideo(video.value.id)
  startPolling()
}

const showDelete = ref(false)
const isDeleting = ref(false)

async function onDelete() {
  if (!video.value) return
  isDeleting.value = true
  try {
    const result = await deleteVideo(video.value.id)
    if (result) await navigateTo('/videos')
  } finally {
    isDeleting.value = false
    showDelete.value = false
  }
}

// ─── Файлы на диске ──────────────────────────────────────────────────────────
// На проде persistent disk может быть не смонтирован: БД считает ролик готовым,
// а mp4 и ассеты пропали. Лёгкий probe сразу после готовности показывает кнопки
// восстановления, не дожидаясь ошибки от <video>.
const { check: checkStorage, data: storageStatus } = useVideoStorageStatus()
const storageProbed = ref(false)
const isRecovering = ref(false)

async function probeStorage() {
  if (!video.value || !isCompleted.value) return
  await checkStorage(video.value.id)
  storageProbed.value = true
}

watch(isCompleted, async (val) => {
  if (val && !storageProbed.value) await probeStorage()
}, { immediate: true })

async function onPlayerError() {
  if (storageProbed.value) return
  await probeStorage()
}

async function reassemble() {
  if (!video.value) return
  isRecovering.value = true
  try {
    await $fetch(`/api/videos/${video.value.id}/rerender-assembly`, { method: 'POST' })
    storageProbed.value = false
    await refresh()
  } finally {
    isRecovering.value = false
  }
}

async function regenerateFromImages() {
  if (!video.value) return
  isRecovering.value = true
  try {
    await rerunStep(video.value.id, 'image_generation')
    storageProbed.value = false
    await refresh()
  } finally {
    isRecovering.value = false
  }
}

// Cache-busting: updatedAt меняется после пересборки, ломая кеш браузера.
const videoSrc = computed(() => {
  const v = video.value
  if (!v?.fileUrl) return null
  return `/api/files/${v.fileUrl}?v=${v.updatedAt}`
})

const showPlayer = computed(() =>
  !!videoSrc.value && (!storageProbed.value || storageStatus.value?.videoOnDisk !== false))

const downloadUrl = computed(() => video.value?.fileUrl ? `/api/files/${video.value.fileUrl}` : null)

// ─── Вкладки ─────────────────────────────────────────────────────────────────
const tab = ref<'overview' | 'scenario' | 'subtitles' | 'frames' | 'publish'>('overview')

const frameCount = computed(() => assets.value.filter(a => a.type === 'image' && a.fileUrl).length)

const tabs = computed(() => [
  { key: 'overview' as const, label: 'Обзор' },
  { key: 'scenario' as const, label: 'Сценарий' },
  { key: 'subtitles' as const, label: 'Субтитры', disabled: !isCompleted.value },
  { key: 'frames' as const, label: 'Кадры', count: frameCount.value },
  { key: 'publish' as const, label: 'Публикация', disabled: !isCompleted.value },
])

const variant = computed(() => video.value?.scenario?.variants?.[0] ?? null)

const showUpload = ref(false)

const headerActions = computed(() => {
  const items = [
    { key: 'regenerate', label: 'Сгенерировать заново', icon: 'mingcute:refresh-2-line', cost: 'платно' },
  ]
  if (can('canDelete')) {
    items.push({ key: 'delete', label: 'Удалить ролик', icon: 'mingcute:delete-2-line', danger: true } as never)
  }
  return items
})

function onHeaderAction(key: string) {
  if (key === 'regenerate') void regenerateAll()
  if (key === 'delete') showDelete.value = true
}

function copyId() {
  if (!video.value) return
  navigator.clipboard.writeText(`vid_${video.value.id}`)
  toast.success('Идентификатор скопирован')
}
</script>

<template>
  <div>
    <UiSkeleton v-if="pending && !video" variant="details" :count="6" />

    <UiErrorState
      v-else-if="error"
      title="Не удалось загрузить ролик"
      :message="error.message"
      @retry="refresh"
    />

    <template v-else-if="video">
      <DetailHeader
        :title="title"
        :code="`vid_${video.id}`"
        back-to="/videos"
        back-label="К видео"
        :position="position"
        :has-prev="hasPrev"
        :has-next="hasNext"
        @prev="goSibling(-1)"
        @next="goSibling(1)"
      >
        <template #badges>
          <UiStatusBadge :status="videoStatus(video.status)" />
          <UiButton icon-only variant="ghost" aria-label="Скопировать идентификатор" @click="copyId">
            <Icon name="mingcute:copy-2-line" />
          </UiButton>
        </template>

        <template #actions>
          <UiButton v-if="isActive" :loading="isCanceling" @click="onCancel">Отменить</UiButton>
          <UiButton v-if="isFailed" variant="primary" :loading="isResuming" @click="onResume">
            Возобновить
          </UiButton>
          <UiButton v-if="isCompleted" variant="primary" @click="showUpload = true">
            <Icon name="mingcute:upload-3-line" />
            Загрузить в соцсети
          </UiButton>
          <a v-if="isCompleted && downloadUrl" :href="downloadUrl" download>
            <UiButton icon-only aria-label="Скачать ролик">
              <Icon name="mingcute:download-2-line" />
            </UiButton>
          </a>
          <UiActionMenu :items="headerActions" @select="onHeaderAction" />
        </template>
      </DetailHeader>

      <div class="flex flex-wrap items-center gap-4 px-1 pb-3 text-sm text-muted">
        <span class="flex items-center gap-1.5">
          Стоимость
          <span class="tnum font-mono text-fg">{{ spent.toFixed(2) }} ₽</span>
        </span>
        <span class="flex items-center gap-1.5">
          Создано
          <span class="tnum font-mono">{{ new Date(video.createdAt).toLocaleString('ru-RU') }}</span>
        </span>
        <span v-if="video.duration" class="flex items-center gap-1.5">
          Длительность
          <span class="tnum font-mono">{{ video.duration }} с</span>
        </span>
        <DetailRelations :chain="relations" class="ml-auto" />
      </div>

      <div class="grid items-start gap-3.5 xl:grid-cols-[minmax(0,1fr)_392px]">
        <!-- ЛЕВАЯ КОЛОНКА · содержимое -->
        <div class="flex min-w-0 flex-col gap-3">
          <div
            v-if="storageProbed && storageStatus && storageStatus.recoveryHint !== 'all_present'"
            role="alert"
            class="rounded-lg border border-warning-border bg-warning-bg p-3.5"
          >
            <div class="flex items-start gap-2.5">
              <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0 text-lg text-warning" />
              <div class="min-w-0 flex-1">
                <div class="font-medium text-warning">Файлы ролика не найдены на сервере</div>
                <p class="mt-1 text-sm text-muted">
                  <template v-if="storageStatus.recoveryHint === 'video_missing_can_reassemble'">
                    Mp4 пропал, но все клипы на месте — можно пересобрать без повторной платной генерации.
                  </template>
                  <template v-else-if="storageStatus.recoveryHint === 'video_missing_needs_full_regen'">
                    Mp4 и часть клипов отсутствуют ({{ storageStatus.clips.onDisk }} из
                    {{ storageStatus.clips.total }} клипов на диске). Бесплатная пересборка невозможна.
                  </template>
                  <template v-else>
                    Часть ассетов отсутствует: кадров {{ storageStatus.images.onDisk }} из
                    {{ storageStatus.images.total }}, клипов {{ storageStatus.clips.onDisk }} из
                    {{ storageStatus.clips.total }}.
                  </template>
                </p>
                <p class="mt-1 text-micro text-subtle">
                  Обычная причина — отсутствие постоянного диска на платформе развёртывания.
                </p>
                <div class="mt-2.5 flex flex-wrap gap-1.5">
                  <UiButton
                    v-if="storageStatus.canReassemble"
                    variant="primary"
                    :loading="isRecovering"
                    @click="reassemble"
                  >
                    Пересобрать · бесплатно
                  </UiButton>
                  <UiButton v-else :loading="isRecovering" @click="regenerateFromImages">
                    Перегенерировать · платно
                  </UiButton>
                </div>
              </div>
            </div>
          </div>

          <section class="overflow-hidden rounded-lg border border-border bg-panel">
            <div role="tablist" class="flex flex-wrap gap-0.5 border-b border-border bg-card px-2.5">
              <button
                v-for="t in tabs"
                :key="t.key"
                type="button"
                role="tab"
                :aria-selected="tab === t.key"
                :disabled="t.disabled"
                class="flex h-[34px] items-center gap-1.5 border-b-2 px-2.5 text-sm"
                :class="[
                  tab === t.key ? 'border-accent font-medium text-fg' : 'border-transparent text-muted',
                  t.disabled ? 'cursor-not-allowed text-subtle' : 'cursor-pointer hover:text-fg',
                ]"
                @click="tab = t.key"
              >
                {{ t.label }}
                <span v-if="t.count" class="tnum font-mono text-micro text-subtle">{{ t.count }}</span>
              </button>
            </div>

            <div class="p-3.5">
              <!-- Обзор -->
              <div v-if="tab === 'overview'" class="flex flex-col gap-3.5 md:flex-row">
                <div class="shrink-0">
                  <VideoPlayer
                    v-if="showPlayer && videoSrc"
                    :src="videoSrc"
                    :format="video.format"
                    @error="onPlayerError"
                  />
                  <div
                    v-else
                    class="flex w-[236px] items-center justify-center rounded-md border border-dashed border-border bg-surface text-sm text-subtle"
                    :class="video.format === 'portrait' ? 'aspect-[9/16]' : 'aspect-video'"
                  >
                    {{ isActive ? 'Ролик ещё собирается' : 'Файла нет' }}
                  </div>
                </div>

                <div class="min-w-0 flex-1">
                  <h3 class="mb-2 text-micro tracking-[.06em] text-subtle uppercase">Свойства</h3>
                  <UiKeyValue :items="properties" />
                </div>
              </div>

              <!-- Сценарий -->
              <div v-else-if="tab === 'scenario'" class="flex flex-col gap-3">
                <UiEmptyState
                  v-if="!variant"
                  title="Сценарий недоступен"
                  description="У ролика нет принятого варианта сценария."
                />
                <template v-else>
                  <div v-if="variant.hook">
                    <h3 class="mb-1 text-micro tracking-[.06em] text-subtle uppercase">Хук</h3>
                    <p class="text-sm">{{ variant.hook }}</p>
                  </div>
                  <div v-if="variant.body">
                    <h3 class="mb-1 text-micro tracking-[.06em] text-subtle uppercase">Основная часть</h3>
                    <p class="text-sm whitespace-pre-line">{{ variant.body }}</p>
                  </div>
                  <div v-if="variant.cta">
                    <h3 class="mb-1 text-micro tracking-[.06em] text-subtle uppercase">Призыв к действию</h3>
                    <p class="text-sm">{{ variant.cta }}</p>
                  </div>
                  <div v-if="variant.visualStyleText">
                    <h3 class="mb-1 text-micro tracking-[.06em] text-subtle uppercase">Визуальный стиль</h3>
                    <p class="text-sm">{{ variant.visualStyleText }}</p>
                  </div>
                </template>
              </div>

              <!-- Субтитры -->
              <VideoSubtitleEditor
                v-else-if="tab === 'subtitles'"
                :video-id="video.id"
                :variant="variant"
                :video-subtitles-style="(video.subtitlesStyle as Record<string, unknown>) ?? null"
                :current-preset="video.subtitlePreset"
                @saved="refresh"
              />

              <!-- Кадры -->
              <VideoFramesTab v-else-if="tab === 'frames'" :assets="assets" />

              <!-- Публикация -->
              <VideoCaptionsSection v-else-if="tab === 'publish'" :video-id="video.id" />
            </div>
          </section>

          <VideoUniqueVariantsSection
            v-if="isCompleted"
            :video-id="video.id"
            :video-file-url="video.fileUrl"
          />

          <ScenarioFeedbackForm
            v-if="isCompleted"
            :video-id="video.id"
            :scenario-id="video.scenarioId"
          />
        </div>

        <!-- ПРАВАЯ КОЛОНКА · процесс -->
        <div class="flex flex-col gap-3">
          <DetailErrorReport
            v-if="isFailed && failedStep"
            :step-label="VIDEO_STEP_LABELS[failedStep.stepKey] ?? failedStep.stepKey"
            :message="video.errorMessage ?? failedStep.errorMessage ?? 'Генерация остановилась без сообщения.'"
            :details="failedStep.errorMessage"
            :spent="spent"
            :retry-from-label="VIDEO_STEP_LABELS[failedStep.stepKey] ?? failedStep.stepKey"
            :retry-cost="failedStep.estimatedCost"
            :retrying="isRetrying"
            @retry-from="retryFromFailed"
            @retry-all="regenerateAll"
            @cancel="onCancel"
          />

          <VideoStepsPanel
            :video-id="video.id"
            :steps="steps"
            :active="isActive"
            @changed="afterStepAction"
          />

          <div v-if="costItems.length" class="rounded-lg border border-border bg-panel p-3">
            <DetailCostBreakdown :items="costItems" />
          </div>
        </div>
      </div>

      <UploadCreateModal
        :video-id="video.id"
        :video-format="video.format"
        :open="showUpload"
        @update:open="showUpload = $event"
        @created="showUpload = false"
      />

      <UiModal :open="showDelete" title="Удалить ролик?" size="sm" @close="showDelete = false">
        <p class="text-sm text-muted">
          Ролик и все связанные файлы будут удалены безвозвратно. Отменить это нельзя.
        </p>
        <template #footer>
          <UiButton variant="ghost" @click="showDelete = false">Отмена</UiButton>
          <UiButton variant="danger" :loading="isDeleting" @click="onDelete">Удалить</UiButton>
        </template>
      </UiModal>
    </template>
  </div>
</template>
