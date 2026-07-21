import { sendTelegramAlert } from "./telegram/alerts"

type LogLevel = "info" | "warn" | "error"

/**
 * Записывает лог агента в таблицу AgentLog.
 * Используется оркестратором циклов и другими модулями.
 * При level=error дополнительно отправляет Telegram-алерт.
 */
export async function logAgent(
  module: string,
  level: LogLevel,
  message: string,
  details?: unknown,
  cycleId?: number,
): Promise<void> {
  await prisma.agentLog.create({
    data: {
      module,
      level,
      message,
      details: details ?? undefined,
      cycleId,
    },
  })

  if (level === "error") {
    await sendTelegramAlert(
      "critical_error",
      `[${module}] ${message}`,
      cycleId ? `Цикл: #${cycleId}` : undefined,
    ).catch(() => {})
  }
}
