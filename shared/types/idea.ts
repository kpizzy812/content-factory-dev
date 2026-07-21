export interface IdeaAnalysis {
  id: number
  ideaId: number
  hookAnalysis: Record<string, unknown>
  sceneStructure: Record<string, unknown>
  visualStyle: Record<string, unknown>
  viralityReasons: Record<string, unknown>
  summary: string
  modelVersion: string
  promptVersion: string
  confidence: number | null
  referenceBreakdown: Record<string, unknown> | null
  referenceVersion: string | null
  createdAt: string
  updatedAt: string
}

export interface IdeaOperatorAction {
  id: number
  ideaId: number
  actionType: 'create' | 'edit' | 'delete' | 'restore' | 'reanalyze' | 'send_to_scenario'
  reason: string | null
  actorId: number | null
  createdAt: string
}

export type IdeaSource = 'manual' | 'telegram' | 'pipeline' | 'marketingcamp'
export type SyncStatus = 'none' | 'synced' | 'pending_export' | 'pending_import' | 'conflict' | 'error'
export type SyncDirection = 'local' | 'imported' | 'exported' | 'bidirectional'

export interface Idea {
  id: number
  appId: number | null
  source: IdeaSource
  sourceUrl: string | null
  platform: string | null
  transcription: string | null
  language: string | null
  title: string | null
  hook: string | null
  body: string | null
  cta: string | null
  visualStyle: string | null
  whyViral: string | null
  status: string
  analysisStatus: string
  operatorNotes: string | null
  tags: string[]
  isDeleted: boolean
  deletedAt: string | null
  sentToScenarioAt: string | null
  createdById: number | null
  errorMessage: string | null
  mediaType: string | null
  thumbnailUrl: string | null
  referenceStatus: string | null
  // --- MarketingCamp sync ---
  externalId: number | null
  syncStatus: SyncStatus
  syncDirection: SyncDirection
  lastSyncedAt: string | null
  lastSyncError: string | null
  remoteSnapshot: Record<string, unknown> | null
  localDirty: boolean
  createdAt: string
  updatedAt: string
  app?: {
    id: number
    name: string
  } | null
  analysis?: IdeaAnalysis | null
  operatorActions?: IdeaOperatorAction[]
}

/** Payload креатива из MarketingCamp */
export interface McCreativePayload {
  id: number
  type: string
  title: string | null
  description: string | null
  status: string
  appId: number | null
  appName: string | null
  source: string | null
  sourceUrl: string | null
  thumbnailUrl: string | null
  format: string | null
  duration: number | null
  language: string | null
  metadata: Record<string, unknown> | null
  tags: string[]
}

/** Payload для экспорта идеи в MarketingCamp */
export interface IdeaExportPayload {
  title: string | null
  description: string | null
  type: string
  sourceUrl: string | null
  thumbnailUrl: string | null
  platform: string | null
  tags: string[]
  appId: number | null
  metadata: Record<string, unknown>
}

export interface SyncResult {
  imported: number
  exported: number
  skipped: number
  errors: Array<{ id?: number; error: string }>
}

export interface IdeaListMeta {
  total: number
  page: number
  perPage: number
  totalPages: number
}
