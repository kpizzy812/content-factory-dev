/**
 * GET /api/admin/spend — расход за окно с разбивкой по типам операций.
 *
 * Отвечает на вопрос «куда ушли деньги за сутки и во что обходится ролик».
 * Балансы рядом отвечают на другой — «сколько осталось»; складывать их в один
 * endpoint незачем: остаток вводят руками, расход считается по журналу списаний.
 *
 * Право то же, что у балансов: суммы по заводу видит администратор.
 */

import { computeSpendBreakdown } from '~~/server/utils/balance/spend-breakdown'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'canAdmin')

  const query = getQuery(event)
  const windowHours = Number(query.windowHours) || 24

  return { data: await computeSpendBreakdown(windowHours) }
})
