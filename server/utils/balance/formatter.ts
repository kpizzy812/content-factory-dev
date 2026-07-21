/**
 * Форматирование балансов в текстовый/HTML вид.
 * Используется в Telegram /balance, daily alert, template variables.
 */

import type { ServiceBalance, BalanceSource } from "./types"
import { getServiceConfig } from "./config"

const STATUS_ICON: Record<ServiceBalance["status"], string> = {
  ok: "🟢",
  low: "🟡",
  critical: "🔴",
  error: "⚠️",
  unknown: "⚪",
}

const SOURCE_BADGE: Record<BalanceSource, string> = {
  api: "🤖",
  manual: "📝",
  estimate: "🧮",
  fallback: "⚠️",
}

export function sourceBadge(source: BalanceSource | undefined): string {
  return source ? SOURCE_BADGE[source] : ""
}

const SOURCE_LABEL: Record<BalanceSource, string> = {
  api: "API",
  manual: "Manual",
  estimate: "Estimate",
  fallback: "Fallback",
}

export function sourceLabel(source: BalanceSource | undefined): string {
  return source ? SOURCE_LABEL[source] : "—"
}

function formatAmount(b: ServiceBalance): string {
  if (b.balance) {
    return `${b.balance.amount.toFixed(2)} ${b.balance.currency}`
  }
  if (b.quota) {
    return `${b.quota.used}/${b.quota.limit} ${b.quota.unit}`
  }
  if (b.expiry) {
    return `${b.expiry.daysRemaining} дн. до окончания`
  }
  return "—"
}

function labelOf(b: ServiceBalance): string {
  const cfg = getServiceConfig(b.service)
  return cfg?.label ?? b.service
}

/**
 * Полный формат для Telegram /balance — HTML с эмодзи.
 * Telegram bot.ts использует parse_mode: HTML.
 */
export function formatBalancesForTelegram(balances: ServiceBalance[]): string {
  const lines: string[] = ["💰 <b>Баланс сервисов</b>", ""]

  for (const b of balances) {
    const icon = STATUS_ICON[b.status]
    const badge = sourceBadge(b.source)
    const label = labelOf(b)
    const value = formatAmount(b)
    let line = `${icon} ${badge} <b>${escapeHtml(label)}</b>: ${escapeHtml(value)}`
    if (b.status === "unknown" && b.error) {
      line += ` <i>(нет данных)</i>`
    } else if (b.error && b.status === "error") {
      line += ` <i>${escapeHtml(b.error.slice(0, 80))}</i>`
    } else if (b.enteredAt) {
      const age = humanizeAge(new Date(b.enteredAt))
      if (age) line += ` <i>(${age})</i>`
    }
    const daily = b.metadata?.burnRate?.dailyAvgUsd ?? 0
    if (daily > 0) {
      line += ` <i>(~$${daily.toFixed(2)}/д)</i>`
    }
    lines.push(line)
  }

  const usdTotal = balances
    .filter(b => b.balance?.currency === "USD" && b.status !== "error" && b.status !== "unknown")
    .reduce((sum, b) => sum + (b.balance?.amount ?? 0), 0)

  if (usdTotal > 0) {
    lines.push("", `<i>Итого USD: $${usdTotal.toFixed(2)}</i>`)
  }

  lines.push("", `<i>Проверено: ${new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}</i>`)

  return lines.join("\n")
}

/**
 * Компактный одной строкой — для подстановки в {{balance}} в template.
 * Без HTML, потому что после рендера может попасть в сообщение без HTML mode.
 */
export function formatBalancesCompact(balances: ServiceBalance[]): string {
  const parts = balances.map(b => {
    const icon = STATUS_ICON[b.status]
    const badge = sourceBadge(b.source)
    const label = labelOf(b)
    const value = formatAmount(b)
    return `${icon} ${badge} ${label}: ${value}`.replace(/\s+/g, " ").trim()
  })
  return parts.join(", ")
}

/**
 * Список сервисов с low/critical в строку через запятую.
 * Пустая строка если всё в порядке.
 */
export function formatLowServices(balances: ServiceBalance[]): string {
  const low = balances.filter(b => b.status === "low" || b.status === "critical")
  if (low.length === 0) return ""
  return low
    .map(b => {
      const label = labelOf(b)
      const value = formatAmount(b)
      return `${label}: ${value}`
    })
    .join(", ")
}

/**
 * Top-3 сервисов по dailyAvgUsd через запятую: "fal.ai $1.20/д, anthropic $0.45/д".
 * Пустая строка если нет ни одного с burnRate.dailyAvgUsd > 0.
 */
export function formatBurnRates(balances: ServiceBalance[]): string {
  const items = balances
    .map(b => ({
      label: labelOf(b),
      daily: b.metadata?.burnRate?.dailyAvgUsd ?? 0,
    }))
    .filter(x => x.daily > 0)
    .sort((a, b) => b.daily - a.daily)
    .slice(0, 3)

  if (items.length === 0) return ""
  return items.map(x => `${x.label} $${x.daily.toFixed(2)}/д`).join(", ")
}

/** Сумма USD по сервисам где есть balance в USD */
export function formatTotalUsd(balances: ServiceBalance[]): string {
  const total = balances
    .filter(b => b.balance?.currency === "USD" && b.status !== "error" && b.status !== "unknown")
    .reduce((sum, b) => sum + (b.balance?.amount ?? 0), 0)
  return `$${total.toFixed(2)}`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function humanizeAge(date: Date): string | null {
  const ms = Date.now() - date.getTime()
  const hours = Math.floor(ms / (60 * 60 * 1000))
  if (hours < 1) return "только что"
  if (hours < 24) return `${hours} ч. назад`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} дн. назад`
  return null
}
