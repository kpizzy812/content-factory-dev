<script setup lang="ts">
import { PIPELINE_NODE_META } from './PipelineNodeMeta'
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
// Читаем токен темы, а не хардкодим цвет: значение отличается в dark и light.
const WARNING_STROKE = 'var(--color-warning)'
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

/**
 * Типы блоков, для которых регистрируется свой шаблон ноды.
 *
 * `custom` в списке намеренно: старые графы писали в `node.type` именно его,
 * а настоящий тип клали в `data.type`. Без регистрации такие ноды падали на
 * стандартную ноду Vue Flow — белый прямоугольник без подписи.
 */
const nodeTypes = [...Object.keys(PIPELINE_NODE_META), 'custom']

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
          <PipelineNode v-else :id="nodeId" :data="data" :selected="selected" />
        </template>

        <MiniMap
          position="bottom-right"
          :pannable="true"
          :zoomable="true"
          class="!rounded-md !border !border-border !bg-panel !shadow-sm"
        />
      </VueFlow>

      <!-- Fit view button + space hint -->
      <div class="absolute bottom-4 left-4 z-10 flex items-center gap-1.5">
        <UiTooltip text="Вписать граф в экран" placement="right">
          <button
            type="button"
            class="flex size-7 cursor-pointer items-center justify-center rounded-md border border-border bg-panel text-muted shadow-sm hover:text-fg"
            @click="handleFitView"
          >
            <Icon name="mingcute:fullscreen-line" />
          </button>
        </UiTooltip>
        <Transition name="fade">
          <div
            v-if="isSpaceHeld"
            class="rounded-sm border border-accent-border bg-accent-bg px-2 py-1 text-[10px] font-medium shadow"
          >
            Панорамирование
          </div>
        </Transition>
      </div>

      <!-- Node count indicator -->
      <div class="tnum absolute top-3 left-3 z-10 rounded-sm bg-panel/70 px-1.5 py-0.5 font-mono text-[10px] text-subtle">
        {{ store.nodeCount }} блоков &middot; {{ store.edgeCount }} связей
      </div>

      <!-- Empty state hint -->
      <div
        v-if="store.nodeCount === 0"
        class="absolute inset-0 flex items-center justify-center pointer-events-none z-10"
      >
        <div class="flex flex-col items-center gap-2 text-center">
          <Icon name="mingcute:drag-drop-line" class="text-4xl text-subtle opacity-60" />
          <p class="text-sm text-subtle">Перетащите блок из палитры слева или кликните по нему</p>
        </div>
      </div>

      <template #fallback>
        <div class="flex h-full items-center justify-center p-4">
          <UiSkeleton variant="details" :count="3" />
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

/* Точечная сетка полотна из макета 04: своего токена у неё нет, поэтому
   берётся цвет границы — он одинаково читается в обеих темах. */
.pipeline-canvas.vue-flow {
  background-image: radial-gradient(var(--color-border) 1px, transparent 1px);
  background-size: 18px 18px;
}

/* Marquee selection box styling */
.pipeline-canvas .vue-flow__selection {
  background: color-mix(in oklab, var(--color-accent) 10%, transparent);
  border: 1.5px dashed var(--color-accent-border);
  border-radius: var(--radius-sm);
}

/* Connection line while dragging */
.pipeline-canvas .vue-flow__connection-path {
  stroke: var(--color-accent);
  stroke-width: 2;
}

/* Edge hover state */
.pipeline-canvas .vue-flow__edge:hover .vue-flow__edge-path {
  stroke-width: 3;
  cursor: pointer;
}

/* Selected edge */
.pipeline-canvas .vue-flow__edge.selected .vue-flow__edge-path {
  stroke-width: 2.6;
  stroke: var(--color-accent);
}

/* Связь по умолчанию: тонкая и приглушённая — граф читается блоками, а не
   проводами. */
.pipeline-canvas .vue-flow__edge-path {
  stroke: var(--color-text-subtle);
  stroke-width: 1.6;
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

/* Мини-карта: маска затемняет то, что вне видимой области, а сама карта
   должна лежать на панели, а не на белом прямоугольнике по умолчанию. */
.pipeline-canvas + .vue-flow__minimap,
.pipeline-canvas .vue-flow__minimap {
  background: var(--color-panel);
}

.pipeline-canvas .vue-flow__minimap-mask {
  fill: color-mix(in oklab, var(--color-surface) 70%, transparent);
  stroke: none;
}

.pipeline-canvas .vue-flow__minimap-node {
  fill: var(--color-text-subtle);
  stroke: none;
}

/* Selection box via mouse drag */
.pipeline-canvas .vue-flow__selectionpane {
  cursor: default;
}
</style>
