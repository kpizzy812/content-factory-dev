/**
 * Раскладка прироста подписчиков аккаунта по его публикациям.
 *
 * Прирост подписчиков — величина аккаунта, а не поста: снимки
 * AccountMetricsSnapshot ничего не знают о том, какой ролик привёл человека.
 * Писать один и тот же прирост в каждую публикацию нельзя — дашборд суммирует
 * PostMetrics.followerGain по загрузкам, и «+200 у аккаунта» превращались в
 * «+600» при трёх роликах. Поэтому прирост делим: сумма долей по всем
 * публикациям аккаунта равна фактическому приросту аккаунта.
 *
 * Всё считается без БД и сети — данные приходят готовыми списками.
 */
import type { FollowerSnapshot } from "./metrics-context"
import { normalizeFollowerSnapshots } from "./metrics-context"

export interface PublicationPoint {
  uploadId: number
  /** Момент публикации; без него доля не начисляется — привязывать не к чему. */
  publishedAt: Date | null
}

/** Почему по публикации прироста нет. Текст уходит оператору в отчёт сборщика. */
export const FOLLOWER_GAIN_UNMEASURED = {
  /** У аккаунта меньше двух различимых снимков — сравнивать не с чем. */
  noHistory: "меньше двух снимков подписчиков",
  /** Момент публикации неизвестен — привязать рост не к чему. */
  noPublishedAt: "неизвестен момент публикации",
  /** Последний снимок сделан раньше публикации — аккаунт с тех пор не мерили. */
  noSnapshotAfter: "нет снимка подписчиков после публикации",
} as const

export interface FollowerGainDistribution {
  /** uploadId → измеренная доля прироста (может быть и нулём — это измерение). */
  shares: Map<number, number>
  /**
   * uploadId → причина, по которой прироста нет ВООБЩЕ.
   *
   * Отдельно от нулевой доли намеренно: «ролик вышел, аккаунт с тех пор мерили,
   * новых подписчиков не появилось» и «аккаунт после выхода ролика ни разу не
   * снимали» — разные факты. Первое — ноль, второе — «не измерено», и писать
   * второе нулём значит выдавать пробел в данных за результат.
   */
  unmeasured: Map<number, string>
}

/**
 * Раскладывает прирост подписчиков по публикациям и отмечает, где мерить нечем.
 *
 * Идём по соседним снимкам: рост на отрезке заработали те ролики, которые к
 * концу отрезка уже вышли, — между ними он и делится поровну. Отписки (падение
 * счётчика) в минус никому не пишем: поле в БД — Int «прирост». Рост до первой
 * публикации не достаётся никому: это не заслуга роликов.
 *
 * Снимок ДО публикации не нужен — типовой случай «аккаунт начали снимать позже,
 * чем вышли ролики» считается нормально: к концу первого же наблюдаемого
 * отрезка ролики уже вышли и делят его рост. Рост, случившийся до самого
 * первого снимка, никакими данными не подтверждён — это честная нижняя оценка,
 * а не догадка.
 *
 * А вот ролик, вышедший ПОСЛЕ последнего снимка, — не нижняя оценка, а полное
 * отсутствие наблюдения: аккаунт с его выхода никто не мерил. Раньше такой
 * ролик просто не попадал в карту долей, и сборщик писал ему ноль как
 * измеренную величину. Теперь он попадает в `unmeasured` с причиной.
 */
export function describeFollowerGain(
  snapshots: Array<FollowerSnapshot | null | undefined>,
  publications: PublicationPoint[],
): FollowerGainDistribution {
  const shares = new Map<number, number>()
  const unmeasured = new Map<number, string>()
  const points = normalizeFollowerSnapshots(snapshots)

  const published: Array<{ uploadId: number; at: number }> = []
  for (const item of publications) {
    const at = item.publishedAt instanceof Date ? item.publishedAt.getTime() : Number.NaN
    if (!Number.isFinite(at)) {
      unmeasured.set(item.uploadId, FOLLOWER_GAIN_UNMEASURED.noPublishedAt)
      continue
    }
    if (points.length < 2) {
      unmeasured.set(item.uploadId, FOLLOWER_GAIN_UNMEASURED.noHistory)
      continue
    }
    // Замер должен быть ПОСЛЕ выхода ролика: иначе наблюдений о его влиянии нет.
    if (at > points[points.length - 1]!.at) {
      unmeasured.set(item.uploadId, FOLLOWER_GAIN_UNMEASURED.noSnapshotAfter)
      continue
    }
    published.push({ uploadId: item.uploadId, at })
  }
  if (published.length === 0) return { shares, unmeasured }

  // Дробные доли копим и округляем один раз в конце: округление на каждом
  // отрезке при десятке снимков даёт заметный перекос.
  const exact = new Map<number, number>()
  for (let index = 1; index < points.length; index++) {
    const delta = points[index]!.followers - points[index - 1]!.followers
    if (delta <= 0) continue
    const intervalEnd = points[index]!.at
    const eligible = published.filter(item => item.at <= intervalEnd)
    if (eligible.length === 0) continue
    const perPublication = delta / eligible.length
    for (const item of eligible) {
      exact.set(item.uploadId, (exact.get(item.uploadId) ?? 0) + perPublication)
    }
  }

  // Округляем методом наибольшего остатка: поле в БД целое, а сумма долей по
  // публикациям обязана сойтись с фактическим приростом аккаунта — иначе
  // дашборд снова покажет не ту цифру, пусть и на единицы.
  const parts = [...exact.entries()].map(([uploadId, value]) => ({
    uploadId,
    whole: Math.floor(value),
    remainder: value - Math.floor(value),
  }))
  const target = Math.round([...exact.values()].reduce((sum, value) => sum + value, 0))
  let assigned = parts.reduce((sum, part) => sum + part.whole, 0)
  const byRemainder = [...parts].sort(
    (a, b) => b.remainder - a.remainder || a.uploadId - b.uploadId,
  )
  for (let index = 0; assigned < target && byRemainder.length > 0; index++) {
    byRemainder[index % byRemainder.length]!.whole += 1
    assigned++
  }

  // Ноль проставляем всем публикациям, которые окно снимков покрывает: аккаунт
  // после их выхода мерили, роста не случилось — это измеренный ноль, и он
  // обязан отличаться от «не измерено» выше.
  for (const item of published) shares.set(item.uploadId, 0)
  for (const part of parts) {
    shares.set(part.uploadId, Math.max(0, part.whole))
  }
  return { shares, unmeasured }
}

/**
 * Только доли прироста, без причин «не измерено».
 *
 * Оставлено ради вызывающих, которым нужна одна карта: полный расклад с
 * причинами даёт `describeFollowerGain`.
 *
 * @returns uploadId → прирост; публикации, по которым мерить нечем, в карту не
 *          попадают.
 */
export function distributeFollowerGain(
  snapshots: Array<FollowerSnapshot | null | undefined>,
  publications: PublicationPoint[],
): Map<number, number> {
  return describeFollowerGain(snapshots, publications).shares
}
