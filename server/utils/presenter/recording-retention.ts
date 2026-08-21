/**
 * Что делать с накопленными записями ведущего.
 *
 * Минута нормализованной записи — 30-37 МБ, поток около 300 единиц материала в
 * месяц: от ~20 ГБ при коротких дублях до ~110 ГБ при десятиминутных (spec
 * §6.1). Без правила хранилище растёт линейно и навсегда.
 *
 * Правило чистое: время и кандидаты приходят снаружи, ни БД, ни хранилища здесь
 * нет. Причина отказа возвращается вместе с решением — по ней в логе видно,
 * почему запись пережила проход, и её же проверяет тест.
 */

// Только число, без побочных импортов (см. докстринг файла-константы) —
// planRecordingRetention ниже обязан оставаться DB-free для vitest.pure.config.ts.
import { STALE_RUNNING_THRESHOLD_MS } from "./recording-ingest-constants"

/** Срок жизни auto-записи без активных клипов и без недавних использований. */
export const RECORDING_DELETE_AFTER_MS = 180 * 24 * 60 * 60 * 1000

/** Возраст, после которого запись уезжает в холодный класс хранения. */
export const RECORDING_COOL_AFTER_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Сколько кандидатов проход забирает за один тик.
 *
 * Записей на порядок больше ожидаемого месячного объёма (~300): растущий
 * бэклог разбирается следующими тиками, а не одним запросом по всей таблице
 * сразу (фикс-раунд 1, Мелочь 6).
 */
export const RETENTION_BATCH_LIMIT = 200

export interface RetentionCandidate {
  id: string
  retention: string
  /**
   * Сколько клипов этой записи ещё АКТИВНЫ (`isActive: true`) в библиотеке.
   *
   * Не путать с общим числом клипов записи: повторная нарезка гасит старый
   * разрез через `isActive: false` (server/utils/presenter/recording-store.ts,
   * `reingestRecording`), не удаляя строки. Запись, у которой остались одни
   * отключённые клипы, при подсчёте ВСЕХ клипов никогда не пройдёт под
   * удаление — источник этого числа (applyRecordingRetention ниже) обязан
   * фильтровать по `isActive: true`.
   */
  activeClipCount: number
  createdAtMs: number
  /** Когда запись перевели в холодный класс. null — не переводили. */
  cooledAtMs: number | null
  /**
   * pending | running | completed | failed (server/utils/presenter/recording-store.ts).
   * `running` — нарезка этой записи идёт прямо сейчас: проход не должен
   * сносить файл или его класс хранения из-под работающего процесса
   * (Critical/Мелочь 2 из ревью, фикс-раунд 1 — гонка с reingestRecording).
   */
  ingestStatus: string
  /**
   * Когда запись встала в `running`. null — либо не running, либо строка
   * заведена без этой отметки (на практике недостижимо, `markIngestRunning`
   * и атомарный захват в `reingestRecording` всегда её ставят).
   *
   * Minor 4 из финального ревью: `running` сам по себе — не гарантия живого
   * процесса. Процесс, убитый на середине, статус снять не успевает, и без
   * учёта возраста такая строка была бы защищена от удаления и охлаждения
   * НАВСЕГДА — тот же порог, что `reingestRecording` использует, чтобы
   * решить, можно ли перезапустить нарезку поверх зависшего "running"
   * (STALE_RUNNING_THRESHOLD_MS, recording-ingest-constants.ts).
   */
  ingestStartedAtMs: number | null
  /**
   * Момент последнего использования ЭТОЙ записи напрямую — из
   * `PresenterRecordingUsage`, самое свежее `usedAt`. null — использований нет.
   *
   * Critical из ревью (фикс-раунд 1): audio-first-подбор
   * (`server/utils/presenter-recording-selector.ts`, `reserveRecordingWindow`)
   * режет окно ИЗ САМОЙ ЗАПИСИ по `ingestStatus: "completed"`, не спрашивая
   * `PresenterSourceClip` вовсе. Запись без единого активного клипа может при
   * этом быть живой и востребованной каждую неделю — `activeClipCount` сам по
   * себе это не видит.
   */
  lastUsedAtMs: number | null
}

export interface RetentionDecision {
  recordingId: string
  action: "delete" | "cool" | "keep"
  reason: string
}

export interface RetentionInput {
  candidates: readonly RetentionCandidate[]
  now: number
  deleteAfterMs?: number
  coolAfterMs?: number
}

export function planRecordingRetention(input: RetentionInput): RetentionDecision[] {
  const deleteAfterMs = input.deleteAfterMs ?? RECORDING_DELETE_AFTER_MS
  const coolAfterMs = input.coolAfterMs ?? RECORDING_COOL_AFTER_MS

  return input.candidates.map((candidate) => {
    const ageMs = input.now - candidate.createdAtMs

    if (candidate.retention === "keep") {
      return { recordingId: candidate.id, action: "keep" as const, reason: "помечена keep вручную" }
    }

    // Fail-safe (Мелочь 1 из ревью, фикс-раунд 1): удалять можно только
    // ТОЧНОЕ значение "auto". Раньше условием было "не keep", и любое чужое
    // значение (баг вызывающего, будущее расширение схемы, "Keep" не тем
    // регистром) ехало бы по auto-ветке и подлежало удалению. Лучше ложно
    // защитить запись, чем ложно её снести.
    if (candidate.retention !== "auto") {
      return {
        recordingId: candidate.id,
        action: "keep" as const,
        reason: `нераспознанное значение retention "${candidate.retention}" — не тронуто`,
      }
    }

    // Гонка с реингестом (Мелочь 2): "running" — нарезка идёт прямо сейчас.
    // Ни удаление файла, ни смена его класса хранения не должны случиться
    // из-под работающего процесса.
    //
    // Minor 4 из финального ревью: "running" защищает запись, только пока она
    // МОЛОЖЕ того же порога, что использует reingestRecording для решения "это
    // ещё работа или зависший процесс" (STALE_RUNNING_THRESHOLD_MS). Без этого
    // условия строка, застрявшая в running после убитого процесса (kill -9,
    // деплой, OOM), была бы защищена от удаления и охлаждения НАВСЕГДА — ровно
    // симметричный баг тому, что reingestRecording уже чинит для повторного
    // запуска нарезки. `ingestStartedAtMs: null` при running — недостижимое на
    // практике состояние (markIngestRunning и атомарный захват всегда ставят
    // отметку), но трактуем его как зависший, а не как живой: безопаснее
    // ошибиться в сторону "разрешить проверить ещё раз", чем защитить строку,
    // которую нечем отличить от настоящего зависания.
    if (candidate.ingestStatus === "running") {
      const isStale = candidate.ingestStartedAtMs === null
        || input.now - candidate.ingestStartedAtMs >= STALE_RUNNING_THRESHOLD_MS
      if (!isStale) {
        return { recordingId: candidate.id, action: "keep" as const, reason: "нарезка записи сейчас идёт" }
      }
      // Зависший running — падаем дальше, к обычной проверке "живая/не живая"
      // по activeClipCount/lastUsedAt/возрасту, как для любой auto-записи.
    }

    // "Живая" запись — по любому из двух независимых признаков:
    //  - есть активные клипы (клипы уехали в готовые ролики, снос родителя
    //    отнимает возможность перенарезать материал);
    //  - саму запись, БЕЗ единого клипа, недавно резал audio-first-подбор
    //    напрямую (Critical из ревью — см. комментарий у lastUsedAtMs выше).
    //    "Недавно" — та же мера, что определяет срок удаления: пока запись
    //    используется чаще, чем раз в deleteAfterMs, она не протухает.
    const recentlyUsedDirectly = candidate.lastUsedAtMs !== null
      && input.now - candidate.lastUsedAtMs < deleteAfterMs
    if (candidate.activeClipCount > 0 || recentlyUsedDirectly) {
      const reason = candidate.activeClipCount > 0
        ? "есть активные клипы"
        : "недавно использована напрямую (audio-first-подбор окна)"
      return ageMs >= coolAfterMs && candidate.cooledAtMs === null
        ? { recordingId: candidate.id, action: "cool" as const, reason: `старше 30 дней, но ${reason}` }
        : { recordingId: candidate.id, action: "keep" as const, reason }
    }

    if (ageMs >= deleteAfterMs) {
      return {
        recordingId: candidate.id,
        action: "delete" as const,
        reason: "auto без активных клипов, без недавних использований и старше срока",
      }
    }
    return ageMs >= coolAfterMs && candidate.cooledAtMs === null
      ? { recordingId: candidate.id, action: "cool" as const, reason: "старше 30 дней" }
      : { recordingId: candidate.id, action: "keep" as const, reason: "моложе срока" }
  })
}

/** Решение вместе с фактом его исполнения — то, что реально произошло, а не то, что запланировано. */
export interface AppliedRetentionDecision extends RetentionDecision {
  /**
   * true — операция решения реально выполнена (для `keep` выполнять нечего,
   * поэтому всегда true). false — `delete`/`cool` попытались и провалились:
   * причина ушла в agent-лог, а запись осталась как была до этого прохода.
   *
   * Important из ревью (фикс-раунд 1): решение — это ПЛАН («что правило
   * решило»), а не факт («что реально случилось»). Сводка прохода обязана
   * считаться по этому полю, а не по самим decisions — иначе отозванные
   * креды хранилища дают в логе «удалено 300» при нулевом реальном удалении.
   */
  applied: boolean
}

/**
 * Проход очистки: собрать кандидатов, применить правило, выполнить решения.
 *
 * Удаление идёт в порядке «сначала объект в хранилище, потом строка»:
 * обратный порядок при падении между шагами оставил бы объект без строки —
 * сироту вне любого каскада удаления.
 *
 * Отказ на одной записи (сеть до хранилища легла, гонка с ручным удалением)
 * не должен ронять весь проход целиком: каждое решение выполняется в своём
 * try/catch, ошибка уходит в agent-лог, а сама запись остаётся нетронутой до
 * следующего прохода — остальные кандидаты обрабатываются как обычно.
 *
 * Пометка `keep` этим проходом не трогается никогда: такие строки не
 * попадают даже в выборку из БД (см. `where` ниже), а не просто
 * игнорируются постфактум.
 *
 * `prisma`/`storage`/`logAgent` импортируются динамически внутри функции, а
 * не на верхнем уровне модуля: этот файл целиком (включая чистый
 * `planRecordingRetention` выше) грузит DB-free unit-тест
 * (vitest.pure.config.ts), и статический импорт Prisma-клиента исполнялся бы
 * уже при простом `import` файла — по этому же классу проблем в задаче 6
 * ловилась регрессия на статическом импорте ffmpeg-цепочки (video-tools/ffmpeg.ts
 * зовёт `setFfmpegPath` на уровне модуля).
 */
export async function applyRecordingRetention(now = Date.now()): Promise<AppliedRetentionDecision[]> {
  const { prisma } = await import("../prisma")
  const { getStorageDriver, StorageError } = await import("../storage")
  const { logAgent } = await import("../agent-logger")

  // Important из финального ревью: раньше `where` брал ЛЮБУЮ не-keep строку.
  // Отсортированные по возрасту "вечно-живые" auto-записи (activeClipCount > 0
  // — то есть любая нормально нарезанная запись — уже не меняет состояние
  // никогда, пока живые клипы не иссякнут) занимают голову очереди навсегда:
  // при ~300 единиц материала в месяц лимит пакета (200) выедается такими
  // строками примерно за три недели, и дальше проход КАЖДЫЙ раз забирает один
  // и тот же вечно-keep пакет, до более новых кандидатов не доходя уже
  // никогда — ни одного удаления, ни одного cooledAt. Задача 7 целиком
  // становится no-op.
  //
  // Сужаем до строк, которые правило вообще способно перевести в НОВОЕ
  // состояние в этом прогоне — окончательное решение (живая запись или нет)
  // всё равно принимает planRecordingRetention по свежим
  // activeClipCount/lastUsedAt, здесь только предфильтр кандидатов, а не
  // дубль его логики:
  const coolThreshold = new Date(now - RECORDING_COOL_AFTER_MS)
  const deleteThreshold = new Date(now - RECORDING_DELETE_AFTER_MS)
  const rows = await prisma.presenterRecording.findMany({
    where: {
      // keep и любое нераспознанное значение retention защищены НАВСЕГДА
      // (Мелочь 1) — не тянем такие строки из БД вовсе (Мелочь 6 из ревью,
      // фикс-раунд 1), как и раньше.
      retention: "auto",
      OR: [
        // Ещё не охлаждена и уже достаточно стара, чтобы охладиться:
        // planRecordingRetention проверяет `cooledAtMs === null` независимо
        // от того, живая запись или нет (охлаждение не требует "неживой").
        { cooledAt: null, createdAt: { lte: coolThreshold } },
        // Достаточно стара для удаления И формально может оказаться
        // "неживой" — то же самое условие, что делает candidate.activeClipCount
        // равным нулю и candidate.lastUsedAtMs старее deleteAfterMs в чистом
        // правиле. Без ОБОИХ этих условий строка не может стать `delete` ни
        // при каких данных, а точная "живость" по-прежнему решается ниже.
        {
          createdAt: { lte: deleteThreshold },
          clips: { none: { isActive: true } },
          usages: { none: { usedAt: { gte: deleteThreshold } } },
        },
      ],
    },
    // Старые кандидаты вперёд: при бэклоге лимит должен достаться им, а не
    // записи, ставшей кандидатом минуту назад. Заодно даёт детерминированный
    // порядок обработки внутри одного прохода. Композитный
    // @@index([retention, createdAt]) — под этот, глобальный (не по
    // characterId) проход: прежний @@index([characterId, retention,
    // createdAt]) для него бесполезен (characterId — ведущая колонка, а
    // здесь фильтра по нему нет).
    orderBy: { createdAt: "asc" },
    take: RETENTION_BATCH_LIMIT,
    select: {
      id: true,
      retention: true,
      createdAt: true,
      cooledAt: true,
      storageKey: true,
      ingestStatus: true,
      ingestStartedAt: true,
      // Фильтр по isActive обязателен (см. комментарий у RetentionCandidate
      // выше) — без него запись с одними отключёнными реингестом клипами
      // никогда не подпадёт под удаление.
      _count: { select: { clips: { where: { isActive: true } } } },
      // Последнее использование НАПРЯМУЮ из записи (audio-first-подбор,
      // server/utils/presenter-recording-selector.ts) — именно этот путь
      // правило раньше не видело вовсе (Critical из ревью). Индекс
      // @@index([recordingId, usedAt, frameHash]) на PresenterRecordingUsage
      // покрывает это по префиксу (recordingId, usedAt).
      usages: {
        orderBy: { usedAt: "desc" },
        take: 1,
        select: { usedAt: true },
      },
    },
  })

  const decisions = planRecordingRetention({
    candidates: rows.map(row => ({
      id: row.id,
      retention: row.retention,
      activeClipCount: row._count.clips,
      createdAtMs: row.createdAt.getTime(),
      cooledAtMs: row.cooledAt?.getTime() ?? null,
      ingestStatus: row.ingestStatus,
      ingestStartedAtMs: row.ingestStartedAt?.getTime() ?? null,
      lastUsedAtMs: row.usages[0]?.usedAt.getTime() ?? null,
    })),
    now,
  })

  const byId = new Map(rows.map(row => [row.id, row]))
  const applied: AppliedRetentionDecision[] = []

  for (const decision of decisions) {
    const row = byId.get(decision.recordingId)
    if (!row) continue

    // Minor 5 из ревью: если объект в хранилище реально снесён, а
    // `prisma.presenterRecording.delete` следом упал (сеть до БД легла,
    // гонка), строка осталась бы `completed`, указывающей на несуществующий
    // объект — а reserveRecordingWindow (orderBy: createdAt asc, ingestStatus:
    // "completed") выбирает первого же годного кандидата и предпочтёт именно
    // её, самую старую. Флаг ниже отличает этот случай от "storage.delete
    // тоже упал" (там строка и объект оба целы, ретрай следующим проходом —
    // штатно, поведение не меняется).
    let objectDeleted = false

    try {
      if (decision.action === "delete") {
        try {
          await getStorageDriver().delete(row.storageKey)
        }
        catch (err) {
          // NOT_FOUND здесь на практике недостижим: и LocalDriver (ENOENT,
          // server/utils/storage/local-driver.ts), и GCSDriver (is404,
          // server/utils/storage/gcs-driver.ts) сами глотают "объекта уже
          // нет" и возвращаются без ошибки — идемпотентность повторного
          // прохода обеспечивают драйверы, а не эта ветка (Мелочь 5 из
          // ревью — раньше комментарий здесь приписывал заслугу этому catch).
          // Ветка остаётся защитным дублем на случай драйвера, который всё
          // же бросит StorageError('NOT_FOUND') явно.
          if (!(err instanceof StorageError) || err.code !== "NOT_FOUND") throw err
        }
        objectDeleted = true
        await prisma.presenterRecording.delete({ where: { id: row.id } })
      }
      else if (decision.action === "cool") {
        // Смены класса хранения в драйвере нет: StorageDriver
        // (server/utils/storage/types.ts) знает только upload/download/delete —
        // заводить метод ради одной операции внутри одной задачи не нужно. На
        // GCS холодный класс штатно настраивается lifecycle-правилом bucket по
        // префиксу `recordings/` (docs/operations/presenter-library.md).
        // Здесь только фиксируем момент перехода — саму смену класса делает
        // правило bucket.
        await prisma.presenterRecording.update({ where: { id: row.id }, data: { cooledAt: new Date(now) } })
      }
      applied.push({ ...decision, applied: true })
    }
    catch (error) {
      // Одна запись не должна ронять весь проход: остальные кандидаты
      // обрабатываются как обычно, а эта останется как есть до следующего раза.
      const message = error instanceof Error ? error.message : String(error)
      await logAgent("presenter-retention", "error", `Запись ${row.id} (${decision.action}): ${message}`).catch(() => {})

      if (objectDeleted) {
        // Объекта в хранилище больше нет, а строка — есть: без этого шага она
        // осталась бы "completed" и селектор взял бы её первой (см. комментарий
        // выше). Переводим в failed, чтобы reserveRecordingWindow (фильтр
        // ingestStatus: "completed") её больше не видел; следующий суточный
        // проход снова попробует удалить осиротевшую строку — storage.delete
        // получит NOT_FOUND и молча пройдёт (см. ветку выше).
        await prisma.presenterRecording.update({
          where: { id: row.id },
          data: {
            ingestStatus: "failed",
            ingestError: `Объект в хранилище удалён, но строка не удалилась: ${message}`.slice(0, 500),
          },
        }).catch(() => {})
      }

      applied.push({ ...decision, applied: false })
    }
  }

  return applied
}
