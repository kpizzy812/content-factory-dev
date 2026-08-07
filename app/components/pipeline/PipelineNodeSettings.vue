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
  <div v-if="selectedNode" class="flex h-full flex-col overflow-hidden">
    <header class="flex flex-none items-center gap-2 border-b border-divider px-3 py-2.5">
      <Icon :name="typeIcons[nodeType] || 'mingcute:box-line'" class="shrink-0 text-muted" />

      <div v-if="!isRenaming" class="min-w-0 flex-1">
        <h3
          class="cursor-pointer truncate text-sm font-semibold hover:text-accent-text"
          title="Двойной клик — переименовать блок"
          @dblclick="startRename"
        >
          {{ selectedNode.data?.label || typeLabels[nodeType] || 'Настройки' }}
        </h3>
        <div class="truncate font-mono text-[10.5px] text-subtle">{{ nodeType }}</div>
      </div>

      <UiInput
        v-else
        v-model="renameValue"
        class="flex-1"
        autofocus
        @keyup.enter="finishRename"
        @keyup.escape="isRenaming = false"
        @blur="finishRename"
      />

      <UiButton variant="ghost" icon-only title="Закрыть настройки блока" @click="store.selectNode(null)">
        <Icon name="mingcute:close-line" />
      </UiButton>
    </header>

    <p
      v-if="typeDescriptions[nodeType] && !isNoteNode"
      class="mx-3 mt-3 flex items-start gap-2 rounded-md border border-border bg-card px-2.5 py-2 text-sm text-muted"
    >
      <Icon name="mingcute:information-line" class="mt-0.5 shrink-0 text-info" />
      {{ typeDescriptions[nodeType] }}
    </p>

    <div :key="store.selectedNodeId ?? undefined" class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      <div
        v-if="isNoteNode"
        class="flex flex-col gap-1 rounded-md border border-border bg-card px-2.5 py-2 text-sm text-muted"
      >
        <p>Заметка на полотне — в выполнении конвейера она не участвует.</p>
        <p class="text-subtle">Двойной клик по заметке открывает текст, цвет и размер.</p>
      </div>

      <PipelineAiAutofill
        v-if="!isNoteNode && !hasCustomAiAutofill"
        :node-type="nodeType"
        :config="config"
        @apply="onAiAutofillApply"
      />

      <PipelineAiAuditLog v-if="!isNoteNode && !hasCustomAiAutofill" :node-type="nodeType" />

      <PipelineNodeConfigForm
        v-if="!isNoteNode"
        :node-type="nodeType"
        :config="config"
        :node-id="store.selectedNodeId ?? undefined"
        :pipeline-id="store.pipelineId ?? undefined"
        @update="onConfigUpdate"
      />
    </div>

    <!-- Проверка блока отдельно от конвейера: свёрнута, потому что нужна
         далеко не каждый раз, но и прятать её в меню незачем. -->
    <div v-if="!isNoteNode" class="flex-none border-t border-divider p-3">
      <UiDisclosure title="Проверить блок отдельно" icon="mingcute:flask-line">
        <div class="flex flex-col gap-2">
          <p class="text-[11px] text-subtle">
            Блок отработает изолированно на текущих настройках — весь конвейер при
            этом не запускается.
          </p>

          <PipelineNodeTestPanel :node-type="nodeType" :config="config" />

          <div class="flex gap-1.5">
            <UiButton v-if="!hasPinnedOutput" class="flex-1" @click="pinOutput">
              <Icon name="mingcute:pin-line" />
              Закрепить данные последнего запуска
            </UiButton>
            <UiButton v-else variant="primary" class="flex-1" @click="unpinOutput">
              <Icon name="mingcute:pin-fill" />
              Открепить данные
            </UiButton>

            <UiButton icon-only title="Дублировать блок · Ctrl+D" @click="duplicateSelectedNode">
              <Icon name="mingcute:copy-2-line" />
            </UiButton>
          </div>

          <div
            v-if="hasPinnedOutput"
            class="rounded-md border border-warning-border bg-warning-bg p-2 text-sm"
          >
            <div class="mb-1 flex items-center gap-1.5 font-medium text-warning">
              <Icon name="mingcute:pin-fill" />
              Данные закреплены
            </div>
            <details>
              <summary class="cursor-pointer text-[11px] text-subtle">Показать данные</summary>
              <pre class="mt-1 max-h-24 overflow-auto text-[10px] break-all whitespace-pre-wrap">{{ JSON.stringify(selectedNode?.data?.pinnedOutput, null, 2) }}</pre>
            </details>
          </div>
        </div>
      </UiDisclosure>
    </div>

    <div
      v-if="!isNoteNode && store.pipelineId && store.selectedNodeId"
      class="flex-none border-t border-divider px-3 py-3"
    >
      <PipelineNodeLastRun :pipeline-id="store.pipelineId" :node-id="store.selectedNodeId" />
    </div>

    <div class="flex-none border-t border-divider p-3">
      <UiButton variant="danger" class="w-full" @click="removeSelectedNode">
        <Icon name="mingcute:delete-2-line" />
        Удалить блок
      </UiButton>
    </div>
  </div>
</template>
