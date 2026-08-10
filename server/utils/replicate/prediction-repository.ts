import { prisma } from "../prisma"
import type { MediaPredictionStatus, MediaProviderName } from "../media-provider/types"
import type { AssetStorageColumns } from "../storage/persist-asset"
import {
  isTerminalPredictionStatus,
  sanitizePredictionSnapshot,
  transitionPredictionStatus,
} from "./prediction-state"
import { attemptScopeKeyFilters, MAX_PERSISTENCE_ATTEMPTS } from "./attempt-key"

/**
 * Через сколько запись считается брошенной: и «висит в processing», и «висит
 * в persisting». Одно значение на выборку и на заявку — иначе `findRecoverable`
 * выбирает запись, которую `claimPersistence` не отдаёт, и добивание крутится
 * вхолостую.
 */
const PERSISTENCE_STALE_MS = 2 * 60 * 1000

export interface MediaPredictionRecord {
  id: string
  externalId: string | null
  idempotencyKey: string
  status: string
  inputSnapshot: unknown
  outputSnapshot: unknown
  outputUrl: string | null
  persistedStorageKey: string | null
  persistedStorageProvider: string | null
  persistenceStatus: string
  persistenceAttemptCount?: number | null
  persistenceError: string | null
  errorMessage: string | null
  terminalAt: Date | null
  webhookReceivedAt: Date | null
  [key: string]: unknown
}

interface MediaPredictionDelegate {
  upsert(args: Record<string, unknown>): Promise<MediaPredictionRecord>
  findUnique(args: Record<string, unknown>): Promise<MediaPredictionRecord | null>
  findMany(args: Record<string, unknown>): Promise<MediaPredictionRecord[]>
  update(args: Record<string, unknown>): Promise<MediaPredictionRecord>
  updateMany(args: Record<string, unknown>): Promise<{ count: number }>
  count(args: Record<string, unknown>): Promise<number>
}

export interface MediaPredictionDbClient {
  mediaPrediction: MediaPredictionDelegate
  $transaction<T>(
    operation: (tx: MediaPredictionDbClient) => Promise<T>,
    options?: { isolationLevel: "Serializable" },
  ): Promise<T>
}

export interface CreateMediaPredictionRecord {
  videoId?: number | null
  videoAssetId?: number | null
  provider: MediaProviderName
  capability: string
  model: string
  idempotencyKey: string
  inputSnapshot: unknown
}

export interface PredictionStatusPatch {
  outputSnapshot?: unknown
  outputUrl?: string | null
  errorMessage?: string | null
  metrics?: unknown
  startedAt?: Date | null
  completedAt?: Date | null
  terminalAt?: Date | null
  webhookReceivedAt?: Date | null
}

export function createMediaPredictionRepository(
  client: MediaPredictionDbClient = prisma as unknown as MediaPredictionDbClient,
) {
  return {
    createOrRead(input: CreateMediaPredictionRecord): Promise<MediaPredictionRecord> {
      return client.mediaPrediction.upsert({
        where: { idempotencyKey: input.idempotencyKey },
        update: {},
        create: {
          videoId: input.videoId ?? null,
          videoAssetId: input.videoAssetId ?? null,
          provider: input.provider,
          capability: input.capability,
          model: input.model,
          idempotencyKey: input.idempotencyKey,
          status: "starting",
          inputSnapshot: sanitizePredictionSnapshot(input.inputSnapshot),
        },
      })
    },

    findByIdempotencyKey(idempotencyKey: string): Promise<MediaPredictionRecord | null> {
      return client.mediaPrediction.findUnique({ where: { idempotencyKey } })
    },

    findById(id: string): Promise<MediaPredictionRecord | null> {
      return client.mediaPrediction.findUnique({ where: { id } })
    },

    findByExternalId(externalId: string): Promise<MediaPredictionRecord | null> {
      return client.mediaPrediction.findUnique({ where: { externalId } })
    },

    async attachExternalId(
      id: string,
      externalId: string,
      status: MediaPredictionStatus,
    ): Promise<MediaPredictionRecord> {
      return withSerializableRetry(() => client.$transaction(async (tx) => {
        const current = await tx.mediaPrediction.findUnique({ where: { id } })
        if (!current) throw new Error(`Media prediction not found: ${id}`)
        if (current.externalId === externalId) return current
        if (current.externalId) {
          throw new Error(`Media prediction ${id} is already attached to ${current.externalId}`)
        }

        const updated = await tx.mediaPrediction.updateMany({
          where: { id, externalId: null },
          data: {
            externalId,
            status,
            submittedAt: new Date(),
          },
        })
        if (updated.count !== 1) {
          throw new Error(`Concurrent external id attachment for media prediction ${id}`)
        }

        const result = await tx.mediaPrediction.findUnique({ where: { id } })
        if (!result) throw new Error(`Media prediction disappeared after update: ${id}`)
        return result
      }, { isolationLevel: "Serializable" }))
    },

    async applyStatusUpdate(
      externalId: string,
      nextStatus: MediaPredictionStatus,
      patch: PredictionStatusPatch = {},
    ): Promise<MediaPredictionRecord> {
      return withSerializableRetry(() => client.$transaction(async (tx) => {
        const current = await tx.mediaPrediction.findUnique({ where: { externalId } })
        if (!current) throw new Error(`Media prediction not found for provider id: ${externalId}`)

        const currentStatus = current.status as MediaPredictionStatus
        if (isTerminalPredictionStatus(currentStatus)) {
          return current
        }

        const transition = transitionPredictionStatus(currentStatus, nextStatus)
        if (!transition.changed) return current

        const now = new Date()
        const data: Record<string, unknown> = {
          status: transition.status,
          ...copyDefinedPatch(patch),
        }
        if (patch.outputSnapshot !== undefined) {
          data.outputSnapshot = sanitizePredictionSnapshot(patch.outputSnapshot)
        }
        if (patch.metrics !== undefined) {
          data.metrics = sanitizePredictionSnapshot(patch.metrics)
        }
        if (transition.terminal) {
          data.terminalAt = patch.terminalAt ?? now
          data.completedAt = patch.completedAt ?? now
        }

        const updated = await tx.mediaPrediction.updateMany({
          where: { id: current.id, status: current.status },
          data,
        })
        if (updated.count !== 1) {
          throw new Error(`Concurrent status update for media prediction ${current.id}`)
        }

        const result = await tx.mediaPrediction.findUnique({ where: { id: current.id } })
        if (!result) throw new Error(`Media prediction disappeared after update: ${current.id}`)
        return result
      }, { isolationLevel: "Serializable" }))
    },

    /**
     * Заявка на перенос: условный UPDATE, где выигрывает ровно один.
     *
     * Ветка «зависшая заявка» обязательна. Перенос запускают три независимых
     * финализатора, и если процесс умер посреди заливки, статус так и остаётся
     * `persisting`. Сбросить его некому: `findRecoverable` такую запись
     * исправно выбирает раз в минуту, а захватить её было нельзя — заявка
     * никогда не выдавалась, ключ оставался запертым навсегда, ролик —
     * невосстановимым. Порог тот же, что в выборке: иначе выборка и заявка не
     * договорятся и ветка снова окажется мёртвой.
     *
     * Цена — после порога возможны два переносчика разом (медленная заливка
     * большого ролика). Ключ в хранилище детерминированный, так что второй
     * пишет тот же объект; хуже дубля трафика не будет.
     */
    async claimPersistence(id: string): Promise<boolean> {
      const staleBefore = new Date(Date.now() - PERSISTENCE_STALE_MS)
      const result = await client.mediaPrediction.updateMany({
        where: {
          id,
          status: "succeeded",
          persistedStorageKey: null,
          OR: [
            { persistenceStatus: { in: ["pending", "failed"] } },
            { persistenceStatus: "persisting", persistenceStartedAt: { lte: staleBefore } },
          ],
        },
        data: {
          persistenceStatus: "persisting",
          persistenceStartedAt: new Date(),
          persistenceError: null,
          persistenceAttemptCount: { increment: 1 },
        },
      })
      return result.count === 1
    },

    markOutputPersisted(
      id: string,
      asset: AssetStorageColumns,
    ): Promise<MediaPredictionRecord> {
      return client.mediaPrediction.update({
        where: { id },
        data: {
          persistenceStatus: "persisted",
          persistenceError: null,
          persistedStorageKey: asset.storageKey,
          persistedStorageProvider: asset.storageProvider,
          persistedFileSizeBytes: asset.fileSizeBytes,
          persistedFileSha256: asset.fileSha256,
          persistedContentType: asset.contentType,
        },
      })
    },

    /**
     * Перенос не удался. Для устранимой причины заявка возвращается в бюджет.
     *
     * `claimPersistence` инкрементит `persistenceAttemptCount` до того, как
     * что-либо пробовало качать: иначе запись без ссылки никогда не набрала бы
     * лимит и держала бы свой ключ вечно. Но заявки берут три независимых
     * финализатора (вебхук, polling, recovery), и двухминутный отказ MinIO
     * сжигал весь бюджет за один сбой — оплаченный результат объявлялся
     * потерянным, хотя файл у Replicate ещё жив.
     *
     * Отдельной колонки под «устранимые» неудачи в схеме нет и завести её
     * нельзя, поэтому компромисс такой: откат инкремента, а не второй счётчик.
     * Цена — `persistenceAttemptCount` теперь означает не «сколько раз
     * пробовали», а «сколько неустранимых неудач насчитали»; полное число
     * попыток видно только по логам. Взамен затяжной отказ хранилища не
     * приближает запись к «lost». Вечного цикла тут нет: когда ссылка
     * replicate.delivery протухнет, ошибка станет 404 — неустранимой, — и
     * бюджет доработает как раньше.
     */
    async markPersistenceFailed(
      id: string,
      error: string,
      options: { retriable?: boolean } = {},
    ): Promise<MediaPredictionRecord> {
      // Условие по persistedStorageKey: после порога зависшей заявки переносчиков
      // может быть двое, и опоздавший неудачник не должен откатывать уже
      // сохранённый результат обратно в «failed».
      await client.mediaPrediction.updateMany({
        where: { id, persistedStorageKey: null },
        data: {
          persistenceStatus: "failed",
          persistenceError: error.slice(0, 2_000),
          // Декремент атомарен: заявку в норме держит один финализатор, он же
          // её и возвращает, так что счётчик откатывается к своему значению.
          ...(options.retriable ? { persistenceAttemptCount: { decrement: 1 } } : {}),
        },
      })
      const result = await client.mediaPrediction.findUnique({ where: { id } })
      if (!result) throw new Error(`Media prediction disappeared after update: ${id}`)
      return result
    },

    /**
     * Живые prediction'ы ролика — то, что имеет смысл отменять.
     *
     * Записи без externalId провайдеру ещё не ушли: отменять там нечего,
     * а вызов cancel по пустому id только зашумит лог.
     */
    findActiveByVideoId(videoId: number): Promise<MediaPredictionRecord[]> {
      return client.mediaPrediction.findMany({
        where: {
          videoId,
          status: { in: ["starting", "processing"] },
          externalId: { not: null },
        },
        orderBy: { createdAt: "asc" },
      })
    },

    /**
     * Записи, которые ещё имеет смысл добивать.
     *
     * Ограничение по persistenceAttemptCount критично: ссылка replicate.delivery
     * протухает за часы, и запись «succeeded без файла» после нескольких 404
     * не оживёт никогда. Без потолка планировщик выбирал её раз в минуту и
     * вечно писал в лог одну и ту же ошибку.
     */
    findRecoverable(limit: number): Promise<MediaPredictionRecord[]> {
      const staleBefore = new Date(Date.now() - PERSISTENCE_STALE_MS)
      return client.mediaPrediction.findMany({
        where: {
          externalId: { not: null },
          persistedStorageKey: null,
          OR: [
            {
              status: { in: ["starting", "processing"] },
              updatedAt: { lte: staleBefore },
            },
            {
              status: "succeeded",
              persistenceStatus: { in: ["pending", "failed"] },
              persistenceAttemptCount: { lt: MAX_PERSISTENCE_ATTEMPTS },
            },
            {
              status: "succeeded",
              persistenceStatus: "persisting",
              persistenceStartedAt: { lte: staleBefore },
              persistenceAttemptCount: { lt: MAX_PERSISTENCE_ATTEMPTS },
            },
          ],
        },
        orderBy: { updatedAt: "asc" },
        take: Math.max(1, Math.min(limit, 100)),
      })
    },

    /**
     * Сколько попыток уже сожжено в области подсчёта.
     *
     * Работает на обоих уровнях: узкая область (ролик + сцена + модель +
     * отпечатки исходников) и широкая (та же сущность без отпечатков). Область —
     * префикс идемпотентного ключа: отдельной колонки под неё нет, а схему
     * трогать нельзя. Принадлежность ключа области считает
     * `attemptScopeKeyFilters` — простого `startsWith(scope + ":")` мало, он не
     * видит ни сам базовый ключ узкой области, ни его ретраи через `#`.
     *
     * Отменённые записи не в счёт: отмену инициировал оператор, деньгами она не
     * пахнет.
     */
    countSpentAttemptsInScope(scope: string): Promise<number> {
      return client.mediaPrediction.count({
        where: {
          persistedStorageKey: null,
          // Два независимых OR (по ключу и по статусу) нельзя держать в одном
          // объекте — второй затёр бы первый; поэтому явный AND.
          AND: [
            { OR: attemptScopeKeyFilters(scope).map(idempotencyKey => ({ idempotencyKey })) },
            {
              OR: [
                { status: "failed" },
                {
                  status: "succeeded",
                  persistenceStatus: "failed",
                  persistenceAttemptCount: { gte: MAX_PERSISTENCE_ATTEMPTS },
                },
              ],
            },
          ],
        },
      })
    },
  }
}

/** Postgres сообщает о неудачной сериализации транзакции этим кодом. */
const SERIALIZATION_FAILURE = "P2034"
const SERIALIZABLE_MAX_ATTEMPTS = 5

/**
 * Состояние prediction меняют одновременно два пути: вебхук от Replicate и
 * поллинг пайплайна. Serializable-транзакция делает это корректно, но при
 * столкновении Postgres откатывает одну из них — и это нормальный исход,
 * который надо повторить, а не выносить наверх как ошибку сцены.
 */
async function withSerializableRetry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= SERIALIZABLE_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : ""
      const conflicted = code === SERIALIZATION_FAILURE
        || (error instanceof Error && (
          /write conflict or a deadlock/i.test(error.message)
          // Наши собственные compare-and-set проверки: строку успел изменить сосед.
          || /^Concurrent (status update|external id attachment)/.test(error.message)
        ))
      if (!conflicted || attempt === SERIALIZABLE_MAX_ATTEMPTS) throw error
      await new Promise(resolve => setTimeout(resolve, 50 * attempt))
    }
  }
  throw new Error("Unreachable serializable retry state")
}

function copyDefinedPatch(patch: PredictionStatusPatch): Record<string, unknown> {
  const copy: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined && key !== "outputSnapshot" && key !== "metrics") {
      copy[key] = value
    }
  }
  return copy
}
