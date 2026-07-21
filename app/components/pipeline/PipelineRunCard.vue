<script setup lang="ts">
import { getRunStatus, getTrigger, getErrorCategoryLabel } from '~~/shared/utils/pipeline-status'
import { formatDurationRange, formatRelativeTime } from '~~/shared/utils/pipeline-format'

const props = defineProps<{
  run: {
    id: number
    status: string
    triggerType: string
    errorCategory?: string | null
    errorMessage?: string | null
    replayOfRunId?: number | null
    startedAt: string
    finishedAt: string | null
    createdAt: string
    _count?: { steps?: number }
  }
  /** Navigate target base, e.g. '/pipeline/5' */
  basePath: string
  /** More compact layout for modals */
  compact?: boolean
}>()

const status = computed(() => getRunStatus(props.run.status))
const trigger = computed(() => getTrigger(props.run.triggerType))
</script>

<template>
  <div
    class="card card-border bg-base-100 cursor-pointer transition-shadow hover:shadow-md"
    @click="navigateTo(`${basePath}/runs/${run.id}`)"
  >
    <div class="card-body gap-1.5" :class="compact ? 'p-2.5' : 'p-3'">
      <div class="flex items-center gap-2.5">
        <!-- Status indicator -->
        <div
          class="rounded-full flex items-center justify-center shrink-0"
          :class="[status.indicator, compact ? 'w-7 h-7' : 'w-8 h-8']"
        >
          <Icon :name="status.icon" :class="compact ? 'text-sm' : 'text-base'" />
        </div>

        <!-- Info -->
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1.5 flex-wrap">
            <span class="font-mono text-xs font-semibold">#{{ run.id }}</span>
            <span class="badge badge-xs" :class="status.class">
              {{ status.label }}
            </span>
            <span v-if="run.errorCategory" class="badge badge-xs badge-error badge-outline">
              {{ getErrorCategoryLabel(run.errorCategory) }}
            </span>
            <span v-if="run.replayOfRunId" class="badge badge-xs badge-ghost">
              replay #{{ run.replayOfRunId }}
            </span>
          </div>
          <div class="flex items-center gap-2 mt-0.5 text-[10px] text-base-content/50">
            <span class="flex items-center gap-0.5">
              <Icon :name="trigger.icon" class="text-[10px]" />
              {{ trigger.label }}
            </span>
            <span>{{ run._count?.steps ?? 0 }} шагов</span>
            <span class="font-mono">{{ formatDurationRange(run.startedAt, run.finishedAt) }}</span>
          </div>
        </div>

        <!-- Time -->
        <div class="text-right shrink-0">
          <div class="text-[10px] text-base-content/50">{{ formatRelativeTime(run.createdAt) }}</div>
        </div>

        <Icon name="mingcute:arrow-right-line" class="text-base-content/20 shrink-0 text-xs" />
      </div>

      <!-- Error preview -->
      <div v-if="run.errorMessage" class="text-[10px] text-error/80 truncate" :class="compact ? 'pl-9' : 'pl-10'">
        {{ run.errorMessage }}
      </div>
    </div>
  </div>
</template>
