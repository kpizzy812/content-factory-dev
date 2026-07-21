<script setup lang="ts">
/**
 * Picker избранных промтов для ноды "Сценарий" в конвейере.
 * Режимы:
 *  - autoSelect: AI сам подбирает топ-5 (по пересечению тегов и usageCount)
 *  - manual: multi-select по чекбоксам из списка, фильтр по appId ноды + универсальные
 *
 * Хранит в config: { autoSelect: boolean, manualIds: number[] }
 */
import type { FavoritePrompt, FavoritePromptListQuery } from '~~/shared/types/favorite-prompt'

const props = defineProps<{
  appId: number | null
  autoSelect: boolean
  selectedIds: number[]
}>()

const emit = defineEmits<{
  'update:autoSelect': [value: boolean]
  'update:selectedIds': [value: number[]]
}>()

// Реактивный query: фильтр по appId ноды. Специальная строка '__app_or_null'
// — не вариант API; серверу передаём либо конкретный appId (и он отдаст только его),
// либо 'all' чтобы получить и универсальные, и на стороне клиента отфильтровать.
// Компромисс: запрашиваем вообще всё (appId=all) и в памяти фильтруем, т.к.
// API не умеет "appId=X OR NULL" одновременно. Hard limit на pagination — 100.
const query = computed<FavoritePromptListQuery>(() => ({
  appId: 'all',
  perPage: 100,
}))

const { data, pending, error, refresh } = useFavoritePrompts(query)

// Фильтрация в памяти: берём записи с appId равным props.appId ИЛИ null.
// Если appId ноды не задан — возвращаем все (пользователь ещё не выбрал приложение).
const filteredItems = computed<FavoritePrompt[]>(() => {
  const all = data.value?.data ?? []
  if (props.appId === null) return all
  return all.filter(p => p.appId === props.appId || p.appId === null)
})

function toggleId(id: number) {
  const current = new Set(props.selectedIds)
  if (current.has(id)) current.delete(id)
  else current.add(id)
  // Hard limit 5
  const next = Array.from(current).slice(0, 5)
  emit('update:selectedIds', next)
}

function isSelected(id: number) {
  return props.selectedIds.includes(id)
}

function previewText(p: FavoritePrompt) {
  const t = p.promptText
  return t.length > 140 ? `${t.slice(0, 140)}…` : t
}

const selectedCount = computed(() => props.selectedIds.length)
</script>

<template>
  <div class="space-y-2">
    <div role="tablist" class="tabs tabs-box tabs-sm">
      <button
        type="button"
        role="tab"
        class="tab gap-1"
        :class="autoSelect ? 'tab-active' : ''"
        @click="emit('update:autoSelect', true)"
      >
        <Icon name="mingcute:ai-line" class="text-sm" />
        AI подберёт сам
      </button>
      <button
        type="button"
        role="tab"
        class="tab gap-1"
        :class="!autoSelect ? 'tab-active' : ''"
        @click="emit('update:autoSelect', false)"
      >
        <Icon name="mingcute:hand-line" class="text-sm" />
        Выберу сам
        <span v-if="!autoSelect && selectedCount > 0" class="badge badge-primary badge-xs">
          {{ selectedCount }}
        </span>
      </button>
    </div>

    <p v-if="autoSelect" class="text-xs text-base-content/60 px-1">
      AI выберет до 5 наиболее релевантных промтов из библиотеки по пересечению тегов и популярности.
    </p>

    <div v-else class="space-y-2">
      <div class="flex items-center justify-between text-xs px-1">
        <span class="text-base-content/60">
          Выбрано {{ selectedCount }} из 5
        </span>
        <button
          v-if="selectedCount > 0"
          type="button"
          class="btn btn-ghost btn-xs"
          @click="emit('update:selectedIds', [])"
        >
          Сбросить
        </button>
      </div>

      <div class="space-y-1 max-h-64 overflow-y-auto border border-base-300 rounded-box p-2">
        <div v-if="pending" class="flex justify-center py-4">
          <span class="loading loading-spinner loading-sm" />
        </div>
        <div v-else-if="error" class="alert alert-error alert-soft text-xs py-1">
          <span>Ошибка: {{ error.message }}</span>
          <button type="button" class="btn btn-ghost btn-xs" @click="() => refresh()">Повторить</button>
        </div>
        <div v-else-if="filteredItems.length === 0" class="text-xs text-base-content/50 text-center py-3">
          Нет подходящих промтов. Добавьте избранные на странице видео.
        </div>
        <label
          v-for="p in filteredItems"
          v-else
          :key="p.id"
          class="flex items-start gap-2 cursor-pointer p-1.5 rounded-field hover:bg-base-200/60"
          :class="isSelected(p.id) ? 'bg-primary/5 ring-1 ring-primary/30' : ''"
        >
          <input
            type="checkbox"
            class="checkbox checkbox-xs mt-0.5"
            :checked="isSelected(p.id)"
            :disabled="!isSelected(p.id) && selectedCount >= 5"
            @change="toggleId(p.id)"
          />
          <div class="flex-1 min-w-0 text-xs">
            <div class="flex items-center gap-1 mb-0.5">
              <span
                class="badge badge-xs"
                :class="p.app ? 'badge-primary' : 'badge-ghost'"
              >
                {{ p.app?.name ?? 'Универсальный' }}
              </span>
              <span
                v-if="p.usageCount > 0"
                class="text-[10px] text-base-content/50"
                :title="`Использовано ${p.usageCount} раз`"
              >
                <Icon name="mingcute:fire-line" class="text-[10px]" /> {{ p.usageCount }}
              </span>
            </div>
            <p class="text-[11px] text-base-content/80 whitespace-pre-line">{{ previewText(p) }}</p>
            <div v-if="p.tags.length > 0" class="flex flex-wrap gap-0.5 mt-0.5">
              <span
                v-for="t in p.tags"
                :key="t"
                class="badge badge-outline badge-xs text-[9px]"
              >
                {{ t }}
              </span>
            </div>
          </div>
        </label>
      </div>
    </div>
  </div>
</template>
