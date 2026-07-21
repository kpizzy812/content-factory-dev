/**
 * Smoke-тест для diagnoseProxy().
 *
 * Запускает диагностику против выбранного прокси и выводит результат как JSON
 * в stdout, плюс короткий summary в stderr.
 *
 * Usage:
 *   bun run scripts/test-proxy-diagnostic.ts                       # dry-run против fake-host (валидирует error paths)
 *   bun run scripts/test-proxy-diagnostic.ts --proxy-id <uuid>      # против реального прокси из БД
 *   bun run scripts/test-proxy-diagnostic.ts --label "NodeMaven 1"  # по label
 *
 * Output JSON не содержит credentials — username/password не попадают в result,
 * curl.command маскирует proxy-user.
 */
import { diagnoseProxy, type ProxyDiagnostic } from "../server/utils/proxy/diagnostic"

interface CliArgs {
  proxyId?: string
  label?: string
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {}
  for (let i = 0; i < argv.length; i++) {
    const cur = argv[i]
    if (cur === "--proxy-id" && argv[i + 1]) {
      args.proxyId = argv[i + 1]
      i++
    } else if (cur === "--label" && argv[i + 1]) {
      args.label = argv[i + 1]
      i++
    }
  }
  return args
}

async function loadFromDb(opts: CliArgs) {
  // Динамический импорт — Prisma не нужен в dry-run сценарии.
  const { prisma } = await import("../server/utils/prisma")
  const { decryptSecret } = await import("../server/utils/crypto")

  const where = opts.proxyId
    ? { id: opts.proxyId }
    : opts.label
      ? { label: opts.label }
      : null

  if (!where) return null

  const proxy = await prisma.proxy.findFirst({ where })
  if (!proxy) {
    console.error(`[test-diagnostic] proxy не найден по ${JSON.stringify(where)}`)
    process.exit(1)
  }

  return {
    protocol: proxy.protocol,
    host: decryptSecret(proxy.host),
    port: proxy.port,
    username: proxy.username ? decryptSecret(proxy.username) : undefined,
    password: proxy.password ? decryptSecret(proxy.password) : undefined,
  } as const
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  let creds:
    | {
        protocol: "http" | "https" | "socks5"
        host: string
        port: number
        username?: string
        password?: string
      }
    | null = null

  if (args.proxyId || args.label) {
    creds = (await loadFromDb(args)) as typeof creds
  }

  if (!creds) {
    // Dry-run: несуществующий хост — валидирует что diagnostic возвращает
    // структурированный verdict при connection_refused / timeout.
    console.error(
      "[test-diagnostic] dry-run mode — против fake-host (нет --proxy-id / --label)",
    )
    creds = {
      protocol: "socks5",
      host: "proxy-test-nonexistent.invalid",
      port: 1080,
    }
  }

  const startedAt = Date.now()
  const diagnostic: ProxyDiagnostic = await diagnoseProxy(creds)
  const elapsedMs = Date.now() - startedAt

  // Stderr — короткий summary для CI/CLI:
  console.error("---")
  console.error(`Proxy: ${diagnostic.proxyHost}:${diagnostic.proxyPort} (${diagnostic.protocol})`)
  console.error(`Container IP: ${diagnostic.containerIp.via_v4 ?? "?"}`)
  console.error(`TCP: ${diagnostic.tcp.error ?? diagnostic.tcp.connectMs + "ms"}`)
  console.error(`Curl: ${diagnostic.curlBaseline.detectedIp ?? "(no IP)"} ${diagnostic.curlBaseline.isLeakingViaCurl ? "LEAK" : "OK"}`)
  console.error(`Raw node: ${diagnostic.rawNodeRequest.detectedIp ?? "(no IP)"} leak=${diagnostic.rawNodeRequest.isLeaking}`)
  console.error(`Native fetch: ${diagnostic.nativeFetch.detectedIp ?? "(no IP)"} leak=${diagnostic.nativeFetch.isLeaking}`)
  console.error(`socks5h: ${diagnostic.socks5hVariant.detectedIp ?? "(skipped/no IP)"}`)
  console.error(`Verdict: ${diagnostic.verdict.suspectedRoot}`)
  console.error(`Recommendation: ${diagnostic.verdict.recommendation}`)
  console.error(`Total elapsed: ${elapsedMs}ms`)
  console.error("---")

  // Stdout — full JSON, можно > file:
  process.stdout.write(JSON.stringify(diagnostic, null, 2))
  process.stdout.write("\n")
}

main().catch((err) => {
  console.error("[test-diagnostic] FAILED:", err)
  process.exit(1)
})
