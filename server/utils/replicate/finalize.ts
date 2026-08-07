/**
 * Достройка вебхука до конца: перенос результата в постоянное хранилище.
 *
 * По PROJECT_CONTEXT §5 завершение принимается вебхуком, а polling — резерв.
 * Фактически вебхук только записывал статус, и файл забирал либо polling внутри
 * `waitForPrediction`, либо recovery раз в минуту. Для длинных задач это значит,
 * что весь контур держался на резерве: если процесс перезапустили между
 * отправкой и завершением, результат ждал recovery, а ссылки Replicate живут
 * считаные часы.
 */

import { createReplicateProvider } from "./client"
import type { ReplicateConfig } from "./config"
import { createFinalizeQueue, type FinalizeQueue } from "./finalize-queue"
import { createMockReplicateProvider } from "./mock"
import { createPredictionService } from "./prediction-service"

export interface FinalizableWebhookPrediction {
  id: string
  status: string
  persistedStorageKey: string | null
}

export interface FinalizeAfterWebhookDeps {
  finalize?: (id: string) => Promise<unknown>
  log?: (message: string) => void
  queue?: FinalizeQueue
}

/**
 * Общая на процесс очередь фоновых переносов.
 *
 * Одна на весь Nitro-процесс: смысл ограничения в том, чтобы пачка вебхуков не
 * открыла десятки загрузок сразу, а очередь на каждый вызов такого ограничения
 * не давала бы вовсе. Экспортируется для тестов и диагностики.
 */
export const webhookFinalizeQueue: FinalizeQueue = createFinalizeQueue()

/** Вебхук принёс успех, но файла в хранилище ещё нет. */
export function needsWebhookFinalization(prediction: FinalizableWebhookPrediction): boolean {
  return prediction.status === "succeeded" && !prediction.persistedStorageKey
}

/**
 * Ставит перенос в фоновую очередь и сразу возвращает управление.
 *
 * Ждать нельзя: Replicate считает вебхук неудачным по таймауту и шлёт повтор,
 * а скачать и загрузить ролик — это секунды. Ошибка переноса тоже не должна
 * превращаться в не-200: повтор вебхука ничего не починит, зато recovery
 * подберёт запись по persistenceStatus.
 *
 * Через очередь, а не напрямую: вебхуки приходят пачкой (пакет роликов ×
 * сцены), и десятки одновременных скачиваний в HTTP-процессе съедали бы память
 * и сеть, роняя часть заливок по таймауту. Повторный вебхук по тому же
 * prediction очередь отсекает по ключу, так что второе скачивание не стартует.
 *
 * С recovery-плагином гонки нет: он делает то же самое раз в минуту, но заявку
 * на перенос обе стороны берут через `claimPersistence` — условный UPDATE, где
 * выигрывает ровно один. Проигравший просто перечитывает запись и выходит,
 * поэтому ожидание в очереди максимум означает, что запись подберёт recovery.
 *
 * Бюджет переносов (`MAX_PERSISTENCE_ATTEMPTS`) при этом делят три финализатора:
 * этот, polling внутри `waitForPrediction` и recovery. Чтобы отказ хранилища на
 * пару минут не сжёг его целиком, устранимые ошибки заявку возвращают — см.
 * `markPersistenceFailed` и `isTransientPersistenceFailure`.
 */
export function finalizeAfterWebhook(
  prediction: FinalizableWebhookPrediction,
  config: ReplicateConfig,
  deps: FinalizeAfterWebhookDeps = {},
): void {
  if (!needsWebhookFinalization(prediction)) return

  const log = deps.log ?? defaultLog
  const finalize = deps.finalize ?? ((id: string) => finalizeWithService(id, config))
  const queue = deps.queue ?? webhookFinalizeQueue

  queue.enqueue(prediction.id, async () => {
    try {
      await finalize(prediction.id)
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log(`не удалось перенести результат ${prediction.id} в хранилище: ${message}`)
    }
  })
}

async function finalizeWithService(id: string, config: ReplicateConfig): Promise<void> {
  // Провайдер финализации не нужен (файл уже отдан), но сервис требует его
  // при сборке — в mock-режиме берём mock, чтобы не трогать боевой клиент.
  const provider = config.mockMode
    ? createMockReplicateProvider()
    : createReplicateProvider({ config })
  await createPredictionService({ provider }).finalizePrediction(id)
}

function defaultLog(message: string): void {
  console.warn(`[replicate-webhook] ${message}`)
}
