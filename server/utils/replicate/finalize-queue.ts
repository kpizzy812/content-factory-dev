/**
 * Очередь фоновых финализаций вебхука с ограничением параллелизма.
 *
 * Вебхуки Replicate приходят пачкой: пакет из 20 роликов по 4 сцены — это до
 * 80 почти одновременных «succeeded». Финализация каждого качает готовый ролик
 * на диск и заливает его в хранилище, и всё это происходит прямо в HTTP-процессе
 * Nitro. Без ограничения десятки таких загрузок стартуют разом: память,
 * исходящая полоса и файловые дескрипторы делятся на всех, часть заливок
 * отваливается по таймауту, и prediction остаётся без persistedStorageKey —
 * то есть ждёт recovery, пока ссылка Replicate не протухнет.
 *
 * Модуль намеренно ничего не знает ни о Nitro, ни о Replicate: на вход даётся
 * задача-функция, наружу — только постановка в очередь и ожидание простоя для
 * тестов.
 */

/**
 * Сколько переносов держим в полёте одновременно.
 *
 * Три — компромисс: скачивание ролика упирается в сеть, а не в CPU, поэтому
 * последовательная очередь заметно тормозила бы пакет, но и разгонять до
 * десятков параллельных загрузок в web-процессе нельзя. Значение подобрано под
 * типичный ролик в десятки мегабайт: три потока насыщают канал, не съедая
 * память под буферы.
 */
export const FINALIZE_CONCURRENCY_LIMIT = 3

export type FinalizeQueueTask = () => Promise<unknown>

export interface CreateFinalizeQueueOptions {
  concurrency?: number
  log?: (message: string) => void
}

export interface FinalizeQueue {
  /**
   * Ставит задачу в очередь. Возвращает false, если задача с таким ключом уже
   * ждёт или выполняется — повторный вебхук по тому же prediction не должен
   * порождать второе скачивание.
   */
  enqueue: (key: string, task: FinalizeQueueTask) => boolean
  /** Диагностика и тесты: сколько задач в работе и сколько ждёт очереди. */
  stats: () => { active: number; pending: number }
  /** Ожидание опустошения очереди. Нужно тестам, в runtime никто не ждёт. */
  whenIdle: () => Promise<void>
}

interface QueueItem {
  key: string
  task: FinalizeQueueTask
}

export function createFinalizeQueue(options: CreateFinalizeQueueOptions = {}): FinalizeQueue {
  // Ноль или отрицательное значение из конфигурации остановило бы очередь
  // навсегда: лучше деградировать в последовательный режим.
  const concurrency = Math.max(1, Math.trunc(options.concurrency ?? FINALIZE_CONCURRENCY_LIMIT))
  const log = options.log ?? defaultLog
  const pending: QueueItem[] = []
  // Ключи в работе и в ожидании — защита от повторной постановки.
  const known = new Set<string>()
  const idleWaiters: Array<() => void> = []
  let active = 0

  function enqueue(key: string, task: FinalizeQueueTask): boolean {
    if (known.has(key)) return false
    known.add(key)
    pending.push({ key, task })
    drain()
    return true
  }

  function drain(): void {
    while (active < concurrency && pending.length > 0) {
      const item = pending.shift()!
      active += 1
      // Задача стартует синхронно (до первого await внутри неё), поэтому ответ
      // вебхука уходит не дожидаясь результата, но и не откладывает запуск.
      void run(item)
    }
  }

  async function run(item: QueueItem): Promise<void> {
    try {
      await item.task()
    }
    catch (error) {
      // Очередь не имеет права падать целиком из-за одной задачи: следующая
      // финализация важнее, а причину видно в логе.
      const message = error instanceof Error ? error.message : String(error)
      log(`задача финализации ${item.key} упала: ${message}`)
    }
    finally {
      known.delete(item.key)
      active -= 1
      drain()
      releaseIdleWaiters()
    }
  }

  function releaseIdleWaiters(): void {
    if (active > 0 || pending.length > 0) return
    while (idleWaiters.length > 0) idleWaiters.shift()!()
  }

  function whenIdle(): Promise<void> {
    if (active === 0 && pending.length === 0) return Promise.resolve()
    return new Promise<void>((resolve) => { idleWaiters.push(resolve) })
  }

  return {
    enqueue,
    stats: () => ({ active, pending: pending.length }),
    whenIdle,
  }
}

function defaultLog(message: string): void {
  console.warn(`[replicate-finalize-queue] ${message}`)
}
