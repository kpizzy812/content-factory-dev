export type RunStatus = 'pending' | 'running' | 'success' | 'failed' | 'cancelled' | 'no_data'
export type StepStatus = 'pending' | 'running' | 'success' | 'partial' | 'no_data' | 'failed' | 'skipped' | 'cancelled' | 'blocked' | 'waiting'
export type TriggerType = 'manual' | 'schedule' | 'webhook'

export type ErrorCategory =
  | 'validation'
  | 'runtime'
  | 'external_api'
  | 'permission'
  | 'timeout'
  | 'cancellation'
  | 'dependency_failure'
  | 'configuration'
  | 'unknown'

export interface WorkflowStep {
  id: number
  runId: number
  nodeId: string
  nodeName: string
  nodeType: string
  status: StepStatus
  input: unknown
  output: unknown
  error: string | null
  errorCategory: ErrorCategory | null
  logs: StepLogEntry[] | null
  attemptCount: number
  retryPolicy: { maxRetries: number; delayMs: number } | null
  artifacts: Record<string, unknown> | null
  /** Фактически списанное за шаг, USD. null — сумму никто не посчитал. */
  costActual: number | null
  /** Оценка до запуска, USD. Есть не у всех типов блоков. */
  costEstimate: number | null
  startedAt: string | null
  finishedAt: string | null
  duration: number | null
  createdAt: string
}

export interface StepLogEntry {
  ts: string
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
  data?: unknown
}

export interface WorkflowRun {
  id: number
  pipelineId: number
  status: RunStatus
  triggerType: TriggerType
  triggeredBy: number | null
  graphVersionId: number | null
  retryOfRunId: number | null
  replayOfRunId: number | null
  parentRunId: number | null
  cycleId: number | null
  trackingToken: string | null
  inputContext: Record<string, unknown> | null
  cancelRequestedAt: string | null
  errorMessage: string | null
  errorCategory: ErrorCategory | null
  /** Агрегат по шагам, USD. Считает движок, см. server/utils/pipeline-cost.ts. */
  costActual: number | null
  costEstimate: number | null
  startedAt: string
  finishedAt: string | null
  createdAt: string
  steps?: WorkflowStep[]
  _count?: { steps: number }
}

export interface WorkflowRunListMeta {
  total: number
  page: number
  perPage: number
  totalPages: number
}

export interface ValidationIssue {
  severity: 'error' | 'warning'
  nodeId?: string
  field?: string
  message: string
  code: string
}

export interface ReadinessResult {
  ready: boolean
  issues: ValidationIssue[]
  checklist: {
    graphValid: boolean
    nodesConfigured: boolean
    noCycles: boolean
    hasEntryNode: boolean
    expressionsValid: boolean
    scheduleReady: boolean | null
    webhookReady: boolean | null
  }
}

export interface PipelineCredentialMeta {
  id: number
  name: string
  type: string
  description: string | null
  expiresAt: string | null
  lastUsedAt: string | null
  lastTestedAt: string | null
  lastTestStatus: string | null
  metadata: { fields: string[] } | null
  createdAt: string
}

export interface RuntimeStats {
  activeRuns: number
  maxConcurrent: number
  queuedRuns: number
  capacityUsed: string
  instanceId: string
  runtimeMode: 'single_instance_hardened'
  uptimeMs: number
}

export type CredentialHealthStatus =
  | 'healthy'
  | 'expiring_soon'
  | 'expired'
  | 'revoked'
  | 'untested'
  | 'failed_test'

export interface PipelineCredentialWithHealth extends PipelineCredentialMeta {
  healthStatus: CredentialHealthStatus
  revokedAt: string | null
}

// --- Pipeline Monitor types ---

export interface WorkflowRunSummary {
  id: number
  pipelineId: number
  status: RunStatus
  triggerType: TriggerType
  errorCategory: ErrorCategory | null
  errorMessage: string | null
  cancelRequestedAt: string | null
  replayOfRunId: number | null
  trackingToken?: string | null
  startedAt: string
  finishedAt: string | null
  createdAt: string
  stepsCount: number
  /** Фактическая стоимость запуска, USD. null — сумму никто не посчитал. */
  costActual: number | null
}

export interface WorkflowStepSummary {
  id: number
  runId: number
  nodeId: string
  nodeName: string
  nodeType: string
  status: StepStatus
  startedAt: string | null
  finishedAt: string | null
}

export interface PipelineUserPermissions {
  isOwner: boolean
  isShared: boolean
  canCancel: boolean
  canRun: boolean
  canWrite: boolean
}

export interface PipelineRunStats {
  total: number
  success: number
  failed: number
  running: number
}

export interface PipelineMonitorItem {
  id: number
  name: string
  description: string | null
  icon: string | null
  color: string | null
  status: string
  tags: Array<{ id: number; name: string }>
  nodesCount: number
  totalNodes: number
  updatedAt: string
  permissions: PipelineUserPermissions
  runStats: PipelineRunStats
  activeRuns: WorkflowRunSummary[]
  recentRuns: WorkflowRunSummary[]
  currentStep: WorkflowStepSummary | null
}

export interface PipelineMonitorMeta {
  total: number
  page: number
  perPage: number
  totalPages: number
  runtime: {
    activeRuns: number
    maxConcurrent: number
    runIds: number[]
    instanceId: string
    runtimeMode: string
    uptimeMs: number
    queuedRuns: number
    capacityUsed: string
  }
}
