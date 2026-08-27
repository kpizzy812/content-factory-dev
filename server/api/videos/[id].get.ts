import { applyScriptOverrides } from '~~/server/utils/voiceover/script-overrides'

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, { permissions: ['canRead'], moduleSlug: 'video-generator' })

  const id = Number(getRouterParam(event, "id"))

  if (Number.isNaN(id) || id <= 0) {
    throw createError({
      statusCode: 400,
      message: "Некорректный ID видео",
    })
  }

  const video = await prisma.video.findUnique({
    where: { id },
    include: {
      assets: {
        orderBy: { order: "asc" },
      },
      scenario: {
        select: {
          id: true,
          trendId: true,
          selectedVariantId: true,
          variants: {
            where: { status: 'accepted' },
            select: {
              id: true,
              title: true,
              hook: true,
              body: true,
              cta: true,
              visualStyleText: true,
              // storyPlan нужен для редактирования субтитров per-scene в UI
              storyPlan: true,
            },
            take: 1,
          },
        },
      },
    },
  })

  if (!video) {
    throw createError({
      statusCode: 404,
      message: "Видео не найдено",
    })
  }

  /**
   * Сценарий отдаётся ГЛАЗАМИ ЭТОГО ролика, а не сырым вариантом.
   *
   * `storyPlan` здесь нужен ровно одному потребителю — редактору субтитров
   * (`app/components/video/VideoSubtitleEditor.vue` читает `variant.storyPlan`).
   * А правки подписей с 28.08.2026 живут на РОЛИКЕ (`Video.scriptOverrides`),
   * потому что вариант общий для всех роликов сценария. Отдай мы вариант как
   * есть — редактор показывал бы чужой (общий) текст сразу после того, как
   * оператор сохранил свой, и следующее сохранение вернуло бы общий текст в
   * ролик поверх собственной правки.
   *
   * Ролик без правок получает ТОТ ЖЕ объект варианта: копии плана не заводится.
   */
  const variant = video.scenario?.variants?.[0]
  if (variant) {
    variant.storyPlan = applyScriptOverrides(variant.storyPlan, video.scriptOverrides)
  }

  return { data: video }
})
