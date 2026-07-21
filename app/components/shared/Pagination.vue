<script setup lang="ts">
const props = defineProps<{
  page: number
  totalPages: number
  total: number
}>()

const emit = defineEmits<{
  'update:page': [value: number]
}>()

type PageItem = { type: 'page'; value: number } | { type: 'ellipsis'; key: string }

const visiblePages = computed<PageItem[]>(() => {
  const { page, totalPages } = props
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, i) => ({
      type: 'page' as const,
      value: i + 1,
    }))
  }

  const pages: PageItem[] = []
  const addPage = (p: number) => pages.push({ type: 'page', value: p })
  const addEllipsis = (key: string) => pages.push({ type: 'ellipsis', key })

  // Первая страница
  addPage(1)

  // Многоточие перед текущей областью
  if (page > 3) {
    addEllipsis('start')
  }

  // Страницы вокруг текущей (page - 1, page, page + 1)
  for (let p = page - 1; p <= page + 1; p++) {
    if (p > 1 && p < totalPages) {
      addPage(p)
    }
  }

  // Многоточие после текущей области
  if (page < totalPages - 2) {
    addEllipsis('end')
  }

  // Последняя страница
  addPage(totalPages)

  return pages
})

function goTo(p: number) {
  if (p >= 1 && p <= props.totalPages) {
    emit('update:page', p)
  }
}
</script>

<template>
  <div class="flex flex-col sm:flex-row items-center justify-between gap-3">
    <span class="text-sm text-base-content/60">
      Всего: {{ total }}. Страница {{ page }} из {{ totalPages }}
    </span>

    <div class="join">
      <button
        class="join-item btn btn-sm"
        :disabled="page <= 1"
        @click="goTo(page - 1)"
      >
        <Icon name="mingcute:arrow-left-line" />
      </button>

      <template v-for="item in visiblePages" :key="item.type === 'page' ? item.value : item.key">
        <button
          v-if="item.type === 'page'"
          class="join-item btn btn-sm"
          :class="{ 'btn-active': item.value === page }"
          @click="goTo(item.value)"
        >
          {{ item.value }}
        </button>
        <button
          v-else
          class="join-item btn btn-sm btn-disabled"
        >
          ...
        </button>
      </template>

      <button
        class="join-item btn btn-sm"
        :disabled="page >= totalPages"
        @click="goTo(page + 1)"
      >
        <Icon name="mingcute:arrow-right-line" />
      </button>
    </div>
  </div>
</template>
