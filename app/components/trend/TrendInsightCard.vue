<script setup lang="ts">
defineProps<{
  insight: {
    id: number
    whyViral: string
    patterns: string[]
    hooks: string[]
    audience?: string | null
    confidence?: number | null
  }
}>()
</script>

<template>
  <div class="card bg-base-100 shadow-sm">
    <div class="card-body p-4 gap-3">
      <h4 class="card-title text-sm">
        <Icon name="mingcute:sparkles-2-line" class="text-warning" />
        Анализ вирусности
      </h4>

      <!-- Почему вирусно -->
      <p class="text-sm text-base-content/80">
        {{ insight.whyViral }}
      </p>

      <!-- Паттерны -->
      <div v-if="insight.patterns.length > 0">
        <span class="text-xs font-medium text-base-content/50 mb-1 block">Паттерны</span>
        <div class="flex flex-wrap gap-1">
          <span
            v-for="pattern in insight.patterns"
            :key="pattern"
            class="badge badge-soft badge-sm badge-primary"
          >
            {{ pattern }}
          </span>
        </div>
      </div>

      <!-- Хуки -->
      <div v-if="insight.hooks.length > 0">
        <span class="text-xs font-medium text-base-content/50 mb-1 block">Хуки</span>
        <ul class="list-disc list-inside text-sm text-base-content/80">
          <li v-for="hook in insight.hooks" :key="hook">
            {{ hook }}
          </li>
        </ul>
      </div>

      <!-- Аудитория -->
      <div v-if="insight.audience">
        <span class="text-xs font-medium text-base-content/50 mb-1 block">Аудитория</span>
        <p class="text-sm text-base-content/80">{{ insight.audience }}</p>
      </div>

      <!-- Уверенность -->
      <div v-if="insight.confidence != null">
        <span class="text-xs font-medium text-base-content/50 mb-1 block">
          Уверенность: {{ Math.round(insight.confidence * 100) }}%
        </span>
        <progress
          class="progress progress-primary w-full"
          :value="insight.confidence * 100"
          max="100"
        />
      </div>
    </div>
  </div>
</template>
