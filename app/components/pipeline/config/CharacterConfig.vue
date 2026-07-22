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

const { data: appsData } = useFetch<{ data: { id: number; name: string }[] }>('/api/apps', {
  default: () => ({ data: [] }) as any,
})
const apps = computed(() => appsData.value?.data ?? [])

const appId = computed(() => Number(props.config.appId) || null)
const mode = computed(() => (props.config.mode as 'fixed' | 'random' | 'first') ?? 'fixed')

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

const allTags = computed(() => {
  const set = new Set<string>()
  for (const c of characters.value) for (const t of c.tags ?? []) set.add(t)
  return Array.from(set).sort()
})

function onAppChange(v: number) {
  emit('update', 'appId', v || null)
  // сбрасываем характер если меняем app
  if (props.config.characterId) emit('update', 'characterId', null)
}
</script>

<template>
  <fieldset class="fieldset">
    <legend class="fieldset-legend">Приложение</legend>
    <select
      class="select select-sm w-full"
      :value="appId ?? ''"
      @change="onAppChange(Number(($event.target as HTMLSelectElement).value))"
    >
      <option value="">Из контекста фабрики</option>
      <option v-for="app in apps" :key="app.id" :value="app.id">{{ app.name }}</option>
    </select>
    <p class="text-[10px] text-base-content/50 mt-0.5">
      Для обычного запуска выберите приложение. Фабрика передаст его автоматически.
    </p>
  </fieldset>

  <fieldset class="fieldset">
    <legend class="fieldset-legend">Стратегия выбора</legend>
    <div class="join w-full">
      <button
        type="button"
        class="join-item btn btn-sm flex-1"
        :class="{ 'btn-primary': mode === 'fixed' }"
        @click="emit('update', 'mode', 'fixed')"
      >Конкретный</button>
      <button
        type="button"
        class="join-item btn btn-sm flex-1"
        :class="{ 'btn-primary': mode === 'first' }"
        @click="emit('update', 'mode', 'first')"
      >Первый</button>
      <button
        type="button"
        class="join-item btn btn-sm flex-1"
        :class="{ 'btn-primary': mode === 'random' }"
        @click="emit('update', 'mode', 'random')"
      >Случайный</button>
    </div>
  </fieldset>

  <fieldset v-if="mode === 'fixed'" class="fieldset">
    <legend class="fieldset-legend">Персонаж *</legend>
    <select
      class="select select-sm w-full"
      :disabled="!appId || charactersPending"
      :value="config.characterId ?? ''"
      @change="emit('update', 'characterId', ($event.target as HTMLSelectElement).value || null)"
    >
      <option value="" disabled>
        {{ !appId ? 'Сначала выберите приложение' : charactersPending ? 'Загрузка…' : 'Выберите персонажа' }}
      </option>
      <option v-for="c in characters" :key="c.id" :value="c.id">
        {{ c.name }}{{ c.role === 'support' ? ' (второстеп.)' : c.role === 'extra' ? ' (массовка)' : '' }}
      </option>
    </select>
    <p v-if="appId && !charactersPending && characters.length === 0" class="text-[10px] text-warning mt-0.5">
      У этого приложения нет персонажей. Создайте в разделе «Персонажи».
    </p>
  </fieldset>

  <fieldset v-if="mode !== 'fixed' && allTags.length" class="fieldset">
    <legend class="fieldset-legend">Фильтр по тегу (опц.)</legend>
    <select
      class="select select-sm w-full"
      :value="config.tag ?? ''"
      @change="emit('update', 'tag', ($event.target as HTMLSelectElement).value || null)"
    >
      <option value="">— любой —</option>
      <option v-for="t in allTags" :key="t" :value="t">{{ t }}</option>
    </select>
  </fieldset>

  <fieldset v-if="mode !== 'fixed'" class="fieldset">
    <legend class="fieldset-legend">Роль персонажа</legend>
    <select
      class="select select-sm w-full"
      :value="config.role ?? ''"
      @change="emit('update', 'role', ($event.target as HTMLSelectElement).value || null)"
    >
      <option value="">Любая</option>
      <option value="protagonist">Главный герой</option>
      <option value="support">Второстепенный</option>
      <option value="extra">Массовка</option>
    </select>
  </fieldset>

  <fieldset class="fieldset">
    <label class="flex items-center justify-between gap-3 cursor-pointer">
      <span>
        <span class="block text-xs font-medium">Только с исходниками lip-sync</span>
        <span class="block text-[10px] text-base-content/50">Не выберет персонажа без активных видео</span>
      </span>
      <input
        type="checkbox"
        class="toggle toggle-sm toggle-primary"
        :checked="config.requireSourceClips === true"
        @change="emit('update', 'requireSourceClips', ($event.target as HTMLInputElement).checked)"
      />
    </label>
  </fieldset>

  <div role="alert" class="alert alert-info alert-soft text-xs">
    <Icon name="mingcute:information-line" />
    <span>
      Output: <code>character</code>, <code>characterId</code>, <code>characterVisualPrompt</code>,
      <code>characterReferenceImageUrls</code>. Подключайте к Сценарию или Видео.
    </span>
  </div>
</template>
