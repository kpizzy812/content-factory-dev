/**
 * Загрузка JSON-фикстур из server/__fixtures__/.
 * Используется mock-режимами Anthropic и fal.ai для возврата детерминированных
 * ответов без реальных сетевых вызовов.
 */

import { readFile, access } from "node:fs/promises"
import { join } from "node:path"

const FIXTURES_ROOT = join(process.cwd(), "server", "__fixtures__")

export interface LoadFixtureOptions {
  /** Подпапка внутри server/__fixtures__/ (например, "agents" или "fal"). */
  category: string
  /** Имя файла без расширения (например, "story-architect-happy"). */
  name: string
}

/**
 * Грузит фикстуру и парсит как JSON.
 * Если файл не найден — выбрасывает понятную ошибку с подсказкой.
 */
export async function loadFixture<T = unknown>(opts: LoadFixtureOptions): Promise<T> {
  const path = join(FIXTURES_ROOT, opts.category, `${opts.name}.json`)

  try {
    await access(path)
  } catch {
    throw new Error(
      `Mock fixture not found: ${path}. ` +
      `Добавь JSON-файл с happy-path ответом, чтобы тестировать "${opts.name}" в mock-режиме.`,
    )
  }

  const raw = await readFile(path, "utf-8")
  try {
    return JSON.parse(raw) as T
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Mock fixture ${path} содержит невалидный JSON: ${msg}`)
  }
}

/**
 * Симулирует задержку на API-вызове, чтобы UI видел loading state даже в mock-режиме.
 */
export function mockDelay(ms = 500): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
