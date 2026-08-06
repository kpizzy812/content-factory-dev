<script setup lang="ts">
/**
 * Кто увидит ролик на YouTube.
 *
 * Значения по умолчанию нет намеренно: пока оператор не выбрал, форма невалидна.
 * «Публично» — самый необратимый вариант, поэтому он подписан отдельно и не
 * выглядит как остальные два.
 */
import type { YoutubeVisibility } from '~~/shared/types/posting-youtube'

const props = defineProps<{
  visibility: YoutubeVisibility | null
  disabled?: boolean
}>()

const emit = defineEmits<{ 'update:visibility': [v: YoutubeVisibility] }>()

interface Option {
  value: YoutubeVisibility
  label: string
  description: string
  icon: string
  selectedTone: string
}

const OPTIONS: Option[] = [
  {
    value: 'private',
    label: 'Только владельцу',
    description: 'Видит владелец канала и те, кого он пригласит',
    icon: 'mingcute:lock-line',
    selectedTone: 'border-warning-border bg-warning-bg',
  },
  {
    value: 'unlisted',
    label: 'По ссылке',
    description: 'Открывается по прямой ссылке, в поиск не попадает',
    icon: 'mingcute:link-line',
    selectedTone: 'border-info-border bg-info-bg',
  },
  {
    value: 'public',
    label: 'Всем',
    description: 'Ролик станет открытым сразу после публикации',
    icon: 'mingcute:earth-line',
    selectedTone: 'border-danger-border bg-danger-bg',
  },
]

function select(value: YoutubeVisibility) {
  if (props.disabled) return
  emit('update:visibility', value)
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <p
      v-if="visibility === null"
      class="flex gap-2 rounded-md border border-info-border bg-info-bg p-2.5 text-sm"
    >
      <Icon name="mingcute:information-line" class="mt-0.5 shrink-0 text-info" />
      YouTube требует явного выбора — по умолчанию ничего не выбрано.
    </p>

    <div class="flex flex-col gap-2">
      <label
        v-for="opt in OPTIONS"
        :key="opt.value"
        class="flex items-start gap-2.5 rounded-md border p-2.5 transition-colors duration-(--duration-fast)"
        :class="[
          visibility === opt.value ? opt.selectedTone : 'border-border bg-card hover:border-accent-border',
          disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
        ]"
      >
        <input
          type="radio"
          class="mt-0.5 size-3.5 shrink-0 cursor-pointer accent-(--color-accent)"
          :checked="visibility === opt.value"
          :disabled="disabled"
          @change="select(opt.value)"
        >
        <span class="min-w-0 flex-1">
          <span class="flex items-center gap-1.5 text-sm font-medium">
            <Icon :name="opt.icon" class="shrink-0" />
            {{ opt.label }}
            <span
              v-if="opt.value === 'public'"
              class="rounded-sm border border-danger-border bg-danger-bg px-1.5 text-micro text-danger"
            >
              необратимо
            </span>
          </span>
          <span class="block text-sm text-muted">{{ opt.description }}</span>
        </span>
      </label>
    </div>

    <p
      v-if="visibility === 'public'"
      class="flex gap-2 rounded-md border border-warning-border bg-warning-bg p-2.5 text-sm"
    >
      <Icon name="mingcute:warning-line" class="mt-0.5 shrink-0 text-warning" />
      Ролик станет виден всем сразу после отправки. Убедитесь, что он готов.
    </p>
  </div>
</template>
