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
  <div class="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
    <div class="flex flex-wrap items-center gap-2">
      <span
        class="rounded-sm border px-1.5 text-micro"
        :class="item.app ? 'border-accent-border bg-accent-bg text-accent-text' : 'border-border bg-panel text-subtle'"
      >
        {{ item.app?.name ?? 'Универсальный' }}
      </span>
      <span class="flex-1" />
      <span class="tnum flex items-center gap-1 font-mono text-micro text-subtle" title="Сколько раз использован">
        <Icon name="mingcute:fire-line" />
        {{ item.usageCount }}
      </span>
      <span class="tnum font-mono text-micro text-subtle">{{ formattedDate }}</span>
    </div>

    <p class="text-sm whitespace-pre-line text-muted">{{ preview }}</p>

    <!-- Разбор паттерна моделью: четыре свойства кадра, по которым промт ищут -->
    <div v-if="analysisStatus === 'ready' && item.aiPatternAnalysis" class="flex flex-wrap gap-1">
      <span
        v-for="chip in [
          { title: `Камера: ${item.aiPatternAnalysis.camera}`, text: truncate(item.aiPatternAnalysis.camera, 18) },
          { title: `Свет: ${item.aiPatternAnalysis.lighting}`, text: truncate(item.aiPatternAnalysis.lighting, 18) },
          { title: `Настроение: ${item.aiPatternAnalysis.mood}`, text: truncate(item.aiPatternAnalysis.mood, 18) },
          { title: `Интенсивность движения: ${item.aiPatternAnalysis.motionIntensity}`, text: `движение ${item.aiPatternAnalysis.motionIntensity}` },
        ]"
        :key="chip.title"
        :title="chip.title"
        class="rounded-sm border border-info-border bg-info-bg px-1.5 text-micro text-info"
      >
        {{ chip.text }}
      </span>
    </div>

    <p v-else-if="analysisStatus === 'pending'" class="flex items-center gap-1.5 text-sm text-subtle">
      <Icon name="mingcute:loading-line" class="animate-spin" />
      Модель разбирает паттерн
    </p>

    <div v-else-if="analysisStatus === 'failed'" class="flex flex-wrap items-center gap-1.5 text-sm text-danger">
      <span :title="item.aiAnalysisError ?? 'Причина неизвестна'">Разбор не удался</span>
      <UiButton variant="ghost" :loading="reanalysisPending" @click="onReanalyze">Повторить</UiButton>
    </div>

    <p v-if="reanalyzeError" class="text-micro text-danger">{{ reanalyzeError }}</p>

    <div v-if="item.tags.length" class="flex flex-wrap gap-1">
      <span
        v-for="t in item.tags"
        :key="t"
        class="rounded-sm border border-border bg-panel px-1.5 text-micro text-subtle"
      >
        {{ t }}
      </span>
    </div>

    <p v-if="item.notes" class="rounded-sm bg-surface p-1.5 text-micro text-subtle">{{ item.notes }}</p>

    <div class="flex flex-wrap items-center justify-end gap-1">
      <NuxtLink v-if="sourceVideoId" :to="`/videos/${sourceVideoId}`" class="mr-auto">
        <UiButton variant="ghost">
          <Icon name="mingcute:link-2-line" />
          К источнику
        </UiButton>
      </NuxtLink>
      <span v-else class="mr-auto text-micro text-subtle">источник не указан</span>

      <UiButton
        v-if="analysisStatus === 'ready'"
        icon-only
        variant="ghost"
        :loading="reanalysisPending"
        aria-label="Разобрать паттерн заново"
        @click="onReanalyze"
      >
        <Icon v-if="!reanalysisPending" name="mingcute:refresh-3-line" />
      </UiButton>
      <UiButton variant="ghost" @click="emit('edit', item.id)">Изменить</UiButton>
      <UiButton variant="ghost" class="text-danger" @click="emit('delete', item.id)">Удалить</UiButton>
    </div>
  </div>
</template>
