/**
 * Регрессия: финализация после вебхука шла в фон без ограничения параллелизма.
 *
 * Пакет из 20 роликов по 4 сцены даёт пачку почти одновременных «succeeded»:
 * старый код запускал скачивание и заливку по каждому сразу, десятками в одном
 * HTTP-процессе Nitro. Проверяем, что теперь в полёте не больше лимита, что
 * повторный вебхук по тому же prediction не порождает второе скачивание и что
 * упавшая задача не роняет очередь и не теряется молча.
 */
import { describe, expect, it, vi } from "vitest"
import {
  createFinalizeQueue,
  FINALIZE_CONCURRENCY_LIMIT,
} from "../../../server/utils/replicate/finalize-queue"
import { finalizeAfterWebhook } from "../../../server/utils/replicate/finalize"

const config = { mockMode: true } as never

/** Задача, которой можно управлять из теста: считаем старты, отпускаем вручную. */
function createControllableFinalize() {
  const started: string[] = []
  const release: Array<(error?: Error) => void> = []
  const finalize = vi.fn((id: string) => {
    started.push(id)
    return new Promise<void>((resolve, reject) => {
      release.push((error?: Error) => (error ? reject(error) : resolve()))
    })
  })
  return { started, release, finalize }
}

/** Даём очереди прокрутить микрозадачи, не завися от таймеров. */
async function flush(times = 5): Promise<void> {
  for (let i = 0; i < times; i += 1) await Promise.resolve()
}

describe("Replicate: очередь фоновых финализаций", () => {
  it("держит в полёте не больше лимита, остальное ждёт очереди", async () => {
    const { started, release, finalize } = createControllableFinalize()
    const queue = createFinalizeQueue({ concurrency: FINALIZE_CONCURRENCY_LIMIT })
    const ids = Array.from({ length: 8 }, (_, index) => `pred_${index}`)

    for (const id of ids) {
      finalizeAfterWebhook({ id, status: "succeeded", persistedStorageKey: null }, config, {
        finalize,
        queue,
      })
    }
    await flush()

    // На старом поведении здесь было бы 8 одновременных скачиваний.
    expect(started).toEqual(ids.slice(0, FINALIZE_CONCURRENCY_LIMIT))
    expect(queue.stats()).toEqual({
      active: FINALIZE_CONCURRENCY_LIMIT,
      pending: ids.length - FINALIZE_CONCURRENCY_LIMIT,
    })

    // Освобождаем слоты по одному: очередь должна подтягивать следующие задачи.
    while (release.length > 0) {
      release.shift()!()
      await flush()
    }
    await queue.whenIdle()

    expect(started).toEqual(ids)
    expect(queue.stats()).toEqual({ active: 0, pending: 0 })
  })

  it("не ставит один и тот же prediction дважды, пока перенос не закончился", async () => {
    const { release, finalize } = createControllableFinalize()
    const queue = createFinalizeQueue({ concurrency: 1 })
    const prediction = { id: "pred_dup", status: "succeeded", persistedStorageKey: null }

    finalizeAfterWebhook(prediction, config, { finalize, queue })
    finalizeAfterWebhook(prediction, config, { finalize, queue })
    finalizeAfterWebhook(prediction, config, { finalize, queue })
    await flush()

    // Повтор вебхука Replicate не должен превращаться во второе скачивание.
    expect(finalize).toHaveBeenCalledTimes(1)
    expect(queue.stats()).toEqual({ active: 1, pending: 0 })

    release.shift()!()
    await queue.whenIdle()

    // После завершения ключ свободен: recovery или новый вебхук могут повторить.
    finalizeAfterWebhook(prediction, config, { finalize, queue })
    await flush()
    expect(finalize).toHaveBeenCalledTimes(2)
    release.shift()!()
    await queue.whenIdle()
  })

  it("падение одной задачи логируется и не блокирует остальные", async () => {
    const log = vi.fn()
    const { release, finalize } = createControllableFinalize()
    const queue = createFinalizeQueue({ concurrency: 1 })

    finalizeAfterWebhook({ id: "pred_bad", status: "succeeded", persistedStorageKey: null }, config, {
      finalize,
      log,
      queue,
    })
    finalizeAfterWebhook({ id: "pred_good", status: "succeeded", persistedStorageKey: null }, config, {
      finalize,
      log,
      queue,
    })
    await flush()

    release.shift()!(new Error("storage недоступен"))
    await flush()

    expect(log).toHaveBeenCalledWith(expect.stringContaining("storage недоступен"))
    expect(finalize).toHaveBeenCalledTimes(2)
    expect(finalize).toHaveBeenLastCalledWith("pred_good")

    release.shift()!()
    await queue.whenIdle()
    expect(queue.stats()).toEqual({ active: 0, pending: 0 })
  })

  it("очередь не глохнет от нулевого лимита и переживает синхронный бросок", async () => {
    const log = vi.fn()
    const queue = createFinalizeQueue({ concurrency: 0, log })
    const done: string[] = []

    // Конфигурация с нулём не должна навсегда останавливать переносы.
    queue.enqueue("boom", () => { throw new Error("сломалось сразу") })
    queue.enqueue("ok", async () => { done.push("ok") })
    await queue.whenIdle()

    expect(log).toHaveBeenCalledWith(expect.stringContaining("сломалось сразу"))
    expect(done).toEqual(["ok"])
  })
})
