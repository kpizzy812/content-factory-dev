/**
 * Роутер команд Telegram-бота.
 * Простые команды — здесь, сложные — в cmd-cycle.ts.
 * Все команды логируются в TelegramCommandAudit.
 */

import { sendMessage } from "./messaging"
import { cmdStop, cmdStartCycle } from "./cmd-cycle"
import { cmdBalance } from "./commands/balance"

interface TelegramFrom {
  id: number
  first_name?: string
  username?: string
}

export async function handleCommand(
  token: string,
  chatId: string,
  command: string,
  args: string,
  fromUser?: TelegramFrom,
): Promise<void> {
  let resultStatus = "success"
  let relatedEntityType: string | undefined
  let relatedEntityId: number | undefined
  let errorMessage: string | undefined

  try {
    switch (command) {
      case "/start":
        await cmdStart(token, chatId)
        break
      case "/link":
        await cmdLink(token, chatId, args)
        break
      case "/status":
        await cmdStatus(token, chatId)
        break
      case "/stop":
        await cmdStop(token, chatId)
        relatedEntityType = "cycle"
        break
      case "/start_cycle":
        await cmdStartCycle(token, chatId, args)
        relatedEntityType = "cycle"
        break
      case "/balance":
        await cmdBalance(token, chatId, args, fromUser)
        break
      case "/help":
        await cmdHelp(token, chatId)
        break
      default:
        await sendMessage(token, chatId, "Неизвестная команда. Используйте /help для списка.")
        resultStatus = "not_found"
    }
  } catch (err) {
    resultStatus = "error"
    errorMessage = err instanceof Error ? err.message : "Неизвестная ошибка"
  }

  // Аудит команды
  await prisma.telegramCommandAudit.create({
    data: {
      chatId,
      telegramUserId: fromUser ? String(fromUser.id) : null,
      telegramUsername: fromUser?.username ?? null,
      command,
      parsedArgs: args || null,
      resultStatus,
      relatedEntityType,
      relatedEntityId,
      errorMessage,
    },
  }).catch(() => {})
}

async function cmdStart(token: string, chatId: string): Promise<void> {
  const text = [
    "Добро пожаловать в Контент-Завод!",
    "",
    "Этот бот поможет вам:",
    "- Получать уведомления о циклах производства",
    "- Управлять циклами прямо из Telegram",
    "- Анализировать видео по ссылке",
    "",
    "Для начала привяжите аккаунт командой:",
    "/link ваш@email.com",
    "",
    "Полный список команд: /help",
  ].join("\n")

  await sendMessage(token, chatId, text)
}

async function cmdLink(token: string, chatId: string, args: string): Promise<void> {
  const email = args.trim().toLowerCase()

  if (!email || !email.includes("@")) {
    await sendMessage(token, chatId, "Укажите email: /link ваш@email.com")
    return
  }

  const user = await prisma.zavodUser.findUnique({
    where: { email },
  })

  if (!user) {
    await sendMessage(token, chatId, `Пользователь с email ${email} не найден в системе.`)
    return
  }

  await prisma.telegramChat.upsert({
    where: { chatId },
    create: { chatId, userId: user.id, alertsEnabled: true, isAuthorized: true },
    update: { userId: user.id, isAuthorized: true },
  })

  await prisma.zavodUser.update({
    where: { id: user.id },
    data: { telegramChatId: chatId },
  })

  const displayName = [user.name, user.surname].filter(Boolean).join(" ") || email
  await sendMessage(token, chatId, `Аккаунт привязан: ${displayName}. Уведомления включены.`)
}

async function cmdStatus(token: string, chatId: string): Promise<void> {
  const chat = await prisma.telegramChat.findUnique({
    where: { chatId },
  })

  if (!chat?.userId) {
    await sendMessage(token, chatId, "Аккаунт не привязан. Используйте /link ваш@email.com")
    return
  }

  const [runningCycle, lastCycle, unresolvedErrors, pendingIdeas] = await Promise.all([
    prisma.productionCycle.findFirst({
      where: { status: "running" },
      orderBy: { startedAt: "desc" },
      include: { app: { select: { name: true } } },
    }),
    prisma.productionCycle.findFirst({
      where: { status: { in: ["completed", "failed"] } },
      orderBy: { completedAt: "desc" },
      include: { app: { select: { name: true } } },
    }),
    prisma.agentLog.count({
      where: { level: "error", resolved: false },
    }),
    prisma.idea.count({
      where: { isDeleted: false, status: { in: ["pending", "processing"] } },
    }),
  ])

  const lines: string[] = ["📊 <b>Статус системы</b>", ""]

  if (runningCycle) {
    lines.push(
      `🏭 <b>Активный цикл:</b> #${runningCycle.id}`,
      `Приложение: ${runningCycle.app.name}`,
      `Запущен: ${runningCycle.startedAt.toLocaleString("ru-RU")}`,
      `Тренды: ${runningCycle.trendsFound} | Сценарии: ${runningCycle.scenariosGen}`,
      `Видео: ${runningCycle.videosGen} | Загрузки: ${runningCycle.uploadsCount}`,
    )
  } else {
    lines.push("Нет активных циклов.")
  }

  if (lastCycle) {
    const statusEmoji = lastCycle.status === "completed" ? "✅" : "❌"
    lines.push("", `${statusEmoji} <b>Последний цикл:</b> #${lastCycle.id} (${lastCycle.status})`)
    lines.push(`Приложение: ${lastCycle.app.name}`)
    if (lastCycle.completedAt) {
      lines.push(`Завершен: ${lastCycle.completedAt.toLocaleString("ru-RU")}`)
    }
    if (lastCycle.status === "failed" && lastCycle.errorMessage) {
      lines.push(`Ошибка: ${lastCycle.errorMessage.slice(0, 200)}`)
    }
  }

  if (unresolvedErrors > 0) {
    lines.push("", `⚠️ Нерешённых ошибок: ${unresolvedErrors}`)
  }

  if (pendingIdeas > 0) {
    lines.push(`📝 Идей в обработке: ${pendingIdeas}`)
  }

  await sendMessage(token, chatId, lines.join("\n"))
}

async function cmdHelp(token: string, chatId: string): Promise<void> {
  const text = [
    "<b>Команды Контент-Завода:</b>",
    "",
    "/start - Приветствие и начало работы",
    "/link email - Привязать Telegram к аккаунту",
    "/status - Статус системы, циклов и ошибок",
    "/balance - Остатки по AI-сервисам, прокси и музыке",
    "/balance set service amount [заметка] - Установить baseline (admin only)",
    "/stop - Остановить активный цикл",
    "/start_cycle id - Запустить цикл для приложения",
    "/help - Список команд",
    "",
    "📹 Отправьте ссылку на видео (YouTube, TikTok, Instagram) для AI-анализа и создания идеи.",
  ].join("\n")

  await sendMessage(token, chatId, text)
}
