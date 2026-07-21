/**
 * Test a single pipeline node with mock or real input.
 * Поддерживает все типы нод из единого реестра pipeline-node-registry.
 */
import { NODE_TYPES, isKnownNodeType } from '~~/shared/utils/pipeline-node-registry'

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ['canRunAgent'],
    moduleSlug: 'pipeline',
  })

  const body = await readBody<{
    nodeType?: string
    nodeConfig?: Record<string, unknown>
    mockInput?: Record<string, unknown>
  }>(event)

  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, message: 'Тело запроса обязательно' })
  }

  const { nodeType, nodeConfig, mockInput } = body

  if (!nodeType || typeof nodeType !== 'string') {
    throw createError({ statusCode: 400, message: 'nodeType обязателен' })
  }

  if (!isKnownNodeType(nodeType)) {
    throw createError({
      statusCode: 400,
      message: `Неизвестный тип ноды. Допустимые: ${NODE_TYPES.join(', ')}`,
    })
  }

  const config = nodeConfig && typeof nodeConfig === 'object' ? nodeConfig : {}
  const input = mockInput && typeof mockInput === 'object' ? mockInput : {}

  const startTime = Date.now()
  const TIMEOUT_MS = 30_000

  try {
    const output = await Promise.race([
      executeNode(nodeType, { type: nodeType, config }, input),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Таймаут теста (30с)')), TIMEOUT_MS),
      ),
    ])

    return {
      data: {
        success: true,
        output,
        duration: Date.now() - startTime,
      },
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Неизвестная ошибка'
    return {
      data: {
        success: false,
        error: errorMsg,
        duration: Date.now() - startTime,
      },
    }
  }
})
