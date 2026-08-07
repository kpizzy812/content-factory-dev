<script setup lang="ts">
definePageMeta({ layout: 'default', middleware: 'module-access', moduleSlug: 'pipeline' })

const route = useRoute()
const store = usePipelineEditorStore()
const { savePipeline, isSaving } = usePipelineActions()

const pipelineId = computed(() => route.params.id as string)
const { data, pending, error } = usePipelineDetail(pipelineId)

const unsavedModalRef = ref<{ open: () => void } | null>(null)
const pendingNavigation = ref<string | null>(null)

// Load pipeline data into store when fetched
watch(
  () => data.value,
  (val) => {
    if (val?.data) {
      store.loadFromApi(val.data)
    }
  },
  { immediate: true },
)

useHead({
  title: computed(() => store.name || 'Конвейер'),
})

// Keyboard shortcuts
// Используем e.code вместо e.key — code не зависит от раскладки клавиатуры и Ctrl-модификатора
function handleKeydown(e: KeyboardEvent) {
  const mod = e.ctrlKey || e.metaKey
  const tag = (e.target as HTMLElement)?.tagName
  const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
    || (e.target as HTMLElement)?.isContentEditable

  // Ctrl+S — save (always works, even in inputs)
  if (mod && e.code === 'KeyS') {
    e.preventDefault()
    e.stopPropagation()
    if (store.pipelineId && store.isDirty && !isSaving.value) {
      savePipeline(store.pipelineId, {
        name: store.name,
        description: store.description,
        markdownDescription: store.markdownDescription,
        icon: store.icon,
        color: store.color,
        tags: store.tags.map(t => t.name),
        graphData: store.toGraphData(),
        status: store.status,
      }).then(() => {
        store.isDirty = false
      })
    }
    return
  }

  // All other shortcuts only work outside inputs
  if (isInput) return

  // Ctrl+Z — undo
  if (mod && e.code === 'KeyZ' && !e.shiftKey) {
    e.preventDefault()
    e.stopPropagation()
    store.undo()
    return
  }

  // Ctrl+Shift+Z / Ctrl+Y — redo
  if (mod && ((e.code === 'KeyZ' && e.shiftKey) || e.code === 'KeyY')) {
    e.preventDefault()
    e.stopPropagation()
    store.redo()
    return
  }

  // Ctrl+D — duplicate selected node
  if (mod && e.code === 'KeyD') {
    e.preventDefault()
    e.stopPropagation()
    if (store.selectedNodeId) {
      store.duplicateNode(store.selectedNodeId)
    }
    return
  }

  // Ctrl+C — copy selected nodes
  if (mod && e.code === 'KeyC') {
    e.preventDefault()
    e.stopPropagation()
    const selectedIds = store.nodes.filter((n: any) => n.selected).map((n: any) => n.id)
    if (selectedIds.length > 0) {
      store.copyNodes(selectedIds)
    } else if (store.selectedNodeId) {
      store.copyNodes([store.selectedNodeId])
    }
    return
  }

  // Ctrl+V — paste
  if (mod && e.code === 'KeyV') {
    e.preventDefault()
    e.stopPropagation()
    if (store.clipboard && store.clipboard.length > 0) {
      store.pasteNodes()
    }
    return
  }

  // Ctrl+A — select all
  if (mod && e.code === 'KeyA') {
    e.preventDefault()
    e.stopPropagation()
    store.selectAll()
    return
  }

  // Delete / Backspace — remove selected nodes or edges
  if (e.key === 'Delete' || e.key === 'Backspace') {
    const selectedIds = store.nodes.filter((n: any) => n.selected).map((n: any) => n.id)
    if (selectedIds.length > 0) {
      e.preventDefault()
      store.removeNodes(selectedIds)
      return
    }
    if (store.selectedNodeId) {
      e.preventDefault()
      store.removeNode(store.selectedNodeId)
      return
    }
    // Remove selected edges
    const selectedEdges = store.edges.filter((edge: any) => edge.selected)
    if (selectedEdges.length > 0) {
      e.preventDefault()
      store.removeSelectedEdges()
      return
    }
  }

  // Escape — deselect
  if (e.key === 'Escape') {
    store.selectNode(null)
  }
}

// Unsaved changes — browser beforeunload
function handleBeforeUnload(e: BeforeUnloadEvent) {
  if (store.isDirty) {
    e.preventDefault()
    e.returnValue = ''
  }
}

// Unsaved changes — in-app navigation guard
onBeforeRouteLeave((_to, _from, next) => {
  if (store.isDirty) {
    pendingNavigation.value = _to.fullPath
    unsavedModalRef.value?.open()
    next(false)
  }
  else {
    next()
  }
})

async function handleUnsavedSave() {
  if (store.pipelineId) {
    await savePipeline(store.pipelineId, {
      name: store.name,
      description: store.description,
      markdownDescription: store.markdownDescription,
      icon: store.icon,
      color: store.color,
      tags: store.tags.map(t => t.name),
      graphData: store.toGraphData(),
      status: store.status,
    })
    store.isDirty = false
  }
  if (pendingNavigation.value) {
    navigateTo(pendingNavigation.value)
  }
}

function handleUnsavedDiscard() {
  store.isDirty = false
  if (pendingNavigation.value) {
    navigateTo(pendingNavigation.value)
  }
}

function handleUnsavedCancel() {
  pendingNavigation.value = null
}

onMounted(() => {
  // capture: true — перехватываем событие ДО того, как браузер или VueFlow его обработают
  window.addEventListener('keydown', handleKeydown, { capture: true })
  window.addEventListener('beforeunload', handleBeforeUnload)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown, { capture: true })
  window.removeEventListener('beforeunload', handleBeforeUnload)
  store.$reset()
})
</script>

<template>
  <!-- Загрузка -->
  <div v-if="pending" class="p-4">
    <UiSkeleton variant="details" :count="6" />
  </div>

  <!-- Ошибка -->
  <UiErrorState
    v-else-if="error"
    title="Не удалось открыть конвейер"
    :message="error.message"
    @retry="navigateTo('/pipeline')"
  />

  <!--
    Отступы у редактора снимает сама оболочка (isFullBleed в layouts/default),
    поэтому здесь ни отрицательных полей, ни ручной ширины: они добавляли
    лишние 32 пикселя и страница ездила по горизонтали.
  -->
  <template v-else>
    <!--
      Редактор — экран для компьютера: палитра, полотно и панель настроек стоят
      в три колонки, а блоки ставятся перетаскиванием. На 390 три колонки
      наезжают друг на друга, поэтому вместо каши — прямой текст, как на
      аналитике («Рейтинги и разбор — с компьютера»).
    -->
    <div class="flex flex-col items-center gap-2 p-6 text-center lg:hidden">
      <Icon name="mingcute:computer-line" class="text-3xl text-subtle" />
      <p class="font-medium">Редактор конвейера — с компьютера</p>
      <p class="max-w-xs text-sm text-muted">
        Блоки ставятся перетаскиванием, а настройки открываются панелью справа —
        на телефоне это не помещается. Запуски и историю конвейера видно и здесь.
      </p>
      <NuxtLink :to="`/pipeline/${pipelineId}/runs`">
        <UiButton size="md">
          <Icon name="mingcute:history-line" />
          История запусков
        </UiButton>
      </NuxtLink>
    </div>

    <div class="hidden h-[calc(100vh-5rem)] flex-col overflow-hidden lg:flex">
      <PipelineToolbar />

      <div class="flex min-h-0 flex-1 overflow-hidden">
        <PipelineSidebar />
        <PipelineCanvas class="min-w-0 flex-1" />
        <PipelineRightPanel />
      </div>
    </div>
  </template>

  <!-- Unsaved changes modal -->
  <PipelineUnsavedModal
    ref="unsavedModalRef"
    @save="handleUnsavedSave"
    @discard="handleUnsavedDiscard"
    @cancel="handleUnsavedCancel"
  />
</template>
