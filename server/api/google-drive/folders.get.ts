/**
 * GET /api/google-drive/folders — список папок Google Drive (browse).
 *
 * Permissions: canRead (модуль trendwatcher).
 * Query: credentialId (required), parentId? (default 'root'), pageToken?
 *
 * Возвращает folders + nextPageToken через Drive REST v3 (или mock).
 */
import { classifyDriveError, createDriveClient } from "~~/server/utils/google-drive/client"
import { loadDriveCredential } from "~~/server/utils/google-drive/credential"
import { listFolders } from "~~/server/utils/google-drive/folders"

export default defineEventHandler(async (event) => {
  const user = await requireScopedAccess(event, {
    permissions: ["canRead"],
    moduleSlug: "trendwatcher",
  })

  const query = getQuery(event)
  const credentialIdRaw = query.credentialId
  const credentialId = Number(
    typeof credentialIdRaw === "string" ? credentialIdRaw : (credentialIdRaw ?? Number.NaN),
  )
  if (!Number.isFinite(credentialId) || credentialId <= 0) {
    throw createError({ statusCode: 400, message: "Параметр credentialId обязателен" })
  }

  const parentId = typeof query.parentId === "string" ? query.parentId : undefined
  const pageToken = typeof query.pageToken === "string" ? query.pageToken : undefined
  const q = typeof query.q === "string" ? query.q : undefined

  const loaded = await loadDriveCredential(credentialId, user.id)
  const client = createDriveClient(loaded.accessToken)

  try {
    const result = await listFolders(client, { parentId, pageToken, q })
    return { data: result }
  } catch (err: unknown) {
    if (typeof err === "object" && err !== null && "statusCode" in err) {
      // Уже classified createError — пробрасываем как есть
      throw err
    }
    const classified = classifyDriveError(err)
    throw createError({
      statusCode: classified.statusCode === 401 ? 502 : classified.statusCode,
      message: `Drive API: ${classified.message}`,
      data: { category: classified.category },
    })
  }
})
