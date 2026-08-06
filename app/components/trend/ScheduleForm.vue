<script setup lang="ts">
/**
 * Расписание профиля парсинга.
 *
 * Модалка, а не панель на странице: расписание правят раз в несколько недель,
 * и рядом со списком профилей оно занимало бы место постоянно.
 *
 * Заготовки cron стоят выше поля: девять из десяти расписаний — это «раз в
 * шесть часов», и набирать звёздочки руками ради них незачем.
 */
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
  { label: 'Раз в сутки в 09:00', cron: '0 9 * * *' },
  { label: 'Раз в сутки в 00:00', cron: '0 0 * * *' },
  { label: 'Пн–Пт в 10:00', cron: '0 10 * * 1-5' },
]

const TIMEZONES = [
  { value: 'UTC', label: 'UTC' },
  { value: 'Europe/Moscow', label: 'Москва (UTC+3)' },
  { value: 'Europe/Kiev', label: 'Киев (UTC+2)' },
  { value: 'Asia/Almaty', label: 'Алматы (UTC+6)' },
]

const { updateSchedule } = useTrendwatcherProfiles()

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('ru-RU')
}

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
  }
  catch (err: unknown) {
    const e = err as { data?: { message?: string } }
    error.value = e?.data?.message ?? 'Не удалось сохранить расписание'
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <UiModal open :title="`Расписание · ${profile.name}`" @close="emit('close')">
    <form class="flex flex-col gap-3" @submit.prevent="handleSave">
      <UiToggle
        v-model="form.scheduleEnabled"
        label="Запускать автоматически по расписанию"
      />

      <UiField
        label="Cron-выражение"
        hint="Минуты · часы · дни месяца · месяц · день недели"
        :error="error ?? undefined"
      >
        <UiInput
          v-model="form.scheduleCron"
          mono
          placeholder="0 */6 * * *"
          :disabled="!form.scheduleEnabled"
        />
      </UiField>

      <div v-if="form.scheduleEnabled" class="flex flex-wrap gap-1.5">
        <button
          v-for="preset in PRESETS"
          :key="preset.cron"
          type="button"
          class="h-7 cursor-pointer rounded-md border px-2 text-sm transition-colors duration-(--duration-fast)"
          :class="form.scheduleCron === preset.cron
            ? 'border-accent-border bg-accent-bg text-fg'
            : 'border-border bg-card text-muted hover:text-fg'"
          @click="form.scheduleCron = preset.cron"
        >
          {{ preset.label }}
        </button>
      </div>

      <UiField label="Часовой пояс">
        <UiSelect
          v-model="form.scheduleTimezone"
          :options="TIMEZONES"
          :disabled="!form.scheduleEnabled"
        />
      </UiField>

      <ClientOnly>
        <UiKeyValue
          v-if="profile.scheduleLastRunAt || profile.scheduleNextRunAt"
          :items="[
            { label: 'Прошлый запуск', value: formatDate(profile.scheduleLastRunAt) },
            { label: 'Следующий', value: formatDate(profile.scheduleNextRunAt) },
          ]"
        />
      </ClientOnly>
    </form>

    <template #footer>
      <UiButton variant="ghost" @click="emit('close')">Отмена</UiButton>
      <UiButton variant="primary" :loading="saving" @click="handleSave">Сохранить</UiButton>
    </template>
  </UiModal>
</template>
