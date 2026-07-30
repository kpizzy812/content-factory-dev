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
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
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
    const form = new FormData()
    for (const file of videos) form.append('files', file)
    if (tagsInput.value.trim()) form.append('tags', tagsInput.value.trim())
    if (outfit.value.trim()) form.append('outfit', outfit.value.trim())
    if (background.value.trim()) form.append('background', background.value.trim())
    if (gesture.value.trim()) form.append('gesture', gesture.value.trim())

    await $fetch(`/api/characters/${props.characterId}/source-clips`, {
      method: 'POST',
      body: form,
    })
    await refresh()
  } catch (e: any) {
    error.value = e?.data?.message || e?.message || 'Ошибка загрузки исходников'
  } finally {
    uploading.value = false
    if (fileInput.value) fileInput.value.value = ''
  }
}

async function onFileInputChange(event: Event) {
  const target = event.target as HTMLInputElement
  await uploadFiles(Array.from(target.files ?? []))
}

// ─── Длинная запись: сервер сам размечает сцены и режет её на фрагменты ───
const recordingInput = ref<HTMLInputElement | null>(null)
const ingesting = ref(false)
const ingestReport = ref<{ accepted: number; duplicates: number; errors: number } | null>(null)

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
    const form = new FormData()
    form.append('file', file)
    if (tagsInput.value.trim()) form.append('tags', tagsInput.value.trim())
    if (outfit.value.trim()) form.append('outfit', outfit.value.trim())
    if (background.value.trim()) form.append('background', background.value.trim())
    if (gesture.value.trim()) form.append('gesture', gesture.value.trim())

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
  catch (e: any) {
    error.value = e?.data?.message || e?.message || 'Не удалось разобрать запись'
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
    await $fetch(`/api/characters/${props.characterId}/source-clips/${clip.id}`, {
      method: 'DELETE',
    })
    await refresh()
  } catch (e: any) {
    error.value = e?.data?.message || e?.message || 'Ошибка удаления исходника'
  } finally {
    deletingId.value = null
  }
}
</script>

<template>
  <div class="space-y-4">
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
      <input v-model="outfit" class="input input-sm w-full" placeholder="Одежда, например белая рубашка">
      <input v-model="background" class="input input-sm w-full" placeholder="Фон, например светлая студия">
      <input v-model="gesture" class="input input-sm w-full" placeholder="Жесты, например активно руками">
      <input v-model="tagsInput" class="input input-sm w-full" placeholder="Теги через запятую">
    </div>

    <div
      class="border-2 border-dashed rounded-lg p-5 transition-colors cursor-pointer"
      :class="dragOver ? 'border-primary bg-primary/5' : 'border-base-300 hover:border-base-content/40'"
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
          :name="uploading ? 'mingcute:loading-3-line' : 'mingcute:video-upload-line'"
          class="size-7 text-base-content/50"
          :class="{ 'animate-spin': uploading }"
        />
        <span class="text-sm font-medium">
          {{ uploading ? 'Проверяю и загружаю…' : 'Добавить talking-head исходники' }}
        </span>
        <span class="text-xs text-base-content/50">
          MP4, MOV или WebM, каждый фрагмент 2–10 секунд и до 100 MB. Lip-sync берёт наименее использованные клипы.
        </span>
      </div>
    </div>

    <div class="rounded-lg border border-base-300 p-4 space-y-2">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div class="text-sm font-medium">Длинная запись целиком</div>
          <div class="text-xs text-base-content/50">
            Разметим сцены, нарежем на фрагменты 2–10 секунд и выбросим похожие.
          </div>
        </div>
        <button type="button" class="btn btn-sm btn-primary" :disabled="ingesting" @click="recordingInput?.click()">
          <Icon
            :name="ingesting ? 'mingcute:loading-3-line' : 'mingcute:scissors-line'"
            :class="{ 'animate-spin': ingesting }"
          />
          {{ ingesting ? 'Разбираю запись…' : 'Загрузить и нарезать' }}
        </button>
      </div>
      <input
        ref="recordingInput"
        type="file"
        accept="video/mp4,video/quicktime,video/webm"
        class="hidden"
        @change="onRecordingChange"
      >
      <div v-if="ingestReport" class="text-xs text-base-content/70">
        Принято фрагментов: {{ ingestReport.accepted }}.
        <span v-if="ingestReport.duplicates"> Похожих отброшено: {{ ingestReport.duplicates }}.</span>
        <span v-if="ingestReport.errors"> С ошибкой: {{ ingestReport.errors }}.</span>
      </div>
    </div>

    <div v-if="error" role="alert" class="alert alert-error alert-soft text-sm py-2">
      <Icon name="mingcute:warning-line" />
      <span>{{ error }}</span>
    </div>

    <div v-if="pending" class="flex justify-center py-6">
      <span class="loading loading-spinner" />
    </div>
    <div v-else-if="clips.length" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      <article v-for="clip in clips" :key="clip.id" class="rounded-lg border border-base-300 overflow-hidden bg-base-100">
        <video :src="clip.fileUrl" muted playsinline controls preload="metadata" class="w-full aspect-[9/16] max-h-64 object-cover bg-black" />
        <div class="p-2 space-y-1.5 text-xs">
          <div class="flex items-center justify-between gap-2">
            <span class="font-medium truncate" :title="clip.name || undefined">{{ clip.name || 'Исходник' }}</span>
            <button
              type="button"
              class="btn btn-ghost btn-xs text-error"
              :disabled="deletingId === clip.id"
              title="Убрать из ротации"
              @click="deactivateClip(clip)"
            >
              <Icon :name="deletingId === clip.id ? 'mingcute:loading-3-line' : 'mingcute:delete-2-line'" :class="{ 'animate-spin': deletingId === clip.id }" />
            </button>
          </div>
          <div class="text-base-content/60">
            {{ clip.durationSec.toFixed(1) }} сек · {{ formatBytes(clip.bytes) }} · использован {{ clip.usageCount }} раз
          </div>
          <div v-if="clip.tags.length" class="flex flex-wrap gap-1">
            <span v-for="tag in clip.tags.slice(0, 5)" :key="tag" class="badge badge-xs badge-ghost">{{ tag }}</span>
          </div>
        </div>
      </article>
    </div>
    <div v-else class="text-sm text-base-content/60 text-center py-4">
      Исходников пока нет. Без них pipeline использует сгенерированный клип как запасной вариант.
    </div>
  </div>
</template>
