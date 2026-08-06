<script setup lang="ts">
/**
 * «Где мы в графе». Источник: design-preview/catalog/05-run-monitor.dc.html
 *
 * Категорийный тон — как на канвасе редактора: полоска слева говорит, к какой
 * группе относится нода. Пройденный путь подсвечивается поверх тона, а не
 * вместо него.
 *
 * Порядок берётся из рёбер графа: сначала ноды без входящих связей, дальше в
 * порядке обхода. Ветвление в столбик не разводится — это не канвас, а
 * напоминание, где мы находимся.
 */
import type { WorkflowStep } from '~~/shared/types/workflow'
import { NODE_CATEGORY_STRIP, pipelineNodeMeta } from '../PipelineNodeMeta'
import { orderGraphNodes } from '../PipelineGraphOrder'
import { stepStatusMeta } from '../PipelineRunStatusMap'

const props = defineProps<{
  graph: { nodes?: any[]; edges?: any[] } | null
  steps: WorkflowStep[]
  editorHref: string
}>()

const stepByNode = computed(() => {
  const map = new Map<string, WorkflowStep>()
  for (const step of props.steps) map.set(step.nodeId, step)
  return map
})

interface SchemeNode {
  id: string
  label: string
  icon: string
  strip: string
  status: string | null
}

const ordered = computed<SchemeNode[]>(() =>
  orderGraphNodes(props.graph).map((node) => {
    const meta = pipelineNodeMeta(node.type)
    return {
      id: node.id,
      label: node.label || meta.label,
      icon: meta.icon,
      strip: NODE_CATEGORY_STRIP[meta.category],
      status: stepByNode.value.get(node.id)?.status ?? null,
    }
  }),
)

function nodeTone(status: string | null) {
  if (!status) return 'border border-dashed border-border opacity-65'
  const entity = stepStatusMeta(status).entity
  return {
    draft: 'border border-border bg-card',
    queued: 'border border-border bg-card',
    running: 'border-[1.5px] border-info bg-info-bg',
    review: 'border border-warning-border bg-warning-bg',
    done: 'border border-success-border bg-success-bg',
    failed: 'border border-danger bg-danger-bg',
    blocked: 'border border-danger-border bg-surface',
    cancelled: 'border border-divider bg-transparent',
  }[entity]
}

function markTone(status: string | null) {
  if (!status) return null
  const meta = stepStatusMeta(status)
  return {
    icon: meta.icon,
    live: meta.live,
    tone: {
      draft: 'text-subtle',
      queued: 'text-subtle',
      running: 'text-info',
      review: 'text-warning',
      done: 'text-success',
      failed: 'text-danger',
      blocked: 'text-danger',
      cancelled: 'text-subtle',
    }[meta.entity],
  }
}
</script>

<template>
  <aside class="flex min-h-0 flex-col border-l border-border bg-panel">
    <div class="flex flex-none items-center gap-2 border-b border-divider px-2.5 py-2.5">
      <span class="text-sm font-semibold">Где мы в графе</span>
      <span class="flex-1" />
      <NuxtLink :to="editorHref" class="text-sm">Открыть</NuxtLink>
    </div>

    <div class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2.5">
      <p v-if="!ordered.length" class="text-sm text-muted">
        В графе конвейера нет блоков — схему собирать не из чего.
      </p>

      <template v-for="(node, i) in ordered" :key="node.id">
        <div
          v-if="i > 0"
          class="flex justify-center"
          :class="!node.status && 'opacity-50'"
        >
          <Icon
            name="mingcute:arrow-down-line"
            class="text-micro"
            :class="node.status ? 'text-success' : 'text-subtle'"
          />
        </div>

        <div class="relative flex items-center gap-2 rounded-sm px-2 py-1.5" :class="nodeTone(node.status)">
          <span class="absolute inset-y-1 left-0 w-[3px] rounded-[2px]" :class="node.strip" />
          <Icon
            :name="node.icon"
            class="ml-1 shrink-0"
            :class="node.status ? 'text-fg' : 'text-subtle'"
          />
          <span class="min-w-0 flex-1 truncate text-sm" :class="!node.status && 'text-muted'">
            {{ node.label }}
          </span>
          <Icon
            v-if="markTone(node.status)"
            :name="markTone(node.status)!.icon"
            class="shrink-0"
            :class="[markTone(node.status)!.tone, markTone(node.status)!.live && 'motion-safe:animate-spin']"
          />
        </div>
      </template>
    </div>

    <p class="flex-none border-t border-divider bg-card px-2.5 py-2 text-micro leading-normal text-subtle">
      Полоска слева — категория ноды с канваса редактора. Цвет рамки — состояние
      шага в этом запуске.
    </p>
  </aside>
</template>
