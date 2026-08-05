<script setup lang="ts">
/**
 * Пагинация страницами. Источник: design-preview/_system/blocks/EntityTable.html
 *
 * Страницы, а не бесконечная прокрутка: нужны для «Выделить все N», для
 * пересылки ссылки и для стабильности при поллинге раз в 5 секунд —
 * автоподгрузка сдвигает список под курсором и ломает выделение.
 * Там, где страницы избыточны, используется кнопка «Показать ещё».
 */
const props = defineProps<{
  page: number
  totalPages: number
  total: number
  perPage: number
}>()

const emit = defineEmits<{
  'update:page': [value: number]
  'update:perPage': [value: number]
}>()

const from = computed(() => (props.total === 0 ? 0 : (props.page - 1) * props.perPage + 1))
const to = computed(() => Math.min(props.page * props.perPage, props.total))

/** Окно страниц вокруг текущей: при 200 страницах список номеров бесполезен. */
const pages = computed(() => {
  const out: Array<number | '…'> = []
  const last = props.totalPages
  const push = (n: number) => out.push(n)

  if (last <= 7) {
    for (let i = 1; i <= last; i++) push(i)
    return out
  }
  push(1)
  if (props.page > 3) out.push('…')
  for (let i = Math.max(2, props.page - 1); i <= Math.min(last - 1, props.page + 1); i++) push(i)
  if (props.page < last - 2) out.push('…')
  push(last)
  return out
})

/**
 * Текущий размер страницы добавляется в список, если его там нет: разделы
 * приходят со своим значением из стора, и без этого селект показывал бы
 * чужое число, а строка «Показано 1–12» — своё.
 */
const perPageOptions = computed(() => {
  const base = [25, 50, 100]
  const values = base.includes(props.perPage) ? base : [props.perPage, ...base].sort((a, b) => a - b)
  return values.map(v => ({ value: v, label: String(v) }))
})
</script>

<template>
  <div class="flex flex-wrap items-center gap-3">
    <span class="tnum text-sm text-subtle">
      Показано {{ from }}–{{ to }} из {{ total }}
    </span>

    <div class="flex items-center gap-1">
      <UiButton icon-only variant="ghost" :disabled="page <= 1" aria-label="Предыдущая" @click="emit('update:page', page - 1)">
        <Icon name="mingcute:left-line" />
      </UiButton>

      <template v-for="(p, i) in pages" :key="`${p}-${i}`">
        <span v-if="p === '…'" class="px-1 text-subtle">…</span>
        <button
          v-else
          type="button"
          class="tnum h-7 min-w-7 cursor-pointer rounded-md px-2 font-mono text-sm"
          :class="p === page ? 'bg-accent text-on-accent' : 'text-muted hover:bg-card hover:text-fg'"
          @click="emit('update:page', p as number)"
        >{{ p }}</button>
      </template>

      <UiButton icon-only variant="ghost" :disabled="page >= totalPages" aria-label="Следующая" @click="emit('update:page', page + 1)">
        <Icon name="mingcute:right-line" />
      </UiButton>
    </div>

    <div class="ml-auto flex items-center gap-2 text-sm text-subtle">
      <span>На странице</span>
      <UiSelect
        :model-value="perPage"
        class="w-20"
        :options="perPageOptions"
        @update:model-value="emit('update:perPage', Number($event))"
      />
    </div>
  </div>
</template>
