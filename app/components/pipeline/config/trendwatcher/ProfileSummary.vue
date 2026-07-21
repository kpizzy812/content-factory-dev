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
  <div v-if="profile" class="rounded-lg border border-base-300 bg-base-200/40 p-3 space-y-2">
    <div class="flex items-start justify-between gap-2">
      <div>
        <div class="font-medium text-sm flex items-center gap-1.5">
          <Icon name="mingcute:search-2-line" class="text-base-content/60 text-sm" />
          {{ profile.name }}
          <span v-if="!profile.enabled" class="badge badge-warning badge-xs">Отключён</span>
          <span v-if="profile.isInline" class="badge badge-ghost badge-xs">inline</span>
        </div>
        <div class="text-xs text-base-content/60 mt-0.5">
          {{ profile.app?.name || `App #${profile.appId}` }}
        </div>
      </div>
      <div v-if="profile.validationStatus" class="text-xs">
        <span
          v-if="profile.validationStatus === 'valid'"
          class="badge badge-success badge-xs gap-1"
        >
          <Icon name="mingcute:check-circle-line" />
          актор OK
        </span>
        <span v-else class="badge badge-warning badge-xs gap-1">
          <Icon name="mingcute:warning-line" />
          {{ profile.validationStatus }}
        </span>
      </div>
    </div>

    <div class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
      <div>
        <span class="text-base-content/50">Актор:</span>
        <span class="ml-1">{{ actorShort[profile.actorId] ?? profile.actorId }}</span>
      </div>
      <div>
        <span class="text-base-content/50">Макс. результатов:</span>
        <span class="ml-1">{{ profile.maxItems }}</span>
      </div>
      <div class="col-span-2">
        <span class="text-base-content/50">Платформы:</span>
        <span class="ml-1">
          {{ profile.platforms.map((p) => platformLabels[p] ?? p).join(', ') || '—' }}
        </span>
      </div>
      <div v-if="profile.geo || profile.language">
        <span class="text-base-content/50">Гео/Язык:</span>
        <span class="ml-1">{{ [profile.geo, profile.language].filter(Boolean).join(' / ') }}</span>
      </div>
      <div v-if="profile.viewCountMin != null || profile.viewCountMax != null">
        <span class="text-base-content/50">Просмотры:</span>
        <span class="ml-1">
          {{ profile.viewCountMin != null ? profile.viewCountMin.toLocaleString('ru') : '0' }}
          —
          {{ profile.viewCountMax != null ? profile.viewCountMax.toLocaleString('ru') : '∞' }}
        </span>
      </div>
      <div v-if="profile.keywords.length" class="col-span-2">
        <span class="text-base-content/50">Keywords:</span>
        <span class="ml-1 italic line-clamp-2">
          {{ profile.keywords.slice(0, 8).join(', ') }}{{ profile.keywords.length > 8 ? '…' : '' }}
        </span>
      </div>
    </div>

    <div v-if="profile.lastRun" class="text-xs flex items-center gap-1 pt-1 border-t border-base-300/60">
      <Icon name="mingcute:time-line" class="text-base-content/50" />
      <span class="text-base-content/60">
        Последний запуск:
        {{ new Date(profile.lastRun.startedAt).toLocaleString('ru') }}
        · impored {{ profile.lastRun.importedCount }}
      </span>
    </div>
  </div>

  <div
    v-else
    class="rounded-lg border border-dashed border-base-300 p-3 text-xs text-base-content/60 text-center"
  >
    Профиль не выбран
  </div>
</template>
