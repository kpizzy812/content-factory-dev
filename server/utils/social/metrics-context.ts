/**
 * Чистые расчёты производных метрик поста.
 *
 * Платформы отдают только сырые счётчики. Досматриваемость и CTR считаются уже
 * у нас — здесь, без БД и сети, чтобы формулы можно было проверить тестом, а не
 * «на проде по ощущениям». Прирост подписчиков живёт в `follower-attribution.ts`:
 * он относится к аккаунту целиком, и его ещё нужно разложить по публикациям.
 */

/**
 * Доля досмотра: среднее время просмотра к длительности ролика.
 *
 * Instagram отдаёт среднее время в миллисекундах и может вернуть больше
 * длительности (петля повторов), поэтому результат зажимаем в 0…1 — иначе в
 * отчёте появится «досматриваемость 240 %».
 */
export function computeWatchThrough(
  averageWatchTimeMs: number | null | undefined,
  videoDurationSec: number | null | undefined,
): number {
  const watchMs = Number(averageWatchTimeMs)
  const durationSec = Number(videoDurationSec)
  if (!Number.isFinite(watchMs) || watchMs <= 0) return 0
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 0
  const ratio = watchMs / (durationSec * 1000)
  if (!Number.isFinite(ratio) || ratio <= 0) return 0
  return Math.min(1, ratio)
}

/**
 * CTR ролика — доля переходов по трекинг-ссылке от просмотров.
 * Считается так же, как в сквозной аналитике (`analytics/rankings.ts`):
 * переход = событие атрибуции `messenger_opened`.
 */
export function computeCtr(clicks: number, views: number): number {
  const safeClicks = Number.isFinite(clicks) && clicks > 0 ? clicks : 0
  const safeViews = Number.isFinite(views) && views > 0 ? views : 0
  if (safeViews === 0) return 0
  return Math.min(1, safeClicks / safeViews)
}

export interface FollowerSnapshot {
  fetchedAt: Date
  followers: bigint | number | null
}

function followersToNumber(value: bigint | number | null): number | null {
  if (value === null || value === undefined) return null
  const numeric = typeof value === "bigint" ? Number(value) : Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

export interface FollowerPoint {
  at: number
  followers: number
}

/**
 * Приводит снимки подписчиков к упорядоченному ряду точек.
 *
 * Мусор (пустые счётчики, кривые даты) выбрасываем, дубли по времени схлопываем:
 * два запроса могут вернуть один и тот же снимок, а для расчёта прироста это
 * одна точка, а не две.
 */
export function normalizeFollowerSnapshots(
  snapshots: Array<FollowerSnapshot | null | undefined>,
): FollowerPoint[] {
  const points = snapshots
    .filter((item): item is FollowerSnapshot => Boolean(item))
    .map(item => ({ at: item.fetchedAt?.getTime() ?? Number.NaN, followers: followersToNumber(item.followers) }))
    .filter((item): item is FollowerPoint => Number.isFinite(item.at) && item.followers !== null)
    .sort((a, b) => a.at - b.at)

  return points.filter((item, index) => index === 0 || item.at !== points[index - 1]!.at)
}
