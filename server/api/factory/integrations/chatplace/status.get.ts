import { discoverChatPlaceTools } from '../../../../utils/factory-automation/chatplace-mcp'

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ['canAdmin'],
    moduleSlug: 'pipeline',
  })

  const query = getQuery(event)
  const configured = Boolean(process.env.CHATPLACE_API_KEY?.trim())
  const data: Record<string, unknown> = {
    provider: 'chatplace_mcp',
    enabled: process.env.ENABLE_AUTOMATION_SYNC === 'true',
    configured,
    endpoint: process.env.CHATPLACE_MCP_URL || 'https://mcp.chatplace.io/mcp',
    toolName: process.env.CHATPLACE_MCP_TOOL?.trim() || null,
  }

  if (query.discover === 'true') {
    if (!configured) {
      throw createError({ statusCode: 409, message: 'CHATPLACE_API_KEY is not configured' })
    }
    const tools = await discoverChatPlaceTools()
    data.tools = tools.map(tool => ({
      name: tool.name,
      description: tool.description ?? null,
      inputSchema: tool.inputSchema ?? null,
    }))
  }

  return { data }
})
