<script setup lang="ts">
/**
 * Библиотека фонов приложения (`/api/apps/:id/background-clips`).
 *
 * Макет: `design-preview/catalog/09-edit-console.dc.html`, секция `#v5`,
 * блоки `BackgroundLibrary` и `DedupNotice`.
 *
 * Загрузка идёт по одному файлу: ручка принимает один `file` за запрос и
 * отвечает на КАЖДЫЙ своим вердиктом — принят, дубль по sha1, похож по первому
 * кадру. Пачка отправляется последовательно, и каждый вердикт показывается
 * отдельной строкой: тихий успех на дубле заставил бы оператора грузить один и
 * тот же файл снова и снова, не понимая, почему счётчик не растёт.
 */
import type { BackgroundClip } from '~~/shared/types/edit-console'
import { formatBytes } from '~/utils/format-bytes'
import {
  BACKGROUND_ACCEPT_ATTR,
  BACKGROUND_KIND_OPTIONS,
  BACKGROUND_MAX_BYTES,
  PREVIEW_FAILED_TEXT,
  clipBytes,
  clipKindLabel,
  clipTitle,
  describeBackgroundUpload,
  describeClipPreview,
  formatClipDuration,
  summarizeLibrary,
} from './background-library-model'
import type { BackgroundUploadNotice } from './background-library-model'
import { BackgroundFileRejectedError, deleteBackgroundClip, uploadBackgroundClip } from './background-library-client'
import { adminErrorText } from './edit-profile-client'

const props = defineProps<{ appId: number }>()

/**
 * Список читается через `useFetch`, а не `$fetch`: на серверном рендере
 * `$fetch` не донёс бы cookie сессии и ручка ответила бы 401. Мутации ниже
 * идут через `$fetch` — они всегда происходят в браузере по действию оператора.
 */
const { data, pending, error: loadError, refresh } = await useFetch<{ data: BackgroundClip[] }>(
  () => `/api/apps/${props.appId}/background-clips`,
  { key: `admin-background-clips-${props.appId}` },
)

const clips = computed<BackgroundClip[]>(() => data.value?.data ?? [])

const uploading = ref(false)
const uploadProgress = ref({ done: 0, total: 0 })
const deletingId = ref<string | null>(null)
const dragOver = ref(false)
const actionError = ref('')

const nameInput = ref('')
const kindInput = ref<string>('')
const tagsInput = ref('')

interface Notice extends BackgroundUploadNotice { key: string }
const notices = ref<Notice[]>([])

const fileInput = ref<HTMLInputElement | null>(null)

const summary = computed(() => summarizeLibrary(clips.value))

async function uploadFiles(files: File[]) {
  if (!files.length) return

  uploading.value = true
  actionError.value = ''
  notices.value = []
  uploadProgress.value = { done: 0, total: files.length }

  // Имя применяется только к одиночному файлу: одно имя на пачку сделало бы
  // библиотеку из десяти одинаковых строк.
  const singleName = files.length === 1 ? nameInput.value : ''

  for (const file of files) {
    const knownClipIds = clips.value.map(clip => clip.id)
    const clipsById = Object.fromEntries(clips.value.map(clip => [clip.id, clip]))
    try {
      const response = await uploadBackgroundClip($fetch, props.appId, {
        file,
        name: singleName,
        kind: kindInput.value || undefined,
        tags: tagsInput.value,
      })
      const notice = describeBackgroundUpload(response.data, { knownClipIds, clipsById })
      notices.value = [...notices.value, { ...notice, key: `${file.name}-${notices.value.length}` }]
      await refresh()
    }
    catch (error) {
      const text = error instanceof BackgroundFileRejectedError
        // Файл до сети не дошёл — сервер его не видел, и говорить надо об этом.
        ? error.message
        : adminErrorText(error, `Не удалось загрузить «${file.name}»`)
      notices.value = [...notices.value, {
        tone: 'warning',
        text,
        similarNames: [],
        key: `${file.name}-${notices.value.length}`,
      }]
    }
    finally {
      uploadProgress.value = { ...uploadProgress.value, done: uploadProgress.value.done + 1 }
    }
  }

  uploading.value = false
  nameInput.value = ''
  if (fileInput.value) fileInput.value.value = ''
}

function onFileInputChange(event: Event) {
  const target = event.target as HTMLInputElement
  return uploadFiles(Array.from(target.files ?? []))
}

function onDrop(event: DragEvent) {
  dragOver.value = false
  return uploadFiles(Array.from(event.dataTransfer?.files ?? []))
}

async function remove(clip: BackgroundClip) {
  deletingId.value = clip.id
  actionError.value = ''
  try {
    await deleteBackgroundClip($fetch, props.appId, clip.id)
    await refresh()
  }
  catch (error) {
    actionError.value = adminErrorText(error, 'Не удалось убрать фон из библиотеки')
  }
  finally {
    deletingId.value = null
  }
}

const NOTICE_CLASS: Record<BackgroundUploadNotice['tone'], string> = {
  success: 'border-success-border bg-success-bg text-success',
  info: 'border-info-border bg-info-bg text-info',
  warning: 'border-warning-border bg-warning-bg text-warning',
}

const NOTICE_ICON: Record<BackgroundUploadNotice['tone'], string> = {
  success: 'mingcute:check-circle-line',
  info: 'mingcute:information-line',
  warning: 'mingcute:alert-line',
}

const KIND_ICON: Record<string, string> = {
  screen_recording: 'mingcute:computer-line',
  footage: 'mingcute:video-line',
  image: 'mingcute:pic-line',
}

/**
 * Фоны, у которых ссылка была, но браузер файл не открыл (истекла, файла нет).
 * Отдельно от «ссылки не было»: причины разные, и совет оператору разный.
 * Сбрасывается на каждое обновление списка — новая ссылка заслуживает новой
 * попытки.
 */
const previewFailed = ref<Record<string, boolean>>({})
watch(clips, () => { previewFailed.value = {} })

function onPreviewError(clipId: string) {
  previewFailed.value = { ...previewFailed.value, [clipId]: true }
}

/**
 * Клип вместе с разобранным превью. Разбор делается один раз на карточку, а не
 * пять раз прямо в разметке: в шаблоне Vue негде завести локальную переменную.
 */
const cards = computed(() => clips.value.map(clip => ({
  clip,
  preview: describeClipPreview(clip),
})))
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <span
        class="tnum rounded-sm border border-border bg-card px-1.5 py-0.5 font-mono text-micro text-muted"
      >
        {{ summary.count }} · {{ formatBytes(summary.bytes) }}
      </span>
      <span class="text-micro text-subtle">
        Фон из библиотеки бесплатен: он не тратит ни потолок картинок, ни потолок генеративного видео.
      </span>
    </div>

    <div class="grid gap-2 sm:grid-cols-3">
      <UiField label="Название" hint="Применяется, когда загружается один файл">
        <UiInput v-model="nameInput" placeholder="Экран онбординга" />
      </UiField>
      <UiField label="Тип" hint="Пусто — определим по файлу">
        <UiSelect v-model="kindInput" :options="BACKGROUND_KIND_OPTIONS" />
      </UiField>
      <UiField label="Теги" hint="Через запятую">
        <UiInput v-model="tagsInput" placeholder="онбординг, тарифы" />
      </UiField>
    </div>

    <div
      class="cursor-pointer rounded-lg border-2 border-dashed p-4 transition-colors duration-(--duration-fast)"
      :class="dragOver ? 'border-accent bg-accent-bg' : 'border-border hover:border-subtle'"
      role="button"
      tabindex="0"
      @click="fileInput?.click()"
      @keydown.enter="fileInput?.click()"
      @dragover.prevent="dragOver = true"
      @dragleave="dragOver = false"
      @drop.prevent="onDrop"
    >
      <input
        ref="fileInput"
        type="file"
        :accept="BACKGROUND_ACCEPT_ATTR"
        multiple
        class="hidden"
        @change="onFileInputChange"
      >
      <div class="flex flex-col items-center gap-1 text-center">
        <Icon
          :name="uploading ? 'mingcute:loading-3-line' : 'mingcute:add-circle-line'"
          class="text-2xl text-subtle"
          :class="uploading && 'animate-spin'"
        />
        <span class="text-sm font-medium">
          {{ uploading
            ? `Загружаем ${uploadProgress.done + 1} из ${uploadProgress.total}`
            : 'Добавить фоны' }}
        </span>
        <span class="text-micro text-subtle">
          Запись экрана, съёмка или статичная картинка. MP4, MOV, PNG, JPEG, WebP
          до {{ Math.floor(BACKGROUND_MAX_BYTES / (1024 * 1024)) }} МБ. Файлы уходят по одному.
        </span>
      </div>
    </div>

    <!-- Вердикт по каждому файлу: принят, дубль по sha1 или похож по первому кадру. -->
    <div
      v-for="notice in notices"
      :key="notice.key"
      role="status"
      class="flex flex-col gap-1.5 rounded-md border px-2.5 py-2 text-sm"
      :class="NOTICE_CLASS[notice.tone]"
    >
      <div class="flex items-start gap-2">
        <Icon :name="NOTICE_ICON[notice.tone]" class="mt-0.5 shrink-0" />
        <span>{{ notice.text }}</span>
      </div>
      <div v-if="notice.similarNames.length" class="flex flex-wrap gap-1 pl-6">
        <span
          v-for="name in notice.similarNames"
          :key="name"
          class="rounded-sm border border-current px-1.5 py-0.5 text-micro"
        >
          {{ name }}
        </span>
      </div>
    </div>

    <div
      v-if="actionError"
      role="alert"
      class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
    >
      <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
      <span>{{ actionError }}</span>
    </div>

    <UiSkeleton v-if="pending && !clips.length" variant="cards" :count="4" />

    <UiErrorState
      v-else-if="loadError"
      title="Не удалось загрузить библиотеку фонов"
      :message="loadError.message"
      @retry="refresh"
    />

    <div v-else-if="clips.length" class="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
      <article
        v-for="{ clip, preview } in cards"
        :key="clip.id"
        class="overflow-hidden rounded-md border border-border bg-card"
      >
        <!--
          Превью. Три состояния, и ни одно не выглядит пустой рамкой: файл видно;
          ссылки нет (сервер её не собрал); ссылка была, но файл не открылся.
          Последнее ловится `@error` — без него карточка молча осталась бы
          пустым прямоугольником, и оператор снова выбирал бы фон вслепую.
        -->
        <div class="flex aspect-video items-center justify-center bg-surface text-subtle">
          <video
            v-if="preview.kind === 'video' && !previewFailed[clip.id]"
            :src="preview.url"
            class="size-full object-cover"
            preload="metadata"
            muted
            playsinline
            :aria-label="`Превью фона «${clipTitle(clip)}»`"
            @error="onPreviewError(clip.id)"
          />

          <img
            v-else-if="preview.kind === 'image' && !previewFailed[clip.id]"
            :src="preview.url"
            :alt="`Превью фона «${clipTitle(clip)}»`"
            class="size-full object-cover"
            loading="lazy"
            @error="onPreviewError(clip.id)"
          >

          <div v-else class="flex flex-col items-center gap-1 px-2 py-1.5 text-center">
            <Icon :name="KIND_ICON[clip.kind] ?? 'mingcute:pic-line'" class="text-2xl" />
            <span class="text-micro text-subtle">
              {{ previewFailed[clip.id]
                ? PREVIEW_FAILED_TEXT
                : (preview.kind === 'none' ? preview.reason : '') }}
            </span>
          </div>
        </div>
        <div class="flex flex-col gap-1.5 p-2">
          <div class="flex items-start justify-between gap-2">
            <span class="truncate text-sm" :title="clipTitle(clip)">{{ clipTitle(clip) }}</span>
            <UiButton
              icon-only
              variant="ghost"
              :loading="deletingId === clip.id"
              title="Убрать из библиотеки. Кадры собранных роликов ссылку сохранят; повторная заливка того же файла вернёт фон в список."
              aria-label="Убрать из библиотеки"
              @click="remove(clip)"
            >
              <Icon v-if="deletingId !== clip.id" name="mingcute:delete-2-line" />
            </UiButton>
          </div>
          <div class="tnum flex flex-wrap gap-1.5 font-mono text-micro text-subtle">
            <span>{{ formatClipDuration(clip) }}</span>
            <span>·</span>
            <span>{{ formatBytes(clipBytes(clip)) }}</span>
            <span>·</span>
            <span :title="`Использован в кадрах: ${clip.usageCount}`">×{{ clip.usageCount }}</span>
          </div>
          <div class="text-micro text-subtle">{{ clipKindLabel(clip.kind) }}</div>
          <div v-if="clip.tags.length" class="flex flex-wrap gap-1">
            <span
              v-for="tag in clip.tags.slice(0, 4)"
              :key="tag"
              class="rounded-sm border border-divider px-1.5 py-0.5 text-micro text-subtle"
            >
              {{ tag }}
            </span>
          </div>
        </div>
      </article>
    </div>

    <UiEmptyState
      v-else
      icon="mingcute:pic-line"
      title="Фонов пока нет"
      description="Пока библиотека пуста, каждый фоновый кадр уходит в платную генерацию картинки и тратит потолок. Загруженные фоны бесплатны и берутся в первую очередь."
    >
      <UiButton variant="primary" @click="fileInput?.click()">
        <Icon name="mingcute:upload-2-line" />
        Загрузить фоны
      </UiButton>
    </UiEmptyState>
  </div>
</template>
