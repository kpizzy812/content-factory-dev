<script setup lang="ts">
/**
 * Проверка входа для аккаунта, публикующего через устройство.
 * Запускает `POST /api/accounts/:id/check-login` — проверка идёт до минуты.
 */
const props = defineProps<{ accountId: number }>()

const emit = defineEmits<{
  checked: [result: import('~~/shared/types/login-check').LoginCheckResult]
}>()

const { runCheck, isBusy, error, status } = useLoginCheck()

async function handleClick() {
  const result = await runCheck(props.accountId)
  if (result) emit('checked', result)
}
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <UiButton
      class="w-fit"
      :loading="isBusy"
      :aria-busy="isBusy"
      title="Запустить устройство и проверить, залогинен ли профиль в платформе"
      @click="handleClick"
    >
      <Icon v-if="!isBusy" name="mingcute:refresh-3-line" />
      {{ isBusy ? 'Проверяю…' : 'Проверить вход' }}
    </UiButton>

    <div aria-live="polite" class="text-sm">
      <p v-if="error" class="flex items-center gap-2 rounded-md border border-danger-border bg-danger-bg p-2 text-danger">
        <Icon name="mingcute:warning-line" class="shrink-0" />
        {{ error }}
      </p>
      <p v-else-if="status && status.loggedIn === true" class="text-success">
        Вход подтверждён{{ status.username ? ` · @${status.username}` : '' }}
      </p>
      <p v-else-if="status && status.loggedIn === false" class="text-danger">
        Не залогинен — откройте устройство и войдите вручную
      </p>
      <p v-else-if="status && status.error" class="text-warning">
        Проверка упала: {{ status.error }}
      </p>
    </div>
  </div>
</template>
