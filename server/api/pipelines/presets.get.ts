/**
 * Pipeline presets — готовые шаблоны конвейеров для быстрого старта.
 */
import { pipelinePresets } from '../../../shared/utils/pipeline-presets'

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ['canRead'],
    moduleSlug: 'pipeline',
  })

  return { data: pipelinePresets }
})
