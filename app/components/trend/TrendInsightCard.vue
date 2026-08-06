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
  <section class="overflow-hidden rounded-lg border border-border bg-panel">
    <header class="flex items-center gap-2 border-b border-border bg-card px-3.5 py-2.5">
      <Icon name="mingcute:sparkles-2-line" class="text-warning" />
      <h2 class="text-sm font-medium">Анализ вирусности</h2>
      <span class="flex-1" />
      <span v-if="insight.confidence != null" class="tnum font-mono text-micro text-subtle">
        уверенность {{ Math.round(insight.confidence * 100) }}%
      </span>
    </header>

    <div class="flex flex-col gap-3 p-3.5">
      <p class="text-sm">{{ insight.whyViral }}</p>

      <div v-if="insight.patterns.length">
        <h3 class="mb-1 text-micro tracking-[.06em] text-subtle uppercase">Паттерны</h3>
        <div class="flex flex-wrap gap-1">
          <span
            v-for="pattern in insight.patterns"
            :key="pattern"
            class="rounded-sm border border-accent-border bg-accent-bg px-1.5 py-0.5 text-micro text-accent"
          >
            {{ pattern }}
          </span>
        </div>
      </div>

      <div v-if="insight.hooks.length">
        <h3 class="mb-1 text-micro tracking-[.06em] text-subtle uppercase">Хуки</h3>
        <ul class="flex flex-col gap-1">
          <li v-for="hook in insight.hooks" :key="hook" class="flex gap-2 text-sm">
            <span class="text-subtle">·</span>
            <span>{{ hook }}</span>
          </li>
        </ul>
      </div>

      <div v-if="insight.audience">
        <h3 class="mb-1 text-micro tracking-[.06em] text-subtle uppercase">Аудитория</h3>
        <p class="text-sm text-muted">{{ insight.audience }}</p>
      </div>
    </div>
  </section>
</template>
