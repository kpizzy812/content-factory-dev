/**
 * Token-bucket rate limiter для постинг-провайдера. Device-нейтрален (R3).
 *
 * Класс-механизм провайдеро-агностичен (чистый token-bucket по RPM). До Этапа 3
 * единственный потребитель — Indigo client.ts (выпиливается в R5). На Этапе 3
 * под DuoPlus REST/ADB лимит ~1 QPS (60 RPM) — конфигурируется через maxRpm при
 * инстанцировании, тело класса менять не нужно.
 *
 * Алгоритм:
 * - Bucket capacity = maxTokens (= maxRpm).
 * - Refill rate = 1 token / (60_000 / maxRpm) ms.
 * - acquire() ждёт пока tokens >= 1, забирает 1.
 *
 * Безопасный для конкурентных вызовов (sequential await chain в одном process).
 */

export interface ProviderRateLimiterOptions {
  maxRpm: number
}

export class ProviderRateLimiter {
  private tokens: number
  private readonly maxTokens: number
  private readonly refillIntervalMs: number
  private lastRefillAt: number

  constructor(opts: ProviderRateLimiterOptions) {
    if (opts.maxRpm <= 0) {
      throw new Error("ProviderRateLimiter: maxRpm must be > 0")
    }
    this.maxTokens = opts.maxRpm
    this.tokens = opts.maxRpm
    this.refillIntervalMs = 60_000 / opts.maxRpm
    this.lastRefillAt = Date.now()
  }

  async acquire(): Promise<void> {
    this.refill()
    while (this.tokens < 1) {
      const waitMs = Math.max(this.refillIntervalMs, 10)
      await new Promise((resolve) => setTimeout(resolve, waitMs))
      this.refill()
    }
    this.tokens -= 1
  }

  private refill(): void {
    const now = Date.now()
    const elapsed = now - this.lastRefillAt
    if (elapsed <= 0) return
    const refillCount = Math.floor(elapsed / this.refillIntervalMs)
    if (refillCount > 0) {
      this.tokens = Math.min(this.maxTokens, this.tokens + refillCount)
      this.lastRefillAt += refillCount * this.refillIntervalMs
    }
  }

  // Для тестов / диагностики
  snapshot(): { tokens: number; maxTokens: number } {
    this.refill()
    return { tokens: this.tokens, maxTokens: this.maxTokens }
  }
}
