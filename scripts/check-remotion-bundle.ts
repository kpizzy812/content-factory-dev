/**
 * Проверка, что слой инфографики собирается.
 *
 * Бандл — это сборка композиций без браузера: он ловит ошибки JSX, импортов и
 * регистрации корня, но не требует Chrome и не рендерит ни одного кадра.
 * Полный рендер проверяется только на готовом ролике и тянет headless Chrome.
 *
 * Запуск:
 *   bun run scripts/check-remotion-bundle.ts
 */

import { join } from 'node:path'

async function main() {
  const entryPoint = join(process.cwd(), 'remotion', 'index.ts')
  const { bundle } = await import('@remotion/bundler')

  const startedAt = Date.now()
  const serveUrl = await bundle({ entryPoint })
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1)

  console.log(`Композиции собраны за ${elapsedSec}s`)
  console.log(`Бандл: ${serveUrl}`)
}

main().catch((error: unknown) => {
  console.error('Сборка композиций упала:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
