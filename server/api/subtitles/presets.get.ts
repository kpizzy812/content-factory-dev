/**
 * GET /api/subtitles/presets
 *
 * Список всех публичных пресетов субтитров. Используется UI-picker'ом для рендера
 * карточек. Legacy aliases (tiktok_classic, ...) скрыты — они нужны только для
 * валидации существующих записей в БД, в новый UI их не публикуем.
 */

import { listPresets } from '~~/server/utils/subtitles/preset-registry'

export default defineEventHandler(async (event) => {
  // RBAC: чтение video-generator модуля. Не платный gate — список статичен и не дёргает API.
  await requireScopedAccess(event, {
    permissions: ['canRead'],
    moduleSlug: 'video-generator',
  })

  return {
    data: listPresets(),
  }
})
