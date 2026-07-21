import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

const ALGORITHM = "aes-256-gcm"
const IV_LENGTH = 16
const AUTH_TAG_LENGTH = 16

/**
 * Получает ключ шифрования из конфигурации.
 * Ключ должен быть 32 байта (64 hex-символа).
 */
function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY

  if (!key) {
    throw createError({
      statusCode: 500,
      message:
        "ENCRYPTION_KEY не настроен в .env. Сгенерировать новый ключ: openssl rand -hex 32",
    })
  }

  const keyBuffer = Buffer.from(key, "hex")

  if (keyBuffer.length !== 32) {
    throw createError({
      statusCode: 500,
      message:
        "ENCRYPTION_KEY должен быть 32 байта (64 hex-символа). " +
        "Сгенерировать новый: openssl rand -hex 32",
    })
  }

  return keyBuffer
}

/**
 * Шифрует текст с помощью AES-256-GCM.
 * Возвращает строку в формате: iv:authTag:ciphertext (hex).
 */
export function encrypt(text: string): string {
  const key = getEncryptionKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)

  let encrypted = cipher.update(text, "utf8", "hex")
  encrypted += cipher.final("hex")

  const authTag = cipher.getAuthTag()

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`
}

/**
 * Расшифровывает текст, зашифрованный функцией encrypt.
 * Принимает строку в формате: iv:authTag:ciphertext (hex).
 */
export function decrypt(encrypted: string): string {
  const key = getEncryptionKey()
  const parts = encrypted.split(":")

  if (parts.length !== 3) {
    throw createError({
      statusCode: 500,
      message: "Неверный формат зашифрованных данных",
    })
  }

  const [ivHex, authTagHex, ciphertext] = parts as [string, string, string]
  const iv = Buffer.from(ivHex, "hex")
  const authTag = Buffer.from(authTagHex, "hex")

  if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) {
    throw createError({
      statusCode: 500,
      message: "Повреждены зашифрованные данные (iv или authTag)",
    })
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  let decrypted = decipher.update(ciphertext, "hex", "utf8")
  decrypted += decipher.final("utf8")

  return decrypted
}

/**
 * Семантический alias для encrypt() — для секретов (пароли, 2FA, прокси-credentials).
 * Используется в Social Automation foundation: SocialAccount.loginPassword,
 * Proxy.host/username/password, SecretAccessLog audit и т.д.
 */
export function encryptSecret(plain: string): string {
  return encrypt(plain)
}

/**
 * Семантический alias для decrypt() — низкоуровневая расшифровка БЕЗ audit-log.
 * Использовать только в внутренних утилитах (например proxy-checker.ts для health checks).
 * Для UI / API reveal-операций использовать readSecret() из secret-access.ts.
 */
export function decryptSecret(cipher: string): string {
  return decrypt(cipher)
}
