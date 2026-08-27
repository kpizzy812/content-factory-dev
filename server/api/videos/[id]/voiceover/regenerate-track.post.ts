/**
 * POST /api/videos/[id]/voiceover/regenerate-track
 *
 * Полная перегенерация трека озвучки (§4.5) — самая дорогая кнопка озвучки.
 *
 * Она пересинтезирует ВЕСЬ трек и меняет отпечаток файла, по которому считаются
 * ключи кусков: обесцениваются все аватарные кадры ролика. Поэтому молчаливого
 * пути сюда нет — нужен явный `{ confirmExpensive: true }`, а без него ручка
 * отвечает 400 с числами: сколько кадров придётся собрать заново и во что это
 * обойдётся.
 *
 * Ручка тонкая (AGENTS.md): все правила — в чистой `planTrackRegeneration`,
 * сама перегенерация — штатный каскад `rerunVideoStep('voiceover_generation')`.
 * На маршруте «монтаж от звука» он сбрасывает и транскрипцию, и план монтажа, и
 * lip-sync, и сборку: трек другой, значит всё, что от него посчитано, невалидно.
 *
 * Отдельная ручка от `rerun-step`: там нет ни подтверждения суммы, ни защиты от
 * повторной оплаты, а `voiceover_generation` не входит в её список шагов именно
 * потому, что стоит слишком дорого для кнопки без подписи.
 */

import { planTrackRegeneration } from '~~/server/utils/voiceover/track-regenerate'
import { loadVideoStoryPlan } from '~~/server/utils/voiceover/script-source'
import { getModel, getDefaultTtsModel, getDefaultLipSyncModel } from '~~/server/utils/video-models'
import { rerunVideoStep } from '~~/server/utils/video-pipeline'

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canRunAgent'], moduleSlug: 'video-generator' })

  const id = Number(getRouterParam(event, 'id'))
  const body = await readBody<{ confirmExpensive?: unknown, force?: unknown }>(event).catch(() => null)

  const video = Number.isInteger(id) && id > 0
    ? await prisma.video.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        isLocked: true,
        voiceoverEnabled: true,
        voiceoverVoiceId: true,
        voiceoverModelId: true,
        lipSyncModelId: true,
      },
    })
    : null

  // Читаем ТОЛЬКО когда ролик существует: на 404 лишние запросы в БД не нужны.
  //
  // Сценарий берётся ролика, а не варианта: вариант ОБЩИЙ, и правки реплик,
  // сделанные на этом ролике, живут в `Video.scriptOverrides`. Читай мы вариант
  // напрямую — перегенерация синтезировала бы общий текст, то есть откатила бы
  // правку, за которую оператор уже заплатил, и списала бы за это ещё раз.
  const [voiceoverStep, storyPlan, shotsToRebuild] = video
    ? await Promise.all([
      prisma.videoGenerationStep.findFirst({
        where: { videoId: video.id, stepKey: 'voiceover_generation' as never },
        select: { status: true, outputSnapshot: true },
      }),
      loadVideoStoryPlan(video.id),
      prisma.videoShot.count({ where: { videoId: video.id } }),
    ])
    : [null, null, 0]

  // Цены берём из реестра моделей — того же, по которому считается смета ролика.
  // Модель без цены даёт ноль, и в окне подтверждения это честнее выдумки.
  const ttsModel = (video?.voiceoverModelId ? getModel(video.voiceoverModelId) : null) ?? getDefaultTtsModel()
  const lipSyncModel = (video?.lipSyncModelId ? getModel(video.lipSyncModelId) : null) ?? getDefaultLipSyncModel()

  const plan = planTrackRegeneration({
    id,
    body,
    video: video
      ? {
        status: String(video.status),
        isLocked: video.isLocked,
        voiceoverEnabled: video.voiceoverEnabled,
        voiceoverVoiceId: video.voiceoverVoiceId,
        voiceoverModelId: video.voiceoverModelId,
      }
      : null,
    voiceoverStep: voiceoverStep
      ? {
        status: String(voiceoverStep.status),
        snapshot: (voiceoverStep.outputSnapshot ?? null) as Record<string, unknown> | null,
      }
      : null,
    storyPlan: storyPlan ?? null,
    shotsToRebuild,
    pricing: {
      ttsUnit: ttsModel?.pricing.unit ?? 'character',
      ttsBase: ttsModel?.pricing.base ?? 0,
      lipSyncUsdPerSecond: lipSyncModel?.pricing.base ?? 0,
    },
  })

  if (plan.kind === 'refuse') {
    throw createError({ statusCode: plan.statusCode, message: plan.message })
  }

  if (plan.kind === 'confirm') {
    // 400 с ЧИСЛАМИ, а не просто отказ: оператор должен принимать решение,
    // видя цену, — иначе подтверждение превращается в лишний клик.
    throw createError({ statusCode: plan.statusCode, message: plan.message, data: { preview: plan.preview } })
  }

  if (plan.kind === 'noop') {
    // Не ошибка: работа уже сделана или идёт. Ответ 200 с `regenerated: false`
    // — повторный заход обязан быть безопасным и внятным, а не пятисоткой.
    return {
      data: {
        id: plan.videoId,
        regenerated: false,
        reason: plan.reason,
        preview: plan.preview,
      },
    }
  }

  // Каскад сброса сам переводит ролик в `pending`, чистит `awaitingStepKey` и
  // откатывает приёмку на шаг назад, после чего запускает новый прогон
  // fire-and-forget: держать HTTP-соединение на весь синтез нельзя.
  await rerunVideoStep(plan.videoId, 'voiceover_generation')

  return {
    data: {
      id: plan.videoId,
      regenerated: true,
      status: 'pending',
      rerunFrom: 'voiceover_generation',
      preview: plan.preview,
    },
  }
})
