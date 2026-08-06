<script setup lang="ts">
/**
 * Запуски одного конвейера внутри блока «Исполнения».
 *
 * «Запустить» осталось видимой кнопкой, хотя операция платная: это главное
 * действие раздела, и прятать его в меню глубже, чем деактивацию, вредно. Тот
 * же компромисс, что у включения устройства: цена объясняется в подтверждении.
 */
import type { PipelineMonitorItem } from '~~/shared/types/workflow'

const props = defineProps<{ item: PipelineMonitorItem }>()

const emit = defineEmits<{ refresh: [] }>()

const toast = useToast()

const isStarting = ref(false)
const isTogglingStatus = ref(false)
const confirmStart = ref(false)

const canRun = computed(() => props.item.permissions.canRun)
const canWrite = computed(() => props.item.permissions.canWrite)
const isActive = computed(() => props.item.status === 'active')

async function handleStart() {
  confirmStart.value = false
  if (!canRun.value || isStarting.value) return
  isStarting.value = true
  try {
    await $fetch(`/api/pipelines/${props.item.id}/run`, { method: 'POST' })
    toast.success('Запуск поставлен в очередь')
    emit('refresh')
  }
  catch (e: any) {
    toast.error(e?.data?.message || 'Не удалось запустить конвейер')
  }
  finally {
    isStarting.value = false
  }
}

async function handleToggleStatus() {
  if (!canWrite.value || isTogglingStatus.value) return
  isTogglingStatus.value = true
  try {
    await $fetch(`/api/pipelines/${props.item.id}`, {
      method: 'PUT',
      body: { status: isActive.value ? 'inactive' : 'active' },
    })
    emit('refresh')
  }
  catch (e: any) {
    toast.error(e?.data?.message || 'Не удалось изменить статус')
  }
  finally {
    isTogglingStatus.value = false
  }
}

const hasAny = computed(
  () => props.item.activeRuns.length > 0 || props.item.recentRuns.length > 0,
)

const runTitle = computed(() => {
  if (canRun.value) return 'Запустить конвейер'
  return isActive.value ? 'Нет прав на запуск' : 'Конвейер выключен — сначала включите его'
})
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="tnum flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-sm text-muted">
      <span class="flex items-center gap-1">
        <Icon name="mingcute:history-line" />всего {{ item.runStats.total }}
      </span>
      <span v-if="item.runStats.running" class="flex items-center gap-1 text-info">
        <span class="size-1.5 rounded-full bg-current motion-safe:animate-pulse" />
        идёт {{ item.runStats.running }}
      </span>
      <span v-if="item.runStats.success" class="text-success">успешных {{ item.runStats.success }}</span>
      <span v-if="item.runStats.failed" class="text-danger">упало {{ item.runStats.failed }}</span>
    </div>

    <div v-if="item.activeRuns.length" class="flex flex-col gap-1.5">
      <h4 class="flex items-center gap-1.5 text-micro tracking-[.06em] text-subtle uppercase">
        <span class="size-1.5 rounded-full bg-info motion-safe:animate-pulse" />
        Активные
      </h4>
      <PipelineMonitorRun
        v-for="(run, idx) in item.activeRuns"
        :key="run.id"
        :run="run"
        :pipeline-id="item.id"
        :can-cancel="item.permissions.canCancel"
        :active-current-step="idx === 0 ? item.currentStep : null"
        @cancelled="emit('refresh')"
      />
    </div>

    <div v-if="item.recentRuns.length" class="flex flex-col gap-1.5">
      <h4 class="text-micro tracking-[.06em] text-subtle uppercase">Последние</h4>
      <PipelineMonitorRun
        v-for="run in item.recentRuns"
        :key="run.id"
        :run="run"
        :pipeline-id="item.id"
        :can-cancel="item.permissions.canCancel"
      />
    </div>

    <p
      v-if="!hasAny"
      class="rounded-md border border-dashed border-border px-3 py-3 text-center text-sm text-muted"
    >
      Запусков пока нет.
    </p>

    <div class="flex flex-wrap items-center gap-2">
      <UiButton
        variant="primary"
        :disabled="!canRun"
        :loading="isStarting"
        :title="runTitle"
        @click="confirmStart = true"
      >
        <Icon v-if="!isStarting" name="mingcute:play-circle-line" />
        Запустить
      </UiButton>
      <UiButton
        v-if="canWrite"
        :loading="isTogglingStatus"
        :title="isActive ? 'Выключить конвейер' : 'Включить конвейер — разблокирует запуск'"
        @click="handleToggleStatus"
      >
        <Icon v-if="!isTogglingStatus" :name="isActive ? 'mingcute:pause-circle-line' : 'mingcute:power-line'" />
        {{ isActive ? 'Выключить' : 'Включить' }}
      </UiButton>

      <span class="flex-1" />

      <NuxtLink :to="`/pipeline/${item.id}/runs`">
        <UiButton variant="ghost" :disabled="item.runStats.total === 0">
          <Icon name="mingcute:list-check-line" />
          Все запуски
          <span v-if="item.runStats.total" class="tnum font-mono text-micro text-subtle">
            {{ item.runStats.total }}
          </span>
        </UiButton>
      </NuxtLink>
      <NuxtLink :to="`/pipeline/${item.id}`">
        <UiButton variant="ghost">
          <Icon name="mingcute:edit-2-line" />
          Редактор
        </UiButton>
      </NuxtLink>
    </div>

    <UiModal :open="confirmStart" size="sm" title="Запустить конвейер?" @close="confirmStart = false">
      <p class="text-sm text-muted">
        «{{ item.name }}» отработает целиком. Платные шаги — генерация сценариев,
        роликов и публикация — будут оплачены; сумму запуска ни один endpoint пока
        не отдаёт, поэтому она появится только по факту в балансах.
      </p>
      <template #footer>
        <UiButton variant="ghost" @click="confirmStart = false">Отмена</UiButton>
        <UiButton variant="primary" :loading="isStarting" @click="handleStart">Запустить</UiButton>
      </template>
    </UiModal>
  </div>
</template>
