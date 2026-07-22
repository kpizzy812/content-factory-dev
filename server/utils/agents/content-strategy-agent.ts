import { createHash } from 'node:crypto'
import { callAnthropicAgent } from './call-anthropic'

export interface ContentStrategyLeadMagnet {
  title: string
  format: string
  problem: string
  audience: string
  sections: Array<{ title: string, content: string }>
  deliveryMessage: string
  warmupMessages: Array<{ delayHours: number, text: string }>
}

export interface ContentStrategyResult {
  title: string
  angle: string
  audience: string
  problem: string
  promise: string
  hook: string
  cta: string
  keyword: string
  proofPoints: string[]
  rationale: string
  leadMagnet: ContentStrategyLeadMagnet
}

export interface ContentStrategyInput {
  app: Record<string, unknown>
  trends: Array<Record<string, unknown>>
  ideas: Array<Record<string, unknown>>
  internalMetrics: Array<Record<string, unknown>>
  funnel?: Record<string, unknown> | null
  ordinal?: number
  trackingToken?: string
  extraContext?: Record<string, unknown>
  avoidFingerprints?: string[]
}

function requiredText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`)
  return value.trim().slice(0, max)
}

function stringArray(value: unknown, field: string, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`)
  const items = value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map(item => item.trim().slice(0, maxLength))
    .slice(0, maxItems)
  if (items.length === 0) throw new Error(`${field} must not be empty`)
  return items
}

export function validateContentStrategyResult(data: unknown): ContentStrategyResult {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('strategy result must be an object')
  const value = data as Record<string, unknown>
  const leadRaw = value.leadMagnet
  if (!leadRaw || typeof leadRaw !== 'object' || Array.isArray(leadRaw)) throw new Error('leadMagnet is required')
  const lead = leadRaw as Record<string, unknown>
  if (!Array.isArray(lead.sections)) throw new Error('leadMagnet.sections must be an array')
  const sections = lead.sections.slice(0, 12).map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`leadMagnet.sections[${index}] must be an object`)
    const section = raw as Record<string, unknown>
    return {
      title: requiredText(section.title, `leadMagnet.sections[${index}].title`, 160),
      content: requiredText(section.content, `leadMagnet.sections[${index}].content`, 6000),
    }
  })
  if (sections.length < 2) throw new Error('leadMagnet.sections must contain at least 2 sections')

  const warmupRaw = Array.isArray(lead.warmupMessages) ? lead.warmupMessages : []
  const warmupMessages = warmupRaw.slice(0, 10).map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`leadMagnet.warmupMessages[${index}] must be an object`)
    const item = raw as Record<string, unknown>
    const delayHours = Math.max(0, Math.min(720, Math.trunc(Number(item.delayHours) || 0)))
    return { delayHours, text: requiredText(item.text, `leadMagnet.warmupMessages[${index}].text`, 4000) }
  })

  const keyword = requiredText(value.keyword, 'keyword', 32).replace(/^[@#]+/, '')
  if (!/^[\p{L}\p{N}_-]{2,32}$/u.test(keyword)) throw new Error('keyword must be one word with 2-32 letters or digits')

  return {
    title: requiredText(value.title, 'title', 200),
    angle: requiredText(value.angle, 'angle', 1000),
    audience: requiredText(value.audience, 'audience', 1000),
    problem: requiredText(value.problem, 'problem', 1000),
    promise: requiredText(value.promise, 'promise', 1000),
    hook: requiredText(value.hook, 'hook', 1000),
    cta: requiredText(value.cta, 'cta', 1000),
    keyword,
    proofPoints: stringArray(value.proofPoints, 'proofPoints', 8, 500),
    rationale: requiredText(value.rationale, 'rationale', 2000),
    leadMagnet: {
      title: requiredText(lead.title, 'leadMagnet.title', 200),
      format: requiredText(lead.format, 'leadMagnet.format', 100),
      problem: requiredText(lead.problem, 'leadMagnet.problem', 1000),
      audience: requiredText(lead.audience, 'leadMagnet.audience', 1000),
      sections,
      deliveryMessage: requiredText(lead.deliveryMessage, 'leadMagnet.deliveryMessage', 4000),
      warmupMessages,
    },
  }
}

export function contentHypothesisFingerprint(result: Pick<ContentStrategyResult, 'angle' | 'hook' | 'cta'>): string {
  const normalized = [result.angle, result.hook, result.cta]
    .map(value => value
      .normalize('NFKC')
      .toLocaleLowerCase('ru-RU')
      .replace(/\s+/g, ' ')
      .trim())
    .join('|')
  return createHash('sha256').update(normalized, 'utf8').digest('hex')
}

export async function generateContentStrategy(input: ContentStrategyInput): Promise<ContentStrategyResult> {
  const systemPrompt = `You are a content strategy and performance marketing agent.
Create one production-ready hypothesis for a 70-90 second vertical video and a matching lead magnet.
Base decisions on the supplied evidence. Do not invent facts, statistics, guarantees, or customer outcomes.
Use the application language from the supplied context for all audience-facing text.
The hook must work in the first 2-3 seconds. The CTA must ask for exactly one trigger keyword.
The funnel must continue the promise, repeat the keyword in the CTA, and deliver it in the lead magnet.
The lead magnet must provide practical standalone value, not a thin advertisement.
Return valid JSON only.`

  const userPrompt = `Create a strategy and lead magnet for item ${input.ordinal ?? 1}.
Tracking seed for deterministic linking: ${input.trackingToken ?? 'standalone'}.

Application context:
${JSON.stringify(input.app).slice(0, 12000)}

Trends:
${JSON.stringify(input.trends).slice(0, 18000)}

Editorial ideas:
${JSON.stringify(input.ideas).slice(0, 12000)}

Internal performance metrics:
${JSON.stringify(input.internalMetrics).slice(0, 12000)}

Existing funnel, if any:
${JSON.stringify(input.funnel ?? null).slice(0, 8000)}

Additional constraints:
${JSON.stringify(input.extraContext ?? {}).slice(0, 8000)}

Avoid these fingerprints:
${JSON.stringify(input.avoidFingerprints ?? [])}

JSON schema:
{
  "title": "short hypothesis name",
  "angle": "specific point of view",
  "audience": "specific audience",
  "problem": "one audience problem",
  "promise": "useful and supportable outcome",
  "hook": "first spoken hook",
  "cta": "single trigger-keyword action",
  "keyword": "one word without spaces",
  "proofPoints": ["evidence from supplied data"],
  "rationale": "why the hypothesis fits the evidence",
  "leadMagnet": {
    "title": "lead magnet title",
    "format": "checklist|guide|template|table",
    "problem": "problem it solves",
    "audience": "who it is for",
    "sections": [{"title": "section", "content": "practical standalone value"}],
    "deliveryMessage": "delivery message",
    "warmupMessages": [{"delayHours": 24, "text": "follow-up message"}]
  }
}`

  return callAnthropicAgent({
    systemPrompt,
    userPrompt,
    maxTokens: 5000,
    validate: validateContentStrategyResult,
    agentName: 'content-strategy',
  })
}
