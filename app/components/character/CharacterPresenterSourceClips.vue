<script setup lang="ts">
import type { PresenterSourceClip } from '~~/shared/types/character'

const props = defineProps<{ characterId: string }>()

const { data, pending, refresh } = await useFetch<{ data: PresenterSourceClip[] }>(
  () => `/api/characters/${props.characterId}/source-clips`,
)
const clips = computed(() => data.value?.data ?? [])

const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const deletingId = ref<string | null>(null)
const dragOver = ref(false)
const error = ref('')
const tagsInput = ref('')
const outfit = ref('')
const background = ref('')
const gesture = ref('')

function formatBytes(bytes?: number | null): string {
  if (!bytes) return '—'
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`
}

function errorText(e: unknown, fallback: string) {
  return (e as { data?: { message?: string }, message?: string })?.data?.message
    || (e as Error)?.message
    || fallback
}

function metaForm() {
  const form = new FormData()
  if (tagsInput.value.trim()) form.append('tags', tagsInput.value.trim())
  if (outfit.value.trim()) form.append('outfit', outfit.value.trim())
  if (background.value.trim()) form.append('background', background.value.trim())
  if (gesture.value.trim()) form.append('gesture', gesture.value.trim())
  return form
}

async function uploadFiles(files: File[]) {
  const videos = files.filter(file => file.type.startsWith('video/'))
  if (!videos.length) {
    error.value = 'Нужны видеофайлы MP4, MOV или WebM'
    return
  }

  uploading.value = true
  error.value = ''
  try {
    const form = metaForm()
    for (const file of videos) form.append('files', file)
    await $fetch(`/api/characters/${props.characterId}/source-clips`, { method: 'POST', body: form })
    await refresh()
  }
  catch (e) {
    error.value = errorText(e, 'Не удалось загрузить исходники')
  }
  finally {
    uploading.value = false
    if (fileInput.value) fileInput.value.value = ''
  }
}

async function onFileInputChange(event: Event) {
  const target = event.target as HTMLInputElement
  await uploadFiles(Array.from(target.files ?? []))
}

// ─── Длинная запись: сервер размечает сцены и режет её на фрагменты ──────────
const recordingInput = ref<HTMLInputElement | null>(null)
const ingesting = ref(false)
const ingestReport = ref<{ accepted: number, duplicates: number, errors: number } | null>(null)

interface IngestResponse {
  data: {
    acceptedCount: number
    skipped: Array<{ reason: 'duplicate' | 'error' }>
  }
}

async function onRecordingChange(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return

  ingesting.value = true
  error.value = ''
  ingestReport.value = null
  try {
    const form = metaForm()
    form.append('file', file)
    const response = await $fetch<IngestResponse>(
      `/api/characters/${props.characterId}/source-recordings`,
      { method: 'POST', body: form },
    )
    ingestReport.value = {
      accepted: response.data.acceptedCount,
      duplicates: response.data.skipped.filter(s => s.reason === 'duplicate').length,
      errors: response.data.skipped.filter(s => s.reason === 'error').length,
    }
    await refresh()
  }
  catch (e) {
    error.value = errorText(e, 'Не удалось разобрать запись')
  }
  finally {
    ingesting.value = false
    if (recordingInput.value) recordingInput.value.value = ''
  }
}

function onDrop(event: DragEvent) {
  dragOver.value = false
  uploadFiles(Array.from(event.dataTransfer?.files ?? []))
}

async function deactivateClip(clip: PresenterSourceClip) {
  deletingId.value = clip.id
  error.value = ''
  try {
    await $fetch(`/api/characters/${props.characterId}/source-clips/${clip.id}`, { method: 'DELETE' })
    await refresh()
  }
  catch (e) {
    error.value = errorText(e, 'Не удалось убрать исходник')
  }
  finally {
    deletingId.value = null
  }
}
</script>

<template>
  <div class="flex flex-col gap-3.5">
    <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <UiInput v-model="outfit" placeholder="Одежда, например белая рубашка" />
      <UiInput v-model="background" placeholder="Фон, например светлая студия" />
      <UiInput v-model="gesture" placeholder="Жесты, например активно руками" />
      <UiInput v-model="tagsInput" placeholder="Теги через запятую" />
    </div>

    <div
      class="cursor-pointer rounded-lg border-2 border-dashed p-5 transition-colors duration-(--duration-fast)"
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
        accept="video/mp4,video/quicktime,video/webm"
        multiple
        class="hidden"
        @change="onFileInputChange"
      >
      <div class="flex flex-col items-center gap-1 text-center">
        <Icon
          :name="uploading ? 'mingcute:loading-3-line' : 'mingcute:video-line'"
          class="text-2xl text-subtle"
          :class="uploading && 'animate-spin'"
        />
        <span class="text-sm font-medium">
          {{ uploading ? 'Проверяем и загружаем' : 'Добавить фрагменты с ведущим' }}
        </span>
        <span class="text-micro text-subtle">
          MP4, MOV или WebM. Фрагмент 2–10 секунд, до 100 МБ. Липсинк берёт наименее использованные.
        </span>
      </div>
    </div>

    <section class="rounded-lg border border-border p-3.5">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="text-sm font-medium">Длинная запись целиком</div>
          <div class="text-micro text-subtle">
            Разметим сцены, нарежем на фрагменты 2–10 секунд и выбросим похожие.
          </div>
        </div>
        <UiButton variant="primary" :loading="ingesting" @click="recordingInput?.click()">
          <Icon v-if="!ingesting" name="mingcute:scissors-line" />
          {{ ingesting ? 'Разбираем запись' : 'Загрузить и нарезать' }}
        </UiButton>
      </div>

      <input
        ref="recordingInput"
        type="file"
        accept="video/mp4,video/quicktime,video/webm"
        class="hidden"
        @change="onRecordingChange"
      >

      <p v-if="ingestReport" class="mt-2 text-sm text-muted">
        Принято фрагментов: <span class="tnum font-mono">{{ ingestReport.accepted }}</span>.
        <span v-if="ingestReport.duplicates">
          Похожих отброшено: <span class="tnum font-mono">{{ ingestReport.duplicates }}</span>.
        </span>
        <span v-if="ingestReport.errors">
          С ошибкой: <span class="tnum font-mono">{{ ingestReport.errors }}</span>.
        </span>
      </p>
    </section>

    <div
      v-if="error"
      role="alert"
      class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
    >
      <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
      <span>{{ error }}</span>
    </div>

    <UiSkeleton v-if="pending && !clips.length" variant="cards" :count="4" />

    <div v-else-if="clips.length" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <article
        v-for="clip in clips"
        :key="clip.id"
        class="overflow-hidden rounded-md border border-border bg-card"
      >
        <video
          :src="clip.fileUrl"
          muted
          playsinline
          controls
          preload="metadata"
          class="aspect-[9/16] max-h-64 w-full bg-surface object-cover"
        />
        <div class="flex flex-col gap-1.5 p-2 text-micro">
          <div class="flex items-center justify-between gap-2">
            <span class="truncate text-sm font-medium" :title="clip.name || undefined">
              {{ clip.name || 'Исходник' }}
            </span>
            <UiButton
              icon-only
              variant="ghost"
              :loading="deletingId === clip.id"
              title="Убрать из ротации"
              aria-label="Убрать из ротации"
              @click="deactivateClip(clip)"
            >
              <Icon v-if="deletingId !== clip.id" name="mingcute:delete-2-line" />
            </UiButton>
          </div>
          <div class="tnum font-mono text-subtle">
            {{ clip.durationSec.toFixed(1) }} с · {{ formatBytes(clip.bytes) }} ·
            использован {{ clip.usageCount }}
          </div>
          <div v-if="clip.tags.length" class="flex flex-wrap gap-1">
            <span
              v-for="tag in clip.tags.slice(0, 5)"
              :key="tag"
              class="rounded-sm border border-divider px-1.5 py-0.5 text-subtle"
            >
              {{ tag }}
            </span>
          </div>
        </div>
      </article>
    </div>

    <p v-else class="py-4 text-center text-sm text-subtle">
      Исходников нет. Без них конвейер подставит сгенерированный клип.
    </p>
  </div>
</template>
