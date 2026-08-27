/**
 * POST /api/videos/[id]/voiceover/replace-segment
 *
 * Замена ОДНОЙ фразы в готовом треке озвучки (§4.5). Фраза пересинтезируется
 * отдельно и вклеивается в трек по паузам; пересобираются только те кадры, чьи
 * границы реально сдвинулись, — остальные и их lip-sync остаются оплаченными
 * один раз.
 *
 * Ручка тонкая (AGENTS.md): разбор и гейты — чистая `planReplaceSegmentRequest`,
 * вся работа — в раннере. Ждём мы здесь только САМУ замену (синтез одной фразы,
 * склейка, разметка новой фразы) — её результат оператор обязан увидеть в
 * ответе: дельта, что пересоберётся и во сколько это обошлось. А вот пересборка
 * ролика уходит фоном тем же приёмом, что у `approve-step` и `rerender`: держать
 * HTTP-соединение на весь прогон нельзя.
 */

import {
  createReplaceSegmentDeps,
  planReplaceSegmentRequest,
  replaceVoiceoverSegment,
} from '~~/server/utils/voiceover/segment-replace-runner'
import { runVideoPipeline } from '~~/server/utils/video-pipeline'

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canRunAgent'], moduleSlug: 'video-generator' })

  const id = Number(getRouterParam(event, 'id'))
  const body = await readBody<{ sceneOrder?: unknown, newText?: unknown }>(event).catch(() => null)

  const video = Number.isInteger(id) && id > 0
    ? await prisma.video.findUnique({ where: { id }, select: { id: true, status: true, isLocked: true } })
    : null

  const plan = planReplaceSegmentRequest({ id, body, video })
  if (!plan.ok) {
    throw createError({ statusCode: plan.statusCode, message: plan.message })
  }

  let result
  try {
    result = await replaceVoiceoverSegment(
      { videoId: plan.videoId, sceneOrder: plan.sceneOrder, newText: plan.newText },
      createReplaceSegmentDeps(),
    )
  } catch (err) {
    // Отказ раннера — это отказ ПО СУЩЕСТВУ (ролик не собирали от звука, некуда
    // вклеить, трек не измеряется). Текст причины уходит оператору как есть:
    // без него он не поймёт, чинить сценарий или маршрут.
    throw createError({
      statusCode: 400,
      message: err instanceof Error ? err.message : 'Замена фразы не выполнена',
    })
  }

  // Ролик возвращается в очередь, и новый прогон поднимает завершённые шаги из
  // снапшотов: пересобирается только то, что инвалидировано заменой.
  await updateVideoStatus(plan.videoId, 'pending', {
    errorMessage: null,
    finishedAt: null,
    filePath: null,
    fileUrl: null,
  })

  runVideoPipeline(plan.videoId).catch((err) => {
    logAgent('video-pipeline', 'error',
      `Ошибка пересборки видео ${plan.videoId} после замены фразы сцены ${plan.sceneOrder}: `
      + `${err instanceof Error ? err.message : err}`,
      { videoId: plan.videoId },
    ).catch(() => {})
  })

  return {
    data: {
      id: plan.videoId,
      sceneOrder: plan.sceneOrder,
      status: 'pending',
      deltaSec: result.deltaSec,
      invalidatedSceneOrders: result.invalidatedSceneOrders,
      costUsd: result.costUsd,
      reused: result.reused,
      trackDurationSec: result.trackDurationSec,
      // Хвост §4.6: маркеры пауз в новом тексте могли не найти точки вставки, а
      // длительность — не измериться. Оператор обязан видеть это в ответе, а не
      // только в логе шага.
      skippedPauses: result.skippedPauses,
      sourceDurationMeasureFailed: result.sourceDurationMeasureFailed,
      durationEstimated: result.durationEstimated,
      warnings: result.warnings,
    },
  }
})
