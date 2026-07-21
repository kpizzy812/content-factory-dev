<script setup lang="ts">
const props = defineProps<{
  profile: {
    id: number
    name: string
    scheduleEnabled: boolean
    scheduleCron: string | null
    scheduleTimezone: string
    scheduleNextRunAt: string | null
    scheduleLastRunAt: string | null
  }
}>()

const emit = defineEmits<{
  close: []
  saved: []
}>()

const saving = ref(false)
const error = ref<string | null>(null)

const form = reactive({
  scheduleEnabled: props.profile.scheduleEnabled,
  scheduleCron: props.profile.scheduleCron ?? '',
  scheduleTimezone: props.profile.scheduleTimezone,
})

const PRESETS = [
  { label: 'Каждый час', cron: '0 * * * *' },
  { label: 'Каждые 3 часа', cron: '0 */3 * * *' },
  { label: 'Каждые 6 часов', cron: '0 */6 * * *' },
  { label: 'Каждые 12 часов', cron: '0 */12 * * *' },
  { label: 'Раз в сутки (09:00)', cron: '0 9 * * *' },
  { label: 'Раз в сутки (00:00)', cron: '0 0 * * *' },
  { label: 'Пн-Пт в 10:00', cron: '0 10 * * 1-5' },
]

function applyPreset(cron: string) {
  form.scheduleCron = cron
}

const { updateSchedule } = useTrendwatcherProfiles()

async function handleSave() {
  error.value = null
  saving.value = true
  try {
    await updateSchedule(props.profile.id, {
      scheduleEnabled: form.scheduleEnabled,
      scheduleCron: form.scheduleCron.trim() || null,
      scheduleTimezone: form.scheduleTimezone,
    })
    emit('saved')
    emit('close')
  } catch (err: unknown) {
    const e = err as { data?: { message?: string } }
    error.value = e?.data?.message ?? 'Ошибка сохранения расписания'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="card bg-base-100 shadow-sm">
    <div class="card-body p-4">
      <div class="flex items-center justify-between mb-3">
        <h3 class="card-title text-lg">
          <Icon name="mingcute:time-line" class="text-lg" />
          Расписание: {{ profile.name }}
        </h3>
        <button class="btn btn-ghost btn-sm btn-square" @click="emit('close')">
          <Icon name="mingcute:close-line" class="text-lg" />
        </button>
      </div>

      <form class="space-y-4" @submit.prevent="handleSave">
        <!-- Enable/disable -->
        <div class="form-control">
          <label class="label cursor-pointer justify-start gap-3">
            <input
              v-model="form.scheduleEnabled"
              type="checkbox"
              class="toggle toggle-primary toggle-sm"
            >
            <span class="label-text">Автоматический запуск по расписанию</span>
          </label>
        </div>

        <!-- Cron expression -->
        <fieldset class="fieldset" :class="{ 'opacity-50': !form.scheduleEnabled }">
          <legend class="fieldset-legend">Cron-выражение</legend>
          <input
            v-model="form.scheduleCron"
            type="text"
            class="input w-full font-mono"
            placeholder="0 */6 * * *"
            :disabled="!form.scheduleEnabled"
          >
          <p class="label text-xs">
            Формат: минуты часы дни месяц день_недели
          </p>
        </fieldset>

        <!-- Presets -->
        <div v-if="form.scheduleEnabled" class="flex flex-wrap gap-1">
          <button
            v-for="preset in PRESETS"
            :key="preset.cron"
            type="button"
            class="btn btn-ghost btn-xs"
            :class="{ 'btn-active': form.scheduleCron === preset.cron }"
            @click="applyPreset(preset.cron)"
          >
            {{ preset.label }}
          </button>
        </div>

        <!-- Timezone -->
        <fieldset class="fieldset" :class="{ 'opacity-50': !form.scheduleEnabled }">
          <legend class="fieldset-legend">Часовой пояс</legend>
          <select
            v-model="form.scheduleTimezone"
            class="select w-full"
            :disabled="!form.scheduleEnabled"
          >
            <option value="UTC">UTC</option>
            <option value="Europe/Moscow">Москва (UTC+3)</option>
            <option value="Europe/Kiev">Киев (UTC+2)</option>
            <option value="Asia/Almaty">Алматы (UTC+6)</option>
          </select>
        </fieldset>

        <!-- Current schedule info -->
        <div v-if="profile.scheduleNextRunAt || profile.scheduleLastRunAt" class="text-xs text-base-content/60 space-y-1">
          <div v-if="profile.scheduleLastRunAt">
            Последний запуск: {{ new Date(profile.scheduleLastRunAt).toLocaleString('ru-RU') }}
          </div>
          <div v-if="profile.scheduleNextRunAt">
            Следующий запуск: {{ new Date(profile.scheduleNextRunAt).toLocaleString('ru-RU') }}
          </div>
        </div>

        <!-- Error -->
        <div v-if="error" role="alert" class="alert alert-error alert-sm">
          <Icon name="mingcute:warning-line" />
          <span>{{ error }}</span>
        </div>

        <!-- Actions -->
        <div class="flex justify-end gap-2">
          <button type="button" class="btn btn-ghost btn-sm" @click="emit('close')">
            Отмена
          </button>
          <button type="submit" class="btn btn-primary btn-sm" :disabled="saving">
            <span v-if="saving" class="loading loading-spinner loading-xs" />
            Сохранить
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
