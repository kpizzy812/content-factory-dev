/**
 * POST /api/admin/telegram/restart
 * Принудительный перезапуск Telegram-бота (polling).
 */

import { restartBot } from "../../../utils/telegram/bot"

export default defineEventHandler(async (event) => {
  await requirePermission(event, "canAdmin")

  await restartBot()

  return { data: { success: true } }
})
