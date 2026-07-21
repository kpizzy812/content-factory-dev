/**
 * Registry балансных провайдеров.
 *
 * Сейчас:
 * - indigo, mubert — manual (нет публичного API для balance)
 * - apify, nodemaven, fal.ai — API с graceful fallback на manual при сбое/отсутствии env
 * - anthropic — estimate через AiAuditLog (baseline - accumulated cost)
 *
 * Добавление нового сервиса: расширить KNOWN_SERVICES в config.ts и factory здесь.
 */

import type { BalanceProvider } from "./types"
import { getServiceConfig, KNOWN_SERVICES, type ServiceConfig } from "./config"
import { ManualBalanceProvider } from "./providers/manual-provider"
import { ApifyApiBalanceProvider } from "./providers/apify-api-provider"
import { NodeMavenApiBalanceProvider } from "./providers/nodemaven-api-provider"
import { FalApiBalanceProvider } from "./providers/fal-api-provider"
import { AnthropicEstimateBalanceProvider } from "./providers/anthropic-estimate-provider"

type ProviderFactory = (cfg: ServiceConfig) => BalanceProvider

const FACTORIES: Record<string, ProviderFactory> = {
  "fal.ai": (cfg) => new FalApiBalanceProvider(cfg),
  "anthropic": (cfg) => new AnthropicEstimateBalanceProvider(cfg),
  "apify": (cfg) => new ApifyApiBalanceProvider(cfg),
  "nodemaven": (cfg) => new NodeMavenApiBalanceProvider(cfg),
  "indigo": (cfg) => new ManualBalanceProvider(cfg),
  "mubert": (cfg) => new ManualBalanceProvider(cfg),
}

export function getProvider(service: string): BalanceProvider | null {
  const cfg = getServiceConfig(service)
  if (!cfg) return null
  const factory = FACTORIES[service] ?? ((c: ServiceConfig) => new ManualBalanceProvider(c))
  return factory(cfg)
}

export function getAllProviders(): BalanceProvider[] {
  return KNOWN_SERVICES.map((cfg) => {
    const factory = FACTORIES[cfg.key] ?? ((c: ServiceConfig) => new ManualBalanceProvider(c))
    return factory(cfg)
  })
}
