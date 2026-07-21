/**
 * Telegram-алерты: структурированные уведомления с tracking доставки и routing.
 */

import { sendMessage } from "./messaging"

export type AlertType = "cycle_started" | "upload_success" | "critical_error" | "idea_created" | "test" | "custom"

const ALERT_EMOJI: Record<AlertType, string> = {
  cycle_started: "\u{1F3ED}",   // factory
  upload_success: "\u{2705}",   // check mark
  critical_error: "\u{1F6A8}",  // siren
  idea_created: "\u{1F4A1}",    // lightbulb
  test: "\u{1F50D}",            // magnifying glass
  custom: "\u{1F4AC}",          // speech balloon
}

const ALERT_TITLE: Record<AlertType, string> = {
  cycle_started: "Цикл запущен",
  upload_success: "Загрузка завершена",
  critical_error: "Критическая ошибка",
  idea_created: "Новая идея",
  test: "Тестовое сообщение",
  custom: "Уведомление",
}

interface AlertOptions {
  type: AlertType
  message: string
  details?: string
  relatedEntityType?: string
  relatedEntityId?: number
  templateId?: number
}

/**
 * Отправка структурированного алерта с tracking доставки.
 * Чаты фильтруются по routingTags (если заполнены) или получают всё (если пусты).
 */
export async function sendTelegramAlert(
  type: AlertType,
  message: string,
  details?: string,
): Promise<void> {
  await sendStructuredAlert({
    type,
    message,
    details,
  })
}

export async function sendStructuredAlert(opts: AlertOptions): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN || ""
  if (!token) return

  const chats = await prisma.telegramChat.findMany({
    where: { alertsEnabled: true },
  })

  if (chats.length === 0) return

  const emoji = ALERT_EMOJI[opts.type]
  const title = ALERT_TITLE[opts.type]

  const lines = [`${emoji} <b>${title}</b>`, "", opts.message]
  if (opts.details) {
    lines.push("", `<i>${opts.details}</i>`)
  }
  if (opts.relatedEntityType && opts.relatedEntityId) {
    lines.push("", `📎 ${opts.relatedEntityType} #${opts.relatedEntityId}`)
  }

  const text = lines.join("\n")

  // Фильтруем чаты по routingTags
  const targetChats = chats.filter((chat) => {
    if (chat.routingTags.length === 0) return true
    return chat.routingTags.includes(opts.type)
  })

  const deliveryPromises = targetChats.map(async (chat: { chatId: string }) => {
    // Создаём запись доставки
    const delivery = await prisma.telegramDelivery.create({
      data: {
        templateId: opts.templateId ?? null,
        eventType: opts.type,
        relatedEntityType: opts.relatedEntityType ?? null,
        relatedEntityId: opts.relatedEntityId ?? null,
        targetChatId: chat.chatId,
        status: "pending",
        messageText: text,
      },
    })

    try {
      const result = await sendMessage(token, chat.chatId, text)

      await prisma.telegramDelivery.update({
        where: { id: delivery.id },
        data: {
          status: result.success ? "sent" : "failed",
          telegramMessageId: result.messageId,
          errorMessage: result.error ?? null,
          sentAt: result.success ? new Date() : null,
        },
      })
    } catch (err) {
      await prisma.telegramDelivery.update({
        where: { id: delivery.id },
        data: {
          status: "failed",
          errorMessage: err instanceof Error ? err.message : "Неизвестная ошибка",
        },
      }).catch(() => {})
    }
  })

  await Promise.allSettled(deliveryPromises)
}

/**
 * Отправка сообщения по шаблону с подстановкой переменных.
 * Использует единый renderer из variable-registry.
 * Strict mode: если есть unresolved переменные — не отправляет.
 */
export async function sendTemplateAlert(
  templateKey: string,
  variables: Record<string, string>,
  opts?: {
    relatedEntityType?: string
    relatedEntityId?: number
    strict?: boolean
  },
): Promise<{ sent: boolean; error?: string; unresolvedVariables?: string[]; strippedExpressions?: string[] }> {
  const template = await prisma.telegramMessageTemplate.findUnique({
    where: { key: templateKey },
  })

  if (!template || !template.isActive) {
    return { sent: false, error: `Шаблон '${templateKey}' не найден или неактивен` }
  }

  const { renderTemplate } = await import("./variable-registry")
  const { enrichVariablesWithBalance } = await import("../balance/enrich-variables")

  const enriched = await enrichVariablesWithBalance(template.messageBody, variables)

  const { text, unresolvedVariables, strippedExpressions } = renderTemplate(
    template.messageBody,
    enriched,
    { strict: opts?.strict },
  )

  if (unresolvedVariables.length > 0) {
    console.warn(
      `[telegram] Шаблон '${templateKey}': неразрешённые переменные: ${unresolvedVariables.join(", ")}`,
    )

    // Strict mode: блокируем отправку с unresolved переменными
    if (opts?.strict) {
      return {
        sent: false,
        error: `Шаблон содержит неразрешённые переменные: ${unresolvedVariables.join(", ")}`,
        unresolvedVariables,
        strippedExpressions: strippedExpressions.length > 0 ? strippedExpressions : undefined,
      }
    }
  }

  const categoryToAlertType: Record<string, AlertType> = {
    alert: "critical_error",
    notification: "custom",
    report: "custom",
    custom: "custom",
  }

  await sendStructuredAlert({
    type: categoryToAlertType[template.category] ?? "custom",
    message: text,
    templateId: template.id,
    relatedEntityType: opts?.relatedEntityType,
    relatedEntityId: opts?.relatedEntityId,
  })

  return {
    sent: true,
    unresolvedVariables: unresolvedVariables.length > 0 ? unresolvedVariables : undefined,
    strippedExpressions: strippedExpressions.length > 0 ? strippedExpressions : undefined,
  }
}
