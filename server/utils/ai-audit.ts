/**
 * AI Audit Trail — запись действий AI в журнал.
 * Каждый AI suggest логирует: кто вызвал, что предложено, что применено.
 * Если передан usage — рассчитываем costUsd по pricing table.
 */

import { calculateAnthropicCost, type AnthropicUsage } from './ai-pricing'

interface AuditLogEntry {
  userId: number
  action: 'block_suggest' | 'field_suggest' | 'taxonomy_suggest' | 'external_api_call'
  nodeType?: string
  pipelineId?: number
  nodeCanvasId?: string
  model: string
  prompt: string
  suggestions?: unknown
  blockedFields?: unknown
  rejectedFields?: unknown
  /** Token usage из callAnthropicAgent.onUsage — для расчёта costUsd */
  usage?: AnthropicUsage | null
  /** Опционально: денормализованный service tag для balance_v2.
   *  По умолчанию для claude-* моделей подставляется 'anthropic'. */
  service?: string
}

export async function logAiAudit(entry: AuditLogEntry): Promise<number> {
  const costUsd = entry.usage ? calculateAnthropicCost(entry.model, entry.usage) : null
  const service = entry.service ?? (entry.model.startsWith('claude') ? 'anthropic' : null)

  const record = await prisma.aiAuditLog.create({
    data: {
      userId: entry.userId,
      action: entry.action,
      nodeType: entry.nodeType ?? null,
      pipelineId: entry.pipelineId ?? null,
      nodeCanvasId: entry.nodeCanvasId ?? null,
      model: entry.model,
      prompt: entry.prompt,
      suggestions: entry.suggestions ?? undefined,
      blockedFields: entry.blockedFields ?? undefined,
      rejectedFields: entry.rejectedFields ?? undefined,
      costUsd: costUsd ?? null,
      service,
      status: 'suggested',
    },
  })
  return record.id
}

export async function updateAiAuditStatus(
  id: number,
  status: 'applied' | 'partial' | 'dismissed',
  appliedFields?: unknown,
) {
  await prisma.aiAuditLog.update({
    where: { id },
    data: {
      status,
      appliedFields: appliedFields ?? undefined,
    },
  })
}
