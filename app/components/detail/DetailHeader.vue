<script setup lang="ts">
/**
 * Липкая шапка детальной страницы. Источник: design-preview/catalog/03-detail-video.dc.html
 *
 * Навигация «← предыдущее / следующее →» обязательна: оператор просматривает
 * пачками и не должен возвращаться в список после каждого объекта.
 *
 * Кнопки, недоступные во время длительной операции, отключаются, а не
 * прячутся — иначе шапка прыгает в момент завершения. Скрываются только те,
 * на которые нет прав.
 */
defineProps<{
  title: string
  /** Моноширинный идентификатор рядом с названием. */
  code?: string
  backTo: string
  backLabel?: string
  position?: string
  hasPrev?: boolean
  hasNext?: boolean
  editable?: boolean
}>()

const emit = defineEmits<{
  prev: []
  next: []
  'update:title': [value: string]
}>()

const editing = ref(false)
const draft = ref('')

function startEdit(current: string) {
  draft.value = current
  editing.value = true
}

function commit() {
  editing.value = false
  if (draft.value.trim()) emit('update:title', draft.value.trim())
}
</script>

<template>
  <header class="sticky top-0 z-20 -mx-4 -mt-4 mb-4 border-b border-border bg-panel/95 px-4 py-2.5 backdrop-blur">
    <div class="flex flex-wrap items-center gap-2">
      <NuxtLink
        :to="backTo"
        class="flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-sm text-muted hover:bg-card hover:text-fg"
      >
        <Icon name="mingcute:left-line" />
        {{ backLabel ?? 'К списку' }}
      </NuxtLink>

      <!--
        На узком экране заголовок занимает всю строку: иначе `min-w-0` схлопывает
        его в ноль, а бейджи наезжают на кнопки навигации.
      -->
      <div class="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:flex-1 sm:flex-nowrap">
        <template v-if="editing">
          <UiInput
            v-model="draft"
            class="max-w-md"
            @keyup.enter="commit"
            @keyup.esc="editing = false"
            @blur="commit"
          />
        </template>
        <template v-else>
          <h1
            class="truncate text-lg font-semibold"
            :class="editable && 'cursor-text hover:underline decoration-dotted'"
            @click="editable && startEdit(title)"
          >
            {{ title }}
          </h1>
        </template>
        <span v-if="code" class="shrink-0 font-mono text-sm text-subtle">{{ code }}</span>
        <slot name="badges" />
      </div>

      <div class="flex shrink-0 items-center gap-1">
        <UiButton icon-only variant="ghost" :disabled="!hasPrev" aria-label="Предыдущий" @click="emit('prev')">
          <Icon name="mingcute:left-line" />
        </UiButton>
        <span v-if="position" class="tnum px-1 font-mono text-micro text-subtle">{{ position }}</span>
        <UiButton icon-only variant="ghost" :disabled="!hasNext" aria-label="Следующий" @click="emit('next')">
          <Icon name="mingcute:right-line" />
        </UiButton>
      </div>

      <div class="flex shrink-0 flex-wrap items-center gap-1.5">
        <slot name="actions" />
      </div>
    </div>

    <div v-if="$slots.unsaved" class="mt-2">
      <slot name="unsaved" />
    </div>
  </header>
</template>
