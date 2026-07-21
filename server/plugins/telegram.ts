/**
 * Nitro-плагин для запуска Telegram-бота.
 * Бот стартует только при наличии TELEGRAM_BOT_TOKEN.
 */

import { startBot, stopBot } from "../utils/telegram/bot"

export default defineNitroPlugin((nitro) => {
  // Гейт scheduler'ов (тестовая инфраструктура). См. .env.test.
  if (process.env.SCHEDULERS_ENABLED === "false") return

  startBot()

  nitro.hooks.hook("close", () => {
    stopBot()
  })
})
