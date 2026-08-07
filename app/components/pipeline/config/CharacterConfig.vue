<script setup lang="ts">
/**
 * Конфиг pipeline-ноды character.
 * Выбор app → выбор персонажа (или режим random) → output на downstream-блоки.
 */
import type { Character } from '~~/shared/types/character'

const props = defineProps<{
  config: Record<string, any>
}>()

const emit = defineEmits<{
  update: [key: string, value: any]
}>()

const { data: appsData } = useFetch<{ data: { id: number, name: string }[] }>('/api/apps', {
  default: () => ({ data: [] }) as any,
})
const apps = computed(() => appsData.value?.data ?? [])

const appOptions = computed(() => [
  { value: '', label: 'Из контекста фабрики' },
  ...apps.value.map(a => ({ value: a.id, label: a.name })),
])

const appId = computed(() => Number(props.config.appId) || null)
const mode = computed(() => (props.config.mode as 'fixed' | 'random' | 'first') ?? 'fixed')

const MODES = [
  { value: 'fixed', label: 'Конкретный' },
  { value: 'first', label: 'Первый' },
  { value: 'random', label: 'Случайный' },
] as const

const charactersQuery = computed(() => (appId.value ? { appId: appId.value } : {}))
const { data: charactersData, pending: charactersPending } = useFetch<{ data: Character[] }>(
  '/api/characters',
  {
    query: charactersQuery,
    watch: [appId],
    server: false,
    default: () => ({ data: [] }) as any,
  },
)
const characters = computed<Character[]>(() => charactersData.value?.data ?? [])

const characterOptions = computed(() => characters.value.map(c => ({
  value: c.id,
  label: c.name + (c.role === 'support' ? ' (второстеп.)' : c.role === 'extra' ? ' (массовка)' : ''),
})))

const characterPlaceholder = computed(() => {
  if (!appId.value) return 'Сначала выберите приложение'
  return charactersPending.value ? 'Загрузка…' : 'Выберите персонажа'
})

const allTags = computed(() => {
  const set = new Set<string>()
  for (const c of characters.value) for (const t of c.tags ?? []) set.add(t)
  return Array.from(set).sort()
})

const tagOptions = computed(() => [
  { value: '', label: '— любой —' },
  ...allTags.value.map(t => ({ value: t, label: t })),
])

const roleOptions = [
  { value: '', label: 'Любая' },
  { value: 'protagonist', label: 'Главный герой' },
  { value: 'support', label: 'Второстепенный' },
  { value: 'extra', label: 'Массовка' },
]

function onAppChange(v: string | number) {
  emit('update', 'appId', Number(v) || null)
  // сбрасываем персонажа если меняем app
  if (props.config.characterId) emit('update', 'characterId', null)
}
</script>

<template>
  <UiField label="Приложение" hint="Для обычного запуска выберите приложение. Фабрика передаст его автоматически.">
    <UiSelect
      :model-value="appId ?? ''"
      :options="appOptions"
      @update:model-value="onAppChange"
    />
  </UiField>

  <UiField label="Стратегия выбора">
    <div class="flex rounded-md border border-border bg-card p-0.5">
      <button
        v-for="m in MODES"
        :key="m.value"
        type="button"
        class="h-6 flex-1 cursor-pointer rounded-sm text-sm font-medium transition-colors duration-(--duration-fast) ease-out"
        :class="mode === m.value ? 'bg-accent text-on-accent' : 'text-muted hover:text-fg'"
        @click="emit('update', 'mode', m.value)"
      >{{ m.label }}</button>
    </div>
  </UiField>

  <UiField v-if="mode === 'fixed'" label="Персонаж *">
    <UiSelect
      :model-value="config.characterId ?? ''"
      :options="characterOptions"
      :placeholder="characterPlaceholder"
      :disabled="!appId || charactersPending"
      @update:model-value="(v) => emit('update', 'characterId', v || null)"
    />
    <p v-if="appId && !charactersPending && characters.length === 0" class="mt-1 text-micro text-warning">
      У этого приложения нет персонажей. Создайте в разделе «Персонажи».
    </p>
  </UiField>

  <UiField v-if="mode !== 'fixed' && allTags.length" label="Фильтр по тегу (опц.)">
    <UiSelect
      :model-value="config.tag ?? ''"
      :options="tagOptions"
      @update:model-value="(v) => emit('update', 'tag', v || null)"
    />
  </UiField>

  <UiField v-if="mode !== 'fixed'" label="Роль персонажа">
    <UiSelect
      :model-value="config.role ?? ''"
      :options="roleOptions"
      @update:model-value="(v) => emit('update', 'role', v || null)"
    />
  </UiField>

  <div class="flex items-start justify-between gap-3">
    <span class="min-w-0">
      <span class="block font-medium">Только с исходниками lip-sync</span>
      <span class="block text-micro text-subtle">Не выберет персонажа без активных видео</span>
    </span>
    <UiToggle
      :model-value="config.requireSourceClips === true"
      @update:model-value="(v) => emit('update', 'requireSourceClips', v)"
    />
  </div>

  <p class="flex items-start gap-2 rounded-md border border-info-border bg-info-bg px-2.5 py-2 text-micro text-muted">
    <Icon name="mingcute:information-line" class="mt-0.5 shrink-0 text-info" />
    <span>
      Output: <code class="font-mono text-fg">character</code>,
      <code class="font-mono text-fg">characterId</code>,
      <code class="font-mono text-fg">characterVisualPrompt</code>,
      <code class="font-mono text-fg">characterReferenceImageUrls</code>.
      Подключайте к Сценарию или Видео.
    </span>
  </p>
</template>
