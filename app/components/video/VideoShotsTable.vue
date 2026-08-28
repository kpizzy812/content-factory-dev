<script setup lang="ts">
import { formatMoney } from '~~/shared/utils/money'
import type { VideoGenerationStep } from '~~/shared/types/video'
import type { EditProfile, ShotFact } from '~~/shared/types/edit-console'
import {
  buildShotRows,
  readEditPlanShots,
  shotBackgroundLabel,
  shotStatusLabel,
  shotStatusTone,
  shotsAwaitingExecution,
  spentOnBackground,
} from './edit-console-model'
import { consoleErrorText, fetchShotFacts, rerenderShot } from './edit-console-api'

/**
 * Таблица кадров: что план просил, что получилось, во что обошлось.
 *
 * ПЛАН берётся из снапшота шага «План монтажа» — там лежат ровно те строки, что
 * записаны в `VideoShot`, вместе с идеей кадра и плановой стоимостью.
 * ФАКТ исполнения приезжает своей ручкой `GET /api/videos/:id/shots`
 * (`backgroundActual`, итоговый статус, причина деградации, путь к файлу).
 *
 * Два источника, а не один, потому что и вопроса два: «что заказали» и «что
 * получилось». Расхождение между ними — не сбой чтения, а ровно та информация,
 * ради которой таблица существует.
 *
 * Макет: design-preview/catalog/09-edit-console.dc.html (секция «Консоль»).
 */
const props = defineProps<{
  videoId: number
  steps: VideoGenerationStep[]
  profile?: EditProfile | null
  /** Готовый факт от родителя. Не передан — таблица берёт его сама. */
  facts?: ShotFact[]
  /** Пока прогон идёт, пересобирать кадры нечего. */
  active?: boolean
}>()

const emit = defineEmits<{ changed: [] }>()

const plan = computed(() => readEditPlanShots(props.steps))

// ─── Факт исполнения ─────────────────────────────────────────────────────────
const loadedFacts = ref<ShotFact[]>([])
const factsError = ref('')

const facts = computed(() => props.facts ?? loadedFacts.value)

/**
 * Отпечаток состояния исполнения. Перечитывать факт имеет смысл ровно тогда,
 * когда сдвинулся один из двух шагов, которые пишут в `VideoShot`: план создаёт
 * строки, фоны заполняют исполнение. Опрос прогресса тикает каждые 4 секунды, и
 * дёргать ручку кадров на каждый тик незачем.
 */
const executionSignature = computed(() => (props.steps ?? [])
  .filter(s => s.stepKey === 'edit_plan' || s.stepKey === 'shot_background')
  .map(s => `${s.stepKey}:${s.status}`)
  .join('|'))

async function loadFacts() {
  try {
    loadedFacts.value = await fetchShotFacts($fetch, props.videoId)
    factsError.value = ''
  }
  catch (e) {
    // Факт не приехал — таблица остаётся на плане и говорит об этом словами
    // сервера. Молча показать прочерки нельзя: их не отличить от «ещё не
    // исполнялось».
    factsError.value = consoleErrorText(e, 'Не удалось загрузить кадры')
  }
}

function reloadFacts() {
  // Факта от родителя достаточно; плана нет — и кадров в БД ещё нет.
  if (props.facts || !plan.value.available) return
  void loadFacts()
}

onMounted(reloadFacts)
watch([() => props.videoId, () => plan.value.available, executionSignature], reloadFacts)

const rows = computed(() => buildShotRows(plan.value.shots, facts.value))

/** Строки кадров есть, но фоны по ним ещё не снимались — это не ошибка. */
const awaitingExecution = computed(() => shotsAwaitingExecution(facts.value))
const degradedCount = computed(() => rows.value.filter(r => r.degraded).length)
const totalCost = computed(() => rows.value.reduce((sum, r) => sum + (r.costUsd || 0), 0))

const imageSpent = computed(() => spentOnBackground(rows.value, 'image'))
const videoSpent = computed(() => spentOnBackground(rows.value, 'video'))

/** Доля потолка. Потолок 0 или не задан — полосу не рисуем, а не делим на ноль. */
function budgetShare(spent: number, budget: number | undefined) {
  if (!budget || !Number.isFinite(budget) || budget <= 0) return null
  return Math.min(1, spent / budget)
}

const imageShare = computed(() => budgetShare(imageSpent.value, props.profile?.imageBudgetUsd))
const videoShare = computed(() => budgetShare(videoSpent.value, props.profile?.generativeVideoBudgetUsd))

const TONE_BADGE: Record<string, string> = {
  neutral: 'border-neutral-border bg-neutral-bg text-neutral',
  info: 'border-info-border bg-info-bg text-info',
  success: 'border-success-border bg-success-bg text-success',
  warning: 'border-warning-border bg-warning-bg text-warning',
  danger: 'border-danger-border bg-danger-bg text-danger',
}

function secs(value: number) {
  return value.toFixed(1).replace('.', ',')
}

// ─── Пересборка одного кадра ─────────────────────────────────────────────────
const confirmOrder = ref<number | null>(null)
const busyOrder = ref<number | null>(null)
const error = ref('')

const toast = useToast()

const confirmRow = computed(() => rows.value.find(r => r.order === confirmOrder.value) ?? null)

async function onRerender(order: number, paid: boolean) {
  // Бесплатная пересборка идёт сразу, платная сначала называет сумму: цена
  // решения должна быть видна до нажатия, а не после.
  if (paid) {
    confirmOrder.value = order
    return
  }
  await runRerender(order)
}

async function runRerender(order: number) {
  confirmOrder.value = null
  busyOrder.value = order
  error.value = ''
  try {
    await rerenderShot($fetch, props.videoId, order)
    toast.success(`Кадр ${order} отправлен на пересборку`)
    // Кадр сброшен в план прямо сейчас — факт в таблице устарел раньше, чем
    // приедет следующий тик опроса прогресса.
    reloadFacts()
    emit('changed')
  }
  catch (e) {
    error.value = consoleErrorText(e, 'Не удалось перегенерировать кадр')
  }
  finally {
    busyOrder.value = null
  }
}
</script>

<template>
  <section class="overflow-hidden rounded-lg border border-border bg-panel">
    <header class="flex flex-wrap items-center gap-2.5 border-b border-border px-3 py-2.5">
      <h2 class="text-base font-semibold">План монтажа</h2>
      <span
        v-if="plan.available"
        class="tnum inline-flex h-5 items-center rounded-sm border border-border bg-card px-1.5 font-mono text-micro text-muted"
      >
        {{ rows.length }} кадров
      </span>
      <span
        v-if="degradedCount"
        class="inline-flex h-5 items-center gap-1 rounded-sm border border-warning-border bg-warning-bg px-1.5 text-micro text-warning"
      >
        <Icon name="mingcute:alert-line" />
        {{ degradedCount }} деградировали
      </span>
      <span class="flex-1" />
      <span v-if="totalCost > 0" class="tnum font-mono text-sm text-muted">{{ formatMoney(totalCost) }}</span>
    </header>

    <UiEmptyState
      v-if="!plan.available"
      icon="mingcute:layout-line"
      title="Кадры появятся после шага «План монтажа»"
      description="Ролик собирается от звука: сначала трек и транскрипция, потом раскадровка. До этого шага показывать нечего."
      class="m-3.5"
    />

    <template v-else>
      <div
        v-if="factsError"
        role="alert"
        class="flex items-start gap-2 border-b border-divider bg-danger-bg px-3 py-2 text-micro text-danger"
      >
        <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
        <span>Не удалось загрузить кадры: {{ factsError }}. Показан план монтажа без факта исполнения.</span>
      </div>

      <div
        v-else-if="awaitingExecution"
        class="flex items-start gap-2 border-b border-divider bg-card px-3 py-2 text-micro text-subtle"
      >
        <Icon name="mingcute:information-line" class="mt-0.5 shrink-0" />
        <span>
          Кадры запланированы, но фоны по ним ещё не снимались — колонка «факт» заполнится
          после шага «Фоны кадров». Прочерк здесь означает «ещё не дошли», а не «не получилось».
        </span>
      </div>

      <div class="overflow-x-auto">
        <div class="min-w-[860px]">
          <div
            class="grid h-8 grid-cols-[34px_minmax(220px,1fr)_88px_88px_92px_120px_56px] items-center gap-2 border-b border-border bg-card px-3 text-micro tracking-[.06em] text-subtle uppercase"
          >
            <span>#</span>
            <span>Кадр и смысл</span>
            <span>Фон · план</span>
            <span>Фон · факт</span>
            <span class="text-right">Стоимость</span>
            <span>Статус</span>
            <span class="text-right">Ещё раз</span>
          </div>

          <div
            v-for="row in rows"
            :key="row.order"
            class="border-b border-divider last:border-b-0"
            :class="row.degraded ? 'bg-warning-bg' : 'hover:bg-card'"
          >
            <div class="grid h-11 grid-cols-[34px_minmax(220px,1fr)_88px_88px_92px_120px_56px] items-center gap-2 px-3">
              <span class="tnum font-mono text-sm text-subtle">{{ row.order }}</span>

              <span class="min-w-0">
                <span class="block truncate text-sm">{{ row.idea ?? 'Кадр без описания' }}</span>
                <span class="tnum block font-mono text-micro text-subtle">
                  {{ secs(row.startSec) }} – {{ secs(row.endSec) }}
                  · {{ row.sceneOrder != null ? `сцена ${row.sceneOrder}` : 'перебивка' }}
                  <template v-if="row.withPresenter"> · ведущий</template>
                  <template v-if="row.pipEnabled"> · картинка в углу</template>
                </span>
              </span>

              <span class="truncate text-micro text-muted">{{ shotBackgroundLabel(row.background) }}</span>
              <span
                class="truncate text-micro"
                :class="row.degraded ? 'text-warning' : 'text-fg'"
              >{{ shotBackgroundLabel(row.backgroundActual) }}</span>

              <span class="tnum text-right font-mono text-sm" :class="row.costUsd > 0 ? 'text-fg' : 'text-subtle'">
                {{ row.costUsd > 0 ? formatMoney(row.costUsd) : '—' }}
              </span>

              <span>
                <span
                  class="inline-flex h-5 items-center gap-1 rounded-sm border px-1.5 text-micro whitespace-nowrap"
                  :class="TONE_BADGE[shotStatusTone(row.status, row.degraded)]"
                >
                  {{ row.degraded ? 'Деградировал' : shotStatusLabel(row.status) }}
                </span>
              </span>

              <span class="flex justify-end">
                <UiButton
                  v-if="!active"
                  icon-only
                  :variant="row.rerenderPaid ? 'secondary' : 'ghost'"
                  :loading="busyOrder === row.order"
                  :aria-label="row.rerenderPaid
                    ? `Пересобрать кадр ${row.order} — обратится к платной модели`
                    : `Пересобрать кадр ${row.order} — бесплатно`"
                  :class="row.rerenderPaid ? 'border-warning-border bg-warning-bg text-warning' : ''"
                  @click="onRerender(row.order, row.rerenderPaid)"
                >
                  <Icon name="mingcute:refresh-2-line" />
                </UiButton>
              </span>
            </div>

            <p
              v-if="row.degradeReason"
              class="flex items-start gap-1.5 px-3 pb-2 pl-[52px] text-micro leading-relaxed text-warning"
            >
              <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
              <span>{{ row.degradeReason }}</span>
            </p>
          </div>
        </div>
      </div>

      <div
        v-if="plan.warnings.length"
        class="flex flex-col gap-1 border-t border-divider bg-card px-3 py-2 text-micro text-muted"
      >
        <span v-for="(warning, i) in plan.warnings" :key="i">{{ warning }}</span>
      </div>

      <!-- Потолки видно ровно там, где видно их последствия. -->
      <footer
        v-if="profile"
        class="flex flex-wrap items-center gap-4 border-t border-border bg-card px-3 py-2"
      >
        <div class="flex min-w-[220px] flex-1 items-center gap-2">
          <span class="text-micro whitespace-nowrap text-muted">Картинки</span>
          <span class="relative h-1.5 flex-1 overflow-hidden rounded-full bg-surface">
            <span
              class="absolute inset-y-0 left-0"
              :class="imageShare != null && imageShare >= 1 ? 'bg-warning' : 'bg-accent'"
              :style="{ width: `${(imageShare ?? 0) * 100}%` }"
            />
          </span>
          <span class="tnum font-mono text-micro whitespace-nowrap text-muted">
            {{ formatMoney(imageSpent) }} / {{ formatMoney(profile.imageBudgetUsd) }}
          </span>
        </div>
        <div class="flex min-w-[220px] flex-1 items-center gap-2">
          <span class="text-micro whitespace-nowrap text-muted">Генеративное видео</span>
          <span class="relative h-1.5 flex-1 overflow-hidden rounded-full bg-surface">
            <span
              class="absolute inset-y-0 left-0"
              :class="videoShare != null && videoShare >= 1 ? 'bg-warning' : 'bg-accent'"
              :style="{ width: `${(videoShare ?? 0) * 100}%` }"
            />
          </span>
          <span class="tnum font-mono text-micro whitespace-nowrap text-muted">
            {{ formatMoney(videoSpent) }} / {{ formatMoney(profile.generativeVideoBudgetUsd) }}
          </span>
        </div>
      </footer>
    </template>

    <p
      v-if="error"
      role="alert"
      class="m-3.5 flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
    >
      <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
      {{ error }}
    </p>

    <UiModal
      :open="confirmOrder !== null"
      title="Пересобрать кадр платно?"
      size="sm"
      @close="confirmOrder = null"
    >
      <p class="text-sm text-muted">
        Кадр {{ confirmRow?.order }} просит фон источника «{{ shotBackgroundLabel(confirmRow?.background) }}» —
        пересборка снова обратится к платной модели и потратит потолок ролика.
      </p>
      <p v-if="confirmRow && confirmRow.costUsd > 0" class="tnum mt-2 font-mono text-base">
        в прошлый раз ~{{ formatMoney(confirmRow.costUsd) }}
      </p>
      <template #footer>
        <UiButton variant="ghost" @click="confirmOrder = null">Отмена</UiButton>
        <UiButton
          variant="primary"
          :loading="busyOrder !== null"
          @click="confirmOrder !== null && runRerender(confirmOrder)"
        >
          Пересобрать
        </UiButton>
      </template>
    </UiModal>
  </section>
</template>
