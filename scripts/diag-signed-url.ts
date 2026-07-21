/**
 * Диагностика media-push: сгенерировать GCS signed-URL для тестового ключа и
 * посмотреть его длину/спецсимволы — проверить, не он ли ломает `curl` в
 * `cloudPhone/command` (длина команды / shell-спецсимволы).
 * Запуск: npx tsx scripts/diag-signed-url.ts
 */
import { getStorageDriver } from "../server/utils/storage"

async function main() {
  const key = "zavodcamp/diagnostic-test-video.mp4"
  const url = await getStorageDriver().getSignedDownloadUrl(key, { expiresInSec: 3600 })
  console.log("SIGNED_URL_LENGTH:", url.length)
  console.log("HAS_SINGLE_QUOTE:", url.includes("'"))
  console.log("HAS_BACKTICK:", url.includes("`"))
  console.log("HAS_DOLLAR:", url.includes("$"))
  console.log("FIRST_140:", url.slice(0, 140))
  console.log("FULL:", url)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("ERR:", e?.message ?? e)
    process.exit(1)
  })
