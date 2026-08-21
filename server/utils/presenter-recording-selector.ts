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
 *
 * Фикс-раунд 1 (ревью): проверка/замена старого использования по ключу
 * идемпотентности переехала ВНУТРЬ той же Serializable-транзакции, что заводит
 * новое окно (Minor 3) — раньше удаление устаревшей строки шло ДО открытия
 * транзакции отдельным запросом, и падение или пустой результат резервирования
 * между удалением и созданием оставляли интервал прошлого прогона без всякой
 * защиты в БД. Обработчик гонки на P2002 (Important 1) больше не удаляет
 * ничего сам — только читает строку победителя и либо отдаёт её, либо честно
 * бросает понятную ошибку конфликта, а не сырой Prisma-код.
 */

import { prisma } from "./prisma"
import { MAX_SHORTFALL_FRAMES, planRecordingWindow, RECORDING_WINDOW_COOLDOWN_MS } from "./presenter/recording-window"

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
   * идемпотентность не применяется (работает как раньше): единственный
   * легитимный случай — служебный прогон без videoId (videoId === null),
   * для которого пары ключа нет вовсе, а не какой-то особый вызывающий.
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
   *
   * Поля reused/overlapSec на ветке "existing" — заведомо приблизительные
   * (0/false): решение о них принималось В ПРОШЛОМ прогоне и не хранится, а
   * пересчитывать его сейчас нечем (usedIntervals того прогона не сохранены).
   * Это не «настоящий» 0, а «неизвестно» — так и восприниматься лог-строкой.
   */
  idempotency: "existing" | "replaced" | null
}

/** Код ошибки Prisma, если он есть — иначе пустая строка. */
export function prismaErrorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code)
    : ""
}

/**
 * Сохранённое окно ещё годится, только если его длина по-прежнему покрывает
 * requiredSec с точностью до допуска планировщика (`MAX_SHORTFALL_FRAMES` из
 * `recording-window.ts` — та же константа, что решает, когда планировщик
 * прижимает конец окна к концу записи и получает окно чуть короче заказанного;
 * значения обязаны совпадать буквально, а не только численно, иначе они молча
 * разойдутся при следующей правке одного из двух мест).
 */
function windowStillCoversRequiredSec(durationSec: number, requiredSec: number, fps: number): boolean {
  const frameSec = Number.isFinite(fps) && fps > 0 ? 1 / fps : 0
  return requiredSec - durationSec <= frameSec * MAX_SHORTFALL_FRAMES + 1e-9
}

export async function reserveRecordingWindow(
  input: ReserveRecordingWindowInput,
): Promise<ReservedRecordingWindow | null> {
  const now = input.now ?? Date.now()
  const hasIdempotencyKey = input.videoId !== null && input.sceneIndex !== null

  for (let attempt = 1; attempt <= MAX_RESERVATION_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        // Идемпотентность — ВНУТРИ этой же транзакции (Minor 3 из ревью
        // фикс-раунда 1): чтение существующего использования, его возможное
        // удаление (устарело, короче нового requiredSec) и создание нового
        // должны коммититься или откатываться вместе. Раньше удаление шло
        // отдельным запросом ДО открытия транзакции — падение резервирования
        // или пустой результат между удалением и созданием оставляли интервал
        // прошлого прогона совсем без защиты в БД, хотя окно физически всё
        // ещё используется в уже отрендеренном ролике.
        let idempotency: "existing" | "replaced" | null = null
        if (hasIdempotencyKey) {
          const existing = await tx.presenterRecordingUsage.findUnique({
            where: { videoId_sceneIndex: { videoId: input.videoId!, sceneIndex: input.sceneIndex! } },
            include: { recording: { select: { storageKey: true } } },
          })
          if (existing) {
            const existingDurationSec = existing.endSec - existing.startSec
            if (windowStillCoversRequiredSec(existingDurationSec, input.requiredSec, input.fps)) {
              return {
                recordingId: existing.recordingId,
                storageKey: existing.recording.storageKey,
                startSec: existing.startSec,
                endSec: existing.endSec,
                durationSec: existingDurationSec,
                usageId: existing.id,
                reused: false,
                overlapSec: 0,
                idempotency: "existing",
              }
            }
            // Короче нужного — трек между прогонами изменился. Удаляем и идём
            // обычным путём резервирования заново, но НЕ выходя из транзакции.
            await tx.presenterRecordingUsage.delete({ where: { id: existing.id } })
            idempotency = "replaced"
          }
        }

        // Только завершённые записи: у падавшего ingest файл может быть
        // недокачан, и резать из него — это кадр из ниоткуда.
        //
        // `take` здесь НАРОЧНО не заводится — это не то же самое, что лимит
        // пакета в автоочистке (Minor 9 из первого раунда финального ревью,
        // откачен вторым: он породил Important). В автоочистке выборка
        // самоочищается — обработанная строка меняет retention/cooledAt и
        // выпадает из `where` следующего прохода, так что лимит просто
        // растягивает бэклог на несколько тиков. Здесь `ingestStatus:
        // "completed"` не меняется НИКОГДА — успешно нарезанная запись
        // остаётся кандидатом навечно. С `take` и `orderBy: createdAt asc` у
        // персонажа за сотней с лишним завершённых записей всё, что моложе
        // отрезанной границы, не попало бы в выборку НИ ПРИ ОДНОМ вызове —
        // не отказом, а тихой деградацией: `planRecordingWindow` на
        // насыщенной записи не возвращает null, а ранжирует и отдаёт `reused:
        // true` поверх горячего интервала, и система вечно перерезала бы одни
        // и те же старые записи, пока свежий нетронутый материал лежал бы
        // невидимым — ровно дубль по docs/PROJECT_CONTEXT.md §7. Ранний выход
        // (`best.overlapSec === 0 && !best.reused`, см. ниже) и так обрывает
        // перебор на первой годной записи в типичном случае — платить за
        // редкий персонажа с сотнями записей секундами транзакции дешевле,
        // чем тихо терять материал навсегда.
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

        return { ...best, usageId: usage.id, idempotency }
      }, { isolationLevel: "Serializable" })
    }
    catch (error) {
      const code = prismaErrorCode(error)

      // Гонка на идемпотентности: параллельный прогон ТОЙ ЖЕ сцены успел
      // вставить строку (videoId, sceneIndex) первым между нашим чтением внутри
      // транзакции и её commit. Уникальность в схеме её поймала — это не повод
      // падать сырым P2002. Читаем строку победителя БЕЗ побочных эффектов
      // (никакого delete отсюда — Important 1 из ревью: catch не владеет чужой
      // транзакцией, удалять из него что-либо небезопасно) и либо отдаём её,
      // либо — если она не покрывает наш requiredSec — бросаем понятную ошибку
      // конфликта. Тихого бесконечного retry здесь не будет: это не временная
      // serialization failure (P2034), а два конкурентных прогона одной сцены,
      // которые хотят окна РАЗНОЙ длины, и без явного решения человека/повторного
      // запуска сцены автоматически это не разрулить.
      if (code === "P2002" && hasIdempotencyKey) {
        const winner = await prisma.presenterRecordingUsage.findUnique({
          where: { videoId_sceneIndex: { videoId: input.videoId!, sceneIndex: input.sceneIndex! } },
          include: { recording: { select: { storageKey: true } } },
        })
        if (winner) {
          const winnerDurationSec = winner.endSec - winner.startSec
          if (windowStillCoversRequiredSec(winnerDurationSec, input.requiredSec, input.fps)) {
            return {
              recordingId: winner.recordingId,
              storageKey: winner.recording.storageKey,
              startSec: winner.startSec,
              endSec: winner.endSec,
              durationSec: winnerDurationSec,
              usageId: winner.id,
              reused: false,
              overlapSec: 0,
              idempotency: "existing",
            }
          }
        }
        throw new Error(
          `Резервирование окна конфликтует с уже занятым (videoId=${input.videoId}, `
          + `sceneIndex=${input.sceneIndex}): параллельный прогон занял окно другой длины `
          + `(requiredSec=${input.requiredSec}с не покрыт). Повторите прогон сцены.`,
        )
      }

      if (code !== "P2034" || attempt === MAX_RESERVATION_ATTEMPTS) throw error
    }
  }

  return null
}
