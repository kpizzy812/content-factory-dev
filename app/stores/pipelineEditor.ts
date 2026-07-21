export const usePipelineEditorStore = defineStore('pipelineEditor', () => {
  const pipelineId = ref<number | null>(null)
  const name = ref('')
  const description = ref<string | null>(null)
  const markdownDescription = ref<string | null>(null)
  const icon = ref<string | null>(null)
  const color = ref<string | null>(null)
  const tags = ref<Array<{ id: number; name: string }>>([])
  const status = ref<'active' | 'inactive'>('inactive')
  const nodes = ref<any[]>([])
  const edges = ref<any[]>([])
  const webhookToken = ref<string | null>(null)
  const webhookEnabled = ref(true)
  const isDirty = ref(false)
  const selectedNodeId = ref<string | null>(null)
  const clipboard = ref<any[] | null>(null)

  // Undo/Redo history
  const history = ref<Array<{ nodes: any[]; edges: any[] }>>([])
  const historyIndex = ref(-1)
  const maxHistory = 50

  function pushHistory() {
    history.value = history.value.slice(0, historyIndex.value + 1)
    history.value.push({
      nodes: JSON.parse(JSON.stringify(nodes.value)),
      edges: JSON.parse(JSON.stringify(edges.value)),
    })
    if (history.value.length > maxHistory) {
      history.value.shift()
    }
    historyIndex.value = history.value.length - 1
  }

  function undo() {
    if (historyIndex.value > 0) {
      historyIndex.value--
      const snap = history.value[historyIndex.value]!
      nodes.value = JSON.parse(JSON.stringify(snap.nodes))
      edges.value = JSON.parse(JSON.stringify(snap.edges))
      isDirty.value = true
    }
  }

  function redo() {
    if (historyIndex.value < history.value.length - 1) {
      historyIndex.value++
      const snap = history.value[historyIndex.value]!
      nodes.value = JSON.parse(JSON.stringify(snap.nodes))
      edges.value = JSON.parse(JSON.stringify(snap.edges))
      isDirty.value = true
    }
  }

  const canUndo = computed(() => historyIndex.value > 0)
  const canRedo = computed(() => historyIndex.value < history.value.length - 1)

  function loadFromApi(pipeline: any) {
    pipelineId.value = pipeline.id
    name.value = pipeline.name
    description.value = pipeline.description ?? null
    markdownDescription.value = pipeline.markdownDescription ?? null
    icon.value = pipeline.icon ?? null
    color.value = pipeline.color ?? null
    tags.value = pipeline.tags ?? []
    status.value = pipeline.status ?? 'inactive'
    webhookToken.value = pipeline.webhookToken ?? null
    webhookEnabled.value = pipeline.webhookEnabled ?? true

    const graph = pipeline.graphData as { nodes?: any[]; edges?: any[] } | null
    nodes.value = Array.isArray(graph?.nodes) ? graph.nodes : []
    edges.value = Array.isArray(graph?.edges) ? graph.edges : []

    isDirty.value = false
    selectedNodeId.value = null
    clipboard.value = null

    history.value = [{
      nodes: JSON.parse(JSON.stringify(nodes.value)),
      edges: JSON.parse(JSON.stringify(edges.value)),
    }]
    historyIndex.value = 0
  }

  function toGraphData() {
    return { nodes: nodes.value, edges: edges.value }
  }

  function addNode(node: any) {
    nodes.value.push(node)
    isDirty.value = true
    pushHistory()
  }

  function removeNode(id: string) {
    nodes.value = nodes.value.filter((n: any) => n.id !== id)
    edges.value = edges.value.filter((e: any) => e.source !== id && e.target !== id)
    if (selectedNodeId.value === id) selectedNodeId.value = null
    isDirty.value = true
    pushHistory()
  }

  /** Remove multiple nodes at once. */
  function removeNodes(ids: string[]) {
    const idSet = new Set(ids)
    nodes.value = nodes.value.filter((n: any) => !idSet.has(n.id))
    edges.value = edges.value.filter((e: any) => !idSet.has(e.source) && !idSet.has(e.target))
    if (selectedNodeId.value && idSet.has(selectedNodeId.value)) selectedNodeId.value = null
    isDirty.value = true
    pushHistory()
  }

  function updateNodeData(id: string, data: Record<string, any>) {
    const node = nodes.value.find((n: any) => n.id === id)
    if (node) {
      node.data = { ...node.data, ...data }
      isDirty.value = true
    }
  }

  function addEdge(edge: any) {
    edges.value.push(edge)
    isDirty.value = true
    pushHistory()
  }

  function removeEdge(id: string) {
    edges.value = edges.value.filter((e: any) => e.id !== id)
    isDirty.value = true
    pushHistory()
  }

  /** Remove selected edges. */
  function removeSelectedEdges() {
    const selectedIds = edges.value.filter((e: any) => e.selected).map((e: any) => e.id)
    if (selectedIds.length === 0) return
    const idSet = new Set(selectedIds)
    edges.value = edges.value.filter((e: any) => !idSet.has(e.id))
    isDirty.value = true
    pushHistory()
  }

  function selectNode(id: string | null) {
    selectedNodeId.value = id
  }

  /** Duplicate selected node with offset position. */
  function duplicateNode(id: string) {
    const node = nodes.value.find((n: any) => n.id === id)
    if (!node) return

    const newId = `${node.data?.type ?? 'node'}-${Date.now()}-dup`
    const duplicate = JSON.parse(JSON.stringify(node))
    duplicate.id = newId
    duplicate.position = {
      x: (node.position?.x ?? 0) + 40,
      y: (node.position?.y ?? 0) + 40,
    }
    duplicate.selected = false

    nodes.value.push(duplicate)
    isDirty.value = true
    pushHistory()
    selectedNodeId.value = newId
  }

  /** Copy selected nodes to clipboard. */
  function copyNodes(ids: string[]) {
    const toCopy = nodes.value.filter((n: any) => ids.includes(n.id))
    clipboard.value = JSON.parse(JSON.stringify(toCopy))
  }

  /** Paste nodes from clipboard with offset. */
  function pasteNodes() {
    if (!clipboard.value || clipboard.value.length === 0) return

    const idMap = new Map<string, string>()
    const newNodes: any[] = []

    for (const node of clipboard.value) {
      const newId = `${node.data?.type ?? 'node'}-${Date.now()}-paste-${Math.random().toString(36).slice(2, 6)}`
      idMap.set(node.id, newId)

      newNodes.push({
        ...JSON.parse(JSON.stringify(node)),
        id: newId,
        position: {
          x: (node.position?.x ?? 0) + 60,
          y: (node.position?.y ?? 0) + 60,
        },
        selected: false,
      })
    }

    nodes.value.push(...newNodes)

    // Also copy internal edges between pasted nodes
    const pastedIds = new Set(clipboard.value.map((n: any) => n.id))
    for (const edge of edges.value) {
      if (pastedIds.has(edge.source) && pastedIds.has(edge.target)) {
        const newSource = idMap.get(edge.source)
        const newTarget = idMap.get(edge.target)
        if (newSource && newTarget) {
          edges.value.push({
            ...JSON.parse(JSON.stringify(edge)),
            id: `e-${newSource}-${newTarget}-paste`,
            source: newSource,
            target: newTarget,
          })
        }
      }
    }

    isDirty.value = true
    pushHistory()
  }

  /** Select all nodes. */
  function selectAll() {
    for (const node of nodes.value) {
      node.selected = true
    }
  }

  /** Get node count. */
  const nodeCount = computed(() => nodes.value.length)
  const edgeCount = computed(() => edges.value.length)

  function $reset() {
    pipelineId.value = null
    name.value = ''
    description.value = null
    markdownDescription.value = null
    icon.value = null
    color.value = null
    tags.value = []
    status.value = 'inactive'
    webhookToken.value = null
    webhookEnabled.value = true
    nodes.value = []
    edges.value = []
    isDirty.value = false
    selectedNodeId.value = null
    clipboard.value = null
    history.value = []
    historyIndex.value = -1
  }

  return {
    pipelineId,
    name,
    description,
    markdownDescription,
    icon,
    color,
    tags,
    status,
    webhookToken,
    webhookEnabled,
    nodes,
    edges,
    isDirty,
    selectedNodeId,
    clipboard,
    canUndo,
    canRedo,
    nodeCount,
    edgeCount,
    loadFromApi,
    toGraphData,
    addNode,
    removeNode,
    removeNodes,
    updateNodeData,
    addEdge,
    removeEdge,
    removeSelectedEdges,
    selectNode,
    duplicateNode,
    copyNodes,
    pasteNodes,
    selectAll,
    undo,
    redo,
    pushHistory,
    $reset,
  }
})
