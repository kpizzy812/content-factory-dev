<script setup lang="ts">
definePageMeta({ middleware: ['admin-access'] })

const route = useRoute()
const userId = computed(() => Number(route.params.id))

const { data, pending, error, refresh } = useFetch(() => `/api/admin/users/${userId.value}`, {
  key: `admin-user-${userId.value}`,
})

const user = computed(() => data.value?.data ?? null)

useHead({ title: computed(() => `${user.value?.email ?? 'Пользователь'} — пользователь`) })

function onSaved() {
  refreshNuxtData(`admin-user-${userId.value}`)
  refreshNuxtData('admin-users')
}

const title = computed(() => {
  const u = user.value
  if (!u) return 'Пользователь'
  return [u.name, u.surname].filter(Boolean).join(' ') || u.email
})
</script>

<template>
  <div>
    <UiSkeleton v-if="pending && !user" variant="details" :count="4" />

    <UiErrorState
      v-else-if="error"
      title="Не удалось загрузить пользователя"
      :message="error.message"
      @retry="refresh"
    />

    <template v-else-if="user">
      <DetailHeader
        :title="title"
        :code="title === user.email ? undefined : user.email"
        back-to="/admin/users"
        back-label="К пользователям"
      >
        <template #badges>
          <!-- Подпись доменная: «работает» точнее «готово», тон — из общего словаря. -->
          <span
            class="rounded-sm border px-2 py-0.5 text-sm"
            :class="user.isActive
              ? 'border-success-border bg-success-bg text-success'
              : 'border-danger-border bg-danger-bg text-danger'"
          >
            {{ user.isActive ? 'Работает' : 'Заблокирован' }}
          </span>
        </template>
      </DetailHeader>

      <section class="rounded-lg border border-border bg-panel p-3.5">
        <AdminUserRoleEditor :user="user" @saved="onSaved" />
      </section>
    </template>
  </div>
</template>
