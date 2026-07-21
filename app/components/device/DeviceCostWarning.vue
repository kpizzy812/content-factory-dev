<script setup lang="ts">
/**
 * DeviceCostWarning — предупреждение о платности включённого устройства DuoPlus.
 *
 * Правило проекта: облачное устройство DuoPlus тарифицируется ПОМИНУТНО за
 * running-время. Оператор обязан выключать устройство после использования.
 * Это предупреждение показывается рядом с кнопкой powerOn (Start).
 *
 * variant:
 *   - "inline" (дефолт) — компактная строка-подсказка под/рядом с кнопкой.
 *   - "alert" — полноразмерный warning-alert (для detail-страницы).
 */
withDefaults(
  defineProps<{
    variant?: "inline" | "alert"
  }>(),
  { variant: "inline" },
)
</script>

<template>
  <div
    v-if="variant === 'alert'"
    role="alert"
    class="alert alert-warning alert-soft text-sm gap-2"
  >
    <Icon name="mingcute:wallet-line" class="text-base" />
    <span>
      <b>Устройство платное.</b> Включённое устройство тарифицируется DuoPlus
      поминутно. Обязательно выключайте его после использования, чтобы не жечь бюджет.
    </span>
  </div>

  <span
    v-else
    class="inline-flex items-center gap-1 text-[11px] text-warning"
    title="Устройство DuoPlus тарифицируется поминутно за время работы — выключайте после использования"
  >
    <Icon name="mingcute:wallet-line" class="text-xs" />
    Платное — выключайте после
  </span>
</template>
