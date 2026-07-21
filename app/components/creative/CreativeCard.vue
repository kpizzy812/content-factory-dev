<script setup lang="ts">
const props = defineProps<{
  type: 'trend' | 'scenario' | 'video'
  id: number
  title: string
  status: string
  platform: string | null
  createdAt: string
  appName: string | null
}>()

const typeConfig = computed(() => {
  switch (props.type) {
    case 'trend':
      return { icon: 'mingcute:eye-line', label: 'Тренд', route: `/trends/${props.id}` }
    case 'scenario':
      return { icon: 'mingcute:document-line', label: 'Сценарий', route: `/scenarios/${props.id}` }
    case 'video':
      return { icon: 'mingcute:video-line', label: 'Видео', route: `/videos/${props.id}` }
  }
})

const statusColor = computed(() => {
  const colorMap: Record<string, string> = {
    new: 'badge-info', reviewed: 'badge-warning', in_work: 'badge-accent',
    completed: 'badge-success', dismissed: 'badge-ghost',
    draft: 'badge-ghost', selected: 'badge-primary', rejected: 'badge-error',
    pending: 'badge-warning', generating_images: 'badge-accent',
    generating_clips: 'badge-accent', assembling: 'badge-accent', failed: 'badge-error',
  }
  return colorMap[props.status] ?? 'badge-ghost'
})

const formattedDate = computed(() =>
  new Date(props.createdAt).toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'short', year: 'numeric',
  }),
)
</script>

<template>
  <NuxtLink :to="typeConfig.route" class="card bg-base-100 shadow-sm hover:shadow-md transition-shadow">
    <div class="card-body p-4 gap-2">
      <div class="flex items-center gap-2">
        <Icon :name="typeConfig.icon" class="text-primary text-lg" />
        <span class="badge badge-ghost badge-sm">{{ typeConfig.label }}</span>
        <span v-if="platform" class="badge badge-outline badge-sm">{{ platform }}</span>
      </div>
      <h3 class="card-title text-sm line-clamp-2">{{ title }}</h3>
      <div class="flex items-center gap-2 flex-wrap">
        <span class="badge badge-sm" :class="statusColor">{{ status }}</span>
        <span v-if="appName" class="badge badge-soft badge-sm">{{ appName }}</span>
      </div>
      <p class="text-xs text-base-content/50">{{ formattedDate }}</p>
    </div>
  </NuxtLink>
</template>
