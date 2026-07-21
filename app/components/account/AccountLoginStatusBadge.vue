<script setup lang="ts">
/**
 * Badge статуса проверки логина для browser_automation аккаунта.
 *
 *   loginCheckedStatus === true  → 🟢 Залогинен
 *   loginCheckedStatus === false → 🔴 Не залогинен
 *   loginCheckedStatus === null
 *     ИЛИ loginCheckedAt отсутствует → ❓ Не проверялся
 *
 * Tooltip показывает loginCheckedAt + username (если есть).
 */
const props = defineProps<{
  loginCheckedAt?: string | Date | null
  loginCheckedStatus?: boolean | null
  loginCheckedUsername?: string | null
}>()

const formattedAt = computed(() => {
  if (!props.loginCheckedAt) return null
  const d = props.loginCheckedAt instanceof Date
    ? props.loginCheckedAt
    : new Date(props.loginCheckedAt)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
})

const config = computed(() => {
  if (!props.loginCheckedAt) {
    return {
      label: 'Не проверялся',
      badgeClass: 'badge-ghost',
      icon: 'mingcute:question-line',
      tooltip: 'Login-check ни разу не запускался',
    }
  }
  if (props.loginCheckedStatus === true) {
    const userPart = props.loginCheckedUsername
      ? ` (@${props.loginCheckedUsername})`
      : ''
    return {
      label: `Залогинен${userPart}`,
      badgeClass: 'badge-success',
      icon: 'mingcute:check-circle-line',
      tooltip: `Login OK${userPart}. Проверено: ${formattedAt.value}`,
    }
  }
  if (props.loginCheckedStatus === false) {
    return {
      label: 'Не залогинен',
      badgeClass: 'badge-error',
      icon: 'mingcute:close-circle-line',
      tooltip: `Login не обнаружен. Проверено: ${formattedAt.value}. Залогиньтесь через устройство DuoPlus.`,
    }
  }
  return {
    label: 'Ошибка',
    badgeClass: 'badge-warning',
    icon: 'mingcute:warning-line',
    tooltip: `Login-check упал с ошибкой. Проверено: ${formattedAt.value}`,
  }
})
</script>

<template>
  <span class="tooltip tooltip-bottom" :data-tip="config.tooltip">
    <span
      class="badge badge-sm gap-1"
      :class="config.badgeClass"
      :aria-label="config.tooltip"
    >
      <Icon :name="config.icon" class="text-xs" />
      {{ config.label }}
    </span>
  </span>
</template>
