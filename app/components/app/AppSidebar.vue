<script setup lang="ts">
/**
 * Сайдбар. Источник: design-preview/_system/blocks/Sidebar*.html
 *
 * Заменяет горизонтальное меню с выпадающими группами, которое ниже широкого
 * экрана схлопывалось в плоский список из 20+ пунктов без иерархии.
 *
 * Два состояния: развёрнутый 240 px и свёрнутый 56 px (только иконки).
 * Состояние запоминается. На планшете сворачивается автоматически.
 */
const { primary, primaryChildren, groups, matchItem } = useAppNavigation()
const { counters } = useNavCounters()
const { user, clear } = useUserSession()
const colorMode = useColorMode()
const route = useRoute()

const collapsed = useState('sidebar-collapsed', () => false)
const openGroups = useState<Record<string, boolean>>('sidebar-groups', () => ({}))

onMounted(() => {
  const saved = localStorage.getItem('sidebar-collapsed')
  if (saved !== null) collapsed.value = saved === '1'
  else collapsed.value = window.matchMedia('(max-width: 1279px)').matches

  // Раскрыта только группа активного раздела: при 20 пунктах развёрнутый
  // целиком сайдбар перестаёт читаться. Если активной группы нет (главная,
  // страница вне навигации) — раскрываем первую, иначе меню выглядит пустым.
  const active = matchItem(route.path)
  const activeGroup = groups.value.find(g => g.items.some(i => i.to === active?.to))
  const fallback = activeGroup ?? groups.value[0]
  for (const g of groups.value) {
    openGroups.value[g.key] ??= g.key === fallback?.key
  }
})

function toggleCollapsed() {
  collapsed.value = !collapsed.value
  localStorage.setItem('sidebar-collapsed', collapsed.value ? '1' : '0')
}

function isActive(to: string) {
  return route.path === to || route.path.startsWith(`${to}/`)
}

const initials = computed(() => {
  const u = user.value
  if (!u) return '—'
  const parts = [u.name, u.surname].filter(Boolean) as string[]
  if (parts.length) return parts.map(p => p[0]).join('').toUpperCase()
  return (u.email as string | undefined)?.slice(0, 2).toUpperCase() ?? '—'
})

const displayName = computed(() => {
  const u = user.value
  if (!u) return ''
  return [u.name, u.surname].filter(Boolean).join(' ') || (u.email as string)
})

async function logout() {
  try {
    await $fetch('/api/auth/logout', { method: 'POST' })
  }
  finally {
    await clear()
    await navigateTo('/auth/login')
  }
}
</script>

<template>
  <nav
    class="flex shrink-0 flex-col border-r border-border bg-panel transition-[width] duration-(--duration-base) ease-out"
    :class="collapsed ? 'w-14' : 'w-60'"
  >
    <div class="flex h-11 shrink-0 items-center gap-[9px] border-b border-divider px-3">
      <NuxtLink
        to="/"
        class="flex size-[22px] shrink-0 items-center justify-center rounded-sm bg-accent font-mono text-micro font-bold text-on-accent"
      >
        CF
      </NuxtLink>
      <span v-if="!collapsed" class="truncate text-base font-semibold tracking-[-.01em]">ContentFactory</span>
      <button
        type="button"
        class="ml-auto shrink-0 cursor-pointer text-subtle hover:text-fg"
        :aria-label="collapsed ? 'Развернуть меню' : 'Свернуть меню'"
        @click="toggleCollapsed"
      >
        <Icon :name="collapsed ? 'mingcute:right-line' : 'mingcute:left-line'" />
      </button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-2 pt-2 pb-1">
      <!-- Конвейер — главный раздел, отдельным выделенным пунктом -->
      <template v-if="primary">
        <NuxtLink
          :to="primary.to"
          class="relative mb-2 flex h-[34px] items-center gap-[9px] rounded-md border px-[9px] text-base font-medium"
          :class="isActive(primary.to)
            ? 'border-accent-border bg-accent-bg text-fg'
            : 'border-transparent text-muted hover:bg-card hover:text-fg'"
          :title="collapsed ? primary.label : undefined"
        >
          <span v-if="isActive(primary.to)" class="absolute inset-y-1.5 left-0 w-0.5 rounded-[2px] bg-accent" />
          <Icon :name="primary.icon" class="shrink-0" />
          <template v-if="!collapsed">
            <span class="truncate">{{ primary.label }}</span>
            <span
              v-if="counters.activeRuns"
              class="tnum ml-auto min-w-6 text-right font-mono text-micro text-accent-text"
            >{{ counters.activeRuns }}</span>
          </template>
        </NuxtLink>

        <div v-if="!collapsed" class="mt-[-4px] mb-2.5 border-l border-divider pl-[9px]">
          <NuxtLink
            v-for="child in primaryChildren"
            :key="child.to"
            :to="child.to"
            class="flex h-[26px] items-center rounded-sm px-2 text-sm"
            :class="route.path === child.to ? 'bg-card text-fg' : 'text-muted hover:bg-card hover:text-fg'"
          >
            {{ child.label }}
          </NuxtLink>
        </div>
      </template>

      <!-- Группы -->
      <div v-for="group in groups" :key="group.key" class="mb-1">
        <button
          v-if="!collapsed"
          type="button"
          class="flex h-6 w-full cursor-pointer items-center gap-1.5 px-[9px] text-[10.5px] tracking-[.07em] text-subtle uppercase hover:text-muted"
          @click="openGroups[group.key] = !openGroups[group.key]"
        >
          <span class="truncate">{{ group.label }}</span>
          <span class="flex-1" />
          <span v-if="!openGroups[group.key]" class="tnum font-mono text-[10px]">{{ group.items.length }}</span>
          <Icon :name="openGroups[group.key] ? 'mingcute:up-line' : 'mingcute:down-line'" class="shrink-0" />
        </button>
        <div v-else class="my-1.5 h-px bg-divider" />

        <template v-if="collapsed || openGroups[group.key]">
          <NuxtLink
            v-for="item in group.items"
            :key="item.to"
            :to="item.to"
            class="relative flex h-[29px] items-center gap-[9px] rounded-sm px-[9px] text-sm"
            :class="isActive(item.to) ? 'bg-card text-fg' : 'text-muted hover:bg-card hover:text-fg'"
            :title="collapsed ? item.label : undefined"
          >
            <span v-if="isActive(item.to)" class="absolute inset-y-1 left-0 w-0.5 rounded-[2px] bg-accent" />
            <Icon :name="item.icon" class="shrink-0" />
            <template v-if="!collapsed">
              <span class="truncate">{{ item.label }}</span>
              <span class="flex-1" />
              <!-- Место под 3 знака зарезервировано: при поллинге раз в 5 с
                   пункт не должен менять ширину, когда меняется цифра. -->
              <span
                v-if="item.counter && counters[item.counter as keyof typeof counters]"
                class="tnum min-w-6 shrink-0 text-right font-mono text-micro"
                :class="item.counterWarns
                  ? 'rounded-sm border border-warning-border bg-warning-bg px-1 text-warning'
                  : 'text-subtle'"
              >{{ counters[item.counter as keyof typeof counters] }}</span>
            </template>
          </NuxtLink>
        </template>
      </div>
    </div>

    <div class="shrink-0 border-t border-divider p-2">
      <div class="flex h-[34px] items-center gap-[9px] rounded-md px-2 hover:bg-card">
        <span
          class="flex size-[22px] shrink-0 items-center justify-center rounded-full border border-border bg-card font-mono text-[10.5px] text-muted"
        >{{ initials }}</span>
        <div v-if="!collapsed" class="min-w-0 flex-1">
          <div class="truncate text-sm">{{ displayName }}</div>
        </div>
        <template v-if="!collapsed">
          <button
            type="button"
            class="shrink-0 cursor-pointer text-subtle hover:text-fg"
            :title="colorMode.preference === 'dark' ? 'Светлая тема' : 'Тёмная тема'"
            @click="colorMode.preference = colorMode.preference === 'dark' ? 'light' : 'dark'"
          >
            <Icon :name="colorMode.preference === 'dark' ? 'mingcute:sun-line' : 'mingcute:moon-line'" />
          </button>
          <button type="button" class="shrink-0 cursor-pointer text-subtle hover:text-danger" title="Выход" @click="logout">
            <Icon name="mingcute:exit-line" />
          </button>
        </template>
      </div>
    </div>
  </nav>
</template>
