<script setup lang="ts">
const store = usePipelineEditorStore()

const selectedNode = computed(() => {
  if (!store.selectedNodeId) return null
  return store.nodes.find((n: any) => n.id === store.selectedNodeId) ?? null
})

const nodeType = computed(() => selectedNode.value?.data?.type ?? '')
const config = computed(() => selectedNode.value?.data?.config ?? {})

function onConfigUpdate(key: string, value: any) {
  if (!store.selectedNodeId) return
  const newConfig = { ...config.value, [key]: value }
  store.updateNodeData(store.selectedNodeId, { config: newConfig })
}

function removeSelectedNode() {
  if (store.selectedNodeId) {
    store.removeNode(store.selectedNodeId)
  }
}

function duplicateSelectedNode() {
  if (store.selectedNodeId) {
    store.duplicateNode(store.selectedNodeId)
  }
}

// Rename node
const isRenaming = ref(false)
const renameValue = ref('')

function startRename() {
  renameValue.value = selectedNode.value?.data?.label ?? ''
  isRenaming.value = true
}

function finishRename() {
  if (store.selectedNodeId && renameValue.value.trim()) {
    store.updateNodeData(store.selectedNodeId, { label: renameValue.value.trim() })
  }
  isRenaming.value = false
}

// Data pinning
const hasPinnedOutput = computed(() => !!selectedNode.value?.data?.pinnedOutput)

async function pinOutput() {
  if (!store.pipelineId || !store.selectedNodeId) return

  try {
    const res = await $fetch<{ data: any }>(
      `/api/pipelines/${store.pipelineId}/runs`,
      { params: { limit: 1 } },
    )
    const lastRun = res?.data?.[0]
    if (!lastRun?.id) return

    const runDetail = await $fetch<{ data: any }>(
      `/api/pipelines/${store.pipelineId}/runs/${lastRun.id}`,
    )
    const step = runDetail?.data?.steps?.find(
      (s: any) => s.nodeId === store.selectedNodeId && s.status === 'success',
    )
    if (step?.output) {
      store.updateNodeData(store.selectedNodeId, { pinnedOutput: step.output })
    }
  } catch {
    // No data to pin
  }
}

function unpinOutput() {
  if (!store.selectedNodeId) return
  store.updateNodeData(store.selectedNodeId, { pinnedOutput: undefined })
}

// AI autofill — deep merge для nested config (scenario.app/storytelling/subtitles/voiceover).
// Shallow spread терял существующие поля если AI вернул только часть section: например
// {app: {appId: 4}} затирал бы config.app.contextMode и appCenterStrength.
function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...target }
  for (const [k, v] of Object.entries(source)) {
    const isPlainObject = (x: unknown): x is Record<string, unknown> =>
      !!x && typeof x === 'object' && !Array.isArray(x)
    if (isPlainObject(v) && isPlainObject(target[k])) {
      out[k] = deepMerge(target[k], v)
    } else {
      out[k] = v
    }
  }
  return out
}

function onAiAutofillApply(fields: Record<string, unknown>) {
  if (!store.selectedNodeId) return
  const newConfig = deepMerge(config.value, fields)
  store.updateNodeData(store.selectedNodeId, { config: newConfig })
}

// Node meta (auto-imported from app/utils/pipeline-node-meta.ts)
const typeLabels = nodeTypeLabels
const typeDescriptions = nodeTypeDescriptions
const typeIcons = nodeTypeIcons

const isNoteNode = computed(() => nodeType.value === 'note')

// У некоторых нод есть собственный специализированный AI autofill внутри config-формы
// (напр. Trendwatcher — /api/ai/suggest/trendwatcher-config с расширенным контекстом).
// Универсальный PipelineAiAutofill для таких нод скрываем, чтобы не дублировать блок.
const hasCustomAiAutofill = computed(() =>
  nodeTypesWithCustomAiAutofill.has(nodeType.value),
)

// Reset on node switch
watch(() => store.selectedNodeId, () => {
  isRenaming.value = false
})
</script>

<template>
  <div v-if="selectedNode" class="flex flex-col h-full overflow-hidden">
      <!-- Header -->
      <div class="p-3 border-b border-base-300 flex items-center gap-2">
        <Icon :name="typeIcons[nodeType] || 'mingcute:box-line'" class="text-primary text-lg shrink-0" />
        <div v-if="!isRenaming" class="flex-1 min-w-0">
          <h3
            class="text-sm font-bold text-base-content truncate cursor-pointer hover:text-primary"
            @dblclick="startRename"
          >
            {{ selectedNode.data?.label || typeLabels[nodeType] || 'Настройки' }}
          </h3>
          <div class="text-[10px] text-base-content/40">{{ nodeType }}</div>
        </div>
        <div v-else class="flex-1 flex gap-1">
          <input
            v-model="renameValue"
            type="text"
            class="input input-xs flex-1"
            autofocus
            @keyup.enter="finishRename"
            @keyup.escape="isRenaming = false"
            @blur="finishRename"
          />
        </div>
        <div class="tooltip tooltip-left" data-tip="Закрыть настройки блока">
          <button class="btn btn-ghost btn-xs btn-square" @click="store.selectNode(null)">
            <Icon name="mingcute:close-line" />
          </button>
        </div>
      </div>

      <!-- Info block (not for notes — they have their own) -->
      <div v-if="typeDescriptions[nodeType] && !isNoteNode" class="mx-3 mt-3 p-2 rounded-box bg-info/10 border border-info/20 text-xs text-base-content/70">
        <Icon name="mingcute:information-line" class="inline mr-1 text-info" />
        {{ typeDescriptions[nodeType] }}
      </div>

      <!-- Scrollable content -->
      <div :key="store.selectedNodeId ?? undefined" class="p-3 space-y-3 flex-1 overflow-y-auto">
        <!-- Note node info -->
        <div v-if="isNoteNode" class="rounded-box bg-info/10 border border-info/20 p-3 text-xs text-base-content/70 space-y-1">
          <p>Заметка на полотне — не участвует в выполнении конвейера.</p>
          <p class="text-base-content/50">Дважды кликните по заметке на холсте для редактирования текста, смены цвета или размера.</p>
        </div>

        <!-- AI Autofill panel (not for notes; скрыт для нод со своим specialized autofill) -->
        <PipelineAiAutofill
          v-if="!isNoteNode && !hasCustomAiAutofill"
          :node-type="nodeType"
          :config="config"
          @apply="onAiAutofillApply"
        />

        <!-- AI Audit Trail — сразу под промтом autofill. Для нод со specialized
             autofill audit log живёт внутри config-формы, тут не рендерим. -->
        <PipelineAiAuditLog v-if="!isNoteNode && !hasCustomAiAutofill" :node-type="nodeType" />

        <!-- Config form (not for notes) -->
        <PipelineNodeConfigForm
          v-if="!isNoteNode"
          :node-type="nodeType"
          :config="config"
          :node-id="store.selectedNodeId ?? undefined"
          :pipeline-id="store.pipelineId ?? undefined"
          @update="onConfigUpdate"
        />
      </div>

      <!-- Test section (not for notes) — collapsed by default -->
      <div v-if="!isNoteNode" class="border-t border-base-300">
        <div class="collapse collapse-arrow bg-base-100">
          <input type="checkbox" />
          <div class="collapse-title text-xs font-medium text-base-content/60 min-h-0 py-2.5 px-3 flex items-center gap-1.5">
            <Icon name="mingcute:flask-line" class="text-sm" />
            Тестирование блока
          </div>
          <div class="collapse-content px-3 pb-2 space-y-2">
            <p class="text-[10px] text-base-content/40 mb-1">Запустите этот блок изолированно, чтобы проверить настройки</p>

            <PipelineNodeTestPanel
              :node-type="nodeType"
              :config="config"
            />

            <div class="flex gap-1.5">
              <button
                v-if="!hasPinnedOutput"
                class="btn btn-outline btn-xs flex-1"
                @click="pinOutput"
              >
                <Icon name="mingcute:pin-line" class="text-[10px]" />
                Закрепить данные последнего запуска
              </button>
              <button
                v-else
                class="btn btn-primary btn-xs flex-1"
                @click="unpinOutput"
              >
                <Icon name="mingcute:pin-fill" class="text-[10px]" />
                Открепить данные
              </button>

              <div class="tooltip tooltip-top" data-tip="Дублировать блок (Ctrl+D)">
                <button
                  class="btn btn-outline btn-xs btn-square"
                  @click="duplicateSelectedNode"
                >
                  <Icon name="mingcute:copy-2-line" />
                </button>
              </div>
            </div>

            <!-- Pinned output indicator -->
            <div
              v-if="hasPinnedOutput"
              class="rounded-box border border-warning/30 bg-warning/5 p-2 text-xs"
            >
              <div class="flex items-center gap-1 text-warning font-semibold mb-1">
                <Icon name="mingcute:pin-fill" class="text-xs" />
                Данные закреплены
              </div>
              <details>
                <summary class="text-[10px] text-base-content/40 cursor-pointer">Показать данные</summary>
                <pre class="whitespace-pre-wrap break-all text-[10px] max-h-24 overflow-auto mt-1">{{ JSON.stringify(selectedNode?.data?.pinnedOutput, null, 2) }}</pre>
              </details>
            </div>
          </div>
        </div>
      </div>

      <!-- Last run info (not for notes) -->
      <div v-if="!isNoteNode && store.pipelineId && store.selectedNodeId" class="px-3 pb-3 border-t border-base-300 pt-3">
        <PipelineNodeLastRun
          :pipeline-id="store.pipelineId"
          :node-id="store.selectedNodeId"
        />
      </div>

      <!-- Footer -->
      <div class="p-3 border-t border-base-300">
        <button class="btn btn-error btn-sm btn-block btn-outline" @click="removeSelectedNode">
          <Icon name="mingcute:delete-2-line" />
          Удалить блок
        </button>
      </div>
  </div>
</template>
