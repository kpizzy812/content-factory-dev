/**
 * Smoke test для proxy-checker (Шаг 9 итерации Social Automation Foundation).
 *
 * Запуск:
 *   bun run scripts/test-proxy-checker.ts <protocol> <host> <port> [<user>] [<pass>]
 *
 * Где protocol: http | https | socks5
 *
 * Standalone: не зависит от Nuxt runtime / prisma. Использует checkProxy
 * из server/utils/proxy/probe.ts напрямую.
 */

import { checkProxy, getServerIp } from "../server/utils/proxy/probe"
import type { ProxyProtocol } from "../shared/types/proxy"

async function main(): Promise<void> {
  const [protocolArg, hostArg, portArg, userArg, passArg] = process.argv.slice(2)

  if (!protocolArg || !hostArg || !portArg) {
    console.error(
      "Usage: bun run scripts/test-proxy-checker.ts <protocol> <host> <port> [<user>] [<pass>]",
    )
    console.error("protocol: http | https | socks5")
    process.exit(1)
  }

  if (!["http", "https", "socks5"].includes(protocolArg)) {
    console.error(`Invalid protocol: ${protocolArg}. Must be http | https | socks5`)
    process.exit(1)
  }

  const port = Number.parseInt(portArg, 10)
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    console.error(`Invalid port: ${portArg}`)
    process.exit(1)
  }

  console.log("Получаем серверный IP (для leak detection)...")
  const serverIp = await getServerIp()
  console.log(`Server external IP: ${serverIp ?? "(не удалось получить)"}\n`)

  console.log(
    `Проверяем ${protocolArg} прокси ${hostArg}:${port}${userArg ? " (с auth)" : " (без auth)"}...`,
  )
  const startedAt = Date.now()
  const result = await checkProxy({
    protocol: protocolArg as ProxyProtocol,
    host: hostArg,
    port,
    username: userArg || undefined,
    password: passArg || undefined,
  })
  const totalMs = Date.now() - startedAt

  console.log("\n=== Результат ===")
  console.log(JSON.stringify(result, null, 2))
  console.log(`\nTotal: ${totalMs}ms`)

  if (result.httpProbeOk && !result.isLeaking) {
    console.log("\n✓ Прокси работает корректно")
    process.exit(0)
  }

  if (result.isLeaking) {
    console.log("\n✗ ВНИМАНИЕ: прокси передаёт реальный IP сервера, использовать НЕЛЬЗЯ")
    process.exit(2)
  }

  console.log("\n✗ Прокси не работает (см. errorCategory / errorMessage выше)")
  process.exit(2)
}

main().catch((err) => {
  console.error("Unexpected error:", err)
  process.exit(1)
})
