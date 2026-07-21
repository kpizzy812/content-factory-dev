/**
 * /balance — показывает остатки по AI/прокси/музыки сервисам.
 * /balance set <service> <amount> [notes] — установить manual baseline (admin only).
 *
 * Авторизация:
 * - Show: TelegramChat.isAuthorized (любой привязанный пользователь)
 * - Set: ZavodUser.canAdmin (через TelegramChat.userId)
 */

import { sendMessage } from "../messaging"
import { fetchAllBalances } from "../../balance/aggregator"
import { formatBalancesForTelegram } from "../../balance/formatter"
import { isKnownService, KNOWN_SERVICES } from "../../balance/config"
import { invalidateBalanceCache } from "../../balance/aggregator"

interface TelegramFromUser {
  id: number
  first_name?: string
  username?: string
}

export async function cmdBalance(
  token: string,
  chatId: string,
  args: string,
  fromUser?: TelegramFromUser,
): Promise<void> {
  const chat = await prisma.telegramChat.findUnique({ where: { chatId } })
  if (!chat?.isAuthorized) {
    await sendMessage(token, chatId, "Аккаунт не привязан. Используйте /link ваш@email.com")
    return
  }

  const parts = args.trim().split(/\s+/).filter(Boolean)

  if (parts[0]?.toLowerCase() === "set") {
    await handleSet(token, chatId, parts.slice(1), chat.userId, fromUser)
    return
  }

  const balances = await fetchAllBalances()
  await sendMessage(token, chatId, formatBalancesForTelegram(balances))
}

async function handleSet(
  token: string,
  chatId: string,
  args: string[],
  chatUserId: number | null,
  fromUser?: TelegramFromUser,
): Promise<void> {
  if (args.length < 2) {
    const services = KNOWN_SERVICES.map(s => s.key).join(", ")
    await sendMessage(
      token,
      chatId,
      [
        "Использование: <code>/balance set &lt;service&gt; &lt;amount&gt; [заметка]</code>",
        "",
        "Пример: <code>/balance set fal.ai 50</code>",
        `Сервисы: ${services}`,
      ].join("\n"),
    )
    return
  }

  if (!chatUserId) {
    await sendMessage(token, chatId, "Аккаунт не привязан к ZavodUser. Используйте /link ваш@email.com")
    return
  }

  const user = await prisma.zavodUser.findUnique({
    where: { id: chatUserId },
    select: { id: true, email: true, canAdmin: true },
  })
  if (!user?.canAdmin) {
    await sendMessage(token, chatId, "🔒 Только администраторы могут устанавливать баланс.")
    return
  }

  const service = args[0]!.toLowerCase()
  if (!isKnownService(service)) {
    const services = KNOWN_SERVICES.map(s => s.key).join(", ")
    await sendMessage(token, chatId, `❌ Неизвестный сервис: <code>${service}</code>. Доступные: ${services}`)
    return
  }

  const amountRaw = args[1]!.replace(",", ".").replace(/[^\d.]/g, "")
  const amount = parseFloat(amountRaw)
  if (!Number.isFinite(amount) || amount < 0) {
    await sendMessage(
      token,
      chatId,
      `❌ Невалидная сумма: <code>${args[1]}</code>. Используйте число, например 50 или 12.50`,
    )
    return
  }

  const notes = args.slice(2).join(" ").trim() || null

  const entry = await prisma.serviceBalanceEntry.upsert({
    where: { service },
    create: {
      service,
      amount,
      currency: "USD",
      notes,
      enteredBy: user.id,
    },
    update: {
      amount,
      notes,
      enteredBy: user.id,
    },
  })

  invalidateBalanceCache()

  const ackLines = [
    `✅ Баланс <b>${service}</b> установлен: <code>$${amount.toFixed(2)}</code>`,
    notes ? `📝 ${escapeHtml(notes)}` : null,
    `Кто: ${escapeHtml(user.email)}${fromUser?.username ? ` (@${escapeHtml(fromUser.username)})` : ""}`,
    `Запись id=${entry.id}`,
  ].filter(Boolean)

  await sendMessage(token, chatId, ackLines.join("\n"))
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}
