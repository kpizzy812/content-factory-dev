import { randomBytes, scrypt, timingSafeEqual } from "node:crypto"
import { promisify } from "node:util"

// createError импортируется явно: модуль читают DB-free unit-тесты, где
// авто-импортов Nitro нет.
import { createError } from "h3"

const scryptAsync = promisify(scrypt)

const COST = 16384
const BLOCK_SIZE = 8
const PARALLELIZATION = 1
const KEY_LENGTH = 64
const SALT_BYTES = 16
const MIN_LENGTH = 12

/** Формат хранения: scrypt$N$r$p$saltBase64$hashBase64. Сырой пароль не хранится. */
function encode(salt: Buffer, hash: Buffer): string {
  return [
    "scrypt",
    COST,
    BLOCK_SIZE,
    PARALLELIZATION,
    salt.toString("base64"),
    hash.toString("base64"),
  ].join("$")
}

export function assertPasswordPolicy(plain: string): void {
  if (typeof plain !== "string" || plain.length < MIN_LENGTH) {
    throw createError({
      statusCode: 422,
      message: `Пароль должен содержать минимум ${MIN_LENGTH} символов`,
    })
  }
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  const hash = (await scryptAsync(plain, salt, KEY_LENGTH, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELIZATION,
  })) as Buffer
  return encode(salt, hash)
}

export async function verifyPassword(plain: string, stored: string | null): Promise<boolean> {
  if (!stored) return false
  const parts = stored.split("$")
  if (parts.length !== 6 || parts[0] !== "scrypt") return false

  const cost = Number(parts[1])
  const blockSize = Number(parts[2])
  const parallelization = Number(parts[3])
  if (!Number.isFinite(cost) || !Number.isFinite(blockSize) || !Number.isFinite(parallelization)) return false

  const salt = Buffer.from(parts[4]!, "base64")
  const expected = Buffer.from(parts[5]!, "base64")
  if (salt.length === 0 || expected.length === 0) return false

  try {
    const actual = (await scryptAsync(plain, salt, expected.length, {
      N: cost,
      r: blockSize,
      p: parallelization,
    })) as Buffer
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}
