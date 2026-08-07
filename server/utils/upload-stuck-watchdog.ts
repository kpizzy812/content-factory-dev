/**
 * Watchdog залипших публикаций.
 *
 * Пайплайн запускается fire-and-forget уже ПОСЛЕ того, как запись переведена в
 * pending (планировщик, оркестратор цикла, ручной retry). Если процесс умрёт в
 * этот зазор — деплой, OOM, kill — запись останется в pending навсегда: тик
 * планировщика выбирает только scheduled, blocked_by_env и failed, а кнопка
 * «Повторить» в интерфейсе показывается лишь для failed/blocked_by_env. То же
 * самое с uploading, если процесс умер посреди заливки.
 *
 * Поэтому такие записи мы возвращаем не сразу в очередь, а в failed с понятной
 * причиной: дальше решение принимает обычная политика автоповтора. Для площадок
 * с идемпотентным resume (tiktok, instagram) она поднимет загрузку сама и
 * продолжит с сохранённого containerId/postId, а для YouTube сработает защита от
 * дубля из upload-rerun-guard и запись дождётся человека.
 */

import { STUCK_UPLOAD_TIMEOUT_MS } from "./upload-rerun-guard"
import { syncFactoryPublicationFromUpload } from "./factory-publication"

/** Сколько залипших записей разбираем за один заход. */
const STUCK_BATCH_SIZE = 20

/** Статусы «в работе», из которых некому вытащить запись после смерти процесса. */
const IN_FLIGHT_STATUSES = ["pending", "uploading"] as const

export const STUCK_UPLOAD_MESSAGE =
  "Прогон публикации прерван (перезапуск процесса или таймаут). "
  + "Загрузка возвращена в очередь — автоповтор подхватит её, если площадка поддерживает продолжение."

/**
 * Переводит залипшие pending/uploading в failed.
 *
 * lastAttemptAt намеренно не трогаем: это точка отсчёта backoff-а, и сдвигать её
 * значило бы наказать паузой загрузку, которая и так простояла полчаса зря.
 *
 * @returns сколько записей возвращено в очередь
 */
export async function releaseStuckUploads(now: Date = new Date()): Promise<number> {
  const threshold = new Date(now.getTime() - STUCK_UPLOAD_TIMEOUT_MS)

  const stuck = await prisma.upload.findMany({
    where: {
      status: { in: IN_FLIGHT_STATUSES as never },
      updatedAt: { lt: threshold },
    },
    select: { id: true, status: true },
    orderBy: { updatedAt: "asc" },
    take: STUCK_BATCH_SIZE,
  })

  let released = 0
  for (const upload of stuck) {
    // updateMany с проверкой прежнего статуса: пайплайн мог ожить между
    // выборкой и записью — тогда его результат важнее нашего вердикта.
    const updated = await prisma.upload.updateMany({
      where: { id: upload.id, status: upload.status },
      data: {
        status: "failed" as never,
        errorMessage: STUCK_UPLOAD_MESSAGE,
      },
    })
    if (updated.count === 0) continue
    released += updated.count
    await syncFactoryPublicationFromUpload(upload.id).catch(() => {})
  }

  return released
}
