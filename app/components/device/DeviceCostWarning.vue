<script setup lang="ts">
/**
 * Предупреждение о поминутной оплате включённого облачного устройства.
 *
 * Правило проекта: включённое устройство тарифицируется поминутно, поэтому
 * предупреждение стоит рядом с кнопкой включения, а не в справке.
 */
withDefaults(defineProps<{
  variant?: 'inline' | 'alert'
}>(), { variant: 'inline' })
</script>

<template>
  <p
    v-if="variant === 'alert'"
    role="note"
    class="flex items-start gap-2 rounded-md border border-warning-border bg-warning-bg px-2.5 py-2 text-sm text-warning"
  >
    <Icon name="mingcute:wallet-line" class="mt-0.5 shrink-0" />
    <span>
      <span class="font-medium">Устройство платное.</span>
      Включённое устройство тарифицируется поминутно — выключайте после работы.
    </span>
  </p>

  <span
    v-else
    class="inline-flex items-center gap-1 text-micro text-warning"
    title="Облачное устройство тарифицируется поминутно за время работы — выключайте после использования"
  >
    <Icon name="mingcute:wallet-line" />
    Платное — выключайте после
  </span>
</template>
