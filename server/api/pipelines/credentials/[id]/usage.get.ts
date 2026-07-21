/**
 * Get usage info — which pipelines/nodes reference this credential.
 */
export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ['canRead'],
    moduleSlug: 'pipeline',
  })

  const id = Number(getRouterParam(event, 'id'))
  if (Number.isNaN(id) || id <= 0) {
    throw createError({ statusCode: 400, message: 'Некорректный ID' })
  }

  const usage = await findCredentialUsage(id, user.id)

  return { data: usage }
})
