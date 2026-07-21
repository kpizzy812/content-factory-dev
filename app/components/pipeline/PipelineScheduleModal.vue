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

// --- Schedule mode ---
type ScheduleMode = 'daily' | 'weekly' | 'interval' | 'weekdays' | 'custom'
const scheduleMode = ref<ScheduleMode>('daily')

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

const hourOptions = Array.from({ length: 24 }, (_, i) => i)
const minuteOptions = Array.from({ length: 60 }, (_, i) => i)
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

function pad(n: number) {
  return n.toString().padStart(2, '0')
}

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
  if (!confirm('Удалить расписание? Конвейер больше не будет запускаться автоматически.')) return
  isDeleting.value = true
  try {
    await $fetch(`/api/pipelines/${props.pipelineId}/schedule`, { method: 'DELETE' })
    hasSchedule.value = false
    emit('close')
  } catch {
    errorMsg.value = 'Ошибка удаления'
  } finally {
    isDeleting.value = false
  }
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleString('ru-RU')
}

const lastRunStatusLabel = computed(() => {
  if (!lastRunStatus.value) return null
  const map: Record<string, { label: string; class: string }> = {
    triggered: { label: 'Запущен', class: 'badge-success' },
    no_data: { label: 'Нет данных', class: 'badge-warning' },
    skipped_inactive: { label: 'Пропущен (неактивен)', class: 'badge-warning' },
    skipped_empty: { label: 'Пропущен (нет блоков)', class: 'badge-warning' },
    skipped_already_running: { label: 'Пропущен (уже запущен)', class: 'badge-warning' },
  }
  if (lastRunStatus.value.startsWith('error:')) {
    return { label: `Ошибка: ${lastRunStatus.value.slice(7)}`, class: 'badge-error' }
  }
  return map[lastRunStatus.value] ?? { label: lastRunStatus.value, class: 'badge-ghost' }
})

watch(() => props.visible, (v) => {
  if (v) {
    showAdvanced.value = false
    errorMsg.value = null
    loadSchedule()
  }
})
</script>

<template>
  <dialog class="modal" :class="{ 'modal-open': visible }">
    <div class="modal-box max-w-lg">
      <!-- Header -->
      <h3 class="font-bold text-lg mb-1 flex items-center gap-2">
        <Icon name="mingcute:calendar-time-add-line" class="text-primary" />
        Расписание запуска
      </h3>
      <p class="text-xs text-base-content/60 mb-4">
        Cron или интервал. Можно отключить расписание в любой момент.
      </p>

      <!-- Loading -->
      <div v-if="isLoading" class="flex justify-center py-8">
        <span class="loading loading-spinner loading-md" />
      </div>

      <template v-else>
        <!-- Mode tabs (badge-style) -->
        <div v-if="!showAdvanced" class="space-y-4">
          <div role="tablist" class="tabs tabs-box tabs-sm">
            <button
              role="tab"
              class="tab"
              :class="{ 'tab-active': scheduleMode === 'daily' }"
              @click="scheduleMode = 'daily'"
            >
              Ежедневно
            </button>
            <button
              role="tab"
              class="tab"
              :class="{ 'tab-active': scheduleMode === 'weekly' }"
              @click="scheduleMode = 'weekly'"
            >
              Еженедельно
            </button>
            <button
              role="tab"
              class="tab"
              :class="{ 'tab-active': scheduleMode === 'interval' }"
              @click="scheduleMode = 'interval'"
            >
              Интервал
            </button>
            <button
              role="tab"
              class="tab"
              :class="{ 'tab-active': scheduleMode === 'weekdays' }"
              @click="scheduleMode = 'weekdays'"
            >
              По дням
            </button>
          </div>

          <!-- Daily -->
          <div v-if="scheduleMode === 'daily'" class="space-y-3">
            <p class="text-xs text-base-content/60">
              Конвейер будет запускаться каждый день в указанное время
            </p>
            <div class="flex items-center gap-2">
              <fieldset class="fieldset flex-1">
                <legend class="fieldset-legend">Час</legend>
                <select v-model.number="dailyHour" class="select select-sm w-full">
                  <option v-for="h in hourOptions" :key="h" :value="h">{{ pad(h) }}</option>
                </select>
              </fieldset>
              <span class="text-xl font-bold mt-4">:</span>
              <fieldset class="fieldset flex-1">
                <legend class="fieldset-legend">Минута</legend>
                <select v-model.number="dailyMinute" class="select select-sm w-full">
                  <option v-for="m in minuteOptions" :key="m" :value="m">{{ pad(m) }}</option>
                </select>
              </fieldset>
            </div>
          </div>

          <!-- Weekly -->
          <div v-if="scheduleMode === 'weekly'" class="space-y-3">
            <p class="text-xs text-base-content/60">
              Конвейер будет запускаться раз в неделю в выбранный день
            </p>
            <fieldset class="fieldset">
              <legend class="fieldset-legend">День недели</legend>
              <div class="join join-horizontal w-full">
                <button
                  v-for="day in dayNames"
                  :key="day.value"
                  class="join-item btn btn-sm flex-1"
                  :class="weeklyDay === day.value ? 'btn-primary' : 'btn-ghost'"
                  @click="weeklyDay = day.value"
                >
                  {{ day.short }}
                </button>
              </div>
            </fieldset>
            <div class="flex items-center gap-2">
              <fieldset class="fieldset flex-1">
                <legend class="fieldset-legend">Час</legend>
                <select v-model.number="weeklyHour" class="select select-sm w-full">
                  <option v-for="h in hourOptions" :key="h" :value="h">{{ pad(h) }}</option>
                </select>
              </fieldset>
              <span class="text-xl font-bold mt-4">:</span>
              <fieldset class="fieldset flex-1">
                <legend class="fieldset-legend">Минута</legend>
                <select v-model.number="weeklyMinute" class="select select-sm w-full">
                  <option v-for="m in minuteOptions" :key="m" :value="m">{{ pad(m) }}</option>
                </select>
              </fieldset>
            </div>
          </div>

          <!-- Interval -->
          <div v-if="scheduleMode === 'interval'" class="space-y-3">
            <p class="text-xs text-base-content/60">
              Конвейер будет запускаться через равные промежутки времени
            </p>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="opt in intervalOptions"
                :key="opt.value"
                class="btn btn-sm"
                :class="intervalValue === opt.value ? 'btn-primary' : 'btn-ghost'"
                @click="intervalValue = opt.value"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>

          <!-- Weekdays -->
          <div v-if="scheduleMode === 'weekdays'" class="space-y-3">
            <p class="text-xs text-base-content/60">
              Выберите конкретные дни недели и время запуска
            </p>
            <fieldset class="fieldset">
              <legend class="fieldset-legend">Дни недели</legend>
              <div class="join join-horizontal w-full">
                <button
                  v-for="day in dayNames"
                  :key="day.value"
                  class="join-item btn btn-sm flex-1"
                  :class="selectedDays.includes(day.value) ? 'btn-primary' : 'btn-ghost'"
                  @click="toggleDay(day.value)"
                >
                  {{ day.short }}
                </button>
              </div>
            </fieldset>
            <div class="flex items-center gap-2">
              <fieldset class="fieldset flex-1">
                <legend class="fieldset-legend">Час</legend>
                <select v-model.number="weekdaysHour" class="select select-sm w-full">
                  <option v-for="h in hourOptions" :key="h" :value="h">{{ pad(h) }}</option>
                </select>
              </fieldset>
              <span class="text-xl font-bold mt-4">:</span>
              <fieldset class="fieldset flex-1">
                <legend class="fieldset-legend">Минута</legend>
                <select v-model.number="weekdaysMinute" class="select select-sm w-full">
                  <option v-for="m in minuteOptions" :key="m" :value="m">{{ pad(m) }}</option>
                </select>
              </fieldset>
            </div>

            <!-- Quick presets for weekdays -->
            <div class="flex gap-1.5 flex-wrap">
              <button
                class="btn btn-xs btn-ghost"
                @click="selectedDays = [1, 2, 3, 4, 5]"
              >
                Будни
              </button>
              <button
                class="btn btn-xs btn-ghost"
                @click="selectedDays = [0, 6]"
              >
                Выходные
              </button>
              <button
                class="btn btn-xs btn-ghost"
                @click="selectedDays = [0, 1, 2, 3, 4, 5, 6]"
              >
                Все дни
              </button>
            </div>
          </div>
        </div>

        <!-- Advanced cron mode -->
        <div v-if="showAdvanced" class="space-y-3">
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Cron-выражение</legend>
            <input
              v-model="advancedCron"
              type="text"
              class="input input-sm w-full font-mono"
              placeholder="0 9 * * *"
            />
            <p class="label text-xs text-base-content/50">
              Формат: минута час день месяц день_недели
            </p>
          </fieldset>
        </div>

        <!-- Toggle advanced mode -->
        <div class="mt-3">
          <button
            class="btn btn-xs btn-ghost text-base-content/50"
            @click="showAdvanced = !showAdvanced"
          >
            <Icon :name="showAdvanced ? 'mingcute:grid-line' : 'mingcute:code-line'" class="text-xs" />
            {{ showAdvanced ? 'Простой режим' : 'Cron-выражение' }}
          </button>
        </div>

        <div class="divider my-2" />

        <!-- Human-readable preview -->
        <div class="rounded-box bg-base-200/60 p-3 space-y-2">
          <div class="flex items-center gap-2 text-sm font-medium">
            <Icon name="mingcute:calendar-2-line" class="text-primary" />
            <span>{{ humanDescription }}</span>
          </div>
          <div v-if="generatedCron" class="text-[10px] font-mono text-base-content/40">
            {{ generatedCron }}
          </div>
        </div>

        <!-- Timezone -->
        <fieldset class="fieldset mt-3">
          <legend class="fieldset-legend">Часовой пояс</legend>
          <select v-model="timezone" class="select select-sm w-full">
            <option v-for="tz in timezones" :key="tz.value" :value="tz.value">{{ tz.label }}</option>
          </select>
        </fieldset>

        <!-- Active toggle -->
        <div class="flex items-center justify-between mt-3">
          <div>
            <span class="text-sm">Расписание активно</span>
            <p class="text-[10px] text-base-content/40">Выключите, чтобы приостановить без удаления</p>
          </div>
          <input
            v-model="enabled"
            type="checkbox"
            class="toggle toggle-sm toggle-primary"
          />
        </div>

        <!-- Schedule info (existing schedule) -->
        <div v-if="hasSchedule" class="mt-3 space-y-1.5 text-xs text-base-content/60">
          <div v-if="nextRunAt" class="flex items-center gap-1.5">
            <Icon name="mingcute:time-line" class="text-info shrink-0" />
            <span>Следующий запуск: <strong class="text-base-content">{{ formatDate(nextRunAt) }}</strong></span>
          </div>
          <div v-if="lastRunAt" class="flex items-center gap-1.5">
            <Icon name="mingcute:history-line" class="shrink-0" />
            <span>Последний запуск: {{ formatDate(lastRunAt) }}</span>
          </div>
          <div v-if="lastRunStatusLabel" class="flex items-center gap-1.5">
            <span class="badge badge-xs" :class="lastRunStatusLabel.class">
              {{ lastRunStatusLabel.label }}
            </span>
          </div>
          <div v-if="missedRunCount > 0" class="flex items-center gap-1.5 text-warning">
            <Icon name="mingcute:warning-line" class="shrink-0" />
            <span>Пропущенных запусков: {{ missedRunCount }}</span>
          </div>
        </div>

        <!-- Error -->
        <div v-if="errorMsg" class="alert alert-error alert-soft text-sm mt-3">
          {{ errorMsg }}
        </div>

        <!-- Actions -->
        <div class="modal-action">
          <button
            v-if="hasSchedule"
            class="btn btn-sm btn-error btn-outline"
            :disabled="isDeleting"
            @click="deleteSchedule"
          >
            <span v-if="isDeleting" class="loading loading-spinner loading-sm" />
            Удалить расписание
          </button>
          <div class="flex-1" />
          <button class="btn btn-sm" @click="emit('close')">Отмена</button>
          <button
            class="btn btn-sm btn-primary"
            :disabled="isSaving || !generatedCron"
            @click="saveSchedule"
          >
            <span v-if="isSaving" class="loading loading-spinner loading-sm" />
            Сохранить
          </button>
        </div>
      </template>
    </div>
    <form method="dialog" class="modal-backdrop" @click="emit('close')">
      <button>close</button>
    </form>
  </dialog>
</template>
