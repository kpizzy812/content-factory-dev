<script setup lang="ts">
import type { VariantQualityScore, CriticReviewRecord } from '~~/shared/types/scenario'

const props = defineProps<{
  open: boolean
  /** Скоринг текущего варианта (qualityScoreDetails). */
  details: VariantQualityScore | null
  /** История прогонов критика по сценарию. */
  history?: CriticReviewRecord[]
  variantTitle?: string | null
}>()

const emit = defineEmits<{ close: [] }>()

type TabKey = 'criteria' | 'strengths' | 'weaknesses' | 'suggestions' | 'history'

const tab = ref<TabKey>('criteria')

const tabs = computed(() => {
  const list: Array<{ key: TabKey, label: string }> = [
    { key: 'criteria', label: 'По критериям' },
    { key: 'strengths', label: 'Сильные' },
    { key: 'weaknesses', label: 'Слабые' },
    { key: 'suggestions', label: 'Что править' },
  ]
  if (props.history?.length) list.push({ key: 'history', label: 'История' })
  return list
})

const criteriaList = computed(() => {
  if (!props.details) return []
  const s = props.details.scores
  return [
    { key: 'hookStrength', label: 'Сила хука', value: s.hookStrength },
    { key: 'emotionalArc', label: 'Эмоциональная дуга', value: s.emotionalArc },
    { key: 'appIntegration', label: 'Интеграция приложения', value: s.appIntegration },
    { key: 'visualClarity', label: 'Визуальная читаемость', value: s.visualClarity },
    { key: 'ctaPower', label: 'Сила CTA', value: s.ctaPower },
    { key: 'viralPotential', label: 'Вирусный потенциал', value: s.viralPotential },
  ]
})

const VERDICT: Record<string, { label: string, tone: string }> = {
  pass: { label: 'Прошёл', tone: 'border-success-border bg-success-bg text-success' },
  pass_with_notes: { label: 'Прошёл с замечаниями', tone: 'border-warning-border bg-warning-bg text-warning' },
  rework: { label: 'Нужна доработка', tone: 'border-warning-border bg-warning-bg text-warning' },
  reject: { label: 'Отклонён', tone: 'border-danger-border bg-danger-bg text-danger' },
}

function barTone(value: number) {
  if (value >= 8) return 'bg-success'
  if (value >= 6) return 'bg-warning'
  return 'bg-danger'
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ru-RU')
  }
  catch {
    return iso
  }
}

const activeList = computed(() => {
  const d = props.details
  if (!d) return []
  if (tab.value === 'strengths') return d.strengths
  if (tab.value === 'weaknesses') return d.weaknesses
  if (tab.value === 'suggestions') return d.reworkSuggestions
  return []
})
</script>

<template>
  <UiModal :open="open" size="lg" @close="emit('close')">
    <template #header>
      <span class="flex flex-wrap items-center gap-2">
        <Icon name="mingcute:medal-line" />
        Отчёт критика
        <span v-if="variantTitle" class="truncate text-sm font-normal text-muted">{{ variantTitle }}</span>
      </span>
    </template>

    <div v-if="!details" class="flex items-start gap-2 rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-muted">
      <Icon name="mingcute:information-line" class="mt-0.5 shrink-0" />
      <span>Этот вариант ещё не оценён критиком.</span>
    </div>

    <template v-else>
      <div class="mb-3 flex flex-wrap items-center gap-2">
        <ScenarioCriticBadge :score="details.totalScore" />
        <span
          class="rounded-sm border px-2 py-0.5 text-sm"
          :class="VERDICT[details.verdict]?.tone ?? 'border-divider text-muted'"
        >
          {{ VERDICT[details.verdict]?.label ?? details.verdict }}
        </span>
      </div>

      <div role="tablist" class="mb-3 flex flex-wrap gap-0.5 border-b border-border">
        <button
          v-for="t in tabs"
          :key="t.key"
          type="button"
          role="tab"
          :aria-selected="tab === t.key"
          class="h-[30px] cursor-pointer border-b-2 px-2.5 text-sm"
          :class="tab === t.key ? 'border-accent font-medium text-fg' : 'border-transparent text-muted hover:text-fg'"
          @click="tab = t.key"
        >
          {{ t.label }}
        </button>
      </div>

      <!-- По критериям -->
      <div v-if="tab === 'criteria'" class="flex flex-col gap-1.5">
        <div v-for="c in criteriaList" :key="c.key" class="flex items-center gap-3">
          <span class="flex-1 truncate text-sm text-muted">{{ c.label }}</span>
          <span class="h-[5px] w-32 overflow-hidden rounded-full bg-neutral-bg">
            <span class="block h-full" :class="barTone(c.value)" :style="{ width: `${c.value * 10}%` }" />
          </span>
          <span class="tnum w-11 text-right font-mono text-sm">{{ c.value }}/10</span>
        </div>
      </div>

      <!-- История -->
      <div v-else-if="tab === 'history' && history" class="flex flex-col gap-2">
        <div
          v-for="r in history"
          :key="r.id"
          class="rounded-md border border-border bg-card p-2.5"
        >
          <div class="flex flex-wrap items-center gap-2">
            <span class="tnum rounded-sm border border-divider px-1.5 py-0.5 font-mono text-micro text-muted">
              итерация {{ r.iteration }}
            </span>
            <ScenarioCriticBadge :score="r.averageScore" size="xs" />
            <span
              class="rounded-sm border px-1.5 py-0.5 text-micro"
              :class="r.reachedThreshold
                ? 'border-success-border bg-success-bg text-success'
                : 'border-warning-border bg-warning-bg text-warning'"
            >
              {{ r.reachedThreshold ? 'порог пройден' : 'ниже порога' }}
            </span>
            <span class="tnum ml-auto font-mono text-micro text-subtle">{{ fmtDate(r.createdAt) }}</span>
          </div>
          <p class="tnum mt-1 font-mono text-micro text-subtle">
            вариантов {{ r.variantsReviewed }} · средний {{ Math.round(r.averageScore) }}/100 ·
            {{ Math.round(r.durationMs / 1000) }} с
          </p>
        </div>
      </div>

      <!-- Списки: сильные, слабые, правки -->
      <template v-else>
        <ul v-if="activeList.length" class="flex flex-col gap-1">
          <li v-for="(s, i) in activeList" :key="i" class="flex gap-2 text-sm">
            <span class="text-subtle">·</span>
            <span>{{ s }}</span>
          </li>
        </ul>
        <p v-else class="text-sm text-subtle">
          {{ tab === 'suggestions' ? 'Правки не требуются' : 'Нет данных' }}
        </p>
      </template>
    </template>

    <template #footer>
      <UiButton @click="emit('close')">Закрыть</UiButton>
    </template>
  </UiModal>
</template>
