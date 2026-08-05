<script setup lang="ts">
/**
 * Состояние модуля публикации: включён ли постинг и что с OAuth по площадкам.
 *
 * Предупреждение об отключённом постинге показывается всегда, когда он
 * отключён: без него оператор создаёт загрузки и не понимает, почему они не
 * уходят.
 */
const { isEnabled, platforms, isLoading } = useUploadModuleStatus()

const PLATFORM_LABELS: Record<string, string> = {
  youtube: 'YouTube',
  tiktok: 'TikTok',
  instagram: 'Instagram',
}
</script>

<template>
  <div v-if="!isLoading" class="flex flex-col gap-2">
    <p
      v-if="!isEnabled"
      class="rounded-md border border-warning-border bg-warning-bg p-2.5 text-sm text-muted"
    >
      <span class="font-medium text-warning">Публикация отключена.</span>
      {{ ' ' }}<code class="font-mono">ENABLE_SOCIAL_POSTING=false</code> — загрузки можно создавать,
      но наружу они не уйдут.
    </p>

    <div class="flex flex-wrap gap-1.5">
      <span
        v-for="(cap, platform) in platforms"
        :key="platform"
        class="inline-flex h-[22px] items-center gap-1.5 rounded-sm border px-2 text-sm"
        :class="cap.available
          ? cap.oauthConfigured
            ? 'border-success-border bg-success-bg text-success'
            : 'border-warning-border bg-warning-bg text-warning'
          : 'border-border bg-card text-subtle'"
      >
        {{ PLATFORM_LABELS[platform] ?? platform }}
        <template v-if="!cap.available">· недоступна</template>
        <template v-else-if="!cap.oauthConfigured">· OAuth не настроен</template>
      </span>
    </div>
  </div>
</template>
