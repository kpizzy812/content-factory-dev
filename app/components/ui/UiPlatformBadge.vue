<script setup lang="ts">
/**
 * Бейдж платформы. Источник: design-preview/_system/blocks/PlatformBadge.html
 *
 * Платформа — не статус. Цвет вынесен в узкую метку слева и намеренно не
 * заливает бейдж целиком, чтобы не спорить со статусным бейджем в той же строке.
 * Это единственное место в системе, где допустимы небрендовые фирменные цвета.
 */
const props = defineProps<{ platform: string }>()

const PLATFORMS: Record<string, { label: string, color: string }> = {
  instagram: { label: 'Instagram', color: '#d6337f' },
  tiktok: { label: 'TikTok', color: '#25d8d0' },
  youtube: { label: 'YouTube', color: '#e34b4b' },
}

const meta = computed(() =>
  PLATFORMS[props.platform.toLowerCase()] ?? { label: props.platform, color: 'var(--color-text-subtle)' },
)
</script>

<template>
  <span
    class="inline-flex h-[22px] items-center gap-1.5 rounded-sm border border-border bg-card px-2 text-sm whitespace-nowrap text-muted"
  >
    <span class="h-3 w-[5px] shrink-0 rounded-[2px]" :style="{ background: meta.color }" />
    {{ meta.label }}
  </span>
</template>
