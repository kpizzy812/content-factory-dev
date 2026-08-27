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
 * Per-scene текст и позиция (subtitleCopy / subtitlePlacement) — это локальные
 * данные сцены, и живут они В ПРАВКАХ РОЛИКА (`Video.scriptOverrides`), а не в
 * общем `ScenarioVariant.storyPlan`.
 *
 * ПОЧЕМУ НЕ В ВАРИАНТЕ. Вариант ОБЩИЙ: `Video.variantId` уникальности не даёт,
 * один вариант кормит сколько угодно роликов, а конвейер и вовсе выбирает
 * вариант через `Scenario.selectedVariantId` — на ролик не смотрит вообще.
 * Правка подписи на одном ролике переписывала её всем соседям, и сосед узнавал
 * об этом на первой же пересборке — которую, кстати, запускает и эта же ручка.
 * Ровно та дыра, которую для реплик закрыл коммит `f6df7d0`; здесь она жила
 * дальше. Механизм тот же и намеренно тот же самый модуль
 * (`server/utils/voiceover/script-overrides.ts`): патч на ролике, наложение при
 * чтении, копии большого плана не заводится.
 *
 * После сохранения запускается rerunVideoStep('assembly') — клипы на диске
 * переиспользуются, ffmpeg перестраивает финальный mp4 (5-10 сек, бесплатно).
 * Свежие подписи он увидит сам: `runVideoPipeline` строит план прогона из
 * `applyScriptOverrides(variant.storyPlan, video.scriptOverrides)`.
 */

import type { StoryPlan, SubtitleStyleProfile } from '~~/shared/types/story'
import {
  SUBTITLE_WORDS_PER_LINE_MIN,
  SUBTITLE_WORDS_PER_LINE_MAX,
} from '~~/shared/types/story'
import { mergeSubtitleStyle } from '~~/server/utils/subtitle-style'
import { rerunVideoStep } from '~~/server/utils/video-pipeline'
import { isKnownPresetKey, listAllKnownKeys } from '~~/server/utils/subtitles/preset-registry'
import { saveVideoSubtitleOverrides } from '~~/server/utils/voiceover/script-source'
import type { SubtitleScenePatch } from '~~/server/utils/voiceover/script-overrides'

interface EditSubtitlesBody {
  subtitlePreset?: string
  subtitleStyle?: Partial<SubtitleStyleProfile>
  scenes?: SubtitleScenePatch[]
  /** Не пересобирать сразу — оператор хочет сохранить и отдельно нажать «Применить и пересобрать». */
  skipRerun?: boolean
}

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

  // 3. Patch per-scene текст / позиция — В ПРАВКИ ЭТОГО РОЛИКА, а не в общий
  // вариант. Валидация положения (position/alignment) и «сцены нет в сценарии»
  // живут внутри `saveVideoSubtitleOverrides`: там же, где наложение, и потому
  // разъехаться им негде.
  let scenesPatched = 0
  if (body.scenes?.length) {
    const saved = await saveVideoSubtitleOverrides(id, body.scenes)
    scenesPatched = saved.patched
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
        // Сколько сцен РЕАЛЬНО поправлено, а не сколько прислали: сцена вне
        // сценария и повторная правка тем же текстом не пишут ничего, и
        // рапортовать о них как о правках значило бы врать оператору.
        scenesPatched,
      },
      status: body.skipRerun ? video.status : 'pending',
    },
  }
})
