export interface McpTool {
  name: string
  description?: string
  inputSchema?: {
    type?: string
    properties?: Record<string, unknown>
    required?: string[]
    [key: string]: unknown
  }
}

export interface McpCallResult {
  content?: Array<Record<string, unknown>>
  isError?: boolean
  [key: string]: unknown
}

export type McpFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

export interface McpClientOptions {
  endpoint: string
  apiKey: string
  authHeader?: string
  authScheme?: string
  protocolVersion?: string
  timeoutMs?: number
  fetchImpl?: McpFetch
}

interface JsonRpcResponse<T> {
  jsonrpc: '2.0'
  id?: number | string | null
  result?: T
  error?: {
    code?: number
    message?: string
    data?: unknown
  }
}

interface InitializeResult {
  protocolVersion?: string
  capabilities?: Record<string, unknown>
  serverInfo?: Record<string, unknown>
}

function validateEndpoint(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('MCP endpoint must be a valid absolute URL')
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('MCP endpoint must use HTTP(S)')
  }
  if (url.username || url.password) {
    throw new Error('MCP credentials must not be included in the URL')
  }
  if (url.search || url.hash) {
    throw new Error('MCP endpoint must not contain query parameters or a fragment')
  }
  return url.toString()
}

function redact(value: string, secret: string): string {
  return secret ? value.split(secret).join('[REDACTED]') : value
}

function parseSsePayload(text: string): unknown {
  const messages: string[] = []
  let current: string[] = []
  for (const line of text.split(/\r?\n/)) {
    if (line === '') {
      if (current.length) messages.push(current.join('\n'))
      current = []
      continue
    }
    if (line.startsWith('data:')) current.push(line.slice(5).trimStart())
  }
  if (current.length) messages.push(current.join('\n'))
  if (!messages.length) throw new Error('MCP server returned an empty SSE response')

  const parsed = messages.map((message) => JSON.parse(message))
  return parsed.find(item => item && typeof item === 'object' && ('result' in item || 'error' in item))
    ?? parsed.at(-1)
}

async function parseResponse<T>(
  response: Response,
  secret: string,
): Promise<JsonRpcResponse<T> | null> {
  const body = await response.text()
  if (!response.ok) {
    const detail = redact(body.replace(/\s+/g, ' ').trim().slice(0, 400), secret)
    throw new Error(`MCP request failed with HTTP ${response.status}${detail ? `: ${detail}` : ''}`)
  }
  if (!body.trim()) return null

  try {
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
    return (contentType.includes('text/event-stream')
      ? parseSsePayload(body)
      : JSON.parse(body)) as JsonRpcResponse<T>
  } catch {
    throw new Error('MCP server returned an invalid JSON-RPC response')
  }
}

export class StreamableHttpMcpClient {
  private readonly endpoint: string
  private readonly apiKey: string
  private readonly authHeader: string
  private readonly authScheme: string
  private readonly requestedProtocolVersion: string
  private readonly timeoutMs: number
  private readonly fetchImpl: McpFetch
  private requestId = 0
  private sessionId: string | null = null
  private negotiatedProtocolVersion: string | null = null
  private initializePromise: Promise<void> | null = null

  constructor(options: McpClientOptions) {
    this.endpoint = validateEndpoint(options.endpoint)
    this.apiKey = options.apiKey.trim()
    if (!this.apiKey) throw new Error('MCP API key is required')
    this.authHeader = options.authHeader?.trim() || 'Authorization'
    this.authScheme = options.authScheme === undefined ? 'Bearer' : options.authScheme.trim()
    this.requestedProtocolVersion = options.protocolVersion?.trim() || '2025-03-26'
    this.timeoutMs = options.timeoutMs ?? 60_000
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  private headers(): Record<string, string> {
    const authorization = this.authScheme
      ? `${this.authScheme} ${this.apiKey}`
      : this.apiKey
    return {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      [this.authHeader]: authorization,
      ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}),
      ...(this.negotiatedProtocolVersion
        ? { 'mcp-protocol-version': this.negotiatedProtocolVersion }
        : {}),
    }
  }

  private async post<T>(payload: Record<string, unknown>): Promise<JsonRpcResponse<T> | null> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
      const sessionId = response.headers.get('mcp-session-id')
      if (sessionId) this.sessionId = sessionId
      return await parseResponse<T>(response, this.apiKey)
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`MCP request timed out after ${this.timeoutMs}ms`)
      }
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(redact(message, this.apiKey))
    } finally {
      clearTimeout(timeout)
    }
  }

  private async request<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    const id = ++this.requestId
    const response = await this.post<T>({
      jsonrpc: '2.0',
      id,
      method,
      ...(params ? { params } : {}),
    })
    if (!response) throw new Error(`MCP method ${method} returned no response`)
    if (response.error) {
      throw new Error(`MCP ${method} failed: ${response.error.message || `code ${response.error.code ?? 'unknown'}`}`)
    }
    if (response.result === undefined) {
      throw new Error(`MCP method ${method} returned no result`)
    }
    return response.result
  }

  private async notify(method: string): Promise<void> {
    await this.post({
      jsonrpc: '2.0',
      method,
    })
  }

  async initialize(): Promise<void> {
    if (this.negotiatedProtocolVersion) return
    if (!this.initializePromise) {
      this.initializePromise = (async () => {
        const result = await this.request<InitializeResult>('initialize', {
          protocolVersion: this.requestedProtocolVersion,
          capabilities: {},
          clientInfo: {
            name: 'content-factory',
            version: '1.0.0',
          },
        })
        this.negotiatedProtocolVersion = result.protocolVersion || this.requestedProtocolVersion
        await this.notify('notifications/initialized')
      })().catch((error) => {
        this.initializePromise = null
        throw error
      })
    }
    await this.initializePromise
  }

  async listTools(): Promise<McpTool[]> {
    await this.initialize()
    const tools: McpTool[] = []
    let cursor: string | undefined
    do {
      const result = await this.request<{ tools?: McpTool[], nextCursor?: string }>(
        'tools/list',
        cursor ? { cursor } : undefined,
      )
      tools.push(...(result.tools ?? []))
      cursor = result.nextCursor
    } while (cursor)
    return tools
  }

  async callTool(name: string, arguments_: Record<string, unknown>): Promise<McpCallResult> {
    await this.initialize()
    const result = await this.request<McpCallResult>('tools/call', {
      name,
      arguments: arguments_,
    })
    if (result.isError) throw new Error(`MCP tool ${name} returned an error`)
    return result
  }
}

export function createMcpClient(options: McpClientOptions): StreamableHttpMcpClient {
  return new StreamableHttpMcpClient(options)
}
