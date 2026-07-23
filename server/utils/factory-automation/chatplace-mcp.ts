import {
  createMcpClient,
  type McpCallResult,
  type McpFetch,
  type McpTool,
} from '../integrations/mcp-client'
import type {
  FactoryAutomationAdapter,
  FactoryAutomationInput,
  FactoryAutomationResult,
} from './types'

interface ChatPlaceConfig {
  endpoint: string
  apiKey: string
  authHeader: string
  authScheme: string
  protocolVersion: string
  toolName: string | null
}

interface CreateChatPlaceAdapterOptions {
  env?: NodeJS.ProcessEnv
  fetchImpl?: McpFetch
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function compactJson(value: unknown, maxLength = 6_000): string {
  const serialized = JSON.stringify(value ?? null)
  return serialized.length > maxLength
    ? `${serialized.slice(0, maxLength)}…`
    : serialized
}

function getConfig(
  env: NodeJS.ProcessEnv,
): ChatPlaceConfig {
  const endpoint = String(
    env.CHATPLACE_MCP_URL
    ?? 'https://mcp.chatplace.io/mcp',
  ).trim()
  const apiKey = String(env.CHATPLACE_API_KEY ?? '').trim()
  if (!apiKey) throw new Error('CHATPLACE_API_KEY is not configured')

  return {
    endpoint,
    apiKey,
    authHeader: String(env.CHATPLACE_AUTH_HEADER ?? 'Authorization').trim(),
    authScheme: env.CHATPLACE_AUTH_SCHEME === undefined
      ? 'Bearer'
      : String(env.CHATPLACE_AUTH_SCHEME).trim(),
    protocolVersion: String(env.CHATPLACE_MCP_PROTOCOL_VERSION ?? '2025-03-26').trim(),
    toolName: String(env.CHATPLACE_MCP_TOOL ?? '').trim() || null,
  }
}

export function selectChatPlaceTool(tools: McpTool[], explicitName?: string | null): McpTool {
  if (explicitName) {
    const exact = tools.find(tool => tool.name === explicitName)
    if (!exact) throw new Error(`Configured ChatPlace MCP tool "${explicitName}" was not found`)
    return exact
  }

  const scored = tools
    .map((tool) => {
      const text = `${tool.name} ${tool.description ?? ''}`.toLowerCase()
      let score = 0
      if (/(create|build|setup|configure|upsert|generate)/.test(text)) score += 8
      if (/(automation|funnel|chatbot|bot|flow)/.test(text)) score += 7
      if (/(keyword|trigger|comment|direct message|dm)/.test(text)) score += 3
      if (/(delete|remove|archive)/.test(text)) score -= 20
      if (/(list|search|read|get|inspect)/.test(text)) score -= 6
      return { tool, score }
    })
    .sort((left, right) => right.score - left.score)

  const best = scored[0]
  if (!best || best.score < 10) {
    throw new Error('ChatPlace MCP did not expose an automation creation tool; configure CHATPLACE_MCP_TOOL')
  }
  if (scored[1]?.score === best.score) {
    throw new Error('Several ChatPlace MCP tools match automation creation; configure CHATPLACE_MCP_TOOL')
  }
  return best.tool
}

function leadMagnetSection(input: FactoryAutomationInput): string {
  if (!input.leadMagnet) {
    return 'Лид-магнит не привязан. После срабатывания отправь пользователю ссылку на конверсию.'
  }
  return [
    `Лид-магнит: ${input.leadMagnet.title}.`,
    input.leadMagnet.deliveryMessage
      ? `Сообщение выдачи: ${input.leadMagnet.deliveryMessage}`
      : 'Сформулируй короткое сообщение выдачи без изменения смысла материала.',
    `Материал: ${compactJson(input.leadMagnet.content)}`,
    input.leadMagnet.warmupMessages
      ? `Прогревающие сообщения: ${compactJson(input.leadMagnet.warmupMessages, 3_000)}`
      : '',
  ].filter(Boolean).join('\n')
}

export function buildChatPlacePrompt(input: FactoryAutomationInput): string {
  const config = input.funnel.automationConfig
  const requireFollower = config.requireFollower !== false
  const triggers = Array.isArray(config.triggers)
    ? config.triggers.map(String).filter(Boolean).join(', ')
    : 'комментарий под указанным Reels и входящее сообщение'

  const lines = [
    'Создай или обнови автоматизацию ChatPlace для Instagram. Не создавай дубль, если автоматизация с таким внешним идентификатором уже существует.',
    `Внешний идентификатор: ${input.stableReference}`,
    `Название: ContentFactory — ${input.funnel.name}`,
    `Instagram-аккаунт: ${input.socialAccount.platformHandle || input.socialAccount.platformUserId || input.socialAccount.displayName}`,
    `Reels: ${input.platformPostUrl || input.platformPostId || 'опубликованный ролик из контекста'}`,
    `Триггеры: ${triggers}. Кодовое слово без учёта регистра: ${input.keyword}.`,
    requireFollower
      ? 'Перед выдачей проверь подписку на Instagram-аккаунт. Если пользователь не подписан, попроси подписаться и затем повторно проверь.'
      : 'Проверка подписки не требуется.',
    leadMagnetSection(input),
    `Ссылка на следующий шаг: ${input.conversionUrl}`,
  ]

  if (input.attribution.enabled && input.attribution.webhookUrl && input.attribution.webhookSecret) {
    lines.push(
      'Добавь в автоматизацию External API Request для каждой ветки:',
      `1. После кодового слова в комментарии: POST ${input.attribution.webhookUrl}`,
      `2. После кодового слова в личном сообщении: POST ${input.attribution.webhookUrl}`,
      `3. После успешной выдачи лид-магнита: POST ${input.attribution.webhookUrl}`,
      `Для всех запросов заголовок X-Content-Factory-Secret: ${input.attribution.webhookSecret}`,
      `JSON запроса 1: {"eventType":"automation_comment","publicationId":"${input.publicationId}","mediaId":"${input.platformPostId ?? ''}","platform":"${input.platform}","socialAccountId":${input.socialAccount.id}}`,
      `JSON запроса 2: {"eventType":"automation_direct","publicationId":"${input.publicationId}","mediaId":"${input.platformPostId ?? ''}","platform":"${input.platform}","socialAccountId":${input.socialAccount.id}}`,
      `JSON запроса 3: {"eventType":"lead_magnet_delivered","publicationId":"${input.publicationId}","mediaId":"${input.platformPostId ?? ''}","platform":"${input.platform}","socialAccountId":${input.socialAccount.id}}`,
      'Если ChatPlace даёт ID контакта, добавь его в externalUserId и messengerUserId всех запросов.',
    )
  }

  lines.push('Верни идентификатор созданной или обновлённой автоматизации.')
  return lines.join('\n')
}

function interpolateString(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{?([A-Za-z0-9_]+)\}?\}/g, (match, key: string) => (
    Object.prototype.hasOwnProperty.call(values, key) ? values[key]! : match
  ))
}

function interpolateTemplate(value: unknown, values: Record<string, string>): unknown {
  if (typeof value === 'string') return interpolateString(value, values)
  if (Array.isArray(value)) return value.map(item => interpolateTemplate(item, values))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, item]) => [key, interpolateTemplate(item, values)]),
    )
  }
  return value
}

function inferArgument(
  key: string,
  input: FactoryAutomationInput,
  prompt: string,
): string | number | null {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (['prompt', 'instruction', 'instructions', 'request', 'task', 'description', 'input'].includes(normalized)) return prompt
  if (['name', 'title', 'automationname', 'funnelname', 'botname'].includes(normalized)) return `ContentFactory — ${input.funnel.name}`
  if (['keyword', 'triggerkeyword', 'codeword'].includes(normalized)) return input.keyword
  if (['platform'].includes(normalized)) return input.platform
  if (['posturl', 'mediaurl', 'reelsurl', 'publicationurl'].includes(normalized)) return input.platformPostUrl
  if (['postid', 'mediaid', 'reelsid'].includes(normalized)) return input.platformPostId
  if (['accountid', 'instagramaccountid', 'socialaccountid'].includes(normalized)) {
    return input.socialAccount.platformUserId ?? input.socialAccount.id
  }
  if (['account', 'handle', 'username', 'instagramusername'].includes(normalized)) {
    return input.socialAccount.platformHandle ?? input.socialAccount.displayName
  }
  if (['externalid', 'externalreference', 'reference', 'idempotencykey'].includes(normalized)) return input.stableReference
  return null
}

export function buildChatPlaceArguments(
  tool: McpTool,
  input: FactoryAutomationInput,
  prompt = buildChatPlacePrompt(input),
): Record<string, unknown> {
  const configured = input.funnel.automationConfig.arguments
  const template = objectValue(configured)
  if (Object.keys(template).length) {
    const values = {
      prompt,
      publicationId: input.publicationId,
      stableReference: input.stableReference,
      trackingToken: input.trackingToken,
      keyword: input.keyword,
      platform: input.platform,
      platformPostId: input.platformPostId ?? '',
      platformPostUrl: input.platformPostUrl ?? '',
      socialAccountId: String(input.socialAccount.id),
      platformUserId: input.socialAccount.platformUserId ?? '',
      platformHandle: input.socialAccount.platformHandle ?? '',
      conversionUrl: input.conversionUrl,
      webhookUrl: input.attribution.webhookUrl ?? '',
      webhookSecret: input.attribution.webhookSecret ?? '',
    }
    return interpolateTemplate(template, values) as Record<string, unknown>
  }

  const properties = objectValue(tool.inputSchema?.properties)
  const required = Array.isArray(tool.inputSchema?.required)
    ? tool.inputSchema.required.map(String)
    : []
  const arguments_: Record<string, unknown> = {}

  for (const key of Object.keys(properties)) {
    const value = inferArgument(key, input, prompt)
    if (value !== null && value !== '') arguments_[key] = value
  }

  const unresolved = required.filter(key => arguments_[key] === undefined)
  if (unresolved.length) {
    throw new Error(
      `ChatPlace MCP tool "${tool.name}" requires unknown arguments: ${unresolved.join(', ')}. Configure automationConfig.arguments`,
    )
  }
  if (!Object.keys(arguments_).length) {
    throw new Error(`Cannot infer arguments for ChatPlace MCP tool "${tool.name}"; configure automationConfig.arguments`)
  }
  return arguments_
}

function parseTextJson(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function findExternalId(value: unknown, depth = 0): string | null {
  if (depth > 6 || value === null || value === undefined) return null
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findExternalId(item, depth + 1)
      if (found) return found
    }
    return null
  }
  if (typeof value !== 'object') return null

  const record = value as Record<string, unknown>
  for (const key of ['automationId', 'automation_id', 'funnelId', 'funnel_id', 'botId', 'bot_id', 'id']) {
    const candidate = record[key]
    if (typeof candidate === 'string' || typeof candidate === 'number') return String(candidate)
  }
  for (const item of Object.values(record)) {
    const found = findExternalId(parseTextJson(item), depth + 1)
    if (found) return found
  }
  return null
}

export function extractChatPlaceExternalId(result: McpCallResult, fallback: string): string {
  return findExternalId(result) ?? fallback
}

export function createChatPlaceMcpAdapter(
  options: CreateChatPlaceAdapterOptions = {},
): FactoryAutomationAdapter {
  const env = options.env ?? process.env
  return {
    async sync(input: FactoryAutomationInput): Promise<FactoryAutomationResult> {
      const config = getConfig(env)
      const client = createMcpClient({
        endpoint: config.endpoint,
        apiKey: config.apiKey,
        authHeader: config.authHeader,
        authScheme: config.authScheme,
        protocolVersion: config.protocolVersion,
        fetchImpl: options.fetchImpl,
      })
      const tools = await client.listTools()
      const tool = selectChatPlaceTool(tools, config.toolName)
      const prompt = buildChatPlacePrompt(input)
      const arguments_ = buildChatPlaceArguments(tool, input, prompt)
      const result = await client.callTool(tool.name, arguments_)
      return {
        externalId: extractChatPlaceExternalId(result, input.stableReference),
        provider: 'chatplace_mcp',
        toolName: tool.name,
      }
    },
  }
}

export async function discoverChatPlaceTools(
  options: CreateChatPlaceAdapterOptions = {},
): Promise<McpTool[]> {
  const env = options.env ?? process.env
  const config = getConfig(env)
  return createMcpClient({
    endpoint: config.endpoint,
    apiKey: config.apiKey,
    authHeader: config.authHeader,
    authScheme: config.authScheme,
    protocolVersion: config.protocolVersion,
    fetchImpl: options.fetchImpl,
  }).listTools()
}
