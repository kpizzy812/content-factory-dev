/**
 * Конфигурация известных сервисов: пороги low/critical для статуса,
 * человекочитаемые названия. Расширяется добавлением записи в массив.
 */

export interface ServiceConfig {
  /** Канонический ключ сервиса (используется как primary key в ServiceBalanceEntry) */
  key: string
  /** Человекочитаемое название для Telegram и админки */
  label: string
  /** Дефолтная валюта при первом вводе balance */
  defaultCurrency: string
  /** Под этим значением — status 'low' */
  lowThreshold: number
  /** Под этим значением — status 'critical' */
  criticalThreshold: number
  /** Подсказка где брать актуальное значение */
  dashboardHint?: string
}

export const KNOWN_SERVICES: ServiceConfig[] = [
  {
    key: "fal.ai",
    label: "fal.ai",
    defaultCurrency: "USD",
    lowThreshold: 5,
    criticalThreshold: 1,
    dashboardHint: "https://fal.ai/dashboard",
  },
  {
    key: "anthropic",
    label: "Anthropic Claude",
    defaultCurrency: "USD",
    lowThreshold: 10,
    criticalThreshold: 2,
    dashboardHint: "https://console.anthropic.com/settings/billing",
  },
  {
    key: "apify",
    label: "Apify",
    defaultCurrency: "USD",
    lowThreshold: 5,
    criticalThreshold: 1,
    dashboardHint: "https://console.apify.com/billing",
  },
  {
    key: "indigo",
    label: "Indigo Browser",
    defaultCurrency: "USD",
    lowThreshold: 10,
    criticalThreshold: 0,
    dashboardHint: "Indigo dashboard → Subscription",
  },
  {
    key: "nodemaven",
    label: "NodeMaven Proxy",
    defaultCurrency: "USD",
    lowThreshold: 5,
    criticalThreshold: 1,
    dashboardHint: "https://dashboard.nodemaven.com/profile/api",
  },
  {
    key: "mubert",
    label: "Mubert Music",
    defaultCurrency: "USD",
    lowThreshold: 5,
    criticalThreshold: 1,
    dashboardHint: "Mubert dashboard → Subscription",
  },
]

const SERVICE_MAP = new Map(KNOWN_SERVICES.map(s => [s.key, s]))

export function getServiceConfig(key: string): ServiceConfig | undefined {
  return SERVICE_MAP.get(key)
}

export function isKnownService(key: string): boolean {
  return SERVICE_MAP.has(key)
}
