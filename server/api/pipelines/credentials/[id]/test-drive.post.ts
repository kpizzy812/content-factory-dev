/**
 * POST /api/pipelines/credentials/[id]/test-drive — тест Drive credential.
 *
 * Permissions: canRead (модуль pipeline).
 * Rate-limit: global 100/60s (защита от ботов на shared endpoint).
 *
 * Делает JWT exchange + listFolders(pageSize: 1). Обновляет lastTestedAt + lastTestStatus.
 */
import { classifyDriveError, createDriveClient } from "~~/server/utils/google-drive/client"
import { loadDriveCredential } from "~~/server/utils/google-drive/credential"
import { listFolders } from "~~/server/utils/google-drive/folders"
import { checkGlobalRateLimit } from "~~/server/utils/google-drive/rate-limit"

export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ["canRead"],
    moduleSlug: "pipeline",
  })

  const idRaw = getRouterParam(event, "id")
  const id = Number(idRaw)
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, message: "Некорректный ID" })
  }

  const rate = checkGlobalRateLimit()
  if (!rate.ok) {
    setHeader(event, "Retry-After", String(rate.retryAfterSec ?? 60))
    throw createError({
      statusCode: 429,
      message: `Слишком много запросов. Повторите через ${rate.retryAfterSec ?? 60} сек.`,
    })
  }

  const loaded = await loadDriveCredential(id, user.id)
  const client = createDriveClient(loaded.accessToken)

  try {
    const result = await listFolders(client, { pageSize: 1 })
    await prisma.pipelineCredential
      .update({
        where: { id },
        data: { lastTestedAt: new Date(), lastTestStatus: "ok" },
      })
      .catch(() => {})
    return {
      data: {
        ok: true,
        message: "Drive connection OK",
        foldersFound: result.folders.length,
      },
    }
  } catch (err: unknown) {
    const classified = classifyDriveError(err)
    await prisma.pipelineCredential
      .update({
        where: { id },
        data: {
          lastTestedAt: new Date(),
          lastTestStatus: `error: ${classified.category}`.slice(0, 200),
        },
      })
      .catch(() => {})
    if (typeof err === "object" && err !== null && "statusCode" in err) {
      throw err
    }
    throw createError({
      statusCode: classified.statusCode,
      message: `Drive API: ${classified.message}`,
      data: { category: classified.category },
    })
  }
})
