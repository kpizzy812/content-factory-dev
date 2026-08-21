/**
 * Атомарный выбор окна записи ведущего под кадр заданной длины.
 *
 * Устроено так же, как `reservePresenterSourceClip` (тот же файл-сосед):
 * `Serializable` транзакция и три попытки на `P2034`. Причина та же — два
 * параллельных прогона не должны получить один участок: это два одинаковых
 * кадра в двух роликах, то есть дубль по docs/PROJECT_CONTEXT.md §7.
 *
 * Отличие от выбора клипа: единица не строка, а интервал, поэтому «занятость»
 * фиксируется вставкой `PresenterRecordingUsage` внутри той же транзакции.
 * Именно вставка, а не инкремент счётчика, делает резервирование видимым
 * второму прогону.
 *
 * Идемпотентность (задача 6b): `PresenterRecordingUsage` нигде не освобождается
 * (см. докстринг `ReservedRecordingWindow`), а сцена может отвалиться уже
 * после успешного резервирования несколькими путями (расхождение длительности
 * источника, неизмеримый источник, отказ провайдера lip-sync и т.д.). Без
 * идемпотентности каждый такой ретрай занимал бы НОВОЕ окно — после серии
 * ретраев свободные участки записи выедаются, и два ролика получают один и тот
 * же кусок ведущей, ровно тот дубль по §7, ради которого написан весь селектор.
 * Ключ — пара (videoId, sceneIndex): повторный прогон той же сцены того же
 * ролика обязан получить ТО ЖЕ окно, а не новое.
 */

import { prisma } from "./prisma"
import { planRecordingWindow, RECORDING_WINDOW_COOLDOWN_MS } from "./presenter/recording-window"

const MAX_RESERVATION_ATTEMPTS = 3

/**
 * Насколько глубоко тянуть историю использований записи для планировщика.
 *
 * `planRecordingWindow` рассчитан на то, что ему приносят ВСЕ использования —
 * он сам делит их на горячие и остывшие (`recording-window.ts:98`) и считает
 * по ним два разных ключа ранжирования (там же, ~152-159). Предфильтр по
 * cooldown здесь стирал бы вторую половину контракта: usage старше суток
 * выпадал бы из выборки целиком, `reused` вырождался бы в `overlapSec > 0` и
 * окно поверх вчера уже отснятого куска возвращалось бы неотличимым от
 * нетронутого материала — Important из ревью, ровно тот дубль по
 * docs/PROJECT_CONTEXT.md §7, только отложенный на сутки. Берём окно заметно
 * шире cooldown, а не всю историю без границ: у много раз использованной
 * записи выборка иначе росла бы неограниченно.
 */
const USAGE_HISTORY_WINDOW_MS = 30 * RECORDING_WINDOW_COOLDOWN_MS

export interface ReserveRecordingWindowInput {
  characterId: string
  /** Длина кадра — обычно длина вырезанного куска трека. */
  requiredSec: number
  fps: number
  /** Ролик, за которым закрепляется интервал. null — служебный прогон. */
  videoId: number | null
  /**
   * Позиция сцены в ролике — вместе с videoId ключ идемпотентности. null —
   * идемпотентность не применяется (работает как раньше): либо служебный
   * прогон без videoId, либо вызывающий сознательно хочет новое окно
   * (например, перцептивный отбор дубля перерезервирует окно заново).
   */
  sceneIndex: number | null
  now?: number
  /**
   * Участок, который эта попытка обязана обходить, даже если он не входит в
   * недавнюю историю использований записи. Единственный источник — повторное
   * резервирование после отказа по похожести первого кадра
   * (`server/utils/presenter/recording-window-frame-guard.ts`): прошлое окно
   * этой же сцены визуально совпало с недавним кадром персонажа, и повторный
   * выбор не должен вернуть его снова. Это мягкое избегание (тот же принцип,
   * что и у «горячих» интервалов в planRecordingWindow), а не жёсткий запрет —
   * если места действительно больше нет, окно всё равно вернётся.
   */
  excludeInterval?: { recordingId: string, startSec: number, endSec: number } | null
}

export interface ReservedRecordingWindow {
  recordingId: string
  storageKey: string
  startSec: number
  endSec: number
  durationSec: number
  usageId: string
  /** true — нетронутого места не осталось, взят остывший участок. */
  reused: boolean
  /**
   * Секунды пересечения с ещё не остывшими интервалами (0 в норме).
   * Ненулевое значение — сигнал деградации: интервалы, занятые резервированием,
   * освобождать некому (см. комментарий у reserveRecordingWindow), и в
   * крэш-петле на одной записи библиотека свободных слотов выедается быстро.
   * Единственное место, где это видно, — это поле в логе шага.
   */
  overlapSec: number
  /**
   * Идемпотентность резервирования (только когда заданы videoId и sceneIndex):
   * "existing" — вернули то же окно, что и в прошлом прогоне этой сцены, новую
   * строку не создавали; "replaced" — прошлое окно этой сцены короче нужного
   * (трек между прогонами изменился), старое использование удалено и занято
   * новое; null — идемпотентность не применялась (нет ключа или это первое
   * резервирование для пары). Нужно вызывающему только для отдельной строки в
   * логе — на выбор самого окна не влияет.
   */
  idempotency: "existing" | "replaced" | null
}

/** Код ошибки Prisma, если он есть — иначе пустая строка. */
function prismaErrorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code)
    : ""
}

/**
 * Сохранённое окно ещё годится, только если его длина по-прежнему покрывает
 * requiredSec с точностью до одного кадра — тот же допуск на недостачу, что и
 * в `planRecordingWindow` (MAX_SHORTFALL_FRAMES): конец окна там округляется
 * ВВЕРХ до кадра, поэтому свежее окно почти всегда чуть длиннее requiredSec, и
 * небольшой запас — это норма, а не повод перерезервировать.
 */
function windowStillCoversRequiredSec(durationSec: number, requiredSec: number, fps: number): boolean {
  const frameSec = Number.isFinite(fps) && fps > 0 ? 1 / fps : 0
  return requiredSec - durationSec <= frameSec + 1e-9
}

/**
 * Ищет использование по ключу (videoId, sceneIndex) и решает его судьбу:
 * ещё годится — возвращает готовый ReservedRecordingWindow ("existing"); было,
 * но короче нужного — удаляет его и сигнализирует вызывающему идти обычным
 * путём резервирования ("replaced"); не было вовсе — обычный путь без пометки
 * ("none").
 *
 * Вызывается ТОЛЬКО когда videoId и sceneIndex оба заданы — без пары ключа
 * искать нечего (см. вызов ниже).
 */
async function reuseIdempotentUsage(
  videoId: number,
  sceneIndex: number,
  requiredSec: number,
  fps: number,
): Promise<{ kind: "existing", window: ReservedRecordingWindow } | { kind: "replaced" | "none" }> {
  const existing = await prisma.presenterRecordingUsage.findUnique({
    where: { videoId_sceneIndex: { videoId, sceneIndex } },
    include: { recording: { select: { storageKey: true } } },
  })
  if (!existing) return { kind: "none" }

  const durationSec = existing.endSec - existing.startSec
  if (windowStillCoversRequiredSec(durationSec, requiredSec, fps)) {
    return {
      kind: "existing",
      window: {
        recordingId: existing.recordingId,
        storageKey: existing.recording.storageKey,
        startSec: existing.startSec,
        endSec: existing.endSec,
        durationSec,
        usageId: existing.id,
        reused: false,
        overlapSec: 0,
        idempotency: "existing",
      },
    }
  }

  // Короче нужного — трек между прогонами изменился. Освобождаем и идём
  // обычным путём резервирования заново. Отсутствие строки на момент удаления
  // не ошибка: параллельный прогон той же сцены мог удалить её первым — ниже
  // всё равно резервируется заново, и P2002 на create() ловит саму гонку.
  await prisma.presenterRecordingUsage.delete({ where: { id: existing.id } }).catch((err) => {
    if (prismaErrorCode(err) !== "P2025") throw err
  })
  return { kind: "replaced" }
}

export async function reserveRecordingWindow(
  input: ReserveRecordingWindowInput,
): Promise<ReservedRecordingWindow | null> {
  const now = input.now ?? Date.now()
  const hasIdempotencyKey = input.videoId !== null && input.sceneIndex !== null

  let idempotencyState: "replaced" | null = null
  if (input.videoId !== null && input.sceneIndex !== null) {
    const lookup = await reuseIdempotentUsage(input.videoId, input.sceneIndex, input.requiredSec, input.fps)
    if (lookup.kind === "existing") return lookup.window
    if (lookup.kind === "replaced") idempotencyState = "replaced"
  }

  for (let attempt = 1; attempt <= MAX_RESERVATION_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        // Только завершённые записи: у падавшего ingest файл может быть
        // недокачан, и резать из него — это кадр из ниоткуда.
        const recordings = await tx.presenterRecording.findMany({
          where: {
            characterId: input.characterId,
            ingestStatus: "completed",
            durationSec: { gte: input.requiredSec },
          },
          orderBy: [{ createdAt: "asc" }],
          include: {
            usages: {
              // Не cooldown — см. USAGE_HISTORY_WINDOW_MS: planRecordingWindow
              // обязан увидеть и остывшие интервалы тоже, иначе он не сможет
              // отличить их от нетронутого места.
              where: { usedAt: { gte: new Date(now - USAGE_HISTORY_WINDOW_MS) } },
              select: { startSec: true, endSec: true, usedAt: true },
            },
          },
        })
        if (recordings.length === 0) return null

        // Выбор МЕЖДУ записями — тоже двухключевой, а не по одному overlapSec:
        // сначала минимальный overlapSec (перекрытие с горячими интервалами),
        // при равенстве — кандидат с reused === false. Одного overlapSec мало:
        // у остывшего участка overlapSec тоже 0 — он неотличим от нетронутого
        // по этому ключу, а без второго на уровне выбора записи вернулся бы
        // ровно тот дефект, который уже починен внутри planRecordingWindow
        // (решение задачи, п.2).
        let best: Omit<ReservedRecordingWindow, "idempotency"> | null = null
        for (const recording of recordings) {
          // excludeInterval — синтетический "горячий" интервал сверх тех, что
          // реально лежат в БД: перцептивный отбор просит обойти конкретный
          // отвергнутый участок, даже если он ещё не попал бы в usages (только
          // что удалён) или уже остыл бы по времени.
          const usedIntervals = recording.usages.map(usage => ({
            startSec: usage.startSec,
            endSec: usage.endSec,
            usedAtMs: usage.usedAt.getTime(),
          }))
          if (input.excludeInterval && input.excludeInterval.recordingId === recording.id) {
            usedIntervals.push({
              startSec: input.excludeInterval.startSec,
              endSec: input.excludeInterval.endSec,
              usedAtMs: now,
            })
          }

          const window = planRecordingWindow({
            recordingDurationSec: recording.durationSec,
            requiredSec: input.requiredSec,
            fps: input.fps,
            usedIntervals,
            now,
          })
          if (!window) continue

          const candidate = {
            recordingId: recording.id,
            storageKey: recording.storageKey,
            startSec: window.startSec,
            endSec: window.endSec,
            durationSec: window.durationSec,
            usageId: "",
            reused: window.reused,
            overlapSec: window.overlapSec,
          }

          const isBetter = best === null
            || candidate.overlapSec < best.overlapSec
            || (candidate.overlapSec === best.overlapSec && !candidate.reused && best.reused)

          if (isBetter) {
            best = candidate
            // Полностью нетронутый участок найден — лучше не будет, дальше
            // искать нечего.
            if (best.overlapSec === 0 && !best.reused) break
          }
        }
        if (!best) return null

        const usage = await tx.presenterRecordingUsage.create({
          data: {
            recordingId: best.recordingId,
            startSec: best.startSec,
            endSec: best.endSec,
            videoId: input.videoId,
            sceneIndex: input.sceneIndex,
          },
        })

        return { ...best, usageId: usage.id, idempotency: idempotencyState }
      }, { isolationLevel: "Serializable" })
    }
    catch (error) {
      const code = prismaErrorCode(error)

      // Гонка на идемпотентности: параллельный прогон ТОЙ ЖЕ сцены успел
      // вставить строку (videoId, sceneIndex) первым между нашим findUnique
      // выше и этим create(). Уникальность в схеме её поймала — это не повод
      // падать сырым P2002, а повод отдать строку победителя как "existing":
      // ровно то же состояние, в которое мы попали бы, если бы наш findUnique
      // выполнился на долю секунды позже.
      if (code === "P2002" && hasIdempotencyKey) {
        const lookup = await reuseIdempotentUsage(input.videoId!, input.sceneIndex!, input.requiredSec, input.fps)
        if (lookup.kind === "existing") return lookup.window
        // Строка победителя уже не годится по длине (replaced) или пропала
        // между попытками — не зависаем на этой ветке, а даём общему циклу
        // retry ещё один шанс на обычных основаниях.
      }

      if (code !== "P2034" || attempt === MAX_RESERVATION_ATTEMPTS) throw error
    }
  }

  return null
}
