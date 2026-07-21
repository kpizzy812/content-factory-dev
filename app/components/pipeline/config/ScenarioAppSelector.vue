<script setup lang="ts">
const props = defineProps<{
  modelValue: number | null
  contextMode: string
}>()

const emit = defineEmits<{
  'update:modelValue': [id: number | null]
}>()

interface AppItem {
  id: number
  name: string
  description?: string | null
  subtitle?: string | null
  iconUrl?: string | null
  enrichmentStatus?: string | null
  brandTone?: string | null
  corePain?: string | null
  coreOutcome?: string | null
  transformationPromise?: string | null
}

const { data: appsData } = await useFetch<{ data: AppItem[] }>('/api/apps', {
  query: { fields: 'extended' },
})

const apps = computed(() => appsData.value?.data ?? [])

const selectedApp = computed(() =>
  props.modelValue ? apps.value.find(a => a.id === props.modelValue) ?? null : null,
)

function select(id: number | null) {
  emit('update:modelValue', id)
}
</script>

<template>
  <div class="space-y-2">
    <!-- Disabled notice -->
    <div v-if="contextMode === 'off'" class="alert alert-info alert-soft text-xs py-2">
      <Icon name="mingcute:information-line" class="text-sm" />
      <span>Контекст приложения отключён. Сценарии будут генерироваться без привязки к приложению.</span>
    </div>

    <!-- Selected app card -->
    <div v-else-if="selectedApp" class="flex items-start gap-2 p-2 rounded-box border border-base-300 bg-base-200/30">
      <div v-if="selectedApp.iconUrl" class="w-8 h-8 rounded-lg overflow-hidden shrink-0 bg-base-300">
        <img :src="selectedApp.iconUrl" :alt="selectedApp.name" class="w-full h-full object-cover" />
      </div>
      <div v-else class="w-8 h-8 rounded-lg bg-base-300 flex items-center justify-center shrink-0">
        <Icon name="mingcute:apps-line" class="text-base-content/40" />
      </div>

      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-1">
          <span class="text-xs font-semibold truncate">{{ selectedApp.name }}</span>
          <span v-if="selectedApp.enrichmentStatus === 'completed'" class="badge badge-xs badge-success gap-0.5">
            <Icon name="mingcute:check-circle-line" class="text-[9px]" />
            Обогащено
          </span>
        </div>
        <div v-if="selectedApp.subtitle" class="text-[10px] text-base-content/50 truncate">{{ selectedApp.subtitle }}</div>
        <div v-if="selectedApp.corePain" class="text-[10px] text-base-content/40 mt-0.5 line-clamp-2">
          {{ selectedApp.corePain }}
        </div>
      </div>

      <button
        type="button"
        class="btn btn-ghost btn-xs btn-square shrink-0"
        title="Сбросить выбор"
        @click="select(null)"
      >
        <Icon name="mingcute:close-line" />
      </button>
    </div>

    <!-- Empty state / selector -->
    <template v-if="contextMode !== 'off' && !selectedApp">
      <select
        class="select select-sm w-full"
        :value="modelValue ?? ''"
        @change="select(Number(($event.target as HTMLSelectElement).value) || null)"
      >
        <option value="" disabled>Выберите приложение...</option>
        <option v-for="app in apps" :key="app.id" :value="app.id">
          {{ app.name }}{{ app.enrichmentStatus === 'completed' ? ' ✓' : '' }}
        </option>
      </select>
      <div class="text-[10px] text-base-content/40">
        AI получит контекст выбранного приложения для генерации сценариев.
      </div>
    </template>
  </div>
</template>
