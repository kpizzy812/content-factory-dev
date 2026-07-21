<script setup lang="ts">
import type { TrendwatcherProfile } from '~/composables/useTrendwatcherProfiles'

const props = defineProps<{
  appId: number | null
  selectedProfileId: number | null
}>()

const emit = defineEmits<{
  'update:selectedProfileId': [value: number | null]
  new: []
  edit: [profile: TrendwatcherProfile]
  duplicate: [profile: TrendwatcherProfile]
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

const selected = computed<TrendwatcherProfile | null>(() =>
  profiles.value.find(p => p.id === props.selectedProfileId) ?? null,
)

function onSelect(e: Event) {
  const v = (e.target as HTMLSelectElement).value
  emit('update:selectedProfileId', v ? Number(v) : null)
}

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
  <div class="space-y-2">
    <div v-if="!appId" class="alert alert-info py-2 text-xs">
      <Icon name="mingcute:information-line" />
      Сначала выберите приложение, чтобы увидеть доступные профили.
    </div>

    <div v-else>
      <div class="flex items-center gap-2">
        <input
          v-model="filter"
          type="text"
          class="input input-sm flex-1 min-w-0"
          placeholder="Фильтр по имени или keyword…"
        >
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          :disabled="pending"
          @click="() => refresh()"
        >
          <Icon name="mingcute:refresh-2-line" />
        </button>
      </div>

      <select
        class="select select-sm w-full mt-2"
        :value="selectedProfileId ?? ''"
        @change="onSelect"
      >
        <option value="">
          <template v-if="pending">Загрузка…</template>
          <template v-else-if="!filtered.length">Нет профилей — создайте новый</template>
          <template v-else>Выберите профиль</template>
        </option>
        <option
          v-for="p in filtered"
          :key="p.id"
          :value="p.id"
        >
          {{ p.name }}{{ !p.enabled ? ' (отключён)' : '' }}
        </option>
      </select>

      <div class="flex flex-wrap gap-1.5 mt-2">
        <button
          type="button"
          class="btn btn-xs btn-primary"
          @click="emit('new')"
        >
          <Icon name="mingcute:add-line" />
          Новый профиль
        </button>
        <button
          type="button"
          class="btn btn-xs btn-ghost"
          :disabled="!selected"
          @click="selected && emit('edit', selected)"
        >
          <Icon name="mingcute:edit-2-line" />
          Редактировать
        </button>
        <button
          type="button"
          class="btn btn-xs btn-ghost"
          :disabled="!selected"
          @click="onDuplicate"
        >
          <Icon name="mingcute:copy-2-line" />
          Дублировать
        </button>
      </div>
    </div>
  </div>
</template>
