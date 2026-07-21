<script setup lang="ts">
definePageMeta({
  middleware: ['admin-access'],
})

const route = useRoute()
const userId = computed(() => Number(route.params.id))

const { data, pending, error } = useFetch(() => `/api/admin/users/${userId.value}`, {
  key: `admin-user-${userId.value}`,
})

const user = computed(() => data.value?.data ?? null)

useHead({
  title: computed(() => user.value ? `${user.value.email} - Пользователь` : 'Пользователь'),
})

function onSaved() {
  refreshNuxtData(`admin-user-${userId.value}`)
  refreshNuxtData('admin-users')
}
</script>

<template>
  <div class="space-y-6">
    <div class="text-sm breadcrumbs">
      <ul>
        <li><NuxtLink to="/admin">Админ</NuxtLink></li>
        <li><NuxtLink to="/admin/users">Пользователи</NuxtLink></li>
        <li v-if="user">{{ user.email }}</li>
      </ul>
    </div>

    <div v-if="pending" class="flex justify-center py-12">
      <span class="loading loading-spinner loading-lg" />
    </div>

    <div v-else-if="error" role="alert" class="alert alert-error">
      <Icon name="mingcute:warning-line" />
      <span>{{ error.message }}</span>
    </div>

    <template v-else-if="user">
      <div>
        <h1 class="text-2xl font-bold text-base-content">
          {{ [user.name, user.surname].filter(Boolean).join(' ') || user.email }}
        </h1>
        <p class="text-base-content/60">{{ user.email }}</p>
      </div>

      <div class="card bg-base-100 shadow-sm">
        <div class="card-body">
          <AdminUserRoleEditor :user="user" @saved="onSaved" />
        </div>
      </div>
    </template>
  </div>
</template>
