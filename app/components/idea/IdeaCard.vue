<script setup lang="ts">
const props = defineProps<{
  idea: {
    id: number
    title: string | null
    sourceUrl: string | null
    status: string
    analysisStatus: string
    source: string
    platform: string | null
    tags: string[]
    sentToScenarioAt: string | null
    referenceStatus?: string | null
    mediaType?: string | null
    externalId?: number | null
    syncStatus?: string | null
    localDirty?: boolean
    createdAt: string
  }
}>()

function goToDetail() {
  navigateTo(`/ideas/${props.idea.id}`)
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

const platformMap: Record<string, { label: string; icon: string }> = {
  youtube: { label: 'YouTube', icon: 'mingcute:youtube-line' },
  tiktok: { label: 'TikTok', icon: 'mingcute:tiktok-line' },
  instagram: { label: 'Instagram', icon: 'mingcute:instagram-line' },
}
</script>

<template>
  <div
    class="card bg-base-100 shadow-sm cursor-pointer transition-shadow hover:shadow-md"
    @click="goToDetail"
  >
    <div class="card-body p-4 gap-2">
      <div class="flex items-center gap-2 flex-wrap">
        <IdeaStatusBadge :status="idea.status" :analysis-status="idea.analysisStatus" />
        <IdeaSourceBadge
          :source="idea.source"
          :sync-status="idea.syncStatus"
          :external-id="idea.externalId"
        />
        <span
          v-if="idea.platform && platformMap[idea.platform]"
          class="badge badge-sm badge-ghost gap-1"
        >
          <Icon :name="platformMap[idea.platform!]!.icon" class="text-xs" />
          {{ platformMap[idea.platform!]!.label }}
        </span>
        <span
          v-if="idea.referenceStatus === 'completed'"
          class="badge badge-sm badge-outline badge-secondary gap-1"
        >
          <Icon name="mingcute:search-line" class="text-xs" />
          Референс
        </span>
        <span
          v-if="idea.localDirty"
          class="badge badge-xs badge-warning badge-outline gap-0.5"
          title="Есть локальные изменения, не синхронизированные с MarketingCamp"
        >
          <Icon name="mingcute:edit-2-line" class="text-[10px]" />
          Изменено
        </span>
        <span
          v-if="idea.sentToScenarioAt"
          class="badge badge-sm badge-outline badge-primary gap-1"
        >
          <Icon name="mingcute:star-line" class="text-xs" />
          В сценариях
        </span>
      </div>

      <h3 class="font-semibold text-base-content line-clamp-2 text-sm">
        {{ idea.title || idea.sourceUrl || 'Без заголовка' }}
      </h3>

      <p v-if="idea.title && idea.sourceUrl" class="text-xs text-base-content/50 truncate">
        {{ idea.sourceUrl }}
      </p>

      <div v-if="idea.tags.length > 0" class="flex gap-1 flex-wrap">
        <span
          v-for="tag in idea.tags.slice(0, 3)"
          :key="tag"
          class="badge badge-xs badge-outline"
        >
          {{ tag }}
        </span>
        <span v-if="idea.tags.length > 3" class="text-xs text-base-content/40">
          +{{ idea.tags.length - 3 }}
        </span>
      </div>

      <div class="flex items-center justify-end mt-1">
        <span class="text-xs text-base-content/40">
          {{ formatDate(idea.createdAt) }}
        </span>
      </div>
    </div>
  </div>
</template>
