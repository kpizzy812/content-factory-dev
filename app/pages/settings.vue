<script setup lang="ts">
/**
 * Настройки пользователя. Макет: design-preview/catalog/08-settings-admin.dc.html
 *
 * Здесь только то, что человек меняет себе: тема и вид собственной учётки.
 * Права и модули приходят из MarketingCamp и правятся не тут — на них стоит
 * ссылка в админку, чтобы не искать.
 */
definePageMeta({ layout: 'default' })
useHead({ title: 'Настройки' })

const { user } = useUserSession()
const { can } = usePermissions()
const colorMode = useColorMode()

const THEMES = [
  { value: 'dark', label: 'Тёмная', icon: 'mingcute:moon-line' },
  { value: 'light', label: 'Светлая', icon: 'mingcute:sun-line' },
]

const ROLE_LABELS: Record<string, string> = {
  admin: 'Администратор',
  producer: 'Продюсер',
  operator: 'Оператор',
  analyst: 'Аналитик',
  observer: 'Наблюдатель',
}

const displayName = computed(() => {
  if (!user.value) return ''
  const parts = [user.value.name, user.value.surname].filter(Boolean)
  return parts.length ? parts.join(' ') : user.value.email
})

const initials = computed(() =>
  (user.value?.name?.[0] ?? user.value?.email?.[0] ?? '?').toUpperCase(),
)

const roleLabel = computed(() =>
  ROLE_LABELS[user.value?.rolePreset ?? ''] ?? user.value?.rolePreset ?? '',
)

const modules = computed(() => user.value?.moduleAccess ?? [])
</script>

<template>
  <div class="flex max-w-3xl flex-col gap-4">
    <h1 class="text-xl font-semibold">Настройки</h1>

    <section class="overflow-hidden rounded-lg border border-border bg-panel">
      <h2 class="border-b border-divider bg-card px-3.5 py-2.5 text-base font-medium">Профиль</h2>
      <div v-if="user" class="flex flex-wrap items-center gap-3.5 px-3.5 py-3">
        <span
          class="flex size-12 shrink-0 items-center justify-center rounded-full border border-border bg-card text-lg font-mono text-muted"
        >{{ initials }}</span>
        <div class="min-w-0 flex-1">
          <div class="truncate font-medium">{{ displayName }}</div>
          <div class="truncate font-mono text-sm text-subtle">{{ user.email }}</div>
        </div>
        <span
          v-if="roleLabel"
          class="inline-flex h-[22px] items-center rounded-sm border border-border bg-card px-2 text-sm text-muted"
        >{{ roleLabel }}</span>
      </div>

      <div v-if="modules.length" class="flex flex-wrap items-center gap-1.5 border-t border-divider px-3.5 py-2.5">
        <span class="text-sm text-subtle">Доступные разделы:</span>
        <span
          v-for="slug in modules"
          :key="slug"
          class="inline-flex h-[18px] items-center rounded-sm border border-border bg-card px-1.5 font-mono text-micro text-muted"
        >{{ slug }}</span>
      </div>

      <p class="border-t border-divider bg-card px-3.5 py-2 text-micro text-subtle">
        Роль и права приходят из MarketingCamp при входе и здесь не правятся.
        <NuxtLink v-if="can('canAdmin')" to="/admin/users">Кто и что может</NuxtLink>
      </p>
    </section>

    <section class="overflow-hidden rounded-lg border border-border bg-panel">
      <h2 class="border-b border-divider bg-card px-3.5 py-2.5 text-base font-medium">Оформление</h2>
      <div class="flex flex-col gap-2 px-3.5 py-3">
        <ClientOnly>
          <div class="flex flex-wrap gap-1.5">
            <UiButton
              v-for="theme in THEMES"
              :key="theme.value"
              :variant="colorMode.preference === theme.value ? 'primary' : 'secondary'"
              @click="colorMode.preference = theme.value"
            >
              <Icon :name="theme.icon" />
              {{ theme.label }}
            </UiButton>
          </div>
          <template #fallback>
            <div class="flex flex-wrap gap-1.5">
              <UiButton v-for="theme in THEMES" :key="theme.value" disabled>
                <Icon :name="theme.icon" />
                {{ theme.label }}
              </UiButton>
            </div>
          </template>
        </ClientOnly>
        <p class="text-sm text-subtle">Настройка личная и хранится в этом браузере.</p>
      </div>
    </section>

    <section class="flex flex-col gap-2">
      <h2 class="text-base font-medium">Интеграции</h2>
      <SettingsIntegrationCard />
    </section>
  </div>
</template>
