/**
 * Тестовая обёртка над node:crypto для шифрования секретов в фабриках.
 *
 * Зачем нужно отдельно от server/utils/crypto.ts: production-функция
 * encryptSecret() читает ключ через useRuntimeConfig(), который недоступен
 * в чистом vitest-контексте (вне поднятого Nuxt-Nitro). Фабрики же
 * формируют записи в БД до и параллельно с $fetch'ом — там ключ берём
 * напрямую из process.env.ENCRYPTION_KEY (загружен .env.test через dotenv).
 *
 * Алгоритм/формат идентичны server/utils/crypto.ts:
 *   AES-256-GCM, строка "ivHex:authTagHex:ciphertextHex".
 * Это гарантирует, что зашифрованное здесь читается decryptSecret() в API.
 */
import { createCipheriv, randomBytes } from "node:crypto"

const IV_LENGTH = 16

export function testEncrypt(text: string): string {
  const raw = process.env.ENCRYPTION_KEY
  if (!raw) {
    throw new Error("[tests/helpers/test-crypto] ENCRYPTION_KEY не задан в .env.test")
  }
  const key = Buffer.from(raw, "hex")
  if (key.length !== 32) {
    throw new Error("[tests/helpers/test-crypto] ENCRYPTION_KEY должен быть 32 байта (64 hex-символа)")
  }

  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  let encrypted = cipher.update(text, "utf8", "hex")
  encrypted += cipher.final("hex")
  const authTag = cipher.getAuthTag()
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`
}
