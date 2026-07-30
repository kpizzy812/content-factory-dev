<script setup lang="ts">
import { VueFlow, useVueFlow, SelectionMode } from '@vue-flow/core'
import { MiniMap } from '@vue-flow/minimap'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/minimap/dist/style.css'

const store = usePipelineEditorStore()

const { screenToFlowCoordinate, fitView } = useVueFlow()

// Этап 3: подсветка несовместимых рёбер по PortSpec.
// edgeIssues — Map<edgeId, EdgeIssue>; не блокирует, только визуальный сигнал.
const { edgeIssues, nodeWarningCounts } = usePipelineEdgeValidation(
  store.nodes as unknown as Ref<any[]>,
  store.edges as unknown as Ref<any[]>,
)
provide('pipelineNodeWarningCounts', nodeWarningCounts)

// Применяем оранжевую обводку к несовместимым рёбрам (severity=warning, isHint=false).
// Hint loop'а (compatible+warning) НЕ красим — это легитимный паттерн.
// Маркируем edge через _validationStyled чтобы корректно снимать стиль при исчезновении issue.
const WARNING_STROKE = 'oklch(0.79 0.16 70)' // warning из daisyui-tokens (приблизительно)
watchEffect(() => {
  for (const edge of store.edges as any[]) {
    if (edge.sourceHandle === 'error') continue // не трогаем error edges (свой style)
    const issue = edgeIssues.value.get(edge.id)
    const hadStyle = edge._validationStyled === true
    if (issue && !issue.isHint) {
      // ставим warning style, сохраняем previous style для возможного восстановления
      if (!hadStyle) {
        edge._prevStyle = edge.style
        edge._prevLabel = edge.label
      }
      edge.style = { stroke: WARNING_STROKE, strokeWidth: 2.5, strokeDasharray: '4 2' }
      edge.label = '⚠ порт'
      edge.labelStyle = { fill: WARNING_STROKE, fontSize: '10px', fontWeight: '600' }
      edge._validationStyled = true
      edge._validationReason = issue.reason
    } else if (hadStyle) {
      // снимаем — issue исчез
      edge.style = edge._prevStyle ?? undefined
      edge.label = edge._prevLabel ?? ''
      edge.labelStyle = undefined
      edge._validationStyled = false
      edge._validationReason = undefined
      delete edge._prevStyle
      delete edge._prevLabel
    }
  }
})

// Space+drag panning — при зажатом пробеле ноды не перетаскиваются, холст панорамируется
const isSpaceHeld = ref(false)
const nodesDraggable = computed(() => !isSpaceHeld.value)

function onKeyDown(e: KeyboardEvent) {
  if (e.code === 'Space' && !e.repeat && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
    e.preventDefault()
    isSpaceHeld.value = true
  }
}

function onKeyUp(e: KeyboardEvent) {
  if (e.code === 'Space') {
    isSpaceHeld.value = false
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
})

const nodeColorMap: Record<string, { icon: string; color: string }> = {
  trendwatcher: { icon: 'mingcute:eye-line', color: 'bg-info/20 border-info' },
  content_strategy: { icon: 'mingcute:target-line', color: 'bg-primary/20 border-primary' },
  scenario: { icon: 'mingcute:document-line', color: 'bg-warning/20 border-warning' },
  quality_gate: { icon: 'mingcute:shield-check-line', color: 'bg-success/20 border-success' },
  video: { icon: 'mingcute:video-line', color: 'bg-accent/20 border-accent' },
  upload: { icon: 'mingcute:upload-3-line', color: 'bg-success/20 border-success' },
  analytics: { icon: 'mingcute:chart-bar-line', color: 'bg-secondary/20 border-secondary' },
  filter: { icon: 'mingcute:filter-line', color: 'bg-neutral/20 border-neutral' },
  notification: { icon: 'mingcute:notification-line', color: 'bg-error/20 border-error' },
  http_request: { icon: 'mingcute:globe-line', color: 'bg-primary/20 border-primary' },
  code: { icon: 'mingcute:code-line', color: 'bg-neutral/20 border-neutral' },
  set: { icon: 'mingcute:edit-2-line', color: 'bg-neutral/20 border-neutral' },
  if_switch: { icon: 'mingcute:git-branch-line', color: 'bg-warning/20 border-warning' },
  loop: { icon: 'mingcute:refresh-2-line', color: 'bg-accent/20 border-accent' },
  wait: { icon: 'mingcute:time-line', color: 'bg-base-200 border-base-300' },
  sub_pipeline: { icon: 'mingcute:route-line', color: 'bg-primary/20 border-primary' },
  idea: { icon: 'mingcute:bulb-line', color: 'bg-primary/20 border-primary' },
  character: { icon: 'mingcute:user-3-line', color: 'bg-primary/20 border-primary' },
  scene_composer: { icon: 'mingcute:layers-line', color: 'bg-secondary/20 border-secondary' },
  caption_generator: { icon: 'mingcute:hashtag-line', color: 'bg-secondary/20 border-secondary' },
  google_drive_scanner: { icon: 'mingcute:cloud-line', color: 'bg-info/20 border-info' },
  google_drive_uploader: { icon: 'mingcute:cloud-upload-line', color: 'bg-info/20 border-info' },
  video_analyzer: { icon: 'mingcute:scan-2-line', color: 'bg-primary/20 border-primary' },
  note: { icon: 'mingcute:notebook-line', color: 'bg-warning/15 border-warning/40' },
}

let dropCounter = 0

function onDrop(event: DragEvent) {
  const type = event.dataTransfer?.getData('block-type')
  const label = event.dataTransfer?.getData('block-label')
  if (!type || !label) return

  const position = screenToFlowCoordinate({
    x: event.clientX,
    y: event.clientY,
  })

  dropCounter++
  const id = `${type}-${Date.now()}-${dropCounter}`

  store.addNode({
    id,
    type,
    position,
    data: { label, type, config: {} },
  })
}

function onDragOver(event: DragEvent) {
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
}

function onConnect(params: any) {
  const handleSuffix = params.sourceHandle === 'error' ? '-error' : ''
  const id = `e-${params.source}-${params.target}${handleSuffix}`
  const exists = store.edges.some((e: any) => e.id === id)
  if (!exists) {
    const isErrorEdge = params.sourceHandle === 'error'
    store.edges.push({
      id,
      source: params.source,
      target: params.target,
      sourceHandle: params.sourceHandle ?? null,
      animated: !isErrorEdge,
      label: isErrorEdge ? 'ошибка' : '',
      labelStyle: isErrorEdge ? { fill: 'oklch(0.65 0.3 25)', fontSize: '10px', fontWeight: '600' } : undefined,
      style: isErrorEdge
        ? { stroke: 'oklch(0.65 0.3 25)', strokeDasharray: '6 3' }
        : undefined,
    })
    store.isDirty = true
    store.pushHistory()
  }
}

function onNodeClick(event: { node: { id: string } } | any) {
  const nodeId = event?.node?.id ?? event?.id
  if (nodeId) {
    store.selectNode(nodeId)
  }
}

function onEdgeClick(event: any) {
  const edgeId = event?.edge?.id ?? event?.id
  if (!edgeId) return
  // Toggle selection on the edge
  const edge = store.edges.find((e: any) => e.id === edgeId)
  if (edge) {
    // Deselect all other edges first
    for (const e of store.edges) e.selected = false
    edge.selected = true
  }
}

function onEdgeContextMenu(event: any) {
  const edgeId = event?.edge?.id ?? event?.id
  if (!edgeId) return
  // Prevent default browser context menu
  if (event?.event) event.event.preventDefault()
  store.removeEdge(edgeId)
}

function onPaneClick() {
  store.selectNode(null)
  // Deselect edges too
  for (const e of store.edges) e.selected = false
}

function getNodeConfig(type: string) {
  return nodeColorMap[type] ?? { icon: 'mingcute:box-line', color: 'bg-base-200 border-base-300' }
}

// All node types for template registration
const nodeTypes = Object.keys(nodeColorMap)

// Fit view button
function handleFitView() {
  fitView({ padding: 0.2 })
}

defineExpose({ fitView: handleFitView })
</script>

<template>
  <div
    class="flex-1 min-h-0 min-w-0 relative"
    :class="{ 'cursor-grab': isSpaceHeld }"
    @drop="onDrop"
    @dragover="onDragOver"
  >
    <ClientOnly>
      <VueFlow
        v-model:nodes="store.nodes"
        v-model:edges="store.edges"
        class="h-full w-full pipeline-canvas"
        :fit-view-on-init="true"
        :min-zoom="0.2"
        :max-zoom="3"
        :snap-to-grid="true"
        :snap-grid="[20, 20]"
        :delete-key-code="null"
        :multi-selection-key-code="'Shift'"
        :selection-key-code="null"
        :pan-on-drag="[0]"
        :nodes-draggable="nodesDraggable"
        :selection-mode="SelectionMode.Partial"
        :connection-radius="30"
        :default-edge-options="{
          type: 'smoothstep',
          animated: true,
          style: { strokeWidth: 2 },
        }"
        :edges-updatable="true"
        @connect="onConnect"
        @node-click="onNodeClick"
        @pane-click="onPaneClick"
        @edge-click="onEdgeClick"
        @edge-context-menu="onEdgeContextMenu"
      >
        <template v-for="nodeType in nodeTypes" :key="nodeType" #[`node-${nodeType}`]="{ id: nodeId, data, selected }">
          <PipelineNoteNode v-if="nodeType === 'note'" :data="data" :selected="selected" />
          <PipelineNode v-else :id="nodeId" :data="data" v-bind="getNodeConfig(nodeType)" :selected="selected" />
        </template>

        <MiniMap
          position="bottom-right"
          :pannable="true"
          :zoomable="true"
          class="!bg-base-200/80 !border-base-300 !rounded-box !shadow-sm"
        />
      </VueFlow>

      <!-- Fit view button + space hint -->
      <div class="absolute bottom-4 left-4 z-10 flex items-center gap-1.5">
        <div class="tooltip tooltip-right" data-tip="Вписать граф в экран">
          <button
            class="btn btn-sm btn-ghost bg-base-100/80 shadow-sm"
            @click="handleFitView"
          >
            <Icon name="mingcute:fullscreen-line" />
          </button>
        </div>
        <Transition name="fade">
          <div
            v-if="isSpaceHeld"
            class="px-2 py-1 rounded bg-primary/90 text-primary-content text-[10px] font-medium shadow"
          >
            Панорамирование
          </div>
        </Transition>
      </div>

      <!-- Node count indicator -->
      <div class="absolute top-3 left-3 text-[10px] text-base-content/40 bg-base-100/60 rounded px-1.5 py-0.5 z-10">
        {{ store.nodeCount }} блоков &middot; {{ store.edgeCount }} связей
      </div>

      <!-- Empty state hint -->
      <div
        v-if="store.nodeCount === 0"
        class="absolute inset-0 flex items-center justify-center pointer-events-none z-10"
      >
        <div class="text-center space-y-2">
          <Icon name="mingcute:drag-drop-line" class="text-4xl text-base-content/20" />
          <p class="text-sm text-base-content/30">Перетащите блоки из левой панели сюда</p>
        </div>
      </div>

      <template #fallback>
        <div class="flex items-center justify-center h-full">
          <span class="loading loading-spinner loading-lg" />
        </div>
      </template>
    </ClientOnly>
  </div>
</template>

<style>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.pipeline-canvas.vue-flow {
  background-image:
    linear-gradient(to right, oklch(70% 0 0 / 0.06) 1px, transparent 1px),
    linear-gradient(to bottom, oklch(70% 0 0 / 0.06) 1px, transparent 1px);
  background-size: 20px 20px;
}

/* Marquee selection box styling */
.pipeline-canvas .vue-flow__selection {
  background: oklch(0.65 0.15 250 / 0.08);
  border: 1.5px dashed oklch(0.65 0.15 250 / 0.4);
  border-radius: 4px;
}

/* Connection line while dragging */
.pipeline-canvas .vue-flow__connection-path {
  stroke: oklch(0.65 0.15 250 / 0.6);
  stroke-width: 2.5;
}

/* Edge hover state */
.pipeline-canvas .vue-flow__edge:hover .vue-flow__edge-path {
  stroke-width: 3;
  cursor: pointer;
}

/* Selected edge */
.pipeline-canvas .vue-flow__edge.selected .vue-flow__edge-path {
  stroke-width: 3.5;
  stroke: oklch(0.65 0.15 250);
}

/* Edge interaction zone — wider invisible hit area */
.pipeline-canvas .vue-flow__edge-interaction {
  stroke-width: 20;
  cursor: pointer;
}

/* Smoother edge paths */
.pipeline-canvas .vue-flow__edge-path {
  transition: stroke-width 0.15s ease;
}

/* Handle connection zone — larger invisible hit area */
.pipeline-canvas .vue-flow__handle {
  cursor: crosshair;
}

/* Selection box via mouse drag */
.pipeline-canvas .vue-flow__selectionpane {
  cursor: default;
}
</style>
