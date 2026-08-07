<script setup lang="ts">
/**
 * Прогрев аккаунта.
 *
 * Подписи доменные: «холодный», «греется», «прогрет» точнее общего словаря
 * состояний, поэтому из него берётся только тон — как у здоровья прокси.
 * Дата последнего прогрева зависит от «сейчас», поэтому её возраст считается
 * только в браузере.
 */
const props = defineProps<{
  status?: string | null
  lastWarmupAt?: string | null
}>()

const LABELS: Record<string, string> = {
  new: 'Не начат',
  cold: 'Холодный',
  warming: 'Греется',
  ready: 'Прогрет',
}

const TONES: Record<string, string> = {
  new: 'border-neutral-border bg-neutral-bg text-neutral',
  cold: 'border-warning-border bg-warning-bg text-warning',
  warming: 'border-info-border bg-info-bg text-info',
  ready: 'border-success-border bg-success-bg text-success',
}

const label = computed(() => LABELS[props.status ?? 'new'] ?? props.status ?? '—')
const tone = computed(() => TONES[props.status ?? 'new'] ?? TONES.new)

/** «7 дней назад» — по этому сроку решают, пора ли греть снова. */
const age = computed(() => {
  if (!props.lastWarmupAt) return null
  const days = Math.floor((Date.now() - new Date(props.lastWarmupAt).getTime()) / 86_400_000)
  if (!Number.isFinite(days) || days < 0) return null
  if (days === 0) return 'сегодня'
  return `${days} д назад`
})
</script>

<template>
  <span class="flex items-center gap-1.5">
    <span
      class="inline-flex h-[18px] items-center rounded-sm border px-1.5 text-micro whitespace-nowrap"
      :class="tone"
    >
      {{ label }}
    </span>
    <ClientOnly>
      <span v-if="age" class="tnum font-mono text-micro text-subtle">{{ age }}</span>
    </ClientOnly>
  </span>
</template>
