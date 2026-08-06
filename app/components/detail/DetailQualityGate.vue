<script setup lang="ts">
/**
 * Панель проверки качества. Источник: design-preview/catalog/03-detail-video.dc.html
 *
 * Стоит выше степпера: это единственный блок, где требуется решение человека,
 * остальное справочное. В режиме только чтения замечания видны, кнопок нет —
 * они не прячутся, а отсутствуют, потому что права на решение нет.
 */
defineProps<{
  score?: number | null
  notes?: string[]
  readonly?: boolean
  pending?: boolean
}>()

const emit = defineEmits<{ accept: [], reject: [], rework: [] }>()
</script>

<template>
  <div class="rounded-lg border border-warning-border bg-warning-bg p-3.5">
    <div class="flex items-center gap-2">
      <Icon name="mingcute:eye-line" class="shrink-0 text-warning" />
      <span class="font-medium">Ждёт решения</span>
      <span v-if="score != null" class="tnum ml-auto font-mono text-sm">
        критик {{ score.toFixed(1) }} / 10
      </span>
    </div>

    <ul v-if="notes?.length" class="mt-2 flex flex-col gap-1 text-sm text-muted">
      <li v-for="(note, i) in notes" :key="i" class="flex items-start gap-1.5">
        <Icon name="mingcute:subtract-line" class="mt-0.5 shrink-0 text-subtle" />
        <span>{{ note }}</span>
      </li>
    </ul>

    <div v-if="!readonly" class="mt-3 flex flex-wrap gap-1.5">
      <UiButton variant="primary" :loading="pending" @click="emit('accept')">Принять</UiButton>
      <UiButton :loading="pending" @click="emit('rework')">На доработку</UiButton>
      <UiButton variant="danger" :loading="pending" @click="emit('reject')">Отклонить</UiButton>
    </div>
    <p v-else class="mt-2 text-sm text-subtle">
      Решение принимает роль с правом согласования.
    </p>
  </div>
</template>
