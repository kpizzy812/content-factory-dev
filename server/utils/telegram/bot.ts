/**
 * Ядро Telegram-бота: long polling, роутинг команд.
 * Запускается только при наличии TELEGRAM_BOT_TOKEN.
 *
 * Используем globalThis для singleton-состояния polling.
 * При HMR модуль перезагружается, но globalThis сохраняется —
 * это гарантирует единственный polling consumer.
 */

import { handleCommand } from "./commands"
import { analyzeVideoByUrl } from "./analyzer"
import { sendMessage } from "./messaging"

interface TelegramUpdate {
  update_id: number
  message?: {
    chat: { id: number; type?: string; title?: string; username?: string }
    text?: string
    from?: { id: number; first_name?: string; username?: string }
    message_id?: number
  }
}

interface TelegramBotState {
  pollingInterval: ReturnType<typeof setInterval> | null
  recoveryTimeout: ReturnType<typeof setTimeout> | null
  lastUpdateId: number
  lastSuccessfulUpdate: Date | null
  lastError: string | null
  lastErrorCategory: "conflict" | "auth" | "network" | "unknown" | null
  conflictCount: number
}

const G = globalThis as typeof globalThis & { __telegramBot?: TelegramBotState }

if (!G.__telegramBot) {
  G.__telegramBot = {
    pollingInterval: null,
    recoveryTimeout: null,
    lastUpdateId: 0,
    lastSuccessfulUpdate: null,
    lastError: null,
    lastErrorCategory: null,
    conflictCount: 0,
  }
}

const s = G.__telegramBot

function classifyPollingError(err: unknown): { message: string; category: "conflict" | "auth" | "network" | "unknown" } {
  const msg = err instanceof Error ? err.message : String(err)

  if (msg.includes("409") || msg.includes("Conflict")) {
    return {
      message: "Конфликт polling: другой процесс получает обновления этого бота. При dev-разработке это нормально после HMR.",
      category: "conflict",
    }
  }
  if (msg.includes("401") || msg.includes("Unauthorized")) {
    return { message: "Токен бота невалиден или отозван", category: "auth" }
  }
  if (msg.includes("timeout") || msg.includes("ETIMEDOUT") || msg.includes("ECONNREFUSED")) {
    return { message: "Telegram API недоступен — проверьте сетевое подключение", category: "network" }
  }
  return { message: msg, category: "unknown" }
}

async function getUpdates(token: string, offset: number): Promise<TelegramUpdate[]> {
  try {
    const data = await $fetch<{ ok: boolean; result: TelegramUpdate[] }>(
      `https://api.telegram.org/bot${token}/getUpdates`,
      {
        params: { offset, timeout: 1, allowed_updates: JSON.stringify(["message"]) },
        timeout: 10_000,
      },
    )

    if (data.ok) {
      s.lastSuccessfulUpdate = new Date()
      s.lastError = null
      s.lastErrorCategory = null
      s.conflictCount = 0
    }

    return data.ok ? data.result : []
  } catch (err) {
    const classified = classifyPollingError(err)
    s.lastError = classified.message
    s.lastErrorCategory = classified.category

    if (classified.category === "conflict") {
      s.conflictCount++
      // После 5 конфликтов подряд — пауза 30 сек, затем auto-recovery
      if (s.conflictCount >= 5 && !s.recoveryTimeout) {
        console.warn("[Telegram Bot] Пауза polling на 30 сек (конфликт). Автовосстановление.")
        clearPolling()
        s.recoveryTimeout = setTimeout(() => {
          s.recoveryTimeout = null
          s.conflictCount = 0
          startBot()
        }, 30_000)
      }
    } else {
      s.conflictCount = 0
    }

    return []
  }
}

const URL_REGEX = /https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be|tiktok\.com|instagram\.com|vm\.tiktok\.com)\S+/i

async function handleUpdate(token: string, update: TelegramUpdate): Promise<void> {
  const message = update.message
  if (!message?.text) return

  const chatId = String(message.chat.id)
  const text = message.text.trim()
  const fromUser = message.from

  await ensureChatRecord(chatId, message.chat)

  if (text.startsWith("/")) {
    const parts = text.split(/\s+/)
    const command = (parts[0] ?? "").toLowerCase().replace(/@\S+$/, "")
    const args = parts.slice(1).join(" ")

    await handleCommand(token, chatId, command, args, fromUser)
    return
  }

  const urlMatch = text.match(URL_REGEX)
  if (urlMatch) {
    await processVideoUrl(token, chatId, urlMatch[0], fromUser)
    return
  }

  await sendMessage(
    token,
    chatId,
    "Отправьте ссылку на видео (YouTube, TikTok, Instagram) для анализа или используйте /help для списка команд.",
  )
}

async function processVideoUrl(
  token: string,
  chatId: string,
  url: string,
  fromUser?: { id: number; first_name?: string; username?: string },
): Promise<void> {
  const statusResult = await sendMessage(token, chatId, "Анализирую видео, подождите...")

  try {
    const lower = url.toLowerCase()
    let platform: 'youtube' | 'tiktok' | 'instagram' | undefined
    if (lower.includes('youtube.com') || lower.includes('youtu.be')) platform = 'youtube'
    else if (lower.includes('tiktok.com') || lower.includes('vm.tiktok.com')) platform = 'tiktok'
    else if (lower.includes('instagram.com')) platform = 'instagram'

    let createdById: number | null = null
    const chat = await prisma.telegramChat.findUnique({ where: { chatId } })
    if (chat?.userId) createdById = chat.userId

    const existing = await prisma.idea.findFirst({
      where: { sourceUrl: url, isDeleted: false },
    })

    if (existing) {
      const statusText = existing.status === 'ready'
        ? 'готова к сценарию'
        : existing.status === 'processing'
          ? 'обрабатывается'
          : existing.status

      await sendMessage(token, chatId, `Идея с таким URL уже существует (ID: ${existing.id}, статус: ${statusText}).`)
      return
    }

    const idea = await prisma.idea.create({
      data: {
        source: 'telegram',
        sourceUrl: url,
        platform: platform ?? null,
        language: 'русский',
        status: 'pending',
        createdById,
      },
    })

    await prisma.ideaOperatorAction.create({
      data: {
        ideaId: idea.id,
        actionType: 'create',
        actorId: createdById,
        reason: `Создана из Telegram (chat: ${chatId})`,
      },
    }).catch(() => {})

    processIdea(idea.id).catch(() => {})

    const quickAnalysis = await analyzeVideoByUrl(url)

    const responseLines = [
      `Идея #${idea.id} создана и поставлена в очередь обработки.`,
      "",
      quickAnalysis,
      "",
      `Полный анализ будет доступен в системе после обработки.`,
    ]

    await sendMessage(token, chatId, responseLines.join("\n"))

    await prisma.telegramCommandAudit.create({
      data: {
        chatId,
        telegramUserId: fromUser ? String(fromUser.id) : null,
        telegramUsername: fromUser?.username ?? null,
        command: 'video_url',
        parsedArgs: url,
        resultStatus: 'success',
        relatedEntityType: 'idea',
        relatedEntityId: idea.id,
      },
    }).catch(() => {})
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Неизвестная ошибка"
    await sendMessage(
      token,
      chatId,
      `Не удалось обработать видео: ${errorMsg}\n\nПопробуйте позже или обратитесь к администратору.`,
    )
  }
}

async function ensureChatRecord(
  chatId: string,
  chatMeta: { type?: string; title?: string; username?: string },
): Promise<void> {
  try {
    await prisma.telegramChat.upsert({
      where: { chatId },
      create: {
        chatId,
        chatType: chatMeta.type ?? 'private',
        title: chatMeta.title ?? null,
        username: chatMeta.username ?? null,
      },
      update: {
        chatType: chatMeta.type ?? 'private',
        title: chatMeta.title ?? undefined,
        username: chatMeta.username ?? undefined,
      },
    })
  } catch {
    // Не блокируем основной поток
  }
}

function clearPolling(): void {
  if (s.pollingInterval) {
    clearInterval(s.pollingInterval)
    s.pollingInterval = null
  }
}

export async function startBot(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN || ""
  if (!token) return

  // Останавливаем всё предыдущее — критично для HMR
  clearPolling()
  if (s.recoveryTimeout) {
    clearTimeout(s.recoveryTimeout)
    s.recoveryTimeout = null
  }

  s.conflictCount = 0
  s.lastError = null
  s.lastErrorCategory = null

  s.pollingInterval = setInterval(async () => {
    const updates = await getUpdates(token, s.lastUpdateId + 1)
    for (const update of updates) {
      s.lastUpdateId = update.update_id
      try {
        await handleUpdate(token, update)
      } catch {
        // Не падаем из-за одного невалидного update
      }
    }
  }, 3000)
}

export function stopBot(): void {
  clearPolling()
}

export async function restartBot(): Promise<void> {
  stopBot()
  if (s.recoveryTimeout) {
    clearTimeout(s.recoveryTimeout)
    s.recoveryTimeout = null
  }
  s.conflictCount = 0
  s.lastError = null
  s.lastErrorCategory = null
  await startBot()
}

export function isBotRunning(): boolean {
  return s.pollingInterval !== null
}

export function getBotHealth(): {
  running: boolean
  lastSuccessfulUpdate: Date | null
  lastError: string | null
  lastErrorCategory: "conflict" | "auth" | "network" | "unknown" | null
} {
  return {
    running: isBotRunning(),
    lastSuccessfulUpdate: s.lastSuccessfulUpdate,
    lastError: s.lastError,
    lastErrorCategory: s.lastErrorCategory,
  }
}
