/**
 * Startup-инициализация storage driver. Fail-fast при невалидной конфигурации
 * (отсутствие GCS credentials в production = crash контейнера, чтобы оркестратор
 * перезапустил/упал явно вместо тихих 500-ок). Дополнительный sanity probe для
 * GCS: list под `zavodcamp/` с maxResults=1 проверяет, что bucket доступен и
 * service account имеет права на чтение префикса.
 *
 * В non-production падение probe не валит сервер — логирует WARN. Это позволяет
 * разработчикам поднимать `bun run dev` без GCS-доступа (если STORAGE_DRIVER=local).
 */
import { describeStorageDriver, getStorageDriver } from "~~/server/utils/storage"

export default defineNitroPlugin(async () => {
  try {
    const driver = getStorageDriver()
    const desc = describeStorageDriver()
    console.log(`[storage] driver initialized: ${driver.providerName}`, {
      bucketName: desc.bucketName,
      localRoot: desc.localRoot,
      credentialsSource: desc.credentialsSource,
    })

    if (driver.providerName === "gcs") {
      const items = await driver.list("zavodcamp/", { maxResults: 1 })
      console.log(
        `[storage] GCS bucket reachable, ${items.length} sample item(s) under zavodcamp/`,
      )
    }
  } catch (err) {
    console.error("[storage] FATAL: failed to initialize storage driver", err)
    if (process.env.NODE_ENV === "production") {
      throw err
    }
  }
})
