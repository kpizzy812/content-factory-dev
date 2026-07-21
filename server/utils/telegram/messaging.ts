/**
 * Отправка и редактирование сообщений через Telegram Bot API.
 * Возвращает message_id для возможности последующего редактирования.
 *
 * При TELEGRAM_MOCK_MODE=true все вызовы только логируют payload в stdout
 * и возвращают синтетический message_id. Реальных HTTP-запросов не делается.
 */

import { isTelegramMockMode } from "../mock/mode"

const MAX_MESSAGE_LENGTH = 4096

let mockMessageCounter = 1

interface SendResult {
  messageId: number | null
  success: boolean
  error?: string
}

export async function sendMessage(
  token: string,
  chatId: string,
  text: string,
): Promise<SendResult> {
  if (isTelegramMockMode()) {
    void token
    const id = mockMessageCounter++
    const preview = text.replace(/\n/g, " ").slice(0, 120)
    console.log(`[telegram-mock] → chat=${chatId} message_id=${id}: ${preview}${text.length > 120 ? "…" : ""}`)
    return { messageId: id, success: true }
  }

  const chunks = splitMessage(text, MAX_MESSAGE_LENGTH)
  let lastMessageId: number | null = null

  for (const chunk of chunks) {
    try {
      const data = await $fetch<{ ok: boolean; result?: { message_id: number } }>(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: "POST",
          body: {
            chat_id: chatId,
            text: chunk,
            parse_mode: "HTML",
          },
          timeout: 10_000,
        },
      )

      if (data.ok && data.result) {
        lastMessageId = data.result.message_id
      }
    } catch {
      // Попытка без parse_mode при ошибке форматирования
      try {
        const data = await $fetch<{ ok: boolean; result?: { message_id: number } }>(
          `https://api.telegram.org/bot${token}/sendMessage`,
          {
            method: "POST",
            body: {
              chat_id: chatId,
              text: chunk,
            },
            timeout: 10_000,
          },
        )

        if (data.ok && data.result) {
          lastMessageId = data.result.message_id
        }
      } catch (err) {
        return {
          messageId: null,
          success: false,
          error: err instanceof Error ? err.message : "Ошибка отправки",
        }
      }
    }
  }

  return { messageId: lastMessageId, success: true }
}

/**
 * Редактирование уже отправленного сообщения.
 * Работает только для сообщений, отправленных ботом.
 */
export async function editMessage(
  token: string,
  chatId: string,
  messageId: number,
  text: string,
): Promise<SendResult> {
  if (isTelegramMockMode()) {
    void token
    console.log(`[telegram-mock] edit chat=${chatId} message_id=${messageId}: ${text.slice(0, 80)}…`)
    return { messageId, success: true }
  }

  try {
    const data = await $fetch<{ ok: boolean; result?: { message_id: number } }>(
      `https://api.telegram.org/bot${token}/editMessageText`,
      {
        method: "POST",
        body: {
          chat_id: chatId,
          message_id: messageId,
          text: text.slice(0, MAX_MESSAGE_LENGTH),
          parse_mode: "HTML",
        },
        timeout: 10_000,
      },
    )

    return {
      messageId: data.result?.message_id ?? messageId,
      success: data.ok,
    }
  } catch {
    // Попытка без parse_mode
    try {
      const data = await $fetch<{ ok: boolean; result?: { message_id: number } }>(
        `https://api.telegram.org/bot${token}/editMessageText`,
        {
          method: "POST",
          body: {
            chat_id: chatId,
            message_id: messageId,
            text: text.slice(0, MAX_MESSAGE_LENGTH),
          },
          timeout: 10_000,
        },
      )

      return {
        messageId: data.result?.message_id ?? messageId,
        success: data.ok,
      }
    } catch (err) {
      return {
        messageId: null,
        success: false,
        error: err instanceof Error ? err.message : "Ошибка редактирования",
      }
    }
  }
}

/**
 * Проверка валидности токена и получение информации о боте.
 */
export async function getBotInfo(token: string): Promise<{
  ok: boolean
  username?: string
  firstName?: string
  error?: string
}> {
  if (isTelegramMockMode()) {
    void token
    return { ok: true, username: "mock_zavod_bot", firstName: "Mock ZavodCamp" }
  }

  try {
    const data = await $fetch<{
      ok: boolean
      result?: { username: string; first_name: string }
    }>(`https://api.telegram.org/bot${token}/getMe`, { timeout: 10_000 })

    return {
      ok: data.ok,
      username: data.result?.username,
      firstName: data.result?.first_name,
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "API недоступен",
    }
  }
}

function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text]

  const chunks: string[] = []
  let remaining = text

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining)
      break
    }

    let splitIndex = remaining.lastIndexOf("\n", maxLength)
    if (splitIndex <= 0) splitIndex = maxLength

    chunks.push(remaining.slice(0, splitIndex))
    remaining = remaining.slice(splitIndex).trimStart()
  }

  return chunks
}
