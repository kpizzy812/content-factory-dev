<script setup lang="ts">
defineProps<{
  user: {
    id: number
    email: string
    name?: string | null
    surname?: string | null
    rolePreset: string
    isActive: boolean
  }
}>()

const presetLabels: Record<string, string> = {
  admin: 'Администратор',
  producer: 'Продюсер',
  operator: 'Оператор',
  analyst: 'Аналитик',
  observer: 'Наблюдатель',
}
</script>

<template>
  <NuxtLink :to="`/admin/users/${user.id}`" class="card bg-base-100 shadow-sm hover:shadow-md transition-shadow">
    <div class="card-body p-4 gap-2">
      <div class="flex items-center gap-3">
        <div class="avatar avatar-placeholder">
          <div class="bg-neutral text-neutral-content w-10 rounded-full">
            <span class="text-sm">{{ (user.name?.[0] ?? user.email?.[0] ?? '?').toUpperCase() }}</span>
          </div>
        </div>
        <div class="flex-1 min-w-0">
          <div class="font-medium text-base-content truncate">
            {{ [user.name, user.surname].filter(Boolean).join(' ') || user.email }}
          </div>
          <div class="text-sm text-base-content/60 truncate">{{ user.email }}</div>
        </div>
      </div>

      <div class="flex items-center gap-2 mt-1">
        <span class="badge badge-sm badge-outline">
          {{ presetLabels[user.rolePreset] ?? user.rolePreset }}
        </span>
        <span
          :class="['badge badge-sm', user.isActive ? 'badge-success' : 'badge-ghost']"
        >
          {{ user.isActive ? 'Активен' : 'Неактивен' }}
        </span>
      </div>
    </div>
  </NuxtLink>
</template>
