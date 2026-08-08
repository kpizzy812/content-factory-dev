<script setup lang="ts">
definePageMeta({
  middleware: ['admin-access'],
})

useHead({ title: 'Пользователи' })

const { data, pending, error, refresh } = useAdminUsers()
const users = computed(() => data.value?.data ?? [])

// Откуда берутся учётки, зависит от поставки — подпись не должна врать.
const { authProvider, loadLegacyModules } = useLegacyModules()
await loadLegacyModules()
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-xl font-semibold">Пользователи</h1>
      <span class="tnum text-sm text-subtle">{{ users.length }}</span>
    </div>

    <p class="text-sm text-muted">
      {{ authProvider === 'marketingcamp'
        ? 'Учётные записи заводятся входом через MarketingCamp — здесь их только смотрят.'
        : 'Учётные записи заводятся командой bun run create:admin — здесь их только смотрят.' }}
    </p>

    <UiSkeleton v-if="pending && !users.length" variant="details" :count="6" />

    <UiErrorState
      v-else-if="error"
      message="Не удалось загрузить пользователей."
      :details="error.message"
      @retry="refresh()"
    />

    <UiEmptyState
      v-else-if="!users.length"
      title="Пользователей нет"
      :description="authProvider === 'marketingcamp'
        ? 'Появятся после первого входа через MarketingCamp.'
        : 'Первого администратора заводит команда bun run create:admin.'"
    />

    <div v-else class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <AdminUserCard v-for="user in users" :key="user.id" :user="user" />
    </div>
  </div>
</template>
