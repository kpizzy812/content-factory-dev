/**
 * Единая точка для проверки mock-режимов внешних интеграций.
 *
 * Mock-режим включается отдельным env-флагом на каждый внешний сервис, так что
 * можно гибко изолировать только нужные интеграции (например, мокать только fal.ai
 * и Anthropic, а Telegram оставить реальным).
 *
 * Когда любой из *_MOCK_MODE=true — соответствующий хелпер обходит paid-guard,
 * не делает сетевых запросов и возвращает фикстуры. См. server/__mocks__/ и
 * server/__fixtures__/.
 */

export interface MockModeFlags {
  proxy: boolean
  anthropic: boolean
  fal: boolean
  telegram: boolean
  googleDrive: boolean
}

export function getMockModeFlags(): MockModeFlags {
  return {
    proxy: process.env.PROXY_MOCK_MODE === "true",
    anthropic: process.env.ANTHROPIC_MOCK_MODE === "true",
    fal: process.env.FAL_MOCK_MODE === "true",
    telegram: process.env.TELEGRAM_MOCK_MODE === "true",
    googleDrive: process.env.GOOGLE_DRIVE_MOCK_MODE === "true",
  }
}

export function isProxyMockMode(): boolean {
  return process.env.PROXY_MOCK_MODE === "true"
}

export function isAnthropicMockMode(): boolean {
  return process.env.ANTHROPIC_MOCK_MODE === "true"
}

export function isFalMockMode(): boolean {
  return process.env.FAL_MOCK_MODE === "true"
}

export function isTelegramMockMode(): boolean {
  return process.env.TELEGRAM_MOCK_MODE === "true"
}

export function getProxyMockUrl(): string {
  return process.env.PROXY_MOCK_URL || "http://localhost:18888"
}

export function isGoogleDriveMockMode(): boolean {
  return process.env.GOOGLE_DRIVE_MOCK_MODE === "true"
}

export function getGoogleDriveMockUrl(): string {
  return process.env.GOOGLE_DRIVE_MOCK_URL || "http://localhost:18889"
}
