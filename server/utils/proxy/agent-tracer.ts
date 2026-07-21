import * as net from "node:net"
import { SocksProxyAgent } from "socks-proxy-agent"

export interface AgentConnectionAttempt {
  timestamp: string
  targetHost: string
  targetPort: number
  options: Record<string, unknown>
  socketRemoteAddress?: string
  socketRemotePort?: number
  socketLocalAddress?: string
  socketLocalPort?: number
  error?: string
  durationMs?: number
}

export interface AgentTrace {
  proxyUrl: string
  proxyParsed: {
    userId: string | undefined
    userIdLength: number
    hasPassword: boolean
    host: string | undefined
    port: number | undefined
    type: number | undefined
  } | null
  connectionAttempts: AgentConnectionAttempt[]
  totalAttempts: number
}

/**
 * Создаёт SocksProxyAgent и оборачивает его `connect` чтобы зафиксировать
 * каждую попытку подключения. После запроса в trace будет видно: вызвался ли
 * connect вообще, к какому хосту открылся сокет, сколько занял SOCKS5 handshake.
 *
 * Главная диагностическая ценность: socketRemoteAddress показывает реальный
 * IP, к которому установлен сокет. Если это IP прокси (NodeMaven gate) — agent
 * работает; если IP целевого ifconfig.me — agent silently bypass.
 */
export function createTracedSocksAgent(
  proxyUrl: string,
): { agent: SocksProxyAgent; trace: AgentTrace } {
  const trace: AgentTrace = {
    proxyUrl: proxyUrl.replace(/:[^@:/]+@/, ":***@"),
    proxyParsed: null,
    connectionAttempts: [],
    totalAttempts: 0,
  }

  const agent = new SocksProxyAgent(proxyUrl)

  try {
    const proxy = (agent as unknown as { proxy?: Record<string, unknown> }).proxy
    if (proxy) {
      const userId = typeof proxy.userId === "string" ? proxy.userId : undefined
      const host = typeof proxy.host === "string" ? proxy.host : undefined
      const port = typeof proxy.port === "number" ? proxy.port : undefined
      const type = typeof proxy.type === "number" ? proxy.type : undefined
      const hasPassword =
        typeof proxy.password === "string" && (proxy.password as string).length > 0
      trace.proxyParsed = {
        userId,
        userIdLength: userId?.length ?? 0,
        hasPassword,
        host,
        port,
        type,
      }
    }
  } catch {
    trace.proxyParsed = null
  }

  const agentAny = agent as unknown as {
    connect?: (req: unknown, opts: Record<string, unknown>) => Promise<unknown>
  }
  const originalConnect = agentAny.connect?.bind(agent)
  if (originalConnect) {
    agentAny.connect = async function (req: unknown, opts: Record<string, unknown>) {
      const startTime = Date.now()
      const attempt: AgentConnectionAttempt = {
        timestamp: new Date().toISOString(),
        targetHost: String(opts?.hostname ?? opts?.host ?? "unknown"),
        targetPort: typeof opts?.port === "number" ? (opts.port as number) : 0,
        options: {
          method: opts?.method,
          path: opts?.path,
          hasAgent: !!opts?.agent,
        },
      }
      trace.connectionAttempts.push(attempt)
      trace.totalAttempts++

      try {
        const socket = await originalConnect(req, opts)
        attempt.durationMs = Date.now() - startTime
        if (socket instanceof net.Socket) {
          attempt.socketRemoteAddress = socket.remoteAddress
          attempt.socketRemotePort = socket.remotePort
          attempt.socketLocalAddress = socket.localAddress
          attempt.socketLocalPort = socket.localPort
        }
        return socket
      } catch (err) {
        attempt.durationMs = Date.now() - startTime
        attempt.error = err instanceof Error ? err.message : String(err)
        throw err
      }
    }
  }

  return { agent, trace }
}
