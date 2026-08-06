<script setup lang="ts">
/**
 * Результат последней проверки входа. Тон — из общего словаря, подпись доменная:
 * «Не залогинен» точнее «Ошибки», а «Не проверялся» — не то же самое, что провал.
 */
const props = defineProps<{
  loginCheckedAt?: string | Date | null
  loginCheckedStatus?: boolean | null
  loginCheckedUsername?: string | null
}>()

const formattedAt = computed(() => {
  if (!props.loginCheckedAt) return null
  const d = props.loginCheckedAt instanceof Date ? props.loginCheckedAt : new Date(props.loginCheckedAt)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
})

const config = computed(() => {
  if (!props.loginCheckedAt) {
    return {
      label: 'Вход не проверялся',
      tone: 'border-divider bg-transparent text-subtle',
      icon: 'mingcute:question-line',
      tooltip: 'Проверка входа ни разу не запускалась',
    }
  }
  if (props.loginCheckedStatus === true) {
    const user = props.loginCheckedUsername ? ` · @${props.loginCheckedUsername}` : ''
    return {
      label: `Залогинен${user}`,
      tone: 'border-success-border bg-success-bg text-success',
      icon: 'mingcute:check-circle-line',
      tooltip: `Вход подтверждён${user}. Проверено ${formattedAt.value}`,
    }
  }
  if (props.loginCheckedStatus === false) {
    return {
      label: 'Не залогинен',
      tone: 'border-danger-border bg-danger-bg text-danger',
      icon: 'mingcute:close-circle-line',
      tooltip: `Вход не найден. Проверено ${formattedAt.value}. Войдите через устройство.`,
    }
  }
  return {
    label: 'Проверка упала',
    tone: 'border-warning-border bg-warning-bg text-warning',
    icon: 'mingcute:warning-line',
    tooltip: `Проверка входа завершилась ошибкой. Проверено ${formattedAt.value}`,
  }
})
</script>

<template>
  <UiTooltip :text="config.tooltip" placement="bottom">
    <span
      class="inline-flex h-[22px] w-fit items-center gap-1.5 rounded-sm border px-2 text-sm whitespace-nowrap"
      :class="config.tone"
      :aria-label="config.tooltip"
    >
      <Icon :name="config.icon" class="shrink-0" />
      {{ config.label }}
    </span>
  </UiTooltip>
</template>
