<script setup lang="ts">
const { isEnabled, platforms, isLoading } = useUploadModuleStatus()
</script>

<template>
  <div v-if="!isLoading">
    <!-- Disabled banner -->
    <div v-if="!isEnabled" class="alert alert-warning mb-4">
      <Icon name="mingcute:lock-line" class="text-lg" />
      <div>
        <h3 class="font-bold text-sm">Модуль загрузки отключён</h3>
        <p class="text-xs">
          Переменная окружения <code class="font-mono">ENABLE_SOCIAL_POSTING</code> установлена в <code>false</code>.
          Реальная публикация невозможна. Создание загрузок доступно в режиме preview.
        </p>
      </div>
    </div>

    <!-- Platform status -->
    <div class="flex flex-wrap gap-2 mb-4">
      <div
        v-for="(cap, platform) in platforms"
        :key="platform"
        class="badge gap-1"
        :class="cap.available ? (cap.oauthConfigured ? 'badge-success' : 'badge-warning') : 'badge-ghost'"
      >
        <Icon
          :name="platform === 'youtube' ? 'mingcute:youtube-line' : platform === 'tiktok' ? 'mingcute:tiktok-line' : 'mingcute:instagram-line'"
          class="text-xs"
        />
        {{ platform }}
        <template v-if="!cap.available">(недоступно)</template>
        <template v-else-if="!cap.oauthConfigured">(OAuth не настроен)</template>
      </div>
    </div>
  </div>
</template>
