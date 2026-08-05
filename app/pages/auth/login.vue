<script setup lang="ts">
definePageMeta({ layout: 'auth' })
useHead({ title: 'Вход' })

const { fetch: refreshSession } = useUserSession()

const email = ref('')
const password = ref('')
const isLoading = ref(false)
const errorMessage = ref('')

async function handleLogin() {
  errorMessage.value = ''
  isLoading.value = true

  try {
    await $fetch('/api/auth/login', {
      method: 'POST',
      body: { email: email.value, password: password.value },
    })

    await refreshSession()
    await navigateTo('/')
  }
  catch (error: unknown) {
    if (error && typeof error === 'object' && 'data' in error) {
      const fetchError = error as { data?: { message?: string } }
      errorMessage.value = fetchError.data?.message || 'Произошла ошибка при входе'
    }
    else {
      errorMessage.value = 'Не удалось подключиться к серверу'
    }
  }
  finally {
    isLoading.value = false
  }
}
</script>

<template>
  <div>
    <div class="mb-6 flex flex-col items-center gap-1.5 text-center">
      <span class="flex size-9 items-center justify-center rounded-md bg-accent font-mono text-md font-bold text-on-accent">
        CF
      </span>
      <h1 class="text-xl font-semibold">ContentFactory</h1>
      <p class="text-sm text-muted">Войдите в систему</p>
    </div>

    <div
      v-if="errorMessage"
      role="alert"
      class="mb-4 flex items-start gap-2.5 rounded-md border border-danger-border bg-danger-bg p-3"
    >
      <Icon name="mingcute:alert-line" class="mt-px shrink-0 text-danger" />
      <span class="text-sm">{{ errorMessage }}</span>
    </div>

    <form class="flex flex-col gap-4" @submit.prevent="handleLogin">
      <UiField label="Email">
        <UiInput
          v-model="email"
          type="email"
          placeholder="user@example.com"
          required
          autocomplete="email"
        />
      </UiField>

      <UiField label="Пароль" hint="Минимум 8 символов">
        <UiInput
          v-model="password"
          type="password"
          placeholder="••••••••"
          required
          autocomplete="current-password"
        />
      </UiField>

      <UiButton type="submit" variant="primary" size="md" :loading="isLoading" class="mt-2 justify-center">
        {{ isLoading ? 'Вход…' : 'Войти' }}
      </UiButton>
    </form>
  </div>
</template>
