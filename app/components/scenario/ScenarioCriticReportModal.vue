<script setup lang="ts">
import type { VariantQualityScore, CriticReviewRecord } from '~~/shared/types/scenario'

const props = defineProps<{
  /** Открыта ли модалка */
  open: boolean
  /** Детали скоринга текущего variant'а (qualityScoreDetails) */
  details: VariantQualityScore | null
  /** История ревью сценария — опционально, для вкладки «История итераций» */
  history?: CriticReviewRecord[]
  /** Заголовок (название варианта) */
  variantTitle?: string | null
}>()

const emit = defineEmits<{
  close: []
}>()

type TabKey = 'criteria' | 'strengths' | 'weaknesses' | 'suggestions' | 'history'

const activeTab = ref<TabKey>('criteria')

const dialogRef = ref<HTMLDialogElement | null>(null)

watch(() => props.open, (isOpen) => {
  const dlg = dialogRef.value
  if (!dlg) return
  if (isOpen && !dlg.open) dlg.showModal()
  else if (!isOpen && dlg.open) dlg.close()
})

function onDialogClose() {
  emit('close')
}

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

const verdictLabel = computed(() => {
  if (!props.details) return ''
  switch (props.details.verdict) {
    case 'pass': return 'Прошёл'
    case 'pass_with_notes': return 'Прошёл с замечаниями'
    case 'rework': return 'Нужна доработка'
    case 'reject': return 'Отклонён'
    default: return props.details.verdict
  }
})

const verdictBadgeClass = computed(() => {
  if (!props.details) return 'badge-ghost'
  switch (props.details.verdict) {
    case 'pass': return 'badge-success'
    case 'pass_with_notes': return 'badge-warning'
    case 'rework': return 'badge-warning'
    case 'reject': return 'badge-error'
    default: return 'badge-ghost'
  }
})

function tabButtonClass(tab: TabKey): string {
  return tab === activeTab.value ? 'tab tab-active' : 'tab'
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ru-RU')
  } catch {
    return iso
  }
}
</script>

<template>
  <dialog ref="dialogRef" class="modal" @close="onDialogClose">
    <div class="modal-box max-w-2xl">
      <form method="dialog">
        <button class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2" aria-label="Закрыть">
          <Icon name="mingcute:close-line" />
        </button>
      </form>

      <header class="space-y-2 mb-3">
        <h3 class="text-lg font-bold flex items-center gap-2 flex-wrap">
          <Icon name="mingcute:medal-line" class="text-xl" />
          Отчёт критика
          <span v-if="variantTitle" class="text-sm font-normal text-base-content/60 truncate">
            — {{ variantTitle }}
          </span>
        </h3>
        <div v-if="details" class="flex items-center gap-2 flex-wrap">
          <ScenarioCriticBadge :score="details.totalScore" size="md" />
          <span class="badge" :class="verdictBadgeClass">{{ verdictLabel }}</span>
        </div>
      </header>

      <div v-if="!details" class="alert">
        <Icon name="mingcute:information-line" />
        <span>Этот вариант ещё не оценён критиком.</span>
      </div>

      <template v-else>
        <div role="tablist" class="tabs tabs-border mb-3">
          <button role="tab" :class="tabButtonClass('criteria')" @click="activeTab = 'criteria'">
            По критериям
          </button>
          <button role="tab" :class="tabButtonClass('strengths')" @click="activeTab = 'strengths'">
            Сильные
          </button>
          <button role="tab" :class="tabButtonClass('weaknesses')" @click="activeTab = 'weaknesses'">
            Слабые
          </button>
          <button role="tab" :class="tabButtonClass('suggestions')" @click="activeTab = 'suggestions'">
            Suggestions
          </button>
          <button v-if="history && history.length > 0" role="tab" :class="tabButtonClass('history')" @click="activeTab = 'history'">
            История
          </button>
        </div>

        <!-- По критериям -->
        <div v-if="activeTab === 'criteria'" class="space-y-2">
          <div
            v-for="c in criteriaList"
            :key="c.key"
            class="flex items-center gap-3"
          >
            <span class="text-sm text-base-content/80 flex-1 truncate">{{ c.label }}</span>
            <progress
              class="progress w-32"
              :class="c.value >= 8 ? 'progress-success' : c.value >= 6 ? 'progress-warning' : 'progress-error'"
              :value="c.value"
              max="10"
            />
            <span class="text-sm font-mono tabular-nums w-10 text-right">{{ c.value }}/10</span>
          </div>
        </div>

        <!-- Сильные -->
        <div v-else-if="activeTab === 'strengths'">
          <ul v-if="details.strengths.length > 0" class="list-disc list-inside space-y-1 text-sm">
            <li v-for="(s, i) in details.strengths" :key="i" class="text-base-content">{{ s }}</li>
          </ul>
          <p v-else class="text-sm text-base-content/50">Нет данных</p>
        </div>

        <!-- Слабые -->
        <div v-else-if="activeTab === 'weaknesses'">
          <ul v-if="details.weaknesses.length > 0" class="list-disc list-inside space-y-1 text-sm">
            <li v-for="(s, i) in details.weaknesses" :key="i" class="text-base-content">{{ s }}</li>
          </ul>
          <p v-else class="text-sm text-base-content/50">Нет данных</p>
        </div>

        <!-- Suggestions -->
        <div v-else-if="activeTab === 'suggestions'">
          <ul v-if="details.reworkSuggestions.length > 0" class="list-disc list-inside space-y-1 text-sm">
            <li v-for="(s, i) in details.reworkSuggestions" :key="i" class="text-base-content">{{ s }}</li>
          </ul>
          <p v-else class="text-sm text-base-content/50">Правки не требуются</p>
        </div>

        <!-- История -->
        <div v-else-if="activeTab === 'history' && history" class="space-y-2 max-h-72 overflow-y-auto">
          <div
            v-for="r in history"
            :key="r.id"
            class="rounded-box border border-base-300 p-3 space-y-1 text-sm"
          >
            <div class="flex items-center gap-2 flex-wrap">
              <span class="badge badge-ghost">Итерация {{ r.iteration }}</span>
              <ScenarioCriticBadge :score="r.averageScore" size="sm" />
              <span
                class="badge badge-sm"
                :class="r.reachedThreshold ? 'badge-success' : 'badge-warning'"
              >
                {{ r.reachedThreshold ? 'Порог пройден' : 'Ниже порога' }}
              </span>
              <span class="text-xs text-base-content/50 ml-auto">{{ fmtDate(r.createdAt) }}</span>
            </div>
            <p class="text-xs text-base-content/70">
              Вариантов: {{ r.variantsReviewed }} · средний балл: {{ Math.round(r.averageScore) }}/100 · ~{{ Math.round(r.durationMs / 1000) }}с
            </p>
          </div>
        </div>
      </template>

      <div class="modal-action">
        <form method="dialog">
          <button class="btn">Закрыть</button>
        </form>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button>close</button>
    </form>
  </dialog>
</template>
