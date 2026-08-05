<script setup lang="ts">
const route = useRoute()
const { clear } = useUserSession()
const colorMode = useColorMode()
const { can, canAccessModule } = usePermissions()

// Без await: navGroups — computed и сам перерисуется, когда карта приедет.
// Стартовое состояние «всё выключено», поэтому запрещённые пункты не мигают.
const { legacyModules, loadLegacyModules } = useLegacyModules()
loadLegacyModules()

const isLoggingOut = ref(false)

interface NavGroup {
  label: string
  icon: string
  items: NavItem[]
}

interface NavItem {
  to: string
  label: string
  icon: string
  module: string | null
  permission?: string
}

// Группировка навигации по смыслу
const navGroups = computed(() => {
  const groups: (NavItem | NavGroup)[] = []

  // Конвейер — отдельный пункт (главный)
  if (canAccessModule('pipeline')) {
    groups.push({ to: '/pipeline', label: 'Конвейер', icon: 'mingcute:git-merge-line', module: 'pipeline' })
  }

  // Производство: Тренды + Сценарии + Идеи + Креативы + Лучшие промты
  const production: NavItem[] = []
  if (canAccessModule('trendwatcher')) production.push({ to: '/trends', label: 'Тренды', icon: 'mingcute:eye-line', module: 'trendwatcher' })
  if (canAccessModule('script-generator')) production.push({ to: '/scenarios', label: 'Сценарии', icon: 'mingcute:document-line', module: 'script-generator' })
  if (canAccessModule('script-generator')) production.push({ to: '/ideas', label: 'Идеи', icon: 'mingcute:bulb-line', module: 'script-generator' })
  if (canAccessModule('script-generator')) production.push({ to: '/characters', label: 'Персонажи', icon: 'mingcute:user-3-line', module: 'script-generator' })
  if (canAccessModule('script-generator')) production.push({ to: '/scenes', label: 'Композитор сцен', icon: 'mingcute:layers-line', module: 'script-generator' })
  if (canAccessModule('trendwatcher')) production.push({ to: '/creatives', label: 'Креативы', icon: 'mingcute:pic-line', module: 'trendwatcher' })
  if (canAccessModule('trendwatcher') && legacyModules.value.googleDrive) production.push({ to: '/google-drive', label: 'Google Drive', icon: 'mingcute:cloud-line', module: 'trendwatcher' })
  if (canAccessModule('script-generator')) production.push({ to: '/prompts-library', label: 'Лучшие промты', icon: 'mingcute:star-line', module: 'script-generator' })
  if (production.length) groups.push({ label: 'Производство', icon: 'mingcute:movie-line', items: production })

  // Медиа: Видео + Загрузки + Аккаунты
  const media: NavItem[] = []
  if (canAccessModule('video-generator')) media.push({ to: '/videos', label: 'Видео', icon: 'mingcute:video-line', module: 'video-generator' })
  if (canAccessModule('social-upload')) media.push({ to: '/uploads', label: 'Загрузки', icon: 'mingcute:upload-3-line', module: 'social-upload' })
  if (canAccessModule('social-upload') && legacyModules.value.deviceAutomation) media.push({ to: '/posting-jobs', label: 'Постинг', icon: 'mingcute:send-line', module: 'social-upload' })
  if (canAccessModule('social-upload')) media.push({ to: '/accounts', label: 'Аккаунты', icon: 'mingcute:group-line', module: 'social-upload' })
  if (canAccessModule('social-upload') && legacyModules.value.proxyPool) media.push({ to: '/proxies', label: 'Прокси', icon: 'mingcute:wifi-line', module: 'social-upload' })
  if (canAccessModule('social-upload') && legacyModules.value.deviceAutomation) media.push({ to: '/devices', label: 'DuoPlus', icon: 'mingcute:safari-line', module: 'social-upload' })
  if (media.length) groups.push({ label: 'Медиа', icon: 'mingcute:video-line', items: media })

  // Аналитика: Аналитика + Референсы
  const analytics: NavItem[] = []
  if (canAccessModule('analytics')) analytics.push({ to: '/analytics', label: 'Аналитика', icon: 'mingcute:chart-bar-line', module: 'analytics' })
  if (canAccessModule('analytics')) analytics.push({ to: '/references', label: 'Референсы', icon: 'mingcute:star-line', module: 'analytics' })
  if (analytics.length) groups.push({ label: 'Аналитика', icon: 'mingcute:chart-bar-line', items: analytics })

  // Настройки + Админ
  groups.push({ to: '/settings', label: 'Настройки', icon: 'mingcute:settings-3-line', module: null })
  if (can('canAdmin')) groups.push({ to: '/admin', label: 'Админ', icon: 'mingcute:shield-line', module: null, permission: 'canAdmin' })

  return groups
})

// Flat list for mobile
const allNavItems = computed(() => {
  const items: NavItem[] = []
  for (const group of navGroups.value) {
    if ('items' in group) {
      items.push(...group.items)
    } else {
      items.push(group)
    }
  }
  return items
})

function isGroup(item: NavItem | NavGroup): item is NavGroup {
  return 'items' in item
}

// Управление dropdown — только один открыт, закрывается при клике вне
const openDropdown = ref<string | null>(null)

function toggleDropdown(label: string) {
  openDropdown.value = openDropdown.value === label ? null : label
}

function closeDropdowns() {
  openDropdown.value = null
}

function closeMobileMenu() {
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur()
  }
}

// Закрытие при клике вне navbar
onMounted(() => {
  document.addEventListener('click', onDocClick)
})
onUnmounted(() => {
  document.removeEventListener('click', onDocClick)
})

function onDocClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (!target.closest('.nav-dropdown')) {
    openDropdown.value = null
  }
}

const themes = [
  { value: 'dark', label: 'Тёмная', dark: true },
  { value: 'light', label: 'Светлая', dark: false },
]

const currentThemeLabel = computed(() => {
  const t = themes.find(t => t.value === colorMode.preference)
  return t?.label ?? 'Тема'
})

function setTheme(value: string) {
  colorMode.preference = value
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur()
  }
}

async function handleLogout() {
  isLoggingOut.value = true
  try {
    await $fetch("/api/auth/logout", { method: "POST" })
    await clear()
    await navigateTo("/auth/login")
  } catch {
    await navigateTo("/auth/login")
  } finally {
    isLoggingOut.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-base-200">
    <div class="navbar bg-base-100 shadow-sm">
      <div class="navbar-start">
        <NuxtLink to="/" class="btn btn-ghost text-xl">
          <Icon name="mingcute:building-4-fill" class="text-primary" />
          <span class="hidden sm:inline">Контент-Завод</span>
        </NuxtLink>

        <!-- Мобильное меню -->
        <div class="dropdown xl:hidden">
          <div tabindex="0" role="button" class="btn btn-ghost btn-sm">
            <Icon name="mingcute:menu-line" class="h-5 w-5" />
          </div>
          <ul tabindex="0" class="dropdown-content menu bg-base-100 rounded-box z-10 w-56 p-2 shadow-lg mt-1">
            <li v-for="item in allNavItems" :key="item.to">
              <NuxtLink :to="item.to" active-class="active" @click="closeMobileMenu">
                <Icon :name="item.icon" />
                {{ item.label }}
              </NuxtLink>
            </li>
          </ul>
        </div>
      </div>

      <!-- Desktop navbar с группами -->
      <div class="navbar-center hidden xl:flex">
        <ul class="menu menu-horizontal gap-1">
          <template v-for="(group, i) in navGroups" :key="i">
            <!-- Dropdown группа -->
            <li v-if="isGroup(group)" class="nav-dropdown relative">
              <button
                class="flex items-center gap-1"
                @click.stop="toggleDropdown(group.label)"
              >
                <Icon :name="group.icon" />
                {{ group.label }}
                <Icon name="mingcute:down-line" class="h-3 w-3" />
              </button>
              <ul
                v-show="openDropdown === group.label"
                class="absolute top-full left-0 mt-1 bg-base-100 rounded-box z-20 w-48 p-2 shadow-lg border border-base-300"
              >
                <li v-for="item in group.items" :key="item.to">
                  <NuxtLink :to="item.to" active-class="active" @click="closeDropdowns">
                    <Icon :name="item.icon" />
                    {{ item.label }}
                  </NuxtLink>
                </li>
              </ul>
            </li>
            <!-- Одиночный пункт -->
            <li v-else>
              <NuxtLink :to="group.to" active-class="active" @click="closeDropdowns">
                <Icon :name="group.icon" />
                {{ group.label }}
              </NuxtLink>
            </li>
          </template>
        </ul>
      </div>

      <div class="navbar-end gap-1">
        <!-- Theme picker -->
        <div class="dropdown dropdown-end">
          <div tabindex="0" role="button" class="btn btn-ghost btn-sm gap-2">
            <Icon name="mingcute:palette-line" class="h-5 w-5" />
            <span class="hidden lg:inline">{{ currentThemeLabel }}</span>
          </div>
          <ul tabindex="0" class="dropdown-content menu bg-base-100 rounded-box z-10 w-52 p-2 shadow-lg mt-1">
            <li v-for="t in themes" :key="t.value">
              <button
                class="flex items-center gap-2"
                :class="{ active: colorMode.preference === t.value }"
                @click="setTheme(t.value)"
              >
                <span class="inline-block w-3 h-3 rounded-full bg-primary" />
                {{ t.label }}
              </button>
            </li>
          </ul>
        </div>

        <!-- Logout -->
        <button
          class="btn btn-ghost btn-sm"
          :disabled="isLoggingOut"
          @click="handleLogout"
        >
          <span
            v-if="isLoggingOut"
            class="loading loading-spinner loading-sm"
          />
          <Icon v-else name="mingcute:exit-line" />
          <span class="hidden sm:inline">Выйти</span>
        </button>
      </div>
    </div>

    <main class="p-4" :class="route.path.match(/^\/pipeline\/\d+/) ? '' : 'pb-48'">
      <slot />
    </main>

    <SharedToastContainer />
  </div>
</template>
