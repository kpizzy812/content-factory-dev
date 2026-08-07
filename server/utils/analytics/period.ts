/**
 * Период и отбор для экранов аналитики.
 *
 * Один разбор запроса на все четыре endpoint'а сквозной аналитики: воронку,
 * рейтинги, динамику и разбор публикации. Разъезжаться им нельзя — иначе
 * «за 7 дней» в воронке и «за 7 дней» в рейтингах окажутся разными неделями.
 *
 * Предыдущее окно считается той же длины и вплотную к текущему: дельта в KPI
 * сравнивает неделю с неделей, а не неделю с месяцем.
 */

import type { AnalyticsPeriod, AnalyticsPeriodPreset } from '~~/shared/types/analytics-funnel'

export type AnalyticsPlatform = 'tiktok' | 'instagram' | 'youtube'

const PLATFORMS: AnalyticsPlatform[] = ['tiktok', 'instagram', 'youtube']

const PRESET_HOURS: Record<Exclude<AnalyticsPeriodPreset, 'custom'>, number> = {
  '24h': 24,
  '7d': 24 * 7,
  '30d': 24 * 30,
}

export interface AnalyticsScope {
  from: Date
  to: Date
  previousFrom: Date
  previousTo: Date
  preset: AnalyticsPeriodPreset
  appId: number | null
  platform: AnalyticsPlatform | null
  socialAccountId: number | null
  pipelineId: number | null
  runId: number | null
}

function positiveInt(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * Разбирает query-параметры. Мусор молча отбрасывается — экран аналитики
 * читает адресную строку, и опечатка в ней не должна ронять запрос.
 */
export function parseAnalyticsScope(query: Record<string, unknown>): AnalyticsScope {
  const now = new Date()

  const explicitFrom = parseDate(query.dateFrom)
  const explicitTo = parseDate(query.dateTo)

  let preset: AnalyticsPeriodPreset = '7d'
  const presetRaw = String(query.period ?? '').trim()
  if (presetRaw === '24h' || presetRaw === '7d' || presetRaw === '30d') preset = presetRaw

  let from: Date
  let to: Date
  if (explicitFrom || explicitTo) {
    preset = 'custom'
    to = explicitTo ?? now
    from = explicitFrom ?? new Date(to.getTime() - PRESET_HOURS['7d'] * 3_600_000)
  } else {
    to = now
    from = new Date(to.getTime() - PRESET_HOURS[preset as Exclude<AnalyticsPeriodPreset, 'custom'>] * 3_600_000)
  }

  if (from.getTime() > to.getTime()) [from, to] = [to, from]

  const length = Math.max(3_600_000, to.getTime() - from.getTime())
  const previousTo = new Date(from.getTime())
  const previousFrom = new Date(from.getTime() - length)

  const platformRaw = String(query.platform ?? '').trim() as AnalyticsPlatform
  const platform = PLATFORMS.includes(platformRaw) ? platformRaw : null

  return {
    from,
    to,
    previousFrom,
    previousTo,
    preset,
    appId: positiveInt(query.appId),
    platform,
    socialAccountId: positiveInt(query.socialAccountId),
    pipelineId: positiveInt(query.pipelineId),
    runId: positiveInt(query.runId),
  }
}

export function periodToDto(scope: AnalyticsScope): AnalyticsPeriod {
  return {
    from: scope.from.toISOString(),
    to: scope.to.toISOString(),
    preset: scope.preset,
    previousFrom: scope.previousFrom.toISOString(),
    previousTo: scope.previousTo.toISOString(),
  }
}

/** Окно предыдущего периода как самостоятельный отбор. */
export function previousScope(scope: AnalyticsScope): AnalyticsScope {
  return { ...scope, from: scope.previousFrom, to: scope.previousTo }
}

/**
 * Отбор по площадке или аккаунту не сужает стадии производства: тренд,
 * сценарий и ролик не принадлежат площадке, а один ролик уходит сразу на
 * несколько аккаунтов. Про это интерфейс говорит прямо под воронкой.
 */
export function hasPublicationOnlyFilters(scope: AnalyticsScope): boolean {
  return scope.platform !== null || scope.socialAccountId !== null
}
