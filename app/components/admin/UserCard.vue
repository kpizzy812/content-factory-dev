<script setup lang="ts">
/**
 * Карточка пользователя в списке администратора.
 * Здесь только пресет роли и активность: сами права правятся не в карточке.
 */
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
  <NuxtLink
    :to="`/admin/users/${user.id}`"
    class="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 transition-colors duration-(--duration-fast) hover:border-subtle"
  >
    <div class="flex items-center gap-2.5">
      <span
        class="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-panel text-sm text-muted"
        aria-hidden="true"
      >
        {{ (user.name?.[0] ?? user.email?.[0] ?? '?').toUpperCase() }}
      </span>
      <div class="min-w-0 flex-1">
        <div class="truncate font-medium">
          {{ [user.name, user.surname].filter(Boolean).join(' ') || user.email }}
        </div>
        <div class="truncate text-sm text-muted">{{ user.email }}</div>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-1.5">
      <span class="rounded-sm border border-divider px-1.5 py-0.5 text-micro text-muted">
        {{ presetLabels[user.rolePreset] ?? user.rolePreset }}
      </span>
      <span
        class="rounded-sm border px-1.5 py-0.5 text-micro"
        :class="user.isActive
          ? 'border-success-border bg-success-bg text-success'
          : 'border-divider text-subtle'"
      >
        {{ user.isActive ? 'Активен' : 'Неактивен' }}
      </span>
    </div>
  </NuxtLink>
</template>
