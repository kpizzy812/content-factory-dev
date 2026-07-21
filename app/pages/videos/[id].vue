<script setup lang="ts">
import { onAssetMissing } from '~/utils/image-fallback'

definePageMeta({ layout: 'default', middleware: 'module-access', moduleSlug: 'video-generator' })

const route = useRoute()
const videoId = computed(() => route.params.id as string)

const { data, pending, error, refresh } = useVideoDetail(videoId)

const video = computed(() => data.value?.data ?? null)

useHead({
  title: computed(() => {
    if (!video.value?.scenario) return 'Видео'
    return `Видео — ${video.value.scenario.variants?.[0]?.title ?? `Сценарий #${video.value.scenario.id}`}`
  }),
})

const activeStatuses = ['pending', 'configuring', 'generating_prompts', 'generating_images', 'generating_clips', 'generating_music', 'assembling']

const isActive = computed(() => {
  if (!video.value) return false
  return activeStatuses.includes(video.value.status)
})

const isCompleted = computed(() => video.value?.status === 'completed')
const isFailed = computed(() => video.value?.status === 'failed')
const isCanceled = computed(() => video.value?.status === 'canceled')

const formatLabel = computed(() => {
  if (!video.value) return ''
  return video.value.format === 'portrait'
    ? 'Вертикальное (TikTok/Reels)'
    : 'Горизонтальное (YouTube)'
})

// Cache-busting: updatedAt меняется после пересборки, ломая кеш браузера
const videoSrc = computed(() => {
  if (!video.value?.fileUrl) return null
  const cacheBust = video.value.updatedAt || Date.now()
  return `/api/files/${video.value.fileUrl}?v=${cacheBust}`
})

// Ассеты по типу для completed
const imageAssets = computed(() => {
  return video.value?.assets?.filter(a => a.type === 'image' && a.fileUrl) ?? []
})

const promptAssets = computed(() => {
  return video.value?.assets
    ?.filter(a => a.type === 'image' && a.prompt)
    .map(a => ({ assetId: a.id, order: a.order, prompt: a.prompt! })) ?? []
})

const clipAssets = computed(() => {
  return video.value?.assets?.filter(a => a.type === 'clip') ?? []
})

const musicAssets = computed(() => {
  return video.value?.assets?.filter(a => a.type === 'music') ?? []
})

async function onCompleted() {
  await refresh()
}

async function onRetry() {
  if (!video.value?.scenario) return
  const { generateVideo } = useVideoActions()
  const result = await generateVideo(video.value.scenario.id, { format: video.value.format })
  if (result) {
    await navigateTo(`/videos/${(result as { data: { id: number } }).data.id}`)
  }
}

async function onDeleted() {
  await navigateTo('/videos')
}

// Storage status: на проде persistent disk может быть не привязан → файлы
// исчезают между деплоями, а БД статус остаётся 'completed'. Лёгкий probe
// (~10ms на диск) сразу при mount, чтобы UI показал кнопки восстановления
// без ожидания ошибки от <video>.
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

async function onVideoPlayerError() {
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

async function regenerateFromClips() {
  if (!video.value) return
  isRecovering.value = true
  try {
    const { rerunStep } = useVideoActions()
    await rerunStep(video.value.id, 'image_generation')
    storageProbed.value = false
    await refresh()
  } finally {
    isRecovering.value = false
  }
}

const showScenarioDetails = ref(false)
const showUploadModal = ref(false)

// Lightbox state
const showLightbox = ref(false)
const lightboxInitialIndex = ref(0)

function openLightbox(index: number) {
  lightboxInitialIndex.value = index
  showLightbox.value = true
}

function downloadImage(asset: { fileUrl: string | null; order: number }) {
  if (!asset.fileUrl) return
  const a = document.createElement('a')
  a.href = `/api/files/${asset.fileUrl}`
  a.download = `image_${asset.order + 1}.png`
  a.click()
}

function onUploadCreated() {
  showUploadModal.value = false
}
</script>

<template>
  <div class="space-y-4">
    <!-- Назад -->
    <NuxtLink to="/videos" class="btn btn-ghost btn-sm gap-1">
      <Icon name="mingcute:arrow-left-line" />
      Назад к видео
    </NuxtLink>

    <!-- Loading -->
    <div v-if="pending" class="flex justify-center py-12">
      <span class="loading loading-spinner loading-lg" />
    </div>

    <!-- Error -->
    <div v-else-if="error" role="alert" class="alert alert-error">
      <Icon name="mingcute:warning-line" />
      <span>Ошибка загрузки: {{ error.message }}</span>
    </div>

    <!-- Content -->
    <template v-else-if="video">
      <!-- Заголовок -->
      <div class="flex items-center gap-3 flex-wrap">
        <h1 class="text-xl font-bold text-base-content">
          {{ video.scenario?.variants?.[0]?.title ?? 'Видео' }}
        </h1>
        <VideoStatusBadge :status="video.status" />
        <span class="badge badge-ghost badge-sm">{{ formatLabel }}</span>
      </div>

      <!-- Связанные сущности -->
      <div v-if="video.scenario" class="flex items-center gap-3 flex-wrap text-sm">
        <NuxtLink
          :to="`/scenarios/${video.scenario.id}`"
          class="link link-primary inline-flex items-center gap-1"
        >
          <Icon name="mingcute:document-line" class="text-xs" />
          Сценарий #{{ video.scenario.id }}
        </NuxtLink>
        <NuxtLink
          v-if="video.scenario.trendId"
          :to="`/trends/${video.scenario.trendId}`"
          class="link link-hover text-base-content/60 inline-flex items-center gap-1"
        >
          <Icon name="mingcute:eye-line" class="text-xs" />
          Тренд #{{ video.scenario.trendId }}
        </NuxtLink>
      </div>

      <!-- Генерация: прогресс / ошибка / отменено / история шагов для completed -->
      <div v-if="isActive || isFailed || isCanceled" class="card bg-base-100 shadow-sm">
        <div class="card-body">
          <VideoProgress
            :video-id="video.id"
            @completed="onCompleted"
            @retry="onRetry"
          />
        </div>
      </div>

      <!-- Для completed: collapse с шагами генерации и rerun -->
      <div v-if="isCompleted" class="collapse collapse-arrow bg-base-100 shadow-sm">
        <input type="checkbox" />
        <div class="collapse-title text-sm font-medium flex items-center gap-2">
          <Icon name="mingcute:settings-3-line" class="text-base-content/50" />
          Шаги генерации и перезапуск
        </div>
        <div class="collapse-content">
          <VideoProgress
            :video-id="video.id"
            static
            @retry="onRetry"
          />
        </div>
      </div>

      <!-- Редактирование субтитров (без перегенерации клипов) -->
      <div v-if="isCompleted" class="collapse collapse-arrow bg-base-100 shadow-sm">
        <input type="checkbox" />
        <div class="collapse-title text-sm font-medium flex items-center gap-2">
          <Icon name="mingcute:text-line" class="text-base-content/50" />
          Редактировать субтитры
          <span class="badge badge-ghost badge-xs">бесплатно</span>
        </div>
        <div class="collapse-content">
          <VideoSubtitleEditor
            :video-id="video.id"
            :variant="video.scenario?.variants?.[0] ?? null"
            :video-subtitles-style="(video.subtitlesStyle as Record<string, unknown>) ?? null"
            :current-preset="video.subtitlePreset"
            @saved="refresh"
          />
        </div>
      </div>

      <!-- Завершено -->
      <template v-if="isCompleted">
        <!-- Алерт о пропавших файлах: persistent disk на платформе развалился
             или не был смонтирован — БД считает что completed, а mp4/ассеты
             пропали. Показываем сразу после storage probe, без ожидания error. -->
        <div
          v-if="storageProbed && storageStatus && storageStatus.recoveryHint !== 'all_present'"
          role="alert"
          class="alert alert-warning"
        >
          <Icon name="mingcute:warning-line" class="text-xl" />
          <div class="space-y-1">
            <h3 class="font-semibold">
              Файлы видео не найдены на сервере
            </h3>
            <p class="text-sm">
              <template v-if="storageStatus.recoveryHint === 'video_missing_can_reassemble'">
                Mp4 пропал, но все клипы на месте — можно пересобрать без повторной (платной) генерации.
              </template>
              <template v-else-if="storageStatus.recoveryHint === 'video_missing_needs_full_regen'">
                Mp4 и часть клипов отсутствуют ({{ storageStatus.clips.onDisk }}/{{ storageStatus.clips.total }} клипов на диске).
                Бесплатная пересборка невозможна — нужна повторная генерация (платно).
              </template>
              <template v-else>
                Часть ассетов отсутствует: картинок {{ storageStatus.images.onDisk }}/{{ storageStatus.images.total }},
                клипов {{ storageStatus.clips.onDisk }}/{{ storageStatus.clips.total }}.
              </template>
            </p>
            <p class="text-xs opacity-70">
              Корневая причина обычно — отсутствие persistent disk на платформе деплоя.
              Свяжитесь с админом или см. README раздел "Persistent storage".
            </p>
          </div>
          <div class="flex flex-col sm:flex-row gap-2">
            <button
              v-if="storageStatus.canReassemble"
              class="btn btn-sm btn-primary gap-1"
              :disabled="isRecovering"
              @click="reassemble"
            >
              <Icon name="mingcute:refresh-3-line" />
              Пересобрать (бесплатно)
            </button>
            <button
              v-else
              class="btn btn-sm btn-warning gap-1"
              :disabled="isRecovering"
              @click="regenerateFromClips"
            >
              <Icon name="mingcute:refresh-3-line" />
              Перегенерировать (платно)
            </button>
          </div>
        </div>

        <!-- Плеер -->
        <VideoPlayer
          v-if="videoSrc && (!storageProbed || storageStatus?.videoOnDisk !== false)"
          :src="videoSrc"
          :format="video.format"
          @error="onVideoPlayerError"
        />

        <!-- Результаты шагов генерации -->
        <div class="space-y-2">
          <!-- Промпты -->
          <div
            v-if="promptAssets.length > 0"
            class="collapse collapse-arrow bg-base-100 shadow-sm"
          >
            <input type="checkbox" />
            <div class="collapse-title text-sm font-medium flex items-center gap-2">
              <Icon name="mingcute:check-circle-fill" class="text-success" />
              Промпты
              <span class="badge badge-success badge-xs">{{ promptAssets.length }} шт.</span>
            </div>
            <div class="collapse-content space-y-2">
              <div
                v-for="item in promptAssets"
                :key="item.assetId"
                class="bg-base-200 rounded-lg p-3"
              >
                <div class="flex items-center justify-between gap-2 mb-1">
                  <p class="text-xs font-semibold text-base-content/50">Сцена {{ item.order + 1 }}</p>
                  <FavoritePromptButton
                    :prompt-text="item.prompt"
                    :app-id="(video.scenario as { appId?: number | null } | null)?.appId ?? null"
                    :source-video-asset-id="item.assetId"
                  />
                </div>
                <p class="text-sm text-base-content whitespace-pre-line">{{ item.prompt }}</p>
              </div>
            </div>
          </div>

          <!-- Изображения -->
          <div
            v-if="imageAssets.length > 0"
            class="collapse collapse-arrow bg-base-100 shadow-sm"
          >
            <input type="checkbox" />
            <div class="collapse-title text-sm font-medium flex items-center gap-2">
              <Icon name="mingcute:check-circle-fill" class="text-success" />
              Изображения
              <span class="badge badge-success badge-xs">{{ imageAssets.length }} шт.</span>
            </div>
            <div class="collapse-content">
              <div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 pt-2">
                <div
                  v-for="(asset, idx) in imageAssets"
                  :key="asset.id"
                  class="relative group"
                >
                  <figure
                    class="aspect-square rounded-lg overflow-hidden bg-base-200 cursor-pointer"
                    @click="openLightbox(idx)"
                  >
                    <img
                      :src="`/api/files/${asset.fileUrl}`"
                      alt="Ассет"
                      class="w-full h-full object-cover"
                      @error="onAssetMissing"
                    />
                  </figure>
                  <button
                    class="absolute top-1 right-1 btn btn-circle btn-xs btn-ghost bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                    @click.stop="downloadImage(asset)"
                  >
                    <Icon name="mingcute:download-2-line" class="text-xs" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Клипы -->
          <div
            v-if="clipAssets.length > 0"
            class="collapse collapse-arrow bg-base-100 shadow-sm"
          >
            <input type="checkbox" />
            <div class="collapse-title text-sm font-medium flex items-center gap-2">
              <Icon name="mingcute:check-circle-fill" class="text-success" />
              Клипы
              <span class="badge badge-success badge-xs">{{ clipAssets.length }} шт.</span>
            </div>
            <div class="collapse-content">
              <div class="flex flex-wrap gap-2 pt-2">
                <span
                  v-for="asset in clipAssets"
                  :key="asset.id"
                  class="badge badge-outline gap-1"
                >
                  <Icon name="mingcute:film-line" class="text-xs" />
                  Клип {{ asset.order + 1 }}
                </span>
              </div>
              <div v-if="musicAssets.length > 0" class="flex flex-wrap gap-2 pt-2">
                <span
                  v-for="asset in musicAssets"
                  :key="asset.id"
                  class="badge badge-outline gap-1"
                >
                  <Icon name="mingcute:music-2-line" class="text-xs" />
                  Музыка
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- Captions для соцсетей (Caption Generator output) -->
        <VideoCaptionsSection :video-id="video.id" />

        <!-- Действия -->
        <div class="flex flex-wrap gap-2 items-center">
          <button
            class="btn btn-sm btn-accent gap-1"
            @click="showUploadModal = true"
          >
            <Icon name="mingcute:upload-3-line" />
            Загрузить в соцсети
          </button>
          <VideoActions
            :video-id="video.id"
            :file-url="video.fileUrl"
            :status="video.status"
            @deleted="onDeleted"
          />
        </div>

        <!-- Уникализация (Track F) -->
        <VideoUniqueVariantsSection
          :video-id="video.id"
          :video-file-url="video.fileUrl"
        />

        <!-- Модальное окно загрузки -->
        <UploadCreateModal
          :video-id="video.id"
          :video-format="video.format"
          :open="showUploadModal"
          @update:open="showUploadModal = $event"
          @created="onUploadCreated"
        />
        <!-- Image lightbox -->
        <VideoImageLightbox
          v-if="showLightbox && imageAssets.length > 0"
          :images="imageAssets"
          :initial-index="lightboxInitialIndex"
          @close="showLightbox = false"
        />
      </template>

      <!-- Обратная связь по видео -->
      <ScenarioFeedbackForm
        v-if="isCompleted"
        :video-id="video.id"
        :scenario-id="video.scenarioId"
      />

      <!-- Детали сценария (collapse) -->
      <div
        v-if="video.scenario"
        class="collapse collapse-arrow bg-base-100 shadow-sm"
      >
        <input v-model="showScenarioDetails" type="checkbox" />
        <div class="collapse-title font-medium">
          Детали сценария
        </div>
        <div v-if="video.scenario.variants?.[0]" class="collapse-content space-y-3">
          <div v-if="video.scenario.variants[0].hook">
            <p class="text-xs font-semibold text-base-content/50 uppercase">Хук</p>
            <p class="text-sm text-base-content">{{ video.scenario.variants[0].hook }}</p>
          </div>
          <div v-if="video.scenario.variants[0].body">
            <p class="text-xs font-semibold text-base-content/50 uppercase">Основная часть</p>
            <p class="text-sm text-base-content whitespace-pre-line">{{ video.scenario.variants[0].body }}</p>
          </div>
          <div v-if="video.scenario.variants[0].cta">
            <p class="text-xs font-semibold text-base-content/50 uppercase">Призыв к действию</p>
            <p class="text-sm text-base-content">{{ video.scenario.variants[0].cta }}</p>
          </div>
          <div v-if="video.scenario.variants[0].visualStyleText">
            <p class="text-xs font-semibold text-base-content/50 uppercase">Визуальный стиль</p>
            <p class="text-sm text-base-content">{{ video.scenario.variants[0].visualStyleText }}</p>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
