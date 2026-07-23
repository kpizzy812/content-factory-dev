import {
  generateContentFactoryWebhookSecret,
  hashContentFactoryWebhookSecret,
} from '../../../../utils/content-factory-attribution'
import { encrypt } from '../../../../utils/crypto'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, message: 'ID воронки обязателен' })

  const funnel = await prisma.contentFunnel.findUnique({
    where: { id },
    select: { id: true, appId: true },
  })
  if (!funnel) throw createError({ statusCode: 404, message: 'Воронка не найдена' })

  await requireScopedAccess(event, {
    permissions: ['canWrite'],
    moduleSlug: 'pipeline',
    appId: funnel.appId,
  })

  const webhookSecret = generateContentFactoryWebhookSecret()
  await prisma.contentFunnel.update({
    where: { id },
    data: {
      webhookSecretHash: hashContentFactoryWebhookSecret(webhookSecret),
      webhookSecretEncrypted: encrypt(webhookSecret),
    },
  })

  return {
    data: { id },
    integration: {
      webhookSecret,
      secretShownOnce: true,
      headerName: 'X-Content-Factory-Secret',
      webhookUrlTemplate: `${getRequestURL(event).origin}/api/factory/attribution/{trackingToken}`,
      resolverUrl: `${getRequestURL(event).origin}/api/factory/attribution/resolve`,
    },
  }
})
