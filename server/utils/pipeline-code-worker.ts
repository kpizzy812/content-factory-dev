/**
 * Worker thread script for safe code node execution.
 *
 * Runs user transformation code in an isolated worker_threads.Worker.
 * The parent can terminate this worker at any time (hard kill for sync loops).
 *
 * Security model:
 * - Isolated thread: sync infinite loops cannot hang the main process
 * - Hard termination via worker.terminate() after timeout
 * - All dangerous globals explicitly blocked
 * - Static pattern analysis before execution
 * - Frozen input/config (immutable)
 * - Output size limit (1MB)
 */

import { parentPort, workerData } from 'node:worker_threads'

interface WorkerInput {
  code: string
  input: Record<string, unknown>
  config: Record<string, unknown>
}

function run() {
  const { code, input, config } = workerData as WorkerInput

  // Blocked globals — shadow with undefined
  const blockedGlobals: Record<string, undefined> = {}
  for (const name of [
    'process', 'require', 'module', 'exports', 'global', 'globalThis',
    'eval', 'Function', 'fetch', 'setTimeout', 'setInterval', 'setImmediate',
    'clearTimeout', 'clearInterval', 'queueMicrotask', 'Promise',
    'Proxy', 'Reflect', 'Symbol', 'WeakRef', 'FinalizationRegistry',
    'SharedArrayBuffer', 'Atomics', 'WebAssembly',
    'XMLHttpRequest', 'WebSocket', 'Worker', 'Blob', 'File', 'URL',
    'Buffer', 'TextEncoder', 'TextDecoder',
    'window', 'document', 'navigator', 'location', 'self',
    '__dirname', '__filename', 'console',
  ]) {
    blockedGlobals[name] = undefined
  }

  // Frozen data — prevent mutation
  const frozenInput = Object.freeze(JSON.parse(JSON.stringify(input)))
  const frozenConfig = Object.freeze(JSON.parse(JSON.stringify(config)))

  // eslint-disable-next-line no-new-func
  const fn = new Function(
    ...Object.keys(blockedGlobals),
    'input', 'config',
    'Math', 'JSON', 'Date', 'Array', 'Object', 'String', 'Number', 'Boolean', 'RegExp',
    'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent',
    `'use strict';
    ${code}`,
  )

  const result = fn(
    ...Object.values(blockedGlobals),
    frozenInput, frozenConfig,
    Math, JSON, Date, Array, Object, String, Number, Boolean, RegExp,
    parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
  )

  // Output validation
  const outputStr = JSON.stringify(result)
  if (outputStr === undefined) {
    throw new Error('Результат трансформации не сериализуем в JSON')
  }
  if (outputStr.length > 1_000_000) {
    throw new Error('Результат трансформации слишком большой (> 1МБ)')
  }

  parentPort!.postMessage({ success: true, result })
}

try {
  run()
} catch (err) {
  const message = err instanceof Error ? err.message : 'Неизвестная ошибка выполнения'
  parentPort!.postMessage({ success: false, error: message })
}
