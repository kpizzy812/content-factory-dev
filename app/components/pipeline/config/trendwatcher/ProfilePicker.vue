<script setup lang="ts">
import type { TrendwatcherProfile } from '~/composables/useTrendwatcherProfiles'

const props = defineProps<{
  appId: number | null
  selectedProfileId: number | null
}>()

const emit = defineEmits<{
  'update:selectedProfileId': [value: number | null]
  'new': []
  'edit': [profile: TrendwatcherProfile]
  'duplicate': [profile: TrendwatcherProfile]
}>()

const appIdRef = computed(() => (typeof props.appId === 'number' ? props.appId : undefined))
const { profiles, pending, refresh, duplicateProfile } = useTrendwatcherProfiles(appIdRef)

const filter = ref('')
const filtered = computed(() => {
  const q = filter.value.trim().toLowerCase()
  if (!q) return profiles.value
  return profiles.value.filter(p =>
    p.name.toLowerCase().includes(q)
    || p.keywords.some(k => k.toLowerCase().includes(q))
    || p.platforms.some(pl => pl.toLowerCase().includes(q)),
  )
})

const profileOptions = computed(() => filtered.value.map(p => ({
  value: p.id,
  label: p.enabled ? p.name : `${p.name} (отключён)`,
})))

const profilePlaceholder = computed(() => {
  if (pending.value) return 'Загрузка…'
  if (!filtered.value.length) return 'Нет профилей — создайте новый'
  return 'Выберите профиль'
})

const selected = computed<TrendwatcherProfile | null>(() =>
  profiles.value.find(p => p.id === props.selectedProfileId) ?? null,
)

async function onDuplicate() {
  if (!selected.value) return
  try {
    const res = await duplicateProfile(selected.value.id) as { data: TrendwatcherProfile }
    emit('update:selectedProfileId', res.data.id)
    emit('duplicate', res.data)
  } catch {
    // ignore — пусть пользователь увидит это через profiles.error
  }
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <p
      v-if="!appId"
      class="flex items-start gap-2 rounded-md border border-info-border bg-info-bg px-2.5 py-2 text-sm text-muted"
    >
      <Icon name="mingcute:information-line" class="mt-0.5 shrink-0 text-info" />
      Сначала выберите приложение, чтобы увидеть доступные профили.
    </p>

    <template v-else>
      <div class="flex items-center gap-2">
        <UiInput
          v-model="filter"
          class="min-w-0 flex-1"
          placeholder="Фильтр по имени или ключевому слову…"
        />
        <UiButton variant="ghost" icon-only :loading="pending" title="Обновить список" @click="() => refresh()">
          <Icon name="mingcute:refresh-2-line" />
        </UiButton>
      </div>

      <UiSelect
        :model-value="selectedProfileId ?? ''"
        :options="profileOptions"
        :placeholder="profilePlaceholder"
        @update:model-value="(v) => emit('update:selectedProfileId', v ? Number(v) : null)"
      />

      <div class="flex flex-wrap gap-1.5">
        <UiButton variant="primary" @click="emit('new')">
          <Icon name="mingcute:add-line" />
          Новый профиль
        </UiButton>
        <UiButton variant="ghost" :disabled="!selected" @click="selected && emit('edit', selected)">
          <Icon name="mingcute:edit-2-line" />
          Редактировать
        </UiButton>
        <UiButton variant="ghost" :disabled="!selected" @click="onDuplicate">
          <Icon name="mingcute:copy-2-line" />
          Дублировать
        </UiButton>
      </div>
    </template>
  </div>
</template>
