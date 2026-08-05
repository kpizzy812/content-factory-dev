<script setup lang="ts">
/**
 * Подсказка по странице за кнопкой «?» в топбаре.
 *
 * Раньше это был раскрытый блок в начале каждой страницы (SharedPageGuide) —
 * он съедал вертикаль в рабочем режиме у человека, который давно всё знает.
 * Содержимое то же, из app/utils/guides.ts.
 */
const route = useRoute()
const { guideFor } = useAppNavigation()

const open = ref(false)
const guide = computed(() => guideFor(route.path))

// При переходе на другую страницу подсказка закрывается: она про текущий раздел.
watch(() => route.path, () => { open.value = false })
</script>

<template>
  <div v-if="guide" class="relative">
    <button
      type="button"
      class="flex size-[26px] cursor-pointer items-center justify-center rounded-md border border-border bg-card text-muted hover:border-subtle hover:text-fg"
      :class="open && 'border-accent-border text-accent-text'"
      :aria-expanded="open"
      title="Как работать с этим разделом"
      @click="open = !open"
    >
      <Icon name="mingcute:question-line" />
    </button>

    <div
      v-if="open"
      class="absolute top-full right-0 z-40 mt-1.5 w-[420px] max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-raised p-4 shadow-lg"
    >
      <div class="mb-2 flex items-center gap-2">
        <Icon name="mingcute:book-2-line" class="text-info" />
        <span class="font-medium">{{ guide.title }}</span>
        <button type="button" class="ml-auto cursor-pointer text-subtle hover:text-fg" @click="open = false">
          <Icon name="mingcute:close-line" />
        </button>
      </div>

      <ol class="flex list-inside list-decimal flex-col gap-1 text-sm text-muted">
        <li v-for="(step, i) in guide.steps" :key="i">{{ step }}</li>
      </ol>

      <div v-if="guide.tips?.length" class="mt-3 flex flex-col gap-1">
        <p v-for="(tip, i) in guide.tips" :key="i" class="flex items-start gap-1.5 text-sm text-info">
          <Icon name="mingcute:bulb-line" class="mt-0.5 shrink-0" />
          <span>{{ tip }}</span>
        </p>
      </div>
    </div>
  </div>
</template>
