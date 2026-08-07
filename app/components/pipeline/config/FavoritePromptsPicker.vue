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

const tabClass = (active: boolean) => active
  ? 'bg-accent text-on-accent'
  : 'text-muted hover:text-fg'
</script>

<template>
  <div class="flex flex-col gap-2">
    <div role="tablist" class="flex rounded-md border border-border bg-card p-0.5">
      <button
        type="button"
        role="tab"
        class="flex h-6 flex-1 cursor-pointer items-center justify-center gap-1 rounded-sm text-sm font-medium transition-colors duration-(--duration-fast) ease-out"
        :class="tabClass(autoSelect)"
        @click="emit('update:autoSelect', true)"
      >
        <Icon name="mingcute:ai-line" />
        AI подберёт сам
      </button>
      <button
        type="button"
        role="tab"
        class="flex h-6 flex-1 cursor-pointer items-center justify-center gap-1 rounded-sm text-sm font-medium transition-colors duration-(--duration-fast) ease-out"
        :class="tabClass(!autoSelect)"
        @click="emit('update:autoSelect', false)"
      >
        <Icon name="mingcute:hand-line" />
        Выберу сам
        <span
          v-if="!autoSelect && selectedCount > 0"
          class="tnum rounded-sm bg-on-accent/15 px-1 text-micro"
        >{{ selectedCount }}</span>
      </button>
    </div>

    <p v-if="autoSelect" class="text-sm text-muted">
      AI выберет до 5 наиболее релевантных промтов из библиотеки по пересечению тегов и популярности.
    </p>

    <div v-else class="flex flex-col gap-2">
      <div class="flex items-center justify-between gap-2">
        <span class="text-sm text-muted">Выбрано {{ selectedCount }} из 5</span>
        <UiButton
          v-if="selectedCount > 0"
          variant="ghost"
          @click="emit('update:selectedIds', [])"
        >
          Сбросить
        </UiButton>
      </div>

      <div class="max-h-64 overflow-y-auto rounded-md border border-border p-2">
        <div v-if="pending" class="flex justify-center py-4 text-muted">
          <Icon name="mingcute:loading-line" class="animate-spin text-lg" />
        </div>

        <div
          v-else-if="error"
          class="flex items-center justify-between gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-1.5 text-sm text-danger"
        >
          <span>Ошибка: {{ error.message }}</span>
          <UiButton variant="ghost" @click="() => refresh()">Повторить</UiButton>
        </div>

        <p v-else-if="filteredItems.length === 0" class="py-3 text-center text-sm text-subtle">
          Нет подходящих промтов. Добавьте избранные на странице видео.
        </p>

        <div v-else class="flex flex-col gap-1">
          <label
            v-for="p in filteredItems"
            :key="p.id"
            class="flex cursor-pointer items-start gap-2 rounded-md border p-1.5"
            :class="isSelected(p.id) ? 'border-accent-border bg-accent-bg' : 'border-transparent hover:bg-raised'"
          >
            <input
              type="checkbox"
              class="mt-0.5 size-3.5 shrink-0 rounded-sm accent-(--color-accent)"
              :checked="isSelected(p.id)"
              :disabled="!isSelected(p.id) && selectedCount >= 5"
              @change="toggleId(p.id)"
            >
            <div class="min-w-0 flex-1">
              <div class="mb-0.5 flex items-center gap-1">
                <span
                  class="inline-flex h-[18px] items-center rounded-sm border px-1.5 text-micro"
                  :class="p.app
                    ? 'border-accent-border bg-accent-bg text-accent-text'
                    : 'border-neutral-border bg-neutral-bg text-neutral'"
                >{{ p.app?.name ?? 'Универсальный' }}</span>
                <span
                  v-if="p.usageCount > 0"
                  class="inline-flex items-center gap-0.5 text-micro text-subtle"
                  :title="`Использовано ${p.usageCount} раз`"
                >
                  <Icon name="mingcute:fire-line" /> {{ p.usageCount }}
                </span>
              </div>
              <p class="text-micro whitespace-pre-line text-muted">{{ previewText(p) }}</p>
              <div v-if="p.tags.length > 0" class="mt-0.5 flex flex-wrap gap-0.5">
                <span
                  v-for="t in p.tags"
                  :key="t"
                  class="rounded-sm border border-border px-1 text-micro text-subtle"
                >{{ t }}</span>
              </div>
            </div>
          </label>
        </div>
      </div>
    </div>
  </div>
</template>
