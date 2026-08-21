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
    if (candidate.ingestStatus === "running") {
      return { recordingId: candidate.id, action: "keep" as const, reason: "нарезка записи сейчас идёт" }
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

  const rows = await prisma.presenterRecording.findMany({
    // keep никогда не удаляется и не охлаждается — не тянем такие строки из
    // БД вовсе (Мелочь 6 из ревью, фикс-раунд 1). Композитный
    // @@index([characterId, retention, createdAt]) рассчитан на выборку
    // "записи ОДНОГО персонажа" и не покрывает этот глобальный проход
    // идеально, но фильтр всё равно отсекает защищённые строки раньше, чем
    // они долетят до правила, а не просто игнорируются после выборки.
    where: { retention: { not: "keep" } },
    // Старые кандидаты вперёд: при бэклоге лимит должен достаться им, а не
    // записи, ставшей кандидатом минуту назад. Заодно даёт детерминированный
    // порядок обработки внутри одного прохода.
    orderBy: { createdAt: "asc" },
    take: RETENTION_BATCH_LIMIT,
    select: {
      id: true,
      retention: true,
      createdAt: true,
      cooledAt: true,
      storageKey: true,
      ingestStatus: true,
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
      lastUsedAtMs: row.usages[0]?.usedAt.getTime() ?? null,
    })),
    now,
  })

  const byId = new Map(rows.map(row => [row.id, row]))
  const applied: AppliedRetentionDecision[] = []

  for (const decision of decisions) {
    const row = byId.get(decision.recordingId)
    if (!row) continue

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
      applied.push({ ...decision, applied: false })
    }
  }

  return applied
}
