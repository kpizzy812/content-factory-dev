/**
 * Состояние внешних интеграций.
 *
 * Отвечает на вопрос «работает ли оно», а не «какой там ключ»: ключи живут в
 * окружении и в интерфейс не выводятся ни целиком, ни маской — это записанное
 * решение. Здесь только три факта на сервис: настроен ли, отвечает ли и когда
 * проверяли.
 *
 * Проверки бесплатные: у каждого сервиса берётся endpoint, который не
 * тарифицируется и не расходует токены (`/v1/models` у Anthropic, `/v1/account`
 * у Replicate, `getMe` у Telegram, `users/me` у Apify). Генерации здесь нет и
 * быть не может — иначе кнопка «Проверить все» стоила бы денег.
 *
 * Мок-режим сервиса — не «сломано» и не «работает»: это стенд, и честнее
 * сказать прямо, что настоящий ключ не проверялся.
 */

import { describeStorageDriver } from '../storage/index'
import { getUploadsBase } from '../storage-paths'

export type IntegrationState = 'ok' | 'error' | 'not_configured' | 'mock' | 'skipped'

export interface IntegrationHealth {
  key: string
  label: string
  /** Что ломается, если сервис недоступен. */
  purpose: string
  state: IntegrationState
  /** Человеческое пояснение состояния. */
  detail: string
  /** Сколько заняла проверка, мс. null — проверки не было. */
  durationMs: number | null
  checkedAt: string
}

const PROBE_TIMEOUT_MS = 6000

interface ServiceSpec {
  key: string
  label: string
  purpose: string
  envVar: string
  mockEnvVar?: string
  probe: (token: string) => Promise<{ ok: boolean; detail: string }>
}

/** Запрос с жёстким таймаутом: висящая проверка хуже проваленной. */
async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  }
  finally {
    clearTimeout(timer)
  }
}

function describeHttp(response: Response): string {
  if (response.ok) return `ответил ${response.status}`
  if (response.status === 401 || response.status === 403) return `ключ отклонён (${response.status})`
  if (response.status === 429) return 'превышен лимит запросов (429)'
  return `ответил ${response.status}`
}

const SERVICES: ServiceSpec[] = [
  {
    key: 'anthropic',
    label: 'Anthropic',
    purpose: 'сценарии и критик',
    envVar: 'ANTHROPIC_API_KEY',
    mockEnvVar: 'ANTHROPIC_MOCK_MODE',
    async probe(token) {
      const response = await fetchWithTimeout('https://api.anthropic.com/v1/models?limit=1', {
        headers: { 'x-api-key': token, 'anthropic-version': '2023-06-01' },
      })
      return { ok: response.ok, detail: describeHttp(response) }
    },
  },
  {
    key: 'replicate',
    label: 'Replicate',
    purpose: 'генерация видео и lip-sync',
    envVar: 'REPLICATE_API_TOKEN',
    mockEnvVar: 'REPLICATE_MOCK_MODE',
    async probe(token) {
      const response = await fetchWithTimeout('https://api.replicate.com/v1/account', {
        headers: { Authorization: `Bearer ${token}` },
      })
      return { ok: response.ok, detail: describeHttp(response) }
    },
  },
  {
    key: 'fal.ai',
    label: 'fal.ai',
    purpose: 'кадры и клипы',
    envVar: 'FAL_KEY',
    mockEnvVar: 'FAL_MOCK_MODE',
    async probe(token) {
      // Бесплатного «кто я» у fal нет; берём справочник моделей — он не
      // тарифицируется и отвечает 401 на неверный ключ.
      const response = await fetchWithTimeout('https://rest.alpha.fal.ai/tokens/', {
        method: 'GET',
        headers: { Authorization: `Key ${token}` },
      })
      return { ok: response.ok, detail: describeHttp(response) }
    },
  },
  {
    key: 'apify',
    label: 'Apify',
    purpose: 'парсинг трендов',
    envVar: 'APIFY_TOKEN',
    async probe(token) {
      const response = await fetchWithTimeout(
        `https://api.apify.com/v2/users/me?token=${encodeURIComponent(token)}`,
      )
      return { ok: response.ok, detail: describeHttp(response) }
    },
  },
  {
    key: 'telegram',
    label: 'Telegram',
    purpose: 'уведомления и бот',
    envVar: 'TELEGRAM_BOT_TOKEN',
    mockEnvVar: 'TELEGRAM_MOCK_MODE',
    async probe(token) {
      const response = await fetchWithTimeout(`https://api.telegram.org/bot${token}/getMe`)
      if (!response.ok) return { ok: false, detail: describeHttp(response) }
      const body = await response.json().catch(() => null) as { result?: { username?: string } } | null
      const username = body?.result?.username
      return { ok: true, detail: username ? `бот @${username}` : 'ответил 200' }
    },
  },
]

/** Хранилище проверяется локально: сеть тут ни при чём. */
async function checkStorage(): Promise<Omit<IntegrationHealth, 'checkedAt'>> {
  const started = Date.now()
  const driver = describeStorageDriver()
  const driverLabel = driver.provider === 'gcs' ? `GCS ${driver.bucketName ?? ''}`.trim() : driver.provider === 'local' ? `локальный диск` : driver.provider
  try {
    const { stat } = await import('node:fs/promises')
    const base = getUploadsBase()
    const info = await stat(base)
    return {
      key: 'storage',
      label: 'Хранилище',
      purpose: 'готовые ролики и кадры',
      state: info.isDirectory() ? 'ok' : 'error',
      detail: info.isDirectory() ? `${driverLabel}, каталог на месте` : `${driverLabel}, ${base} не каталог`,
      durationMs: Date.now() - started,
    }
  }
  catch (err) {
    return {
      key: 'storage',
      label: 'Хранилище',
      purpose: 'готовые ролики и кадры',
      state: 'error',
      detail: `${driverLabel}: ${err instanceof Error ? err.message : 'каталог недоступен'}`,
      durationMs: Date.now() - started,
    }
  }
}

async function checkService(spec: ServiceSpec): Promise<Omit<IntegrationHealth, 'checkedAt'>> {
  const base = { key: spec.key, label: spec.label, purpose: spec.purpose }
  const token = (process.env[spec.envVar] ?? '').trim()

  if (spec.mockEnvVar && process.env[spec.mockEnvVar] === 'true') {
    return {
      ...base,
      state: 'mock',
      detail: `${spec.mockEnvVar}=true — обращений наружу нет, настоящий ключ не проверялся`,
      durationMs: null,
    }
  }

  if (!token) {
    return {
      ...base,
      state: 'not_configured',
      detail: `${spec.envVar} не задан`,
      durationMs: null,
    }
  }

  const started = Date.now()
  try {
    const result = await spec.probe(token)
    return {
      ...base,
      state: result.ok ? 'ok' : 'error',
      detail: result.detail,
      durationMs: Date.now() - started,
    }
  }
  catch (err) {
    const message = err instanceof Error ? err.message : 'нет ответа'
    return {
      ...base,
      state: 'error',
      detail: message.includes('abort') ? `не ответил за ${PROBE_TIMEOUT_MS / 1000} с` : message,
      durationMs: Date.now() - started,
    }
  }
}

export interface IntegrationsHealth {
  services: IntegrationHealth[]
  okCount: number
  total: number
  checkedAt: string
}

/** Проверяет все интеграции параллельно. Одна упавшая не роняет остальные. */
export async function checkIntegrations(): Promise<IntegrationsHealth> {
  const checkedAt = new Date().toISOString()
  const results = await Promise.all([
    ...SERVICES.map(spec => checkService(spec)),
    checkStorage(),
  ])

  const services = results.map(result => ({ ...result, checkedAt }))
  return {
    services,
    okCount: services.filter(s => s.state === 'ok').length,
    total: services.length,
    checkedAt,
  }
}
