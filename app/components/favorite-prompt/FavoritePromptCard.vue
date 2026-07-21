<script setup lang="ts">
import type { FavoritePrompt } from '~~/shared/types/favorite-prompt'

const props = defineProps<{
  item: FavoritePrompt
}>()

const emit = defineEmits<{
  edit: [id: number]
  delete: [id: number]
  reanalyzed: [id: number]
}>()

const previewLimit = 280

const preview = computed(() => {
  const t = props.item.promptText
  if (t.length <= previewLimit) return t
  return `${t.slice(0, previewLimit)}…`
})

const sourceVideoId = computed(() => props.item.sourceVideoAsset?.video?.id ?? null)

const formattedDate = computed(() => {
  try {
    return new Date(props.item.createdAt).toLocaleDateString('ru')
  } catch {
    return props.item.createdAt
  }
})

// 'ready' — есть aiPatternAnalysis и aiAnalyzedAt.
// 'failed' — attempts >=3 без результата.
// 'pending' — анализ ещё идёт (только что создали или background-extraction в процессе).
type AnalysisStatus = 'ready' | 'pending' | 'failed'
const analysisStatus = computed<AnalysisStatus>(() => {
  if (props.item.aiAnalyzedAt && props.item.aiPatternAnalysis) return 'ready'
  if (props.item.aiAnalysisAttempts >= 3) return 'failed'
  return 'pending'
})

function truncate(s: string | null | undefined, n: number): string {
  if (!s) return ''
  return s.length > n ? `${s.slice(0, n)}…` : s
}

const reanalysisPending = ref(false)
const reanalyzeError = ref<string | null>(null)
const { reanalyzeFavoritePrompt } = useFavoritePromptActions()

async function onReanalyze() {
  if (reanalysisPending.value) return
  reanalysisPending.value = true
  reanalyzeError.value = null
  try {
    await reanalyzeFavoritePrompt(props.item.id)
    emit('reanalyzed', props.item.id)
  }
  catch (e: unknown) {
    const err = e as { data?: { message?: string }, message?: string }
    reanalyzeError.value = err?.data?.message || err?.message || 'Не удалось проанализировать'
  }
  finally {
    reanalysisPending.value = false
  }
}
</script>

<template>
  <div class="card bg-base-100 border border-base-300 shadow-sm">
    <div class="card-body p-4 gap-2">
      <!-- Заголовок: badge приложения + usageCount -->
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <span
          class="badge badge-sm"
          :class="item.app ? 'badge-primary' : 'badge-ghost'"
        >
          <Icon
            :name="item.app ? 'mingcute:apps-line' : 'mingcute:global-line'"
            class="text-xs"
          />
          {{ item.app?.name ?? 'Универсальный' }}
        </span>
        <div class="flex items-center gap-2 text-xs text-base-content/60">
          <span class="inline-flex items-center gap-1" :title="`Использовано ${item.usageCount} раз`">
            <Icon name="mingcute:fire-line" class="text-xs" />
            {{ item.usageCount }}
          </span>
          <span :title="formattedDate">{{ formattedDate }}</span>
        </div>
      </div>

      <!-- Превью промта -->
      <p class="text-xs text-base-content/80 whitespace-pre-line">{{ preview }}</p>

      <!-- AI Pattern: status + badges -->
      <div
        v-if="analysisStatus === 'ready' && item.aiPatternAnalysis"
        class="flex flex-wrap gap-1"
      >
        <span class="badge badge-info badge-xs gap-1" :title="`Камера: ${item.aiPatternAnalysis.camera}`">
          <Icon name="mingcute:camera-line" class="text-[9px]" />
          {{ truncate(item.aiPatternAnalysis.camera, 18) }}
        </span>
        <span class="badge badge-info badge-xs gap-1" :title="`Свет: ${item.aiPatternAnalysis.lighting}`">
          <Icon name="mingcute:light-line" class="text-[9px]" />
          {{ truncate(item.aiPatternAnalysis.lighting, 18) }}
        </span>
        <span class="badge badge-info badge-xs gap-1" :title="`Настроение: ${item.aiPatternAnalysis.mood}`">
          <Icon name="mingcute:emoji-line" class="text-[9px]" />
          {{ truncate(item.aiPatternAnalysis.mood, 18) }}
        </span>
        <span class="badge badge-info badge-xs" :title="`Интенсивность движения: ${item.aiPatternAnalysis.motionIntensity}`">
          intensity {{ item.aiPatternAnalysis.motionIntensity }}
        </span>
      </div>
      <div
        v-else-if="analysisStatus === 'pending'"
        class="flex items-center gap-1 text-xs text-base-content/50"
      >
        <span class="loading loading-spinner loading-xs" />
        <span>AI анализирует паттерн…</span>
      </div>
      <div
        v-else-if="analysisStatus === 'failed'"
        class="flex items-center gap-1 text-xs text-error flex-wrap"
      >
        <Icon name="mingcute:warning-line" class="text-xs" />
        <span :title="item.aiAnalysisError ?? 'Не удалось проанализировать'">Анализ не удался</span>
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          :disabled="reanalysisPending"
          @click="onReanalyze"
        >
          <span v-if="reanalysisPending" class="loading loading-spinner loading-xs" />
          <span v-else>Повторить</span>
        </button>
      </div>

      <!-- Reanalyze error -->
      <div v-if="reanalyzeError" class="text-[10px] text-error">
        {{ reanalyzeError }}
      </div>

      <!-- Теги -->
      <div v-if="item.tags.length > 0" class="flex flex-wrap gap-1">
        <span
          v-for="t in item.tags"
          :key="t"
          class="badge badge-outline badge-xs"
        >
          {{ t }}
        </span>
      </div>

      <!-- Заметки -->
      <div v-if="item.notes" class="text-[10px] text-base-content/50 italic bg-base-200/50 rounded p-1.5">
        {{ item.notes }}
      </div>

      <!-- Действия -->
      <div class="card-actions justify-end gap-1 pt-1">
        <NuxtLink
          v-if="sourceVideoId"
          :to="`/videos/${sourceVideoId}`"
          class="btn btn-ghost btn-xs"
          title="К исходному видео"
        >
          <Icon name="mingcute:link-2-line" class="text-xs" />
          К источнику
        </NuxtLink>
        <span
          v-else
          class="badge badge-ghost badge-xs"
          title="Источник не указан"
        >
          без источника
        </span>
        <button
          v-if="analysisStatus === 'ready'"
          type="button"
          class="btn btn-ghost btn-xs"
          :disabled="reanalysisPending"
          title="Перезапустить AI-анализ паттерна"
          @click="onReanalyze"
        >
          <Icon
            name="mingcute:refresh-3-line"
            class="text-xs"
            :class="reanalysisPending ? 'animate-spin' : ''"
          />
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          @click="emit('edit', item.id)"
        >
          <Icon name="mingcute:edit-2-line" class="text-xs" />
          Изменить
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-xs text-error"
          @click="emit('delete', item.id)"
        >
          <Icon name="mingcute:delete-2-line" class="text-xs" />
          Удалить
        </button>
      </div>
    </div>
  </div>
</template>
