<script setup lang="ts">
definePageMeta({
  middleware: ['admin-access'],
})

useHead({ title: 'Пользователи' })

const { data, pending } = useAdminUsers()
const users = computed(() => data.value?.data ?? [])
</script>

<template>
  <div class="space-y-6">
    <div class="text-sm breadcrumbs">
      <ul>
        <li><NuxtLink to="/admin">Админ</NuxtLink></li>
        <li>Пользователи</li>
      </ul>
    </div>

    <h1 class="text-2xl font-bold text-base-content">Пользователи</h1>

    <div v-if="pending" class="flex justify-center py-12">
      <span class="loading loading-spinner loading-lg" />
    </div>

    <template v-else>
      <div v-if="users.length" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <AdminUserCard v-for="user in users" :key="user.id" :user="user" />
      </div>

      <SharedEmptyState
        v-else
        icon="mingcute:user-3-line"
        title="Нет пользователей"
        description="Пользователи появятся после первой авторизации"
      />
    </template>
  </div>
</template>
