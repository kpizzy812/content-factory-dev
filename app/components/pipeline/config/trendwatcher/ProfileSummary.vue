<script setup lang="ts">
import type { TrendwatcherProfile } from '~/composables/useTrendwatcherProfiles'

defineProps<{
  profile: TrendwatcherProfile | null
}>()

const platformLabels: Record<string, string> = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  youtube: 'YouTube',
}

const actorShort: Record<string, string> = {
  'clockworks/tiktok-scraper': 'TikTok (Clockworks)',
  'apidojo/tiktok-scraper': 'TikTok (Apidojo)',
  'apify/instagram-scraper': 'Instagram',
  'streamers/youtube-scraper': 'YouTube (Streamers)',
  'apidojo/youtube-scraper': 'YouTube (Apidojo)',
}
</script>

<template>
  <div v-if="profile" class="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-1.5 font-medium">
          <Icon name="mingcute:search-2-line" class="shrink-0 text-muted" />
          {{ profile.name }}
          <span
            v-if="!profile.enabled"
            class="inline-flex h-[18px] items-center rounded-sm border border-warning-border bg-warning-bg px-1.5 text-micro text-warning"
          >Отключён</span>
          <span
            v-if="profile.isInline"
            class="inline-flex h-[18px] items-center rounded-sm border border-neutral-border bg-neutral-bg px-1.5 text-micro text-neutral"
          >inline</span>
        </div>
        <div class="mt-0.5 text-sm text-muted">
          {{ profile.app?.name || `App #${profile.appId}` }}
        </div>
      </div>

      <div v-if="profile.validationStatus" class="shrink-0">
        <span
          v-if="profile.validationStatus === 'valid'"
          class="inline-flex h-[18px] items-center gap-1 rounded-sm border border-success-border bg-success-bg px-1.5 text-micro text-success"
        >
          <Icon name="mingcute:check-circle-line" />
          актор OK
        </span>
        <span
          v-else
          class="inline-flex h-[18px] items-center gap-1 rounded-sm border border-warning-border bg-warning-bg px-1.5 text-micro text-warning"
        >
          <Icon name="mingcute:warning-line" />
          {{ profile.validationStatus }}
        </span>
      </div>
    </div>

    <div class="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
      <div>
        <span class="text-subtle">Актор:</span>
        <span class="ml-1">{{ actorShort[profile.actorId] ?? profile.actorId }}</span>
      </div>
      <div>
        <span class="text-subtle">Макс. результатов:</span>
        <span class="ml-1">{{ profile.maxItems }}</span>
      </div>
      <div class="col-span-2">
        <span class="text-subtle">Платформы:</span>
        <span class="ml-1">
          {{ profile.platforms.map((p) => platformLabels[p] ?? p).join(', ') || '—' }}
        </span>
      </div>
      <div v-if="profile.geo || profile.language">
        <span class="text-subtle">Гео/Язык:</span>
        <span class="ml-1">{{ [profile.geo, profile.language].filter(Boolean).join(' / ') }}</span>
      </div>
      <div v-if="profile.viewCountMin != null || profile.viewCountMax != null">
        <span class="text-subtle">Просмотры:</span>
        <span class="ml-1 tnum">
          {{ profile.viewCountMin != null ? profile.viewCountMin.toLocaleString('ru') : '0' }}
          —
          {{ profile.viewCountMax != null ? profile.viewCountMax.toLocaleString('ru') : '∞' }}
        </span>
      </div>
      <div v-if="profile.keywords.length" class="col-span-2">
        <span class="text-subtle">Ключевые слова:</span>
        <span class="ml-1 line-clamp-2 italic">
          {{ profile.keywords.slice(0, 8).join(', ') }}{{ profile.keywords.length > 8 ? '…' : '' }}
        </span>
      </div>
    </div>

    <div v-if="profile.lastRun" class="flex items-center gap-1 border-t border-divider pt-1 text-sm text-muted">
      <Icon name="mingcute:time-line" class="shrink-0 text-subtle" />
      <ClientOnly>
        <span>
          Последний запуск: {{ new Date(profile.lastRun.startedAt).toLocaleString('ru') }}
          · импортировано {{ profile.lastRun.importedCount }}
        </span>
        <template #fallback>
          <span>Импортировано {{ profile.lastRun.importedCount }}</span>
        </template>
      </ClientOnly>
    </div>
  </div>

  <div
    v-else
    class="rounded-lg border border-dashed border-divider p-3 text-center text-sm text-muted"
  >
    Профиль не выбран
  </div>
</template>
