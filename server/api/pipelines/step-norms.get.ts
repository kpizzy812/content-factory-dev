/**
 * GET /api/pipelines/step-norms — нормы длительности шагов по типам блоков.
 *
 * Нужен диаграмме длительностей: без норм «дольше обычного» приходилось
 * считать от самого запуска, а это ничего не говорит о том, застрял шаг или
 * так и должно быть.
 *
 * Отдельный запрос, а не поле запуска: монитор опрашивает запуск раз в две
 * секунды, а нормы меняются днями.
 */

import { computeStepDurationNorms } from '~~/server/utils/pipeline-step-norms'

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ['canRead'],
    moduleSlug: 'pipeline',
  })

  const query = getQuery(event)
  const windowDays = Number(query.windowDays) || 14

  return { data: await computeStepDurationNorms(windowDays) }
})
