/**
 * Общий env-блок для @nuxt/test-utils setup() во всех integration/api spec-файлах.
 *
 * Что важно:
 *  - dev: true — иначе @nuxt/test-utils выставляет NODE_ENV=production,
 *    и наш TEST_AUTH_BYPASS-гейт перестаёт работать (сделано специально).
 *  - SCHEDULERS_ENABLED=false — глушит cron-плагины (telegram/trendwatcher/pipeline/posting).
 *  - *_MOCK_MODE=true — внешние сервисы (proxy-checker/Anthropic/FAL/Telegram)
 *    не делают реальных HTTP-вызовов.
 *  - TEST_AUTH_TOKEN/TEST_AUTH_BYPASS — пускают запросы по x-test-auth-token+x-test-user-id.
 */
export const nuxtTestEnv: Record<string, string> = {
  NODE_ENV: "test",
  DATABASE_URL: process.env.DATABASE_URL ?? "",
  NUXT_SESSION_PASSWORD: process.env.NUXT_SESSION_PASSWORD ?? "",
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ?? "",
  SCHEDULERS_ENABLED: "false",
  POSTING_WORKER_ENABLED: "false",
  PROXY_HEALTH_CHECK_ENABLED: "false",
  ENABLE_PAID_APIS: "false",
  ENABLE_SOCIAL_POSTING: "false",
  PROXY_MOCK_MODE: "true",
  ANTHROPIC_MOCK_MODE: "true",
  FAL_MOCK_MODE: "true",
  TELEGRAM_MOCK_MODE: "true",
  GOOGLE_DRIVE_MOCK_MODE: "true",
  GOOGLE_DRIVE_MOCK_URL: process.env.GOOGLE_DRIVE_MOCK_URL ?? "http://localhost:18889",
  GOOGLE_DRIVE_SCHEDULER_ENABLED: "false",
  TEST_AUTH_BYPASS: "1",
  TEST_AUTH_TOKEN: process.env.TEST_AUTH_TOKEN ?? "",
}
