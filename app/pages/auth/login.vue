<script setup lang="ts">
definePageMeta({
  layout: "auth",
})

useHead({
  title: "Вход",
})

const { fetch: refreshSession } = useUserSession()

const email = ref("")
const password = ref("")
const isLoading = ref(false)
const errorMessage = ref("")

async function handleLogin() {
  errorMessage.value = ""
  isLoading.value = true

  try {
    await $fetch("/api/auth/login", {
      method: "POST",
      body: {
        email: email.value,
        password: password.value,
      },
    })

    await refreshSession()
    await navigateTo("/")
  } catch (error: unknown) {
    if (error && typeof error === "object" && "data" in error) {
      const fetchError = error as { data?: { message?: string } }
      errorMessage.value = fetchError.data?.message || "Произошла ошибка при входе"
    } else {
      errorMessage.value = "Не удалось подключиться к серверу"
    }
  } finally {
    isLoading.value = false
  }
}
</script>

<template>
  <div>
    <div class="mb-6 text-center">
      <Icon
        name="mingcute:building-4-fill"
        class="mb-2 text-5xl text-primary"
      />
      <h1 class="text-2xl font-bold">
        Контент-Завод
      </h1>
      <p class="mt-1 text-sm text-base-content/60">
        Войдите в систему
      </p>
    </div>

    <div
      v-if="errorMessage"
      role="alert"
      class="alert alert-error mb-4"
    >
      <Icon name="mingcute:warning-fill" class="text-lg" />
      <span>{{ errorMessage }}</span>
    </div>

    <form @submit.prevent="handleLogin" class="flex flex-col gap-4">
      <fieldset class="fieldset">
        <legend class="fieldset-legend">Email</legend>
        <input
          v-model="email"
          type="email"
          placeholder="user@example.com"
          class="input input-primary w-full"
          required
          autocomplete="email"
        />
      </fieldset>

      <fieldset class="fieldset">
        <legend class="fieldset-legend">Пароль</legend>
        <input
          v-model="password"
          type="password"
          placeholder="Минимум 8 символов"
          class="input input-primary w-full"
          required
          minlength="8"
          autocomplete="current-password"
        />
      </fieldset>

      <button
        type="submit"
        class="btn btn-primary btn-block mt-2"
        :disabled="isLoading"
      >
        <span
          v-if="isLoading"
          class="loading loading-spinner loading-sm"
        />
        {{ isLoading ? "Вход..." : "Войти" }}
      </button>
    </form>
  </div>
</template>
