<script setup lang="ts">
import type { PipelineMonitorItem } from '~~/shared/types/workflow'

const props = defineProps<{
  item: PipelineMonitorItem
}>()

const emit = defineEmits<{
  refresh: []
}>()

const isStarting = ref(false)
const startError = ref<string | null>(null)

const isTogglingStatus = ref(false)
const statusError = ref<string | null>(null)

const canRun = computed(() => props.item.permissions.canRun)
const canWrite = computed(() => props.item.permissions.canWrite)
const isActive = computed(() => props.item.status === 'active')

async function handleStart() {
  if (!canRun.value || isStarting.value) return
  isStarting.value = true
  startError.value = null
  try {
    await $fetch(`/api/pipelines/${props.item.id}/run`, { method: 'POST' })
    emit('refresh')
  }
  catch (e: any) {
    startError.value = e?.data?.message || 'Не удалось запустить'
  }
  finally {
    isStarting.value = false
  }
}

async function handleToggleStatus() {
  if (!canWrite.value || isTogglingStatus.value) return
  isTogglingStatus.value = true
  statusError.value = null
  const next = isActive.value ? 'inactive' : 'active'
  try {
    await $fetch(`/api/pipelines/${props.item.id}`, {
      method: 'PUT',
      body: { status: next },
    })
    emit('refresh')
  }
  catch (e: any) {
    statusError.value = e?.data?.message || 'Не удалось изменить статус'
  }
  finally {
    isTogglingStatus.value = false
  }
}

function openEditor() {
  navigateTo(`/pipeline/${props.item.id}`)
}

function openAllRuns() {
  navigateTo(`/pipeline/${props.item.id}/runs`)
}

const hasAny = computed(
  () => props.item.activeRuns.length > 0 || props.item.recentRuns.length > 0,
)
</script>

<template>
  <div class="space-y-3">
    <!-- Run stats -->
    <div class="flex items-center gap-3 text-xs text-base-content/60 flex-wrap">
      <span class="flex items-center gap-1">
        <Icon name="mingcute:history-line" class="text-sm" />
        Всего: <span class="font-mono font-semibold text-base-content">{{ item.runStats.total }}</span>
      </span>
      <span v-if="item.runStats.running > 0" class="flex items-center gap-1 text-info">
        <Icon name="mingcute:loading-3-line" class="animate-spin" />
        Активных: <span class="font-mono font-semibold">{{ item.runStats.running }}</span>
      </span>
      <span v-if="item.runStats.success > 0" class="flex items-center gap-1 text-success">
        <Icon name="mingcute:check-circle-line" />
        {{ item.runStats.success }}
      </span>
      <span v-if="item.runStats.failed > 0" class="flex items-center gap-1 text-error">
        <Icon name="mingcute:close-circle-line" />
        {{ item.runStats.failed }}
      </span>
    </div>

    <!-- Active -->
    <div v-if="item.activeRuns.length > 0" class="space-y-2">
      <h4 class="text-xs font-semibold text-base-content/70 uppercase tracking-wide flex items-center gap-1.5">
        <span class="status status-info status-sm animate-pulse" />
        Активные запуски
      </h4>
      <div class="space-y-1.5">
        <PipelineMonitorRun
          v-for="(run, idx) in item.activeRuns"
          :key="run.id"
          :run="run"
          :pipeline-id="item.id"
          :can-cancel="item.permissions.canCancel"
          :active-current-step="idx === 0 ? item.currentStep : null"
          :total-nodes="item.totalNodes"
          @cancelled="emit('refresh')"
        />
      </div>
    </div>

    <!-- Recent -->
    <div v-if="item.recentRuns.length > 0" class="space-y-2">
      <h4 class="text-xs font-semibold text-base-content/70 uppercase tracking-wide">
        Последние
      </h4>
      <div class="space-y-1.5">
        <PipelineMonitorRun
          v-for="run in item.recentRuns"
          :key="run.id"
          :run="run"
          :pipeline-id="item.id"
          :can-cancel="item.permissions.canCancel"
        />
      </div>
    </div>

    <!-- Empty -->
    <div
      v-if="!hasAny"
      class="text-center py-4 text-sm text-base-content/60 border border-dashed border-base-300 rounded-box"
    >
      Ранов пока нет
    </div>

    <div v-if="startError" role="alert" class="alert alert-error alert-soft py-2">
      <Icon name="mingcute:warning-line" />
      <span class="text-xs">{{ startError }}</span>
    </div>
    <div v-if="statusError" role="alert" class="alert alert-error alert-soft py-2">
      <Icon name="mingcute:warning-line" />
      <span class="text-xs">{{ statusError }}</span>
    </div>

    <!-- Actions -->
    <div class="flex items-center justify-between gap-2 flex-wrap pt-1">
      <div class="flex items-center gap-2 flex-wrap">
        <div
          class="tooltip tooltip-top"
          :data-tip="canRun ? 'Запустить конвейер' : (isActive ? 'Нет прав на запуск' : 'Конвейер неактивен — активируйте его')"
        >
          <button
            class="btn btn-primary btn-sm"
            :disabled="!canRun || isStarting"
            @click="handleStart"
          >
            <span v-if="isStarting" class="loading loading-spinner loading-xs" />
            <Icon v-else name="mingcute:play-circle-line" />
            Запустить
          </button>
        </div>
        <div
          v-if="canWrite"
          class="tooltip tooltip-top"
          :data-tip="isActive ? 'Перевести конвейер в неактивный статус' : 'Активировать конвейер — разблокирует запуск'"
        >
          <button
            class="btn btn-sm"
            :class="isActive ? 'btn-ghost' : 'btn-success btn-outline'"
            :disabled="isTogglingStatus"
            @click="handleToggleStatus"
          >
            <span v-if="isTogglingStatus" class="loading loading-spinner loading-xs" />
            <Icon v-else :name="isActive ? 'mingcute:pause-circle-line' : 'mingcute:power-line'" />
            {{ isActive ? 'Деактивировать' : 'Активировать' }}
          </button>
        </div>
      </div>
      <div class="flex items-center gap-1">
        <button
          class="btn btn-ghost btn-sm"
          :disabled="item.runStats.total === 0"
          @click="openAllRuns"
        >
          <Icon name="mingcute:list-check-line" />
          Все запуски
          <span v-if="item.runStats.total > 0" class="badge badge-xs badge-ghost">{{ item.runStats.total }}</span>
        </button>
        <button class="btn btn-ghost btn-sm" @click="openEditor">
          <Icon name="mingcute:edit-2-line" />
          Редактор
        </button>
      </div>
    </div>
  </div>
</template>
