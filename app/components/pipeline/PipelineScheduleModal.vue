<script setup lang="ts">
const props = defineProps<{
  pipelineId: number
  visible: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const isLoading = ref(false)
const isSaving = ref(false)
const isDeleting = ref(false)
const enabled = ref(true)
const timezone = ref('Europe/Moscow')
const nextRunAt = ref<string | null>(null)
const lastRunAt = ref<string | null>(null)
const lastRunStatus = ref<string | null>(null)
const missedRunCount = ref(0)
const errorMsg = ref<string | null>(null)
const hasSchedule = ref(false)
const showAdvanced = ref(false)
const advancedCron = ref('')

// Удаление расписания необратимо — спрашиваем модалкой, а не confirm().
const deleteConfirmRef = ref<{ open: () => void, close: () => void, setBusy: (v: boolean) => void } | null>(null)

// --- Schedule mode ---
type ScheduleMode = 'daily' | 'weekly' | 'interval' | 'weekdays' | 'custom'
const scheduleMode = ref<ScheduleMode>('daily')

const MODE_TABS: Array<{ key: ScheduleMode, label: string }> = [
  { key: 'daily', label: 'Ежедневно' },
  { key: 'weekly', label: 'Еженедельно' },
  { key: 'interval', label: 'Интервал' },
  { key: 'weekdays', label: 'По дням' },
]

// --- Daily ---
const dailyHour = ref(9)
const dailyMinute = ref(0)

// --- Weekly ---
const weeklyDay = ref(1) // 0=Sun, 1=Mon...
const weeklyHour = ref(9)
const weeklyMinute = ref(0)

// --- Interval ---
const intervalValue = ref('h3')

// --- Weekdays ---
const selectedDays = ref<number[]>([1, 2, 3, 4, 5]) // Mon-Fri
const weekdaysHour = ref(10)
const weekdaysMinute = ref(0)

const timezones = [
  { value: 'UTC', label: 'UTC' },
  { value: 'Europe/Moscow', label: 'Москва (MSK)' },
  { value: 'Europe/Amsterdam', label: 'Амстердам (CET)' },
]

const dayNames = [
  { value: 0, short: 'Вс', full: 'Воскресенье' },
  { value: 1, short: 'Пн', full: 'Понедельник' },
  { value: 2, short: 'Вт', full: 'Вторник' },
  { value: 3, short: 'Ср', full: 'Среда' },
  { value: 4, short: 'Чт', full: 'Четверг' },
  { value: 5, short: 'Пт', full: 'Пятница' },
  { value: 6, short: 'Сб', full: 'Суббота' },
]

function pad(n: number) {
  return n.toString().padStart(2, '0')
}

const hourSelectOptions = Array.from({ length: 24 }, (_, i) => ({ value: i, label: pad(i) }))
const minuteSelectOptions = Array.from({ length: 60 }, (_, i) => ({ value: i, label: pad(i) }))

const intervalOptions = [
  { value: 'min5', label: 'Каждые 5 мин', cron: '*/5 * * * *' },
  { value: 'min10', label: 'Каждые 10 мин', cron: '*/10 * * * *' },
  { value: 'min15', label: 'Каждые 15 мин', cron: '*/15 * * * *' },
  { value: 'min30', label: 'Каждые 30 мин', cron: '*/30 * * * *' },
  { value: 'h1', label: 'Каждый час', cron: '0 */1 * * *' },
  { value: 'h2', label: 'Каждые 2 часа', cron: '0 */2 * * *' },
  { value: 'h3', label: 'Каждые 3 часа', cron: '0 */3 * * *' },
  { value: 'h4', label: 'Каждые 4 часа', cron: '0 */4 * * *' },
  { value: 'h6', label: 'Каждые 6 часов', cron: '0 */6 * * *' },
  { value: 'h8', label: 'Каждые 8 часов', cron: '0 */8 * * *' },
  { value: 'h12', label: 'Каждые 12 часов', cron: '0 */12 * * *' },
]

// --- Computed cron ---
const generatedCron = computed(() => {
  if (showAdvanced.value) return advancedCron.value.trim()

  switch (scheduleMode.value) {
    case 'daily':
      return `${dailyMinute.value} ${dailyHour.value} * * *`
    case 'weekly':
      return `${weeklyMinute.value} ${weeklyHour.value} * * ${weeklyDay.value}`
    case 'interval': {
      const opt = intervalOptions.find(o => o.value === intervalValue.value)
      return opt?.cron ?? '0 */3 * * *'
    }
    case 'weekdays': {
      if (selectedDays.value.length === 0) return ''
      const days = [...selectedDays.value].sort().join(',')
      return `${weekdaysMinute.value} ${weekdaysHour.value} * * ${days}`
    }
    case 'custom':
      return advancedCron.value.trim()
    default:
      return ''
  }
})

// --- Human-readable description ---
const humanDescription = computed(() => {
  if (!generatedCron.value) return 'Расписание не задано'

  if (showAdvanced.value || scheduleMode.value === 'custom') {
    return `Cron: ${generatedCron.value}`
  }

  switch (scheduleMode.value) {
    case 'daily':
      return `Каждый день в ${pad(dailyHour.value)}:${pad(dailyMinute.value)}`
    case 'weekly': {
      const dayName = dayNames.find(d => d.value === weeklyDay.value)?.full ?? ''
      return `Каждую неделю, ${dayName} в ${pad(weeklyHour.value)}:${pad(weeklyMinute.value)}`
    }
    case 'interval': {
      const opt = intervalOptions.find(o => o.value === intervalValue.value)
      return opt?.label ?? 'Интервал'
    }
    case 'weekdays': {
      if (selectedDays.value.length === 0) return 'Не выбраны дни'
      const names = [...selectedDays.value]
        .sort()
        .map(d => dayNames.find(n => n.value === d)?.short ?? '')
        .join(', ')
      return `${names} в ${pad(weekdaysHour.value)}:${pad(weekdaysMinute.value)}`
    }
    default:
      return ''
  }
})

function toggleDay(day: number) {
  const idx = selectedDays.value.indexOf(day)
  if (idx >= 0) {
    selectedDays.value.splice(idx, 1)
  } else {
    selectedDays.value.push(day)
  }
}

// --- Parse cron back to UI state ---
function parseCronToUI(cron: string) {
  if (!cron) return

  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) {
    showAdvanced.value = true
    advancedCron.value = cron
    return
  }

  const min = parts[0]!
  const hour = parts[1]!
  const _dom = parts[2]!
  const _mon = parts[3]!
  const dow = parts[4]!

  // Interval: */N * * * * (minute intervals) or 0 */N * * * (hour intervals)
  if (min.startsWith('*/') && hour === '*' && dow === '*') {
    const n = parseInt(min.slice(2))
    const key = `min${n}`
    if (intervalOptions.some(o => o.value === key)) {
      scheduleMode.value = 'interval'
      intervalValue.value = key
      return
    }
  }
  if (min === '0' && hour.startsWith('*/') && dow === '*') {
    const n = parseInt(hour.slice(2))
    const key = `h${n}`
    if (intervalOptions.some(o => o.value === key)) {
      scheduleMode.value = 'interval'
      intervalValue.value = key
      return
    }
  }

  // Daily: M H * * *
  if (dow === '*' && _dom === '*' && _mon === '*' && !hour.includes('/') && !min.includes('/')) {
    const h = parseInt(hour)
    const m = parseInt(min)
    if (!isNaN(h) && !isNaN(m) && h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      scheduleMode.value = 'daily'
      dailyHour.value = h
      dailyMinute.value = m
      return
    }
  }

  // Weekly: M H * * N (single day)
  if (_dom === '*' && _mon === '*' && /^\d$/.test(dow) && !hour.includes('/')) {
    const d = parseInt(dow)
    const h = parseInt(hour)
    const m = parseInt(min)
    if (!isNaN(d) && !isNaN(h) && !isNaN(m)) {
      scheduleMode.value = 'weekly'
      weeklyDay.value = d
      weeklyHour.value = h
      weeklyMinute.value = m
      return
    }
  }

  // Weekdays: M H * * 1,2,3... (multiple days)
  if (_dom === '*' && _mon === '*' && /^[\d,]+$/.test(dow) && dow.includes(',')) {
    const days = dow.split(',').map(Number).filter(n => !isNaN(n) && n >= 0 && n <= 6)
    const h = parseInt(hour)
    const m = parseInt(min)
    if (days.length > 0 && !isNaN(h) && !isNaN(m)) {
      scheduleMode.value = 'weekdays'
      selectedDays.value = days
      weekdaysHour.value = h
      weekdaysMinute.value = m
      return
    }
  }

  // Weekdays: M H * * 1-5 range
  if (_dom === '*' && _mon === '*' && /^\d-\d$/.test(dow)) {
    const rangeParts = dow.split('-').map(Number)
    const start = rangeParts[0] ?? NaN
    const end = rangeParts[1] ?? NaN
    if (!isNaN(start) && !isNaN(end)) {
      const days: number[] = []
      for (let i = start; i <= end; i++) days.push(i)
      const h = parseInt(hour)
      const m = parseInt(min)
      if (!isNaN(h) && !isNaN(m)) {
        scheduleMode.value = 'weekdays'
        selectedDays.value = days
        weekdaysHour.value = h
        weekdaysMinute.value = m
        return
      }
    }
  }

  // Fallback: advanced mode
  showAdvanced.value = true
  advancedCron.value = cron
}

// --- API ---
async function loadSchedule() {
  isLoading.value = true
  errorMsg.value = null
  try {
    const res = await $fetch<{ data: any }>(`/api/pipelines/${props.pipelineId}/schedule`)
    if (res.data) {
      enabled.value = res.data.enabled ?? true
      timezone.value = res.data.timezone ?? 'Europe/Moscow'
      nextRunAt.value = res.data.nextRunAt ?? null
      lastRunAt.value = res.data.lastRunAt ?? null
      lastRunStatus.value = res.data.lastRunStatus ?? null
      missedRunCount.value = res.data.missedRunCount ?? 0
      hasSchedule.value = true

      parseCronToUI(res.data.cronExpr ?? '')
    }
  } catch {
    hasSchedule.value = false
  } finally {
    isLoading.value = false
  }
}

async function saveSchedule() {
  const cron = generatedCron.value
  if (!cron) {
    errorMsg.value = 'Задайте расписание'
    return
  }
  isSaving.value = true
  errorMsg.value = null
  try {
    const res = await $fetch<{ data: any }>(`/api/pipelines/${props.pipelineId}/schedule`, {
      method: 'PUT',
      body: {
        cronExpr: cron,
        enabled: enabled.value,
        timezone: timezone.value,
      },
    })
    if (res.data) {
      nextRunAt.value = res.data.nextRunAt ?? null
      lastRunAt.value = res.data.lastRunAt ?? null
      hasSchedule.value = true
    }
    emit('close')
  } catch (e: any) {
    errorMsg.value = e?.data?.message || 'Ошибка сохранения расписания'
  } finally {
    isSaving.value = false
  }
}

async function deleteSchedule() {
  isDeleting.value = true
  deleteConfirmRef.value?.setBusy(true)
  try {
    await $fetch(`/api/pipelines/${props.pipelineId}/schedule`, { method: 'DELETE' })
    hasSchedule.value = false
    deleteConfirmRef.value?.close()
    emit('close')
  } catch {
    errorMsg.value = 'Ошибка удаления'
  } finally {
    isDeleting.value = false
    deleteConfirmRef.value?.setBusy(false)
  }
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleString('ru-RU')
}

// Тон из общего словаря, подписи доменные: у планировщика свои причины пропуска.
const lastRunStatusLabel = computed(() => {
  if (!lastRunStatus.value) return null
  const warn = 'border-warning-border bg-warning-bg text-warning'
  const map: Record<string, { label: string, tone: string }> = {
    triggered: { label: 'Запущен', tone: 'border-success-border bg-success-bg text-success' },
    no_data: { label: 'Нет данных', tone: warn },
    skipped_inactive: { label: 'Пропущен (неактивен)', tone: warn },
    skipped_empty: { label: 'Пропущен (нет блоков)', tone: warn },
    skipped_already_running: { label: 'Пропущен (уже запущен)', tone: warn },
  }
  if (lastRunStatus.value.startsWith('error:')) {
    return {
      label: `Ошибка: ${lastRunStatus.value.slice(7)}`,
      tone: 'border-danger-border bg-danger-bg text-danger',
    }
  }
  return map[lastRunStatus.value] ?? {
    label: lastRunStatus.value,
    tone: 'border-neutral-border bg-neutral-bg text-neutral',
  }
})

watch(() => props.visible, (v) => {
  if (v) {
    showAdvanced.value = false
    errorMsg.value = null
    loadSchedule()
  }
})

const DAY_BTN = 'h-7 flex-1 cursor-pointer rounded-sm text-sm font-medium transition-colors duration-(--duration-fast) ease-out'
</script>

<template>
  <UiModal :open="visible" @close="emit('close')">
    <template #header>
      <span class="flex items-center gap-2">
        <Icon name="mingcute:calendar-time-add-line" class="text-accent-text" />
        Расписание запуска
      </span>
    </template>

    <div class="flex flex-col gap-3">
      <p class="text-muted">
        Cron или интервал. Расписание можно отключить в любой момент.
      </p>

      <div v-if="isLoading" class="flex justify-center py-8 text-muted">
        <Icon name="mingcute:loading-line" class="animate-spin text-2xl" />
      </div>

      <template v-else>
        <!-- Простой режим -->
        <div v-if="!showAdvanced" class="flex flex-col gap-3">
          <div role="tablist" class="flex rounded-md border border-border bg-card p-0.5">
            <button
              v-for="t in MODE_TABS"
              :key="t.key"
              role="tab"
              type="button"
              class="h-6 flex-1 cursor-pointer rounded-sm text-sm font-medium transition-colors duration-(--duration-fast) ease-out"
              :class="scheduleMode === t.key ? 'bg-accent text-on-accent' : 'text-muted hover:text-fg'"
              @click="scheduleMode = t.key"
            >{{ t.label }}</button>
          </div>

          <!-- Ежедневно -->
          <div v-if="scheduleMode === 'daily'" class="flex flex-col gap-2">
            <p class="text-sm text-muted">Конвейер будет запускаться каждый день в указанное время</p>
            <div class="flex items-end gap-2">
              <UiField label="Час" class="flex-1">
                <UiSelect
                  :model-value="dailyHour"
                  :options="hourSelectOptions"
                  @update:model-value="(v) => dailyHour = Number(v)"
                />
              </UiField>
              <span class="pb-1 text-lg font-bold">:</span>
              <UiField label="Минута" class="flex-1">
                <UiSelect
                  :model-value="dailyMinute"
                  :options="minuteSelectOptions"
                  @update:model-value="(v) => dailyMinute = Number(v)"
                />
              </UiField>
            </div>
          </div>

          <!-- Еженедельно -->
          <div v-if="scheduleMode === 'weekly'" class="flex flex-col gap-2">
            <p class="text-sm text-muted">Конвейер будет запускаться раз в неделю в выбранный день</p>
            <UiField label="День недели">
              <div class="flex gap-0.5 rounded-md border border-border bg-card p-0.5">
                <button
                  v-for="day in dayNames"
                  :key="day.value"
                  type="button"
                  :class="[DAY_BTN, weeklyDay === day.value ? 'bg-accent text-on-accent' : 'text-muted hover:text-fg']"
                  :title="day.full"
                  @click="weeklyDay = day.value"
                >{{ day.short }}</button>
              </div>
            </UiField>
            <div class="flex items-end gap-2">
              <UiField label="Час" class="flex-1">
                <UiSelect
                  :model-value="weeklyHour"
                  :options="hourSelectOptions"
                  @update:model-value="(v) => weeklyHour = Number(v)"
                />
              </UiField>
              <span class="pb-1 text-lg font-bold">:</span>
              <UiField label="Минута" class="flex-1">
                <UiSelect
                  :model-value="weeklyMinute"
                  :options="minuteSelectOptions"
                  @update:model-value="(v) => weeklyMinute = Number(v)"
                />
              </UiField>
            </div>
          </div>

          <!-- Интервал -->
          <div v-if="scheduleMode === 'interval'" class="flex flex-col gap-2">
            <p class="text-sm text-muted">Конвейер будет запускаться через равные промежутки времени</p>
            <div class="flex flex-wrap gap-1.5">
              <UiButton
                v-for="opt in intervalOptions"
                :key="opt.value"
                :variant="intervalValue === opt.value ? 'primary' : 'secondary'"
                @click="intervalValue = opt.value"
              >{{ opt.label }}</UiButton>
            </div>
          </div>

          <!-- По дням -->
          <div v-if="scheduleMode === 'weekdays'" class="flex flex-col gap-2">
            <p class="text-sm text-muted">Выберите конкретные дни недели и время запуска</p>
            <UiField label="Дни недели">
              <div class="flex gap-0.5 rounded-md border border-border bg-card p-0.5">
                <button
                  v-for="day in dayNames"
                  :key="day.value"
                  type="button"
                  :class="[DAY_BTN, selectedDays.includes(day.value) ? 'bg-accent text-on-accent' : 'text-muted hover:text-fg']"
                  :title="day.full"
                  @click="toggleDay(day.value)"
                >{{ day.short }}</button>
              </div>
            </UiField>
            <div class="flex items-end gap-2">
              <UiField label="Час" class="flex-1">
                <UiSelect
                  :model-value="weekdaysHour"
                  :options="hourSelectOptions"
                  @update:model-value="(v) => weekdaysHour = Number(v)"
                />
              </UiField>
              <span class="pb-1 text-lg font-bold">:</span>
              <UiField label="Минута" class="flex-1">
                <UiSelect
                  :model-value="weekdaysMinute"
                  :options="minuteSelectOptions"
                  @update:model-value="(v) => weekdaysMinute = Number(v)"
                />
              </UiField>
            </div>

            <div class="flex flex-wrap gap-1.5">
              <UiButton variant="ghost" @click="selectedDays = [1, 2, 3, 4, 5]">Будни</UiButton>
              <UiButton variant="ghost" @click="selectedDays = [0, 6]">Выходные</UiButton>
              <UiButton variant="ghost" @click="selectedDays = [0, 1, 2, 3, 4, 5, 6]">Все дни</UiButton>
            </div>
          </div>
        </div>

        <!-- Cron-выражение -->
        <UiField
          v-if="showAdvanced"
          label="Cron-выражение"
          hint="Формат: минута час день месяц день_недели"
        >
          <UiInput v-model="advancedCron" mono placeholder="0 9 * * *" />
        </UiField>

        <UiButton variant="ghost" class="self-start" @click="showAdvanced = !showAdvanced">
          <Icon :name="showAdvanced ? 'mingcute:grid-line' : 'mingcute:code-line'" />
          {{ showAdvanced ? 'Простой режим' : 'Cron-выражение' }}
        </UiButton>

        <span class="h-px bg-divider" />

        <!-- Человеческая запись -->
        <div class="flex flex-col gap-1 rounded-md border border-border bg-card p-3">
          <div class="flex items-center gap-2 font-medium">
            <Icon name="mingcute:calendar-2-line" class="text-accent-text" />
            <span>{{ humanDescription }}</span>
          </div>
          <div v-if="generatedCron" class="font-mono text-micro text-subtle">
            {{ generatedCron }}
          </div>
        </div>

        <UiField label="Часовой пояс">
          <UiSelect v-model="timezone" :options="timezones" />
        </UiField>

        <div class="flex items-center justify-between gap-3">
          <div>
            <span class="block">Расписание активно</span>
            <span class="block text-micro text-subtle">Выключите, чтобы приостановить без удаления</span>
          </div>
          <UiToggle v-model="enabled" />
        </div>

        <!-- Состояние существующего расписания -->
        <ClientOnly>
          <div v-if="hasSchedule" class="flex flex-col gap-1.5 text-sm text-muted">
            <div v-if="nextRunAt" class="flex items-center gap-1.5">
              <Icon name="mingcute:time-line" class="shrink-0 text-info" />
              <span>Следующий запуск: <strong class="text-fg">{{ formatDate(nextRunAt) }}</strong></span>
            </div>
            <div v-if="lastRunAt" class="flex items-center gap-1.5">
              <Icon name="mingcute:history-line" class="shrink-0 text-subtle" />
              <span>Последний запуск: {{ formatDate(lastRunAt) }}</span>
            </div>
            <div v-if="lastRunStatusLabel">
              <span
                class="inline-flex h-[18px] items-center rounded-sm border px-1.5 text-micro"
                :class="lastRunStatusLabel.tone"
              >{{ lastRunStatusLabel.label }}</span>
            </div>
            <div v-if="missedRunCount > 0" class="flex items-center gap-1.5 text-warning">
              <Icon name="mingcute:warning-line" class="shrink-0" />
              <span>Пропущенных запусков: {{ missedRunCount }}</span>
            </div>
          </div>
        </ClientOnly>

        <p
          v-if="errorMsg"
          class="rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-danger"
        >
          {{ errorMsg }}
        </p>
      </template>
    </div>

    <template #footer>
      <UiButton
        v-if="hasSchedule"
        variant="danger"
        size="md"
        class="mr-auto"
        :loading="isDeleting"
        @click="deleteConfirmRef?.open()"
      >
        Удалить расписание
      </UiButton>
      <UiButton size="md" @click="emit('close')">Отмена</UiButton>
      <UiButton variant="primary" size="md" :disabled="!generatedCron" :loading="isSaving" @click="saveSchedule">
        Сохранить
      </UiButton>
    </template>
  </UiModal>

  <SharedConfirmModal
    ref="deleteConfirmRef"
    title="Удалить расписание?"
    message="Конвейер больше не будет запускаться автоматически. Настройки расписания восстановить нельзя — их придётся задать заново."
    confirm-label="Удалить"
    variant="danger"
    @confirm="deleteSchedule"
  />
</template>
