<script setup lang="ts">
/**
 * Кнопка "Проверить логин" для browser_automation аккаунта.
 *
 * Запускает POST /api/accounts/:id/check-login, показывает spinner на время
 * проверки (30-60 сек), отображает inline-result. Emit 'checked' после success.
 */
const props = defineProps<{
  accountId: number
  size?: 'xs' | 'sm' | 'md'
}>()

const emit = defineEmits<{
  checked: [result: import('~~/shared/types/login-check').LoginCheckResult]
}>()

const { runCheck, isBusy, error, status } = useLoginCheck()

async function handleClick() {
  const result = await runCheck(props.accountId)
  if (result) {
    emit('checked', result)
  }
}

const sizeClass = computed(() => {
  switch (props.size ?? 'sm') {
    case 'xs': return 'btn-xs'
    case 'md': return 'btn-md'
    default: return 'btn-sm'
  }
})
</script>

<template>
  <div class="flex flex-col gap-1">
    <button
      type="button"
      class="btn btn-ghost gap-1"
      :class="sizeClass"
      :disabled="isBusy"
      :aria-busy="isBusy"
      title="Запустить устройство DuoPlus и проверить, залогинен ли profile в платформе"
      @click="handleClick"
    >
      <span v-if="isBusy" class="loading loading-spinner loading-sm" />
      <Icon v-else name="mingcute:refresh-line" class="text-sm" />
      {{ isBusy ? 'Проверяю...' : 'Проверить логин' }}
    </button>

    <div aria-live="polite">
      <div v-if="error" class="alert alert-error alert-soft text-xs gap-1 py-1 px-2">
        <Icon name="mingcute:warning-line" class="text-sm" />
        <span>{{ error }}</span>
      </div>

      <div
        v-else-if="status && status.loggedIn === true"
        class="text-xs text-success"
      >
        ✓ Login OK{{ status.username ? ` (@${status.username})` : '' }}
      </div>
      <div
        v-else-if="status && status.loggedIn === false"
        class="text-xs text-error"
      >
        ✗ Не залогинен — откройте устройство DuoPlus и залогиньтесь вручную
      </div>
      <div
        v-else-if="status && status.error"
        class="text-xs text-warning"
      >
        Ошибка: {{ status.error }}
      </div>
    </div>
  </div>
</template>
