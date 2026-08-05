<script setup lang="ts">
/**
 * Верхняя панель. Источник: design-preview/_system/blocks/TopBar.html
 *
 * Держит контекст страницы слева, вход в ⌘K по центру и операционные величины
 * справа: сколько запусков идёт, есть ли алерты, сколько потрачено за сутки.
 * Расход вынесен сюда намеренно — раньше он был виден только в админке.
 */
const route = useRoute()
const { matchItem } = useAppNavigation()
const { counters } = useNavCounters()

const palette = ref<{ openPalette: () => void } | null>(null)
const mobileOpen = useState('sidebar-mobile-open', () => false)

const crumbs = computed(() => {
  const item = matchItem(route.path)
  if (!item) return [{ label: 'ContentFactory', muted: false }]
  const parts = item.group ? [{ label: item.group, muted: true }] : []
  return [...parts, { label: item.label, muted: false }]
})

// Определяется только на клиенте и после гидратации: на сервере платформы нет,
// а вычисление прямо в computed давало рассинхрон разметки.
const modKey = ref('Ctrl')
onMounted(() => {
  if (/Mac|iPhone|iPad/.test(navigator.platform)) modKey.value = '⌘'
})
</script>

<template>
  <header class="flex h-11 shrink-0 items-center gap-3 border-b border-border bg-panel px-3.5">
    <button
      type="button"
      class="shrink-0 cursor-pointer text-muted hover:text-fg md:hidden"
      aria-label="Меню"
      @click="mobileOpen = !mobileOpen"
    >
      <Icon name="mingcute:menu-line" />
    </button>

    <div class="flex shrink-0 items-center gap-[7px] text-sm whitespace-nowrap">
      <template v-for="(c, i) in crumbs" :key="i">
        <span v-if="i > 0" class="text-subtle">/</span>
        <span :class="c.muted ? 'text-subtle' : 'font-medium'">{{ c.label }}</span>
      </template>
    </div>

    <button
      type="button"
      class="relative hidden shrink basis-80 cursor-text sm:block"
      @click="palette?.openPalette()"
    >
      <Icon name="mingcute:search-line" class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-subtle" />
      <span
        class="flex h-[29px] items-center rounded-md border border-border bg-card pr-2.5 pl-[30px] text-sm whitespace-nowrap text-subtle"
      >
        Поиск и команды
        <span class="flex-1" />
        <span class="rounded-sm border border-border bg-surface px-1.5 font-mono text-micro">
          {{ modKey === '⌘' ? '⌘K' : 'Ctrl+K' }}
        </span>
      </span>
    </button>

    <div class="flex-1" />

    <NuxtLink
      to="/"
      class="flex h-[26px] shrink-0 items-center gap-2 rounded-md border border-border bg-card px-[9px] whitespace-nowrap hover:border-subtle"
    >
      <span class="inline-flex items-center gap-1.5 text-sm text-muted">
        <span class="size-1.5 rounded-full" :class="counters.activeRuns ? 'bg-info' : 'bg-neutral-border'" />
        <span class="tnum font-mono">{{ counters.activeRuns ?? 0 }}</span> запусков
      </span>
    </NuxtLink>

    <AppPageHint />
  </header>

  <AppCommandPalette ref="palette" />
</template>
