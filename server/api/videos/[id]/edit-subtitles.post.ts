/**
 * POST /api/videos/[id]/edit-subtitles
 *
 * Редактирование субтитров на уже собранном видео без перегенерации клипов.
 *
 * Source of truth для subtitleStyle — Video.subtitlesStyle (Json). Editor пишет
 * сюда; runAssembly при пересборке читает оттуда (через subtitleStyleOverride).
 * StoryPlan.subtitleStyle остаётся snapshot'ом «рекомендации сценария» — нужен
 * чтобы editor показывал badge «из сценария / изменено вручную» и кнопку reset.
 *
 * Per-scene текст и позиция (subtitleCopy / subtitlePlacement) хранятся в
 * ScenarioVariant.storyPlan.scenes[i] — это локальные данные сцены, а не
 * глобальный стиль; их обновляем там же.
 *
 * После сохранения запускается rerunVideoStep('assembly') — клипы на диске
 * переиспользуются, ffmpeg перестраивает финальный mp4 (5-10 сек, бесплатно).
 */

import type { StoryPlan, SubtitleStyleProfile, SubtitlePlacement } from '~~/shared/types/story'
import {
  SUBTITLE_WORDS_PER_LINE_MIN,
  SUBTITLE_WORDS_PER_LINE_MAX,
} from '~~/shared/types/story'
import { mergeSubtitleStyle } from '~~/server/utils/subtitle-style'
import { rerunVideoStep } from '~~/server/utils/video-pipeline'
import { isKnownPresetKey, listAllKnownKeys } from '~~/server/utils/subtitles/preset-registry'

interface SceneSubtitlePatch {
  order: number
  subtitleCopy?: string
  subtitlePlacement?: Partial<SubtitlePlacement>
}

interface EditSubtitlesBody {
  subtitlePreset?: string
  subtitleStyle?: Partial<SubtitleStyleProfile>
  scenes?: SceneSubtitlePatch[]
  /** Не пересобирать сразу — оператор хочет сохранить и отдельно нажать «Применить и пересобрать». */
  skipRerun?: boolean
}

const VALID_POSITIONS = ['top', 'center', 'bottom']
const VALID_ALIGNMENTS = ['left', 'center', 'right']

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canRunAgent'], moduleSlug: 'video-generator' })

  const id = Number(getRouterParam(event, 'id'))
  if (Number.isNaN(id) || id <= 0) {
    throw createError({ statusCode: 400, message: 'Некорректный ID видео' })
  }

  const body = await readBody<EditSubtitlesBody>(event)
  if (!body || (!body.subtitlePreset && !body.subtitleStyle && !body.scenes?.length)) {
    throw createError({ statusCode: 400, message: 'Укажите хотя бы одно поле для обновления' })
  }

  const video = await prisma.video.findUnique({ where: { id } })
  if (!video) {
    throw createError({ statusCode: 404, message: 'Видео не найдено' })
  }
  if (video.isLocked) {
    throw createError({ statusCode: 409, message: 'Видео заблокировано — идёт другая операция' })
  }
  if (video.status !== 'completed' && video.status !== 'failed' && video.status !== 'canceled') {
    throw createError({ statusCode: 400, message: `Редактирование субтитров недоступно в статусе '${video.status}'` })
  }

  // Валидация wordsPerLine на уровне API — отбиваем мусор до записи в БД.
  // mergeSubtitleStyle затем clamp'ит ещё раз для defense-in-depth.
  const incomingWords = body.subtitleStyle?.typography?.wordsPerLine
  if (typeof incomingWords === 'number'
    && (incomingWords < SUBTITLE_WORDS_PER_LINE_MIN || incomingWords > SUBTITLE_WORDS_PER_LINE_MAX)) {
    throw createError({
      statusCode: 400,
      message: `wordsPerLine должен быть в диапазоне ${SUBTITLE_WORDS_PER_LINE_MIN}..${SUBTITLE_WORDS_PER_LINE_MAX}`,
    })
  }

  // 1. Patch subtitlePreset на Video. Известны новые ключи (classic, hormozi, ...) +
  // legacy aliases (tiktok_classic, ...) — последние резолвятся через preset-registry,
  // в БД остаются как есть для backward-compat записей.
  if (body.subtitlePreset !== undefined) {
    if (!isKnownPresetKey(body.subtitlePreset)) {
      throw createError({
        statusCode: 400,
        message: `subtitlePreset должен быть одним из: ${listAllKnownKeys().join(', ')}`,
      })
    }
    await prisma.video.update({
      where: { id },
      data: { subtitlePreset: body.subtitlePreset },
    })
  }

  // 2. Patch subtitleStyle в Video.subtitlesStyle — единая точка истины.
  // Базой служит существующий Video.subtitlesStyle (если есть) либо storyPlan.subtitleStyle
  // как fallback (если video создан до миграции на новую структуру).
  if (body.subtitleStyle) {
    const variant = video.variantId
      ? await prisma.scenarioVariant.findUnique({ where: { id: video.variantId }, select: { storyPlan: true } })
      : null
    const storyPlanStyle = variant?.storyPlan
      ? ((variant.storyPlan as unknown as StoryPlan).subtitleStyle ?? null)
      : null
    const baseStyle = video.subtitlesStyle ?? storyPlanStyle
    const merged = mergeSubtitleStyle(baseStyle, body.subtitleStyle)
    await prisma.video.update({
      where: { id },
      data: { subtitlesStyle: merged as unknown as object },
    })
  }

  // 3. Patch per-scene текст / позиция в ScenarioVariant.storyPlan.scenes —
  // это локальные данные сцен, остаются в storyPlan (там же они и созданы scene-planner'ом).
  if (body.scenes?.length && video.variantId) {
    const variant = await prisma.scenarioVariant.findUnique({ where: { id: video.variantId } })
    if (variant?.storyPlan) {
      const storyPlan = variant.storyPlan as unknown as StoryPlan
      if (Array.isArray(storyPlan.scenes)) {
        const patchMap = new Map<number, SceneSubtitlePatch>()
        for (const p of body.scenes) patchMap.set(p.order, p)

        const patchedScenes = storyPlan.scenes.map((scene) => {
          const p = patchMap.get(scene.order)
          if (!p) return scene
          const next = { ...scene }
          if (typeof p.subtitleCopy === 'string') {
            next.subtitleCopy = p.subtitleCopy
          }
          if (p.subtitlePlacement) {
            const pos = p.subtitlePlacement.position
            const align = p.subtitlePlacement.alignment
            next.subtitlePlacement = {
              position: pos && VALID_POSITIONS.includes(pos) ? pos : scene.subtitlePlacement?.position ?? 'bottom',
              alignment: align && VALID_ALIGNMENTS.includes(align) ? align : scene.subtitlePlacement?.alignment ?? 'center',
              avoidZones: p.subtitlePlacement.avoidZones ?? scene.subtitlePlacement?.avoidZones ?? [],
            }
          }
          return next
        })

        await prisma.scenarioVariant.update({
          where: { id: variant.id },
          data: {
            storyPlan: { ...storyPlan, scenes: patchedScenes } as never,
          },
        })
      }
    }
  }

  // 4. Пересобираем mp4 через rerunVideoStep('assembly') — клипы на диске
  // переиспользуются, runAssembly прочитает свежий Video.subtitlesStyle.
  // skipRerun: оператор может хотеть batch-edit без перерасхода компиляций.
  if (!body.skipRerun) {
    await rerunVideoStep(id, 'assembly')
  }

  return {
    data: {
      id,
      rerunFrom: body.skipRerun ? null : 'assembly',
      updated: {
        subtitlePreset: body.subtitlePreset ?? null,
        hasStyleUpdate: !!body.subtitleStyle,
        scenesPatched: body.scenes?.length ?? 0,
      },
      status: body.skipRerun ? video.status : 'pending',
    },
  }
})
