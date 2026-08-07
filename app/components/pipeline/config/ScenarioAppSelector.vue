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

const appOptions = computed(() => apps.value.map(a => ({
  value: a.id,
  label: a.enrichmentStatus === 'completed' ? `${a.name} ✓` : a.name,
})))

const selectedApp = computed(() =>
  props.modelValue ? apps.value.find(a => a.id === props.modelValue) ?? null : null,
)

function select(id: number | null) {
  emit('update:modelValue', id)
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <!-- Контекст выключен -->
    <p
      v-if="contextMode === 'off'"
      class="flex items-start gap-2 rounded-md border border-info-border bg-info-bg px-2.5 py-2 text-micro text-muted"
    >
      <Icon name="mingcute:information-line" class="mt-0.5 shrink-0 text-info" />
      <span>Контекст приложения отключён. Сценарии будут генерироваться без привязки к приложению.</span>
    </p>

    <!-- Выбранное приложение -->
    <div
      v-else-if="selectedApp"
      class="flex items-start gap-2 rounded-md border border-border bg-card p-2"
    >
      <div v-if="selectedApp.iconUrl" class="size-8 shrink-0 overflow-hidden rounded-md bg-raised">
        <img :src="selectedApp.iconUrl" :alt="selectedApp.name" class="size-full object-cover">
      </div>
      <div v-else class="flex size-8 shrink-0 items-center justify-center rounded-md bg-raised">
        <Icon name="mingcute:apps-line" class="text-subtle" />
      </div>

      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-1">
          <span class="truncate font-semibold">{{ selectedApp.name }}</span>
          <span
            v-if="selectedApp.enrichmentStatus === 'completed'"
            class="inline-flex h-[18px] shrink-0 items-center gap-0.5 rounded-sm border border-success-border bg-success-bg px-1.5 text-micro text-success"
          >
            <Icon name="mingcute:check-circle-line" />
            Обогащено
          </span>
        </div>
        <div v-if="selectedApp.subtitle" class="truncate text-micro text-subtle">{{ selectedApp.subtitle }}</div>
        <div v-if="selectedApp.corePain" class="mt-0.5 line-clamp-2 text-micro text-subtle">
          {{ selectedApp.corePain }}
        </div>
      </div>

      <UiButton variant="ghost" icon-only title="Сбросить выбор" @click="select(null)">
        <Icon name="mingcute:close-line" />
      </UiButton>
    </div>

    <!-- Пустое состояние -->
    <template v-if="contextMode !== 'off' && !selectedApp">
      <UiSelect
        :model-value="modelValue ?? ''"
        :options="appOptions"
        placeholder="Выберите приложение…"
        @update:model-value="(v) => select(Number(v) || null)"
      />
      <p class="text-micro text-subtle">
        AI получит контекст выбранного приложения для генерации сценариев.
      </p>
    </template>
  </div>
</template>
