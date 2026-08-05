<script setup lang="ts">
definePageMeta({ layout: 'default' })
useHead({ title: 'Настройки' })

const { user } = useUserSession()
const colorMode = useColorMode()

const themes = [
  { value: 'dark', label: 'Тёмная', dark: true },
  { value: 'light', label: 'Светлая', dark: false },
]

function setTheme(value: string) {
  colorMode.preference = value
}

const displayName = computed(() => {
  if (!user.value) return ''
  const parts = [user.value.name, user.value.surname].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : user.value.email
})

const roleLabel = computed(() => {
  const labels: Record<string, string> = {
    admin: 'Администратор',
    producer: 'Продюсер',
    operator: 'Оператор',
    analyst: 'Аналитик',
    observer: 'Наблюдатель',
  }
  return labels[user.value?.rolePreset ?? ''] ?? user.value?.rolePreset ?? ''
})
</script>

<template>
  <div class="space-y-6 max-w-2xl">
    <h1 class="text-2xl font-bold text-base-content">Настройки</h1>

    <!-- Профиль -->
    <div class="card bg-base-100 shadow-sm">
      <div class="card-body p-4 gap-3">
        <h2 class="card-title text-sm">
          <Icon name="mingcute:user-3-line" />
          Профиль
        </h2>
        <div v-if="user" class="flex items-center gap-4">
          <div class="avatar avatar-placeholder">
            <div class="bg-primary text-primary-content w-12 rounded-full">
              <span class="text-lg">
                {{ (user.name?.[0] ?? user.email?.[0] ?? '?').toUpperCase() }}
              </span>
            </div>
          </div>
          <div>
            <div class="font-medium text-base-content">{{ displayName }}</div>
            <div class="text-sm text-base-content/60">{{ user.email }}</div>
            <span v-if="roleLabel" class="badge badge-sm badge-outline mt-1">
              {{ roleLabel }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Тема -->
    <div class="card bg-base-100 shadow-sm">
      <div class="card-body p-4 gap-3">
        <h2 class="card-title text-sm">
          <Icon name="mingcute:palette-line" />
          Тема оформления
        </h2>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="t in themes"
            :key="t.value"
            class="btn btn-sm"
            :class="colorMode.preference === t.value ? 'btn-primary' : 'btn-ghost'"
            @click="setTheme(t.value)"
          >
            <Icon :name="t.dark ? 'mingcute:moon-line' : 'mingcute:sun-line'" />
            {{ t.label }}
          </button>
        </div>
      </div>
    </div>

    <!-- Интеграция -->
    <div>
      <h2 class="text-lg font-semibold text-base-content mb-3">Интеграция</h2>
      <SettingsIntegrationCard />
    </div>
  </div>
</template>
