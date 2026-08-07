import { mkdir, unlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { extname, join } from "node:path"
import type {
  CreateMediaPredictionInput,
  MediaProvider,
  MediaPredictionStatus,
  NormalizedMediaPrediction,
} from "../media-provider/types"
import type { AssetStorageColumns } from "../storage/persist-asset"
import {
  createMediaPredictionRepository,
  type CreateMediaPredictionRecord,
  type MediaPredictionRecord,
  type PredictionStatusPatch,
} from "./prediction-repository"
import {
  classifyPoisonedAttempt,
  consumesAttemptBudget,
  exhaustedAttemptsMessage,
  exhaustedEntityAttemptsMessage,
  isTransientPersistenceFailure,
  MAX_ATTEMPT_KEY_SCAN,
  MAX_ENTITY_ATTEMPT_CEILING,
  MAX_PREDICTION_ATTEMPTS,
  planPredictionAttempt,
} from "./attempt-key"

export interface PredictionServiceRepository {
  createOrRead(input: CreateMediaPredictionRecord): Promise<MediaPredictionRecord>
  findById(id: string): Promise<MediaPredictionRecord | null>
  attachExternalId(id: string, externalId: string, status: MediaPredictionStatus): Promise<MediaPredictionRecord>
  applyStatusUpdate(
    externalId: string,
    status: MediaPredictionStatus,
    patch: PredictionStatusPatch,
  ): Promise<MediaPredictionRecord>
  claimPersistence(id: string): Promise<boolean>
  markOutputPersisted(id: string, asset: AssetStorageColumns): Promise<MediaPredictionRecord>
  markPersistenceFailed(
    id: string,
    error: string,
    options?: { retriable?: boolean },
  ): Promise<MediaPredictionRecord>
  findRecoverable(limit: number): Promise<MediaPredictionRecord[]>
  countSpentAttemptsInScope?(scope: string): Promise<number>
}

export interface PredictionSubmission extends CreateMediaPredictionInput {
  videoId?: number | null
  videoAssetId?: number | null
  /**
   * Узкая область бюджета: тот же набор исходников. По умолчанию — сам
   * `idempotencyKey`, потому что ключ уже содержит отпечатки видео и аудио.
   *
   * Именно тут живёт потолок «не зацикливаться на негодном исходнике». Считать
   * его по сущности без отпечатков было нельзя: оператор перегенерировал клип,
   * исходник стал другим, а бюджет оставался сожжённым — сцена запиралась
   * навсегда, и новая попытка падала мгновенно.
   */
  attemptScope?: string | null
  /**
   * Широкая область: устойчивая сущность без отпечатков (ролик + сцена +
   * модель). По ней считается общий потолок `MAX_ENTITY_ATTEMPT_CEILING`.
   *
   * Без неё узкая область не связывала бы ничего: на перезапуске шага TTS
   * пересинтезируется, хэш аудио другой — и каждый перезапуск открывал бы
   * свежий полный бюджет.
   */
  attemptCeilingScope?: string | null
}

export interface WaitForPredictionOptions {
  timeoutMs?: number
  pollIntervalMs?: number
}

export interface PredictionRecoveryResult {
  inspected: number
  recovered: number
  failed: number
}

export interface CreatePredictionServiceOptions {
  repository?: PredictionServiceRepository
  provider: MediaProvider
  persistOutput?: (
    prediction: MediaPredictionRecord,
    outputUrl: string,
  ) => Promise<AssetStorageColumns>
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

export function createPredictionService({
  repository = createMediaPredictionRepository() as unknown as PredictionServiceRepository,
  provider,
  persistOutput = persistPredictionOutput,
  sleep = defaultSleep,
  now = Date.now,
}: CreatePredictionServiceOptions) {
  async function applyProviderPrediction(
    prediction: NormalizedMediaPrediction,
  ): Promise<MediaPredictionRecord> {
    return repository.applyStatusUpdate(prediction.externalId, prediction.status, {
      outputSnapshot: prediction.raw,
      outputUrl: prediction.outputUrl,
      errorMessage: prediction.error,
      startedAt: prediction.startedAt,
      completedAt: prediction.completedAt,
    })
  }

  async function finalizeSucceeded(
    prediction: MediaPredictionRecord,
  ): Promise<MediaPredictionRecord> {
    if (prediction.persistedStorageKey) return prediction
    if (prediction.status !== "succeeded") return prediction

    // Заявку на перенос берём до проверки ссылки: заявка инкрементит счётчик
    // попыток, а без счётчика запись «succeeded без файла» никогда не наберёт
    // лимит и не освободит свой ключ — ролик останется запертым навсегда.
    const claimed = await repository.claimPersistence(prediction.id)
    if (!claimed) {
      return await requirePrediction(prediction.id)
    }

    if (!prediction.outputUrl || typeof prediction.outputUrl !== "string") {
      // Ссылки нет вовсе — переносить нечего и позже не появится: неустранимо,
      // попытка засчитывается, и запись движется к «lost», освобождая ключ.
      const message = `Replicate output is missing or expired for prediction ${prediction.id}`
      await repository.markPersistenceFailed(prediction.id, message)
      throw new Error(message)
    }

    try {
      const asset = await persistOutput(prediction, prediction.outputUrl)
      return await repository.markOutputPersisted(prediction.id, asset)
    } catch (error) {
      // «Не смогли перенести» и «переносить нечем» — разные вещи. Отказ сети
      // или 5xx хранилища повторяем тем же результатом Replicate и бюджет не
      // тратим; 404/410 по ссылке и всё неопознанное тратят, как раньше.
      const message = error instanceof Error ? error.message : String(error)
      await repository.markPersistenceFailed(prediction.id, message, {
        retriable: isTransientPersistenceFailure(error),
      })
      throw error
    }
  }

  async function requirePrediction(id: string): Promise<MediaPredictionRecord> {
    const prediction = await repository.findById(id)
    if (!prediction) throw new Error(`Media prediction not found: ${id}`)
    return prediction
  }

  /**
   * Финализация по внутреннему id — точка входа для вебхука.
   *
   * Вебхук приносит только «succeeded», а ссылки Replicate живут считаные часы:
   * без переноса в постоянное хранилище результат протухает и остаётся только
   * заплатить второй раз.
   */
  async function finalizePrediction(id: string): Promise<MediaPredictionRecord> {
    return finalizeSucceeded(await requirePrediction(id))
  }

  async function submitOrResumePrediction(
    request: PredictionSubmission,
  ): Promise<MediaPredictionRecord> {
    const baseKey = request.idempotencyKey
    // Причина последней терминальной неудачи: без неё сообщение об исчерпании
    // попыток не говорит оператору ничего.
    let lastError: string | null = null

    // Сколько уже сожжено на ЭТИХ исходниках. Область узкая (в неё входят
    // отпечатки видео и аудио), поэтому перегенерированный клип открывает
    // свежий бюджет, а зацикливание на одном негодном исходнике — нет.
    const sourceSpent = await countSpentAttemptsInScope(request.attemptScope ?? baseKey)
    // Сколько сожжено на сцене целиком, по всем наборам исходников. Широкий
    // потолок держит второй край: смена исходников не должна давать бесконечно
    // много свежих бюджетов.
    const entitySpent = await countSpentAttemptsInScope(request.attemptCeilingScope)
    if (entitySpent >= MAX_ENTITY_ATTEMPT_CEILING) {
      throw new Error(exhaustedEntityAttemptsMessage(
        request.attemptCeilingScope ?? baseKey,
        MAX_ENTITY_ATTEMPT_CEILING,
      ))
    }

    // Неудачи текущей цепочки. Оценки пересекаются (записи цепочки входят в
    // узкую область), поэтому берём максимум, а не сумму.
    let chainSpent = 0

    for (let attempt = 1; attempt <= MAX_ATTEMPT_KEY_SCAN; attempt += 1) {
      if (Math.max(sourceSpent, chainSpent) >= MAX_PREDICTION_ATTEMPTS) break
      const plan = planPredictionAttempt(baseKey, attempt, MAX_ATTEMPT_KEY_SCAN)
      if (!plan) break

      let prediction = await repository.createOrRead({
        videoId: request.videoId,
        videoAssetId: request.videoAssetId,
        provider: provider.name,
        capability: request.model.capability,
        model: request.model.id,
        idempotencyKey: plan.key,
        inputSnapshot: request.input,
      })

      // Попытка терминально закончилась и ничего не оставила в хранилище: её
      // ключ отравлен навсегда, ждать от записи нечего — открываем следующую.
      const poisoned = classifyPoisonedAttempt(prediction)
      if (poisoned) {
        lastError = describeAttemptFailure(prediction) ?? lastError
        // Отменённая оператором попытка бюджет не тратит: воскрешать её запись
        // нельзя, но и наказывать за отмену рублём тоже не за что.
        if (consumesAttemptBudget(poisoned)) chainSpent += 1
        continue
      }

      if (!prediction.externalId) {
        // Ключ попытки уходит и провайдеру: mock-провайдер выводит из него
        // стабильный externalId, а тот в базе уникален.
        const submitted = await provider.create({ ...request, idempotencyKey: plan.key })
        prediction = await repository.attachExternalId(
          prediction.id,
          submitted.externalId,
          "starting",
        )
        prediction = await applyProviderPrediction(submitted)
      }

      return finalizeSucceeded(prediction)
    }

    throw new Error(exhaustedAttemptsMessage(baseKey, MAX_PREDICTION_ATTEMPTS, lastError))
  }

  /** Бюджет сущности. Репозиторий без подсчёта (тестовые двойники) — ноль. */
  async function countSpentAttemptsInScope(scope: string | null | undefined): Promise<number> {
    if (!scope?.trim() || !repository.countSpentAttemptsInScope) return 0
    return repository.countSpentAttemptsInScope(scope)
  }

  async function waitForPrediction(
    id: string,
    options: WaitForPredictionOptions = {},
  ): Promise<MediaPredictionRecord> {
    const timeoutMs = options.timeoutMs ?? 15 * 60 * 1000
    const pollIntervalMs = options.pollIntervalMs ?? 5_000
    const deadline = now() + timeoutMs

    while (true) {
      let prediction = await requirePrediction(id)
      if (prediction.persistedStorageKey) return prediction

      if (prediction.status === "failed" || prediction.status === "canceled") {
        throw new Error(
          prediction.errorMessage
            ? `Replicate prediction ${prediction.status}: ${prediction.errorMessage}`
            : `Replicate prediction ${prediction.status}: ${prediction.id}`,
        )
      }

      if (prediction.status === "succeeded") {
        prediction = await finalizeSucceeded(prediction)
        if (prediction.persistedStorageKey) return prediction
      } else {
        if (!prediction.externalId) {
          throw new Error(`Media prediction ${prediction.id} has not been submitted to Replicate`)
        }
        const remote = await provider.get(prediction.externalId)
        prediction = await applyProviderPrediction(remote)
        prediction = await finalizeSucceeded(prediction)
        if (prediction.persistedStorageKey) return prediction
      }

      if (now() >= deadline) {
        throw new Error(`Timed out waiting for media prediction ${id}`)
      }
      await sleep(pollIntervalMs)
    }
  }

  async function recoverStalePredictions(limit = 20): Promise<PredictionRecoveryResult> {
    const predictions = await repository.findRecoverable(limit)
    let recovered = 0
    let failed = 0

    for (const prediction of predictions) {
      try {
        let current = prediction
        if (current.status !== "succeeded") {
          if (!current.externalId) throw new Error(`Prediction ${current.id} has no external id`)
          current = await applyProviderPrediction(await provider.get(current.externalId))
        }
        current = await finalizeSucceeded(current)
        if (current.persistedStorageKey || current.status === "failed" || current.status === "canceled") {
          recovered += 1
        }
      } catch {
        failed += 1
      }
    }

    return { inspected: predictions.length, recovered, failed }
  }

  return {
    submitOrResumePrediction,
    waitForPrediction,
    finalizePrediction,
    recoverStalePredictions,
  }
}

/**
 * Причина неудачи попытки. У «успешной, но утерянной» записи errorMessage пуст —
 * настоящая причина лежит в persistenceError, и без неё оператору нечего читать.
 */
function describeAttemptFailure(prediction: MediaPredictionRecord): string | null {
  return prediction.errorMessage ?? prediction.persistenceError ?? null
}

async function persistPredictionOutput(
  prediction: MediaPredictionRecord,
  outputUrl: string,
): Promise<AssetStorageColumns> {
  const [{ downloadFile }, { StorageKeys }, { uploadLocalAsset }] = await Promise.all([
    import("../video-helpers"),
    import("../storage/keys"),
    import("../storage/persist-asset"),
  ])
  const extension = inferExtension(outputUrl)
  const directory = join(tmpdir(), "contentfactory-replicate")
  const localPath = join(directory, `${prediction.id}.${extension}`)
  await mkdir(directory, { recursive: true })

  try {
    await downloadFile(outputUrl, localPath)
    return await uploadLocalAsset(
      localPath,
      StorageKeys.mediaPredictionOutput(prediction.id, extension),
      extension === "mp4" ? "video/mp4" : undefined,
    )
  } finally {
    await unlink(localPath).catch(() => {})
  }
}

function inferExtension(outputUrl: string): string {
  try {
    const extension = extname(new URL(outputUrl).pathname).replace(/^\./, "").toLowerCase()
    return extension || "mp4"
  } catch {
    return "mp4"
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
