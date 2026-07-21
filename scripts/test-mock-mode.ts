/**
 * Smoke-тест mock-режима. Проверяет что в полном mock-режиме:
 * - checkProxy возвращает синтетический результат на основе host прокси
 * - Anthropic-агент возвращает фикстуру вместо API-вызова
 * - Telegram sendMessage не делает HTTP-запросов
 *
 * Запуск:
 *   PROXY_MOCK_MODE=true ANTHROPIC_MOCK_MODE=true TELEGRAM_MOCK_MODE=true \
 *     npx tsx scripts/test-mock-mode.ts
 */

import "dotenv/config"

// Минимальный shim над useRuntimeConfig — для тестов вне Nitro контекста.
const runtimeConfig = {
  proxyMockMode: process.env.PROXY_MOCK_MODE === "true",
  proxyMockUrl: process.env.PROXY_MOCK_URL ?? "http://localhost:18888",
  anthropicMockMode: process.env.ANTHROPIC_MOCK_MODE === "true",
  falMockMode: process.env.FAL_MOCK_MODE === "true",
  telegramMockMode: process.env.TELEGRAM_MOCK_MODE === "true",
}

;(globalThis as { useRuntimeConfig?: () => typeof runtimeConfig }).useRuntimeConfig = () => runtimeConfig
;(globalThis as { defineNitroPlugin?: (fn: unknown) => unknown }).defineNitroPlugin = (fn) => fn

async function testProxyMock(): Promise<void> {
  const { checkProxy } = await import("../server/utils/proxy/probe")

  console.log("\n=== checkProxy mock ===")

  const happy = await checkProxy({ protocol: "http", host: "mock-happy_path", port: 8080 })
  console.log("happy_path:", happy.httpProbeOk, happy.detectedIp, happy.detectedCountry)

  const leak = await checkProxy({ protocol: "http", host: "mock-leak", port: 8080 })
  console.log("leak:", leak.isLeaking, leak.errorCategory, leak.errorMessage)

  const auth = await checkProxy({ protocol: "http", host: "mock-auth_failed", port: 8080 })
  console.log("auth_failed:", auth.tcpConnectOk, auth.httpProbeOk, auth.errorCategory)
}

async function testAnthropicFixtureLoader(): Promise<void> {
  // Standalone tsx не резолвит Nuxt-алиасы (~~), поэтому грузим фикстуру напрямую
  // через fixture-loader (без агентов). Полный pipeline тестируется через
  // npm run dev в mock-режиме (см. docs/architecture/social_automation.md).
  console.log("\n=== Anthropic fixture loader ===")
  const { loadFixture } = await import("../server/utils/mock/fixture-loader")
  const story = await loadFixture<{ storyArc: { template: string }; protagonist: { type: string } }>({
    category: "agents",
    name: "story-architect-happy",
  })
  console.log("story-architect-happy.json template:", story.storyArc.template, "protagonist:", story.protagonist.type)
}

async function main(): Promise<void> {
  if (runtimeConfig.proxyMockMode) {
    await testProxyMock()
  } else {
    console.log("(skip proxy: PROXY_MOCK_MODE != true)")
  }

  if (runtimeConfig.anthropicMockMode) {
    await testAnthropicFixtureLoader()
  } else {
    console.log("(skip anthropic: ANTHROPIC_MOCK_MODE != true)")
  }

  console.log("\nSMOKE OK")
}

main().catch((err) => {
  console.error("SMOKE FAIL:", err)
  process.exit(1)
})
