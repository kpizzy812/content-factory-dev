/**
 * PrefixGuard — единственная защита от случайной записи поверх файлов
 * MarketingCamp в shared GCS bucket `marketingcamp-creatives`. ZavodCamp
 * пишет ТОЛЬКО под префиксом `zavodcamp/`. Любая попытка write/delete
 * вне него бросает StorageError('PREFIX_GUARD') ДО обращения к SDK.
 *
 * Read-операции валидируются мягче (`assertSafeKey`) — допускаем чтение
 * любых ключей без префикса (для backward compat со старыми filePath
 * через `/api/files/`), но запрещаем path traversal и пустые строки.
 */
import { StorageError } from "./types"

export const STORAGE_PATH_PREFIX = "zavodcamp/"

/** Жёсткая проверка: ключ под `zavodcamp/` + нет path traversal. */
export function assertZavodCampPrefix(key: string, operation: string): void {
  if (typeof key !== "string" || key.length === 0) {
    throw new StorageError(
      `Invalid storage key for ${operation}: must be non-empty string, got ${JSON.stringify(key)}`,
      "INVALID_KEY",
      false,
    )
  }

  if (!key.startsWith(STORAGE_PATH_PREFIX)) {
    throw new StorageError(
      `Security: ZavodCamp can only ${operation} keys under prefix "${STORAGE_PATH_PREFIX}". ` +
        `Got: "${key.slice(0, 100)}". This protects shared GCS bucket from cross-product writes.`,
      "PREFIX_GUARD",
      false,
    )
  }

  if (key.includes("..") || key.includes("//")) {
    throw new StorageError(
      `Invalid storage key: contains path traversal sequences: "${key.slice(0, 100)}"`,
      "INVALID_KEY",
      false,
    )
  }
}

/** Мягкая проверка: read любых ключей разрешён, но без path traversal/пустых. */
export function assertSafeKey(key: string, operation: string): void {
  if (typeof key !== "string" || key.length === 0) {
    throw new StorageError(
      `Invalid storage key for ${operation}: must be non-empty string`,
      "INVALID_KEY",
      false,
    )
  }
  if (key.includes("..") || key.includes("//")) {
    throw new StorageError(
      `Invalid storage key: contains path traversal: "${key.slice(0, 100)}"`,
      "INVALID_KEY",
      false,
    )
  }
}
