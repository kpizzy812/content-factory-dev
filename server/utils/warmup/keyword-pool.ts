/**
 * Загрузка пула ключевых слов для warmup-планов.
 *
 * Стратегия:
 * 1. Если приложение задано — пробуем найти активные пулы для appId с language/platform.
 * 2. Fallback: глобальные пулы (appId IS NULL) с тем же language/platform/category.
 * 3. Final fallback: ['fyp', 'foryou'] — гарантирует, что planner не упадёт.
 *
 * loadKeywordPoolForAccount возвращает массив строк (объединённый keywords всех
 * подходящих пулов с дедупом).
 */

import type { Platform } from "~~/app/generated/prisma/client"
import { prisma } from "../prisma"

export interface LoadKeywordPoolOptions {
  /** ID приложения, к которому привязан аккаунт. null = только глобальные пулы. */
  appId?: number | null
  /** Язык контента ('ru' | 'en' | null = любой). */
  language?: string | null
  /** Платформа аккаунта (для фильтрации specific pools). */
  platform?: Platform | null
  /** Категория ('general' | 'tech' | ...). null = любая. */
  category?: string | null
}

const FALLBACK_KEYWORDS: readonly string[] = ["fyp", "foryou"]

export async function loadKeywordPoolForAccount(
  opts: LoadKeywordPoolOptions,
): Promise<string[]> {
  // Приоритет 1: пулы для конкретного приложения
  let pools: { keywords: string[] }[] = []
  if (opts.appId) {
    pools = await prisma.warmupKeywordPool.findMany({
      where: {
        appId: opts.appId,
        isActive: true,
        ...(opts.language ? { language: opts.language } : {}),
        ...(opts.category ? { category: opts.category } : {}),
        ...(opts.platform
          ? { OR: [{ platform: opts.platform }, { platform: null }] }
          : {}),
      },
      select: { keywords: true },
    })
  }

  // Fallback 1: глобальные пулы (appId IS NULL)
  if (pools.length === 0) {
    pools = await prisma.warmupKeywordPool.findMany({
      where: {
        appId: null,
        isActive: true,
        ...(opts.language ? { language: opts.language } : {}),
        ...(opts.category ? { category: opts.category } : {}),
        ...(opts.platform
          ? { OR: [{ platform: opts.platform }, { platform: null }] }
          : {}),
      },
      select: { keywords: true },
    })
  }

  // Если language задан, но пулы пусты — пробуем без language (универсальные)
  if (pools.length === 0 && opts.language) {
    pools = await prisma.warmupKeywordPool.findMany({
      where: {
        appId: null,
        isActive: true,
        language: null,
        ...(opts.category ? { category: opts.category } : {}),
      },
      select: { keywords: true },
    })
  }

  // Дедуп слиянием
  const seen = new Set<string>()
  const result: string[] = []
  for (const pool of pools) {
    for (const kw of pool.keywords) {
      const trimmed = kw.trim()
      if (trimmed && !seen.has(trimmed)) {
        seen.add(trimmed)
        result.push(trimmed)
      }
    }
  }

  if (result.length === 0) {
    return [...FALLBACK_KEYWORDS]
  }
  return result
}
