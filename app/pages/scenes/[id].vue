<script setup lang="ts">
definePageMeta({ layout: 'default', middleware: 'module-access', moduleSlug: 'script-generator' })

const route = useRoute()
const id = computed(() => String(route.params.id))

const { data, pending, error, refresh } = useScene(id)
const detail = computed(() => data.value?.data ?? null)
useHead({ title: () => detail.value ? `${detail.value.scene.name} — Сцена` : 'Сцена' })

async function onRefresh() {
  await refresh()
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center gap-2">
      <NuxtLink to="/scenes" class="btn btn-ghost btn-sm">
        <Icon name="mingcute:arrow-left-line" />
        К списку
      </NuxtLink>
      <h1 v-if="detail" class="text-2xl font-bold text-base-content">{{ detail.scene.name }}</h1>
    </div>

    <div v-if="pending" class="flex justify-center py-12">
      <span class="loading loading-spinner loading-lg" />
    </div>

    <div v-else-if="error" role="alert" class="alert alert-error">
      <Icon name="mingcute:warning-line" />
      <span>Ошибка: {{ error.message }}</span>
    </div>

    <SceneComposer
      v-else-if="detail"
      :scene="detail.scene"
      :blocks="detail.blocks"
      :characters="detail.characters"
      :app-screens="detail.appScreens"
      :compiled="detail.compiled"
      @refresh="onRefresh"
    />
  </div>
</template>
