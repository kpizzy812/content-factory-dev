<script setup lang="ts">
/**
 * Оболочка приложения. Источник: design-preview/_system/blocks/AppShell*.html
 *
 * Сайдбар и топбар фиксированы, скроллится только рабочая область — при
 * длинных списках шапка и навигация не уезжают.
 */
const route = useRoute()
const { loadLegacyModules } = useLegacyModules()

// Без await: навигация — computed и перерисуется, когда карта модулей приедет.
loadLegacyModules()

/** Редактор конвейера сам управляет своей высотой и не хочет внешних отступов. */
const isFullBleed = computed(() => /^\/pipeline\/\d+/.test(route.path))

// На мобильном сайдбар выезжает поверх содержимого, а не сжимает его.
const mobileOpen = useState('sidebar-mobile-open', () => false)
watch(() => route.path, () => { mobileOpen.value = false })
</script>

<template>
  <div class="flex h-screen overflow-hidden bg-surface text-fg">
    <AppSidebar class="hidden md:flex" />

    <div v-if="mobileOpen" class="fixed inset-0 z-40 flex md:hidden" @click.self="mobileOpen = false">
      <div class="absolute inset-0 bg-overlay" />
      <AppSidebar class="relative flex h-full" />
    </div>

    <div class="flex min-w-0 flex-1 flex-col">
      <AppTopbar />

      <main class="min-h-0 flex-1 overflow-y-auto" :class="isFullBleed ? '' : 'p-4'">
        <slot />
      </main>
    </div>

    <UiToastContainer />
  </div>
</template>
