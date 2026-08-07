import {
  describeFollowerGain,
  type FollowerGainDistribution,
  type PublicationPoint,
} from "./social/follower-attribution"
import { asFollowerCountProvider } from "./social/follower-count"
import { computeCtr, normalizeFollowerSnapshots, type FollowerSnapshot } from "./social/metrics-context"
import { postUnavailableStatus, type UnavailablePostStatus } from "./social/post-availability"
import type { MetricsContext, MetricsResult } from "./social/types"

/**
 * Результат подсчёта производной метрики. Три состояния, а не два:
 *  - `ok` — величину действительно измерили;
 *  - `failed` — запрос упал (таймаут, обрыв соединения);
 *  - `unmeasurable` — измерять нечем: у публикации нет трекинг-ссылки, у
 *    аккаунта нет двух снимков подписчиков.
 *
 * Разделять обязательно: раньше и ошибка, и «нечем измерять» гасились в `0` и
 * уезжали в PostMetrics как измеренная величина — таймаут Postgres на подсчёте
 * кликов давал `ctr = 0` у ролика с реальными переходами, а ролик, выложенный
 * не через фабрику, вечно показывал CTR 0 %, хотя переходов ему никто и не
 * считал. Отличить «ноль» от «не знаем» в аналитике было невозможно.
 */
type Measured<T> =
  | { ok: true; value: T }
  | { ok: false; kind: "failed" | "unmeasurable"; reason: string }

async function measure<T>(compute: () => Promise<T>): Promise<Measured<T>> {
  try {
    return { ok: true, value: await compute() }
  } catch (err) {
    return {
      ok: false,
      kind: "failed",
      reason: err instanceof Error ? err.message : "Неизвестная ошибка",
    }
  }
}

/** Измерять нечем — это не результат «ноль», а отсутствие результата. */
function unmeasurable(reason: string): { ok: false; kind: "unmeasurable"; reason: string } {
  return { ok: false, kind: "unmeasurable", reason }
}

/** Переход по трекинг-ссылке в сквозной аналитике — событие `messenger_opened`. */
const CLICK_EVENT_TYPE = "messenger_opened"
/**
 * Сколько снимков подписчиков берём на аккаунт. Прирост считается по соседним
 * точкам, поэтому вся история не нужна — хватает обозримого окна свежих снимков.
 * Всё, что старше окна, в прирост не попадает: это осознанная нижняя оценка.
 */
const FOLLOWER_SNAPSHOT_LIMIT = 200

/**
 * Считает переходы по трекинг-ссылке ролика.
 * Считаем ровно так же, как рейтинги (`analytics/rankings.ts`), иначе CTR в
 * карточке ролика и CTR в сквозной аналитике разойдутся и никто не поймёт, чему верить.
 */
async function countTrackedClicks(publicationId: string | null): Promise<number> {
  if (!publicationId) return 0
  return prisma.attributionEvent.count({
    where: { publicationId, type: CLICK_EVENT_TYPE },
  })
}

/**
 * Момент публикации: у фабричных постов он записан, у остальных ближайшее,
 * что есть, — время последнего изменения загрузки (переход в published).
 */
function publishedAtOf(upload: {
  updatedAt?: Date | null
  factoryPublication?: { publishedAt: Date | null } | null
}): Date | null {
  return upload.factoryPublication?.publishedAt ?? upload.updatedAt ?? null
}

/**
 * Последние записанные производные метрики загрузки.
 *
 * Компромисс: в схеме PostMetrics поля `ctr`/`followerGain` — NOT NULL с
 * дефолтом 0, выразить «не измерено» в базе нечем, а схему трогать нельзя.
 * Пропустить поле в `create` тоже не выход — Prisma подставит дефолтный 0,
 * то есть тот же выдуманный ноль, только молча. Поэтому при упавшем подсчёте
 * и при «нечем измерять» метрику не обновляем: повторяем последнее измеренное
 * значение. Ноль тогда остаётся только у загрузок, у которых измерений ещё не
 * было, а причина уходит в `errors`/`unmeasured`, в лог и в отчёт сборщика.
 */
async function lastMeasuredDerived(
  uploadId: number,
): Promise<{ ctr: number; followerGain: number } | null> {
  return prisma.postMetrics.findFirst({
    where: { uploadId },
    orderBy: { collectedAt: "desc" },
    select: { ctr: true, followerGain: true },
  })
}

/** История подписчиков аккаунта по возрастанию времени. */
async function followerSnapshots(socialAccountId: number): Promise<FollowerSnapshot[]> {
  const rows = await prisma.accountMetricsSnapshot.findMany({
    where: { socialAccountId, followers: { not: null } },
    orderBy: { fetchedAt: "desc" },
    take: FOLLOWER_SNAPSHOT_LIMIT,
    select: { fetchedAt: true, followers: true },
  })
  return rows
    .map(row => ({ fetchedAt: row.fetchedAt, followers: row.followers }))
    .reverse()
}

/** Все опубликованные загрузки аккаунта — между ними и делится его прирост. */
async function accountPublications(socialAccountId: number): Promise<PublicationPoint[]> {
  const rows = await prisma.upload.findMany({
    where: { socialAccountId, status: "published" },
    select: {
      id: true,
      updatedAt: true,
      factoryPublication: { select: { publishedAt: true } },
    },
  })
  return rows.map(row => ({ uploadId: row.id, publishedAt: publishedAtOf(row) }))
}

interface AccountFollowerGain extends FollowerGainDistribution {
  /** Меньше двух точек — сравнивать не с чем, это «не измерено», а не ноль. */
  hasHistory: boolean
}

/**
 * Доли прироста подписчиков по публикациям аккаунта.
 * Считается один раз на аккаунт: величина общая для всех его загрузок.
 *
 * Снимок «до публикации» не требуется: рост делится по видимому окну снимков,
 * поэтому аккаунт, который начали снимать уже после выхода роликов, тоже
 * получает свои цифры. Невидимым остаётся только рост ДО первого снимка —
 * это честная нижняя оценка, восстановить его неоткуда.
 */
async function accountFollowerGain(socialAccountId: number): Promise<AccountFollowerGain> {
  const [snapshots, publications] = await Promise.all([
    followerSnapshots(socialAccountId),
    accountPublications(socialAccountId),
  ])
  // Считаем точки после нормализации, а не строки из базы: два запроса могут
  // сохранить один и тот же снимок, и по количеству строк «история есть», хотя
  // сравнивать по-прежнему не с чем и в PostMetrics уедет необъявленный ноль.
  const points = normalizeFollowerSnapshots(snapshots)
  return {
    ...describeFollowerGain(snapshots, publications),
    hasHistory: points.length >= 2,
  }
}

/** Сколько строк «не измерено» кладём в лог: остальное сжимаем до счётчика. */
const LOG_SAMPLE_LIMIT = 50

export interface FollowerSnapshotReport {
  /** Сколько аккаунтов реально сняли. */
  collected: number
  /**
   * Аккаунты, подписчиков которых официальным API не получить.
   * Не ошибка: у TikTok в текущем наборе scope такого метода нет вовсе, а
   * manual-аккаунт без OAuth-токена мерить нечем. Оператор обязан видеть, что
   * по этим аккаунтам прирост будет «не измерено», а не ноль.
   */
  skipped: Array<{ socialAccountId: number; platform: string; reason: string }>
  errors: Array<{ socialAccountId: number; error: string }>
}

/**
 * Снимает число подписчиков аккаунтов ОФИЦИАЛЬНЫМИ API и пишет
 * AccountMetricsSnapshot.
 *
 * Зачем отдельный проход, а не поле в сборе метрик поста: подписчики — величина
 * аккаунта, а не публикации. У аккаунта с двадцатью роликами сбор метрик ходит
 * двадцать раз, и замер профиля на каждой итерации был бы двадцатью лишними
 * запросами к площадке ради одного и того же числа.
 *
 * Прирост подписчиков считается по двум соседним снимкам
 * (`social/follower-attribution.ts`), поэтому без регулярных снимков метрика
 * пуста в принципе — до этой задачи снимки делал только ручной обработчик
 * `accounts/:id/metrics/fetch` через Apify-скрапер публичного профиля, что
 * противоречит `docs/PROJECT_CONTEXT.md` §4.
 *
 * Замер бесплатный (квота площадки, а не платный API), поэтому
 * `requirePaidApisEnabled` здесь не нужен — как и в сборе метрик постов.
 *
 * @param socialAccountIds — если указаны, снимаем только эти аккаунты.
 */
export async function collectFollowerSnapshots(
  socialAccountIds?: number[],
): Promise<FollowerSnapshotReport> {
  const where: Record<string, unknown> = {
    // Отозванный доступ не восстановится сам — ходить в площадку бессмысленно.
    // `expired` оставляем: адаптеры умеют обновить токен по refresh_token.
    status: { not: "revoked" },
    accessToken: { not: null },
  }
  if (socialAccountIds && socialAccountIds.length > 0) {
    where.id = { in: socialAccountIds }
  }

  const accounts = await prisma.socialAccount.findMany({
    where,
    select: {
      id: true,
      platform: true,
      displayName: true,
      platformUserId: true,
      accessToken: true,
      refreshToken: true,
      expiresAt: true,
    },
  })

  const skipped: FollowerSnapshotReport["skipped"] = []
  const errors: Array<{ socialAccountId: number; error: string }> = []
  let collected = 0

  for (const account of accounts) {
    // Адаптер площадки может не уметь мерить подписчиков (TikTok) или платформы
    // может не быть в фабрике вовсе — оба случая это «не измерено», а не сбой.
    let provider: ReturnType<typeof asFollowerCountProvider> = null
    try {
      provider = asFollowerCountProvider(getSocialAdapter(account.platform))
    } catch {
      provider = null
    }
    if (!provider) {
      skipped.push({
        socialAccountId: account.id,
        platform: account.platform,
        reason: "официального API подписчиков для площадки нет",
      })
      continue
    }

    try {
      const count = await provider.getFollowerCount({
        id: account.id,
        platform: account.platform,
        displayName: account.displayName,
        platformUserId: account.platformUserId,
        accessToken: account.accessToken ? decrypt(account.accessToken) : null,
        refreshToken: account.refreshToken ? decrypt(account.refreshToken) : null,
        expiresAt: account.expiresAt,
      })

      await prisma.accountMetricsSnapshot.create({
        data: {
          socialAccountId: account.id,
          followers: toSnapshotCounter(count.followers),
          following: toSnapshotCounter(count.following),
          postsCount: typeof count.postsCount === "number" && Number.isFinite(count.postsCount)
            ? Math.max(0, Math.round(count.postsCount))
            : null,
          status: "ok",
          // Источник замера — в снимке, а не только в журнале: в истории
          // аккаунта уже лежат строки от Apify-скрапера, и отличить их от
          // официальных иначе невозможно.
          rawData: { source: "official_api", platform: account.platform },
        },
      })
      collected++
    } catch (err) {
      // Строку-снимок на ошибке не пишем: она всё равно не попадёт в расчёт
      // (там `followers: { not: null }`), зато замусорит историю аккаунта.
      // Авария видна в журнале агента и в отчёте планировщика.
      errors.push({
        socialAccountId: account.id,
        error: err instanceof Error ? err.message : "Неизвестная ошибка",
      })
    }
  }

  if (errors.length > 0) {
    await logAgent(
      "metrics-collector",
      "warn",
      `Снимки подписчиков не сняты: ${errors.length}`,
      { errors: errors.slice(0, LOG_SAMPLE_LIMIT) },
    ).catch(() => {})
  }
  if (skipped.length > 0) {
    await logAgent(
      "metrics-collector",
      "info",
      `Подписчики не измеряются официальным API: аккаунтов ${skipped.length}`,
      { skipped: skipped.slice(0, LOG_SAMPLE_LIMIT) },
    ).catch(() => {})
  }

  return { collected, skipped, errors }
}

/**
 * Счётчик площадки → колонка BigInt снимка.
 * Отсутствующая величина остаётся `null` («не измерено»), а не нулём: колонка
 * nullable ровно для этого.
 */
function toSnapshotCounter(value: number | null | undefined): bigint | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  return BigInt(Math.max(0, Math.round(value)))
}

/** Состояния поста на площадке (Upload.postStatus). */
type PostStatusValue = "active" | UnavailablePostStatus

/**
 * Приводит значение из базы к известному состоянию поста.
 * В тестовых и старых данных поля может не быть — считаем такой пост живым,
 * иначе сборщик начнёт «чинить» статус там, где его никто не портил.
 */
function currentPostStatus(value: unknown): PostStatusValue {
  return value === "deleted" || value === "blocked" ? value : "active"
}

/**
 * Записывает новое состояние поста, но только когда оно действительно другое.
 *
 * Писать на каждом сборе нельзя: у `Upload` стоит `updatedAt @updatedAt`, а по
 * нему сборщик оценивает момент публикации нефабричных загрузок
 * (см. `publishedAtOf`). Лишний UPDATE каждый час сдвигал бы «дату выхода»
 * ролика на «сейчас» и ломал бы разбиение прироста подписчиков.
 */
async function applyPostStatus(uploadId: number, next: PostStatusValue): Promise<void> {
  await prisma.upload.update({ where: { id: uploadId }, data: { postStatus: next } })
}

/**
 * Собирает метрики для опубликованных загрузок.
 * Сбор метрик бесплатный — НЕ требует requirePaidApisEnabled.
 *
 * Одна и та же загрузка может попасть и в `collected`, и в `errors`: сырые
 * счётчики платформы записаны, а производную метрику посчитать не вышло.
 * Так честнее, чем молча записать ноль или выбросить живые просмотры.
 *
 * @param uploadIds — если указаны, собирает только для этих загрузок;
 *                    иначе — для всех опубликованных.
 */
export async function collectMetrics(uploadIds?: number[]): Promise<{
  collected: number
  errors: Array<{ uploadId: number; error: string }>
  /**
   * Метрики, которые нечем измерить (нет трекинг-ссылки, нет истории
   * подписчиков). Не ошибка сбора, но и не измеренный ноль — в отчёт попадают
   * отдельным списком, чтобы оператор не читал старое значение как свежее.
   */
  unmeasured: Array<{
    uploadId: number
    metric: "ctr" | "followerGain"
    reason: string
    keptPrevious: boolean
  }>
  /**
   * Публикации, у которых площадка сообщила о судьбе поста: он удалён,
   * заблокирован или, наоборот, снова доступен. Это не ошибки сбора — в таблице
   * роликов такой пост обязан показываться со своим статусом, а не живым.
   */
  statusChanged: Array<{
    uploadId: number
    from: PostStatusValue
    to: PostStatusValue
    reason: string
  }>
}> {
  const where: Record<string, unknown> = {
    status: "published",
    platformPostId: { not: null },
  }

  if (uploadIds && uploadIds.length > 0) {
    where.id = { in: uploadIds }
  }

  const uploads = await prisma.upload.findMany({
    where,
    include: {
      socialAccount: true,
      video: { select: { duration: true } },
      factoryPublication: { select: { id: true, publishedAt: true } },
    },
  })

  let collected = 0
  const errors: Array<{ uploadId: number; error: string }> = []
  // Что не удалось измерить: платформы врать не должны, ноль без пометки —
  // это «нет данных», и в лог он попадает именно так.
  const unsupportedByMetric = new Map<string, number>()
  let withoutAttribution = 0
  let withoutFollowerHistory = 0
  // Загрузки, у которых производную метрику не удалось посчитать: это не «ноль»,
  // а «не измерено», и оператор должен увидеть их отдельной строкой.
  const notMeasured: Array<{ uploadId: number; reason: string; keptPrevious: boolean }> = []
  // То же самое, но по другой причине: измерять нечем. Не ошибка сбора (в
  // `errors` таким не место — иначе каждый ручной пост поднимет ложную тревогу),
  // однако ноль сюда писать так же нельзя.
  const unmeasured: Array<{
    uploadId: number
    metric: "ctr" | "followerGain"
    reason: string
    keptPrevious: boolean
  }> = []
  // Смены состояния поста на площадке — отдельный канал отчёта: удалённый ролик
  // это не сбой сбора, а новость о публикации.
  const statusChanged: Array<{
    uploadId: number
    from: PostStatusValue
    to: PostStatusValue
    reason: string
  }> = []
  // Прирост подписчиков считается на аккаунт, а не на пост: держим результат,
  // чтобы не пересчитывать его для каждой загрузки одного и того же аккаунта.
  const followerGainByAccount = new Map<number, Measured<AccountFollowerGain>>()

  for (const upload of uploads) {
    try {
      if (!upload.platformPostId) continue

      // Manual аккаунты не имеют OAuth API token — метрики через OAuth недоступны.
      // Сбор статистики для них идёт через Apify profile scraper (AccountMetricsSnapshot).
      if (!upload.socialAccount.accessToken) {
        continue
      }

      const adapter = getSocialAdapter(upload.socialAccount.platform)

      const decryptedAccount = {
        id: upload.socialAccount.id,
        platform: upload.socialAccount.platform,
        displayName: upload.socialAccount.displayName,
        platformUserId: upload.socialAccount.platformUserId,
        accessToken: decrypt(upload.socialAccount.accessToken),
        refreshToken: upload.socialAccount.refreshToken
          ? decrypt(upload.socialAccount.refreshToken)
          : null,
        expiresAt: upload.socialAccount.expiresAt,
      }

      const context: MetricsContext = {
        videoDurationSec: upload.video?.duration ?? null,
      }

      const metrics: MetricsResult = await adapter.getPostMetrics(
        decryptedAccount,
        upload.platformPostId,
        context,
      )

      for (const metric of metrics.unsupported ?? []) {
        unsupportedByMetric.set(metric, (unsupportedByMetric.get(metric) ?? 0) + 1)
      }

      // Публикация без FactoryPublication не размечена трекинг-ссылкой —
      // переходы считать не по чему, а не «переходов ноль».
      const publicationId = upload.factoryPublication?.id ?? null
      if (!publicationId) withoutAttribution++

      const accountId = upload.socialAccount.id
      let accountGain = followerGainByAccount.get(accountId)
      if (!accountGain) {
        // Провал тоже кэшируем: если база отвалилась, долбить её ещё раз на
        // каждой загрузке этого аккаунта смысла нет.
        accountGain = await measure(() => accountFollowerGain(accountId))
        followerGainByAccount.set(accountId, accountGain)
      }
      if (accountGain.ok && !accountGain.value.hasHistory) withoutFollowerHistory++

      const clicks: Measured<number> = publicationId
        ? await measure(() => countTrackedClicks(publicationId))
        : unmeasurable("нет трекинг-ссылки: публикация не через фабрику")

      const ctr: Measured<number> = clicks.ok
        ? { ok: true, value: computeCtr(clicks.value, metrics.views) }
        : clicks

      // Доля аккаунтского прироста, а не весь прирост: дашборд суммирует это
      // поле по загрузкам, и общая величина в каждой строке множилась бы на
      // число роликов аккаунта. Причину «мерить нечем» берём поимённо по
      // загрузке: у одного аккаунта часть роликов измерима, а вышедший после
      // последнего снимка — нет, и общий флаг «история есть» это скрывал.
      const followerGain: Measured<number> = !accountGain.ok
        ? accountGain
        : accountGain.value.shares.has(upload.id)
          ? { ok: true, value: accountGain.value.shares.get(upload.id)! }
          : unmeasurable(
            accountGain.value.unmeasured.get(upload.id)
            ?? "нет данных о подписчиках аккаунта",
          )

      // Что посчитать не удалось и что нечем посчитать — одинаково не выдаём за
      // измеренный ноль: держим последнее измеренное значение и обязательно
      // рассказываем оператору. Разница только в канале отчёта: упавший запрос
      // — это авария (`errors`), отсутствие данных — рутина (`unmeasured`).
      const derived: Array<{ metric: "ctr" | "followerGain"; result: Measured<number> }> = [
        { metric: "ctr", result: ctr },
        { metric: "followerGain", result: followerGain },
      ]
      const needPrevious = derived.some(item => !item.result.ok)
      // За прошлой строкой ходим один раз на загрузку и только когда она нужна:
      // на полностью измеренном сборе лишних запросов не появляется.
      const previous = needPrevious
        ? await lastMeasuredDerived(upload.id).catch(() => null)
        : null

      const failureReasons: string[] = []
      for (const { metric, result } of derived) {
        if (result.ok) continue
        const label = metric === "ctr" ? "переходы" : "прирост подписчиков"
        if (result.kind === "failed") {
          failureReasons.push(`${label}: ${result.reason}`)
          continue
        }
        unmeasured.push({
          uploadId: upload.id,
          metric,
          reason: result.reason,
          keptPrevious: previous !== null,
        })
      }
      if (failureReasons.length > 0) {
        const reason = failureReasons.join("; ")
        errors.push({ uploadId: upload.id, error: `Производные метрики не посчитаны — ${reason}` })
        notMeasured.push({ uploadId: upload.id, reason, keptPrevious: previous !== null })
      }

      await prisma.postMetrics.create({
        data: {
          uploadId: upload.id,
          views: metrics.views,
          likes: metrics.likes,
          comments: metrics.comments,
          shares: metrics.shares,
          watchThrough: metrics.watchThrough,
          ctr: ctr.ok ? ctr.value : previous?.ctr ?? 0,
          followerGain: followerGain.ok ? followerGain.value : previous?.followerGain ?? 0,
        },
      })

      collected++

      // Пост ответил счётчиками — значит он на месте. Если раньше его пометили
      // удалённым или заблокированным (площадка сняла ограничение, оператор
      // восстановил ролик), метку надо снять: иначе живой пост навсегда
      // останется «удалённым» в таблице роликов.
      const knownStatus = currentPostStatus(upload.postStatus)
      if (knownStatus !== "active") {
        await applyPostStatus(upload.id, "active")
        statusChanged.push({
          uploadId: upload.id,
          from: knownStatus,
          to: "active",
          reason: "площадка снова отдаёт счётчики поста",
        })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Неизвестная ошибка"

      // Площадка сказала «такого поста нет» — это не авария сбора, а факт о
      // публикации. В errors такому не место: иначе каждый удалённый ролик
      // вечно поднимал бы тревогу, а postStatus так и остался бы мёртвым полем.
      // Все прочие ошибки (таймаут, 5xx, протухший токен) статус НЕ меняют.
      const unavailable = postUnavailableStatus(err)
      if (unavailable) {
        const knownStatus = currentPostStatus(upload.postStatus)
        if (knownStatus !== unavailable) {
          try {
            await applyPostStatus(upload.id, unavailable)
            statusChanged.push({
              uploadId: upload.id,
              from: knownStatus,
              to: unavailable,
              reason: message,
            })
          } catch (updateErr) {
            // Не смогли записать статус — вот это уже настоящая ошибка сбора.
            const updateMessage = updateErr instanceof Error
              ? updateErr.message
              : "Неизвестная ошибка"
            errors.push({
              uploadId: upload.id,
              error: `Не удалось записать статус поста (${unavailable}): ${updateMessage}`,
            })
          }
        }
        continue
      }

      errors.push({ uploadId: upload.id, error: message })
    }
  }

  // Отдельным сообщением и уровнем warn: «нет данных» — рутина, а вот упавший
  // подсчёт означает, что цифры в дашборде устарели и им нельзя верить как свежим.
  if (notMeasured.length > 0) {
    await logAgent(
      "metrics-collector",
      "warn",
      `Производные метрики не посчитаны у публикаций: ${notMeasured.length}`,
      { notMeasured },
    ).catch(() => {})
  }

  if (collected > 0 && (unsupportedByMetric.size > 0 || withoutAttribution > 0 || withoutFollowerHistory > 0)) {
    await logAgent(
      "metrics-collector",
      "info",
      `Часть метрик не измерена (собрано публикаций: ${collected})`,
      {
        unsupported: Object.fromEntries(unsupportedByMetric),
        withoutAttribution,
        withoutFollowerHistory,
        // Поимённо: без этого «withoutAttribution: 12» не даёт понять, у каких
        // роликов CTR в дашборде — не свежий, а последний известный.
        unmeasuredTotal: unmeasured.length,
        unmeasured: unmeasured.slice(0, LOG_SAMPLE_LIMIT),
      },
    ).catch(() => {})
  }

  // Последним и отдельным сообщением: удалённый или заблокированный ролик —
  // это событие для оператора, а не строка в общей статистике сбора.
  if (statusChanged.length > 0) {
    await logAgent(
      "metrics-collector",
      "warn",
      `Статус публикаций на площадке изменился: ${statusChanged.length}`,
      { statusChanged: statusChanged.slice(0, LOG_SAMPLE_LIMIT) },
    ).catch(() => {})
  }

  return { collected, errors, unmeasured, statusChanged }
}
