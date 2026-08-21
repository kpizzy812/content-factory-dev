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

/** Срок жизни auto-записи без активных клипов. */
export const RECORDING_DELETE_AFTER_MS = 180 * 24 * 60 * 60 * 1000

/** Возраст, после которого запись уезжает в холодный класс хранения. */
export const RECORDING_COOL_AFTER_MS = 30 * 24 * 60 * 60 * 1000

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
      return { recordingId: candidate.id, action: "keep", reason: "помечена keep вручную" }
    }
    if (candidate.activeClipCount > 0) {
      // Клипы уехали в готовые ролики; снос родителя отнимает саму возможность
      // перенарезать материал — то, ради чего запись и хранится.
      return ageMs >= coolAfterMs && candidate.cooledAtMs === null
        ? { recordingId: candidate.id, action: "cool", reason: "старше 30 дней, но клипы живы" }
        : { recordingId: candidate.id, action: "keep", reason: "есть активные клипы" }
    }
    if (ageMs >= deleteAfterMs) {
      return { recordingId: candidate.id, action: "delete", reason: "auto без активных клипов и старше срока" }
    }
    return ageMs >= coolAfterMs && candidate.cooledAtMs === null
      ? { recordingId: candidate.id, action: "cool", reason: "старше 30 дней" }
      : { recordingId: candidate.id, action: "keep", reason: "моложе срока" }
  })
}

/**
 * Проход очистки: собрать кандидатов, применить правило, выполнить решения.
 *
 * Удаление идёт в порядке «сначала объект в хранилище, потом строка»:
 * обратный порядок при падении между шагами оставил бы объект без строки —
 * сироту вне любого каскада удаления. `NOT_FOUND` от `storage.delete()` —
 * идемпотентный случай (прошлый проход уже удалил объект и упал на строке
 * следующим шагом) и не блокирует удаление строки; любая другая ошибка
 * хранилища — блокирует: лучше оставить строку и объект целыми до следующего
 * прохода, чем удалить строку и получить объект-сироту вне каскада.
 *
 * Отказ на одной записи (сеть до хранилища легла, гонка с ручным удалением)
 * не должен ронять весь проход целиком: каждое решение выполняется в своём
 * try/catch, ошибка уходит в agent-лог, а сама запись остаётся нетронутой до
 * следующего прохода — остальные кандидаты обрабатываются как обычно.
 *
 * Пометка `keep` этим проходом не трогается никогда: для нужного решения
 * `planRecordingRetention` уже вернёт `action: "keep"`, и в `for` ниже просто
 * нет ветки, которая бы что-то делала с такой записью.
 *
 * `prisma`/`storage`/`logAgent` импортируются динамически внутри функции, а
 * не на верхнем уровне модуля: этот файл целиком (включая чистый
 * `planRecordingRetention` выше) грузит DB-free unit-тест
 * (vitest.pure.config.ts), и статический импорт Prisma-клиента исполнялся бы
 * уже при простом `import` файла — по этому же классу проблем в задаче 6
 * ловилась регрессия на статическом импорте ffmpeg-цепочки (video-tools/ffmpeg.ts
 * зовёт `setFfmpegPath` на уровне модуля).
 */
export async function applyRecordingRetention(now = Date.now()): Promise<RetentionDecision[]> {
  const { prisma } = await import("../prisma")
  const { getStorageDriver, StorageError } = await import("../storage")
  const { logAgent } = await import("../agent-logger")

  const rows = await prisma.presenterRecording.findMany({
    select: {
      id: true,
      retention: true,
      createdAt: true,
      cooledAt: true,
      storageKey: true,
      // Фильтр по isActive обязателен (см. комментарий у RetentionCandidate
      // выше) — без него запись с одними отключёнными реингестом клипами
      // никогда не подпадёт под удаление.
      _count: { select: { clips: { where: { isActive: true } } } },
    },
  })

  const decisions = planRecordingRetention({
    candidates: rows.map(row => ({
      id: row.id,
      retention: row.retention,
      activeClipCount: row._count.clips,
      createdAtMs: row.createdAt.getTime(),
      cooledAtMs: row.cooledAt?.getTime() ?? null,
    })),
    now,
  })

  const byId = new Map(rows.map(row => [row.id, row]))

  for (const decision of decisions) {
    const row = byId.get(decision.recordingId)
    if (!row) continue

    try {
      if (decision.action === "delete") {
        try {
          await getStorageDriver().delete(row.storageKey)
        }
        catch (err) {
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
    }
    catch (error) {
      // Одна запись не должна ронять весь проход: остальные кандидаты
      // обрабатываются как обычно, а эта останется как есть до следующего раза.
      const message = error instanceof Error ? error.message : String(error)
      await logAgent("presenter-retention", "error", `Запись ${row.id} (${decision.action}): ${message}`).catch(() => {})
    }
  }

  return decisions
}
