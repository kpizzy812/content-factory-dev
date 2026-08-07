/**
 * Команды управления циклами через Telegram-бот.
 * /stop — остановить running цикл
 * /start_cycle — запустить новый цикл
 */

import { sendMessage } from "./messaging"
import { requestCycleStop } from "../cycle-orchestrator"

/**
 * Получает привязанного пользователя по chatId.
 * Возвращает null если чат не привязан или пользователь не найден.
 */
export async function getLinkedUser(chatId: string) {
  const chat = await prisma.telegramChat.findUnique({
    where: { chatId },
  })

  if (!chat?.userId) return null

  return prisma.zavodUser.findUnique({
    where: { id: chat.userId },
  })
}

export async function cmdStop(token: string, chatId: string): Promise<void> {
  const user = await getLinkedUser(chatId)

  if (!user) {
    await sendMessage(token, chatId, "Аккаунт не привязан. Используйте /link ваш@email.com")
    return
  }

  if (!user.canRunAgent) {
    await sendMessage(token, chatId, "У вас нет прав для остановки циклов (требуется canRunAgent).")
    return
  }

  const runningCycle = await prisma.productionCycle.findFirst({
    where: { status: { in: ["running", "pending"] } },
    orderBy: { startedAt: "desc" },
  })

  if (!runningCycle) {
    // Повторный /stop: цикл уже не активен, менять нечего.
    await sendMessage(token, chatId, "Нет активных циклов для остановки.")
    return
  }

  // Сначала статус в БД: его читает оркестратор между шагами (в том числе если
  // цикл крутится в другом процессе), и по нему же он поймёт, что закрывать
  // цикл надо как stopped, а не completed.
  await prisma.productionCycle.update({
    where: { id: runningCycle.id },
    data: {
      status: "stopped",
      completedAt: new Date(),
    },
  })

  // Затем сигнал в память: он прерывает текущий шаг немедленно и гасит уже
  // запущенные внешние генерации, не дожидаясь следующей проверки статуса.
  requestCycleStop(runningCycle.id)

  await logAgent(
    "telegram",
    "info",
    `Цикл #${runningCycle.id} остановлен через Telegram пользователем #${user.id}`,
    { cycleId: runningCycle.id, userId: user.id },
    runningCycle.id,
  )

  await sendMessage(token, chatId, `Цикл #${runningCycle.id} остановлен.`)
}

export async function cmdStartCycle(token: string, chatId: string, args: string): Promise<void> {
  const user = await getLinkedUser(chatId)

  if (!user) {
    await sendMessage(token, chatId, "Аккаунт не привязан. Используйте /link ваш@email.com")
    return
  }

  if (!user.canRunAgent) {
    await sendMessage(token, chatId, "У вас нет прав для запуска циклов (требуется canRunAgent).")
    return
  }

  const appId = Number(args.trim())
  if (!appId || isNaN(appId)) {
    await sendMessage(token, chatId, "Укажите ID приложения: /start_cycle 1")
    return
  }

  const app = await prisma.app.findUnique({ where: { id: appId } })
  if (!app) {
    await sendMessage(token, chatId, `Приложение с ID ${appId} не найдено.`)
    return
  }

  const cycle = await prisma.productionCycle.create({
    data: {
      appId,
      startedById: user.id,
    },
  })

  // Fire-and-forget запуск
  startCycle(cycle.id).catch(() => {})

  await sendMessage(
    token,
    chatId,
    `Цикл #${cycle.id} запущен для приложения "${app.name}".`,
  )
}
