/**
 * GET /api/videos/[id]/shots
 *
 * ФАКТ исполнения кадров монтажа (§12; хвост Task 7 плана «Монтаж, фоны и PiP»).
 *
 * До этой ручки факта наружу не отдавала ни одна GET-ручка, и таблица кадров в
 * консоли монтажа показывала оператору ПЛАН из снапшота шага `edit_plan`,
 * подписывая колонку «факт» баннером «сервер её не отдаёт». Разница между
 * планом и фактом здесь не косметическая: `VideoShot.background` — это то, что
 * ЗАПРОСИЛ шаг плана, а `backgroundActual` — то, что реально произвёл шаг
 * `shot_background` после потолков §7 и отказов провайдера. Ровно на этом
 * расхождении и держится объяснение «почему кадр выглядит не так, как задумано»,
 * а вместе с ним — решение оператора, платить ли за пересборку.
 *
 * План этой ручкой сознательно НЕ отдаётся (`background`, `idea`, `pipEnabled`):
 * его источник — снапшот шага, и второй источник плана дал бы два расходящихся
 * ответа на один вопрос. Здесь только исполнение и то, чем строку факта
 * склеивают с планом (`order`) и с таймлайном (границы, сцена).
 */

export default defineEventHandler(async (event) => {
  // Авторизация ПЕРВОЙ строкой — до разбора id и до любого чтения БД, тем же
  // порядком и по той же причине, что в `shots/[order]/rerender.post.ts`:
  // иначе код ответа (404 против 401/403) отличал бы существующий `Video.id`
  // от несуществующего, а это последовательные целые, то есть перебором —
  // карта чужих роликов.
  await requireScopedAccess(event, { permissions: ['canRead'], moduleSlug: 'video-generator' })

  const id = Number(getRouterParam(event, 'id'))
  if (Number.isNaN(id) || id <= 0) {
    throw createError({ statusCode: 400, message: 'Некорректный ID видео' })
  }

  const video = await prisma.video.findUnique({ where: { id }, select: { id: true } })
  if (!video) {
    throw createError({ statusCode: 404, message: 'Видео не найдено' })
  }

  // Ролик без кадров — это законное состояние (шаг плана ещё не отработал, или
  // ролик собран не от звука), а не 404: пустой список честнее ошибки.
  const shots = await prisma.videoShot.findMany({
    where: { videoId: id },
    // `order` — позиция на таймлайне; без явной сортировки Postgres не обязан
    // возвращать строки по возрастанию, и таблица кадров прыгала бы.
    orderBy: { order: 'asc' },
    select: {
      order: true,
      startSec: true,
      endSec: true,
      sceneOrder: true,
      backgroundActual: true,
      status: true,
      costUsd: true,
      degradeReason: true,
      assetPath: true,
      perceptualHash: true,
    },
  })

  return { data: shots }
})
