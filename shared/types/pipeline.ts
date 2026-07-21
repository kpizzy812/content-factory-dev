export interface Pipeline {
  id: number
  userId: number
  name: string
  description: string | null
  markdownDescription: string | null
  icon: string | null
  color: string | null
  tags: Array<{ id: number; name: string }>
  status: string
  graphData: { nodes: any[]; edges: any[] }
  sharedWith: number[]
  createdAt: string
  updatedAt: string
  lastEditedAt: string
}

export interface PipelineListMeta {
  total: number
  page: number
  perPage: number
  totalPages: number
}

export interface PipelineExport {
  version: 1
  exportedAt: string
  meta?: {
    nodeCount: number
    edgeCount: number
    nodeTypes: string[]
    exportedBy?: number
  }
  pipeline: {
    name: string
    description: string | null
    markdownDescription: string | null
    icon: string | null
    color: string | null
    tags: string[]
    graphData: { nodes: any[]; edges: any[] }
  }
}

export interface PipelinePreset {
  id: string
  name: string
  description: string
  category: string
  difficulty: 'beginner' | 'intermediate' | 'advanced'
  useCase: string
  icon: string
  color: string
  graphData: { nodes: any[]; edges: any[] }
}
