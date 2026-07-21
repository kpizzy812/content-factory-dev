/**
 * Расшифровка proxy.host / proxy.username / proxy.password перед отправкой
 * во внешние сервисы (Indigo API, healthcheck, headless browser).
 *
 * В БД эти три поля **зашифрованы** через encrypt() из server/utils/crypto.ts
 * (формат "iv:tag:cipher" hex). Если отправить как есть — Indigo вернёт 400
 * BAD_REQUEST_VALUES "proxy host is not correct <hex>" (подтверждено через
 * dev-аккаунт May 2026).
 *
 * Используется в:
 * - server/api/device-profiles/index.post.ts (create)
 * - server/api/device-profiles/[id]/test.post.ts (dry-run)
 * - server/api/device-profiles/[id]/resync.post.ts
 * - server/utils/proxy/proxy-checker.ts (healthcheck)
 * - server/api/proxies/[id]/diagnose.post.ts (diagnostics)
 *
 * NB: возвращает plaintext — НЕ логировать, не сохранять в response без redact.
 */
import { decryptSecret } from "../crypto"

export interface DecryptedProxyCredentials {
  host: string
  username: string | null
  password: string | null
}

export function decryptProxyCredentials(proxy: {
  host: string
  username: string | null
  password: string | null
}): DecryptedProxyCredentials {
  return {
    host: decryptSecret(proxy.host),
    username: proxy.username ? decryptSecret(proxy.username) : null,
    password: proxy.password ? decryptSecret(proxy.password) : null,
  }
}
