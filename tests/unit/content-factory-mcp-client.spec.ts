import { describe, expect, it, vi } from 'vitest'
import { createMcpClient } from '../../server/utils/integrations/mcp-client'

describe('streamable HTTP MCP client', () => {
  it('initializes a session, discovers tools and calls one without putting the key in URL or body', async () => {
    const apiKey = 'chatplace-secret-key'
    const requests: Array<{
      url: string
      headers: Record<string, string>
      body: Record<string, unknown>
    }> = []

    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      const headers = init?.headers as Record<string, string>
      requests.push({ url: String(input), headers, body })

      if (body.method === 'initialize') {
        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-03-26',
            capabilities: { tools: {} },
            serverInfo: { name: 'chatplace', version: '1' },
          },
        }), {
          headers: {
            'content-type': 'application/json',
            'mcp-session-id': 'session-123',
          },
        })
      }
      if (body.method === 'notifications/initialized') {
        return new Response(null, { status: 202 })
      }
      if (body.method === 'tools/list') {
        return new Response([
          'event: message',
          `data: ${JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            result: {
              tools: [{
                name: 'create_automation',
                description: 'Create an automation funnel',
                inputSchema: {
                  type: 'object',
                  properties: { prompt: { type: 'string' } },
                  required: ['prompt'],
                },
              }],
            },
          })}`,
          '',
          '',
        ].join('\n'), {
          headers: { 'content-type': 'text/event-stream' },
        })
      }
      if (body.method === 'tools/call') {
        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            content: [{ type: 'text', text: '{"automationId":"cp-42"}' }],
          },
        }), {
          headers: { 'content-type': 'application/json' },
        })
      }
      throw new Error(`Unexpected method: ${String(body.method)}`)
    })

    const client = createMcpClient({
      endpoint: 'https://mcp.chatplace.io/mcp',
      apiKey,
      fetchImpl,
    })
    const tools = await client.listTools()
    const result = await client.callTool(tools[0]!.name, { prompt: 'Create funnel' })

    expect(tools).toHaveLength(1)
    expect(result.content?.[0]?.text).toContain('cp-42')
    expect(requests.map(item => item.body.method)).toEqual([
      'initialize',
      'notifications/initialized',
      'tools/list',
      'tools/call',
    ])
    for (const request of requests) {
      expect(request.url).not.toContain(apiKey)
      expect(JSON.stringify(request.body)).not.toContain(apiKey)
      expect(request.headers.Authorization).toBe(`Bearer ${apiKey}`)
    }
    expect(requests[0]!.headers['mcp-session-id']).toBeUndefined()
    expect(requests[1]!.headers['mcp-session-id']).toBe('session-123')
  })

  it('rejects credentials embedded in an endpoint URL', () => {
    expect(() => createMcpClient({
      endpoint: 'https://user:password@mcp.chatplace.io/mcp',
      apiKey: 'secret',
    })).toThrow('credentials must not be included')
  })

  it('rejects query credentials in an endpoint URL', () => {
    expect(() => createMcpClient({
      endpoint: 'https://mcp.chatplace.io/mcp?token=secret',
      apiKey: 'secret',
    })).toThrow('must not contain query parameters')
  })
})
