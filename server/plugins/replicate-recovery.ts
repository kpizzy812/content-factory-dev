import { readReplicateConfig, type ReplicateConfig } from "../utils/replicate/config"
import { createReplicateProvider } from "../utils/replicate/client"
import { createMockReplicateProvider } from "../utils/replicate/mock"
import { createPredictionService } from "../utils/replicate/prediction-service"

const RECOVERY_INTERVAL_MS = 60_000
const RECOVERY_BATCH_SIZE = 20

export default defineNitroPlugin((nitro) => {
  // Гейт scheduler'ов (тестовая инфраструктура). См. .env.test.
  // Раньше здесь стояло `!== "true"`, и в проде без явной переменной
  // восстановление потерянных predictions молча не запускалось — даже в реестре
  // планировщиков его не было видно.
  if (process.env.SCHEDULERS_ENABLED === "false") return

  // Конфигурация Replicate бросает при отсутствии токена или адреса вебхука.
  // Внутри defineNitroPlugin это валит старт плагина без внятного следа, а
  // восстановление — не тот механизм, ради которого стоит ронять процесс.
  let config: ReplicateConfig
  try {
    config = readReplicateConfig()
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[replicate-recovery] выключено: конфигурация Replicate неполна — ${message}`)
    return
  }

  if (!config.recoveryEnabled) return

  const provider = config.mockMode
    ? createMockReplicateProvider()
    : createReplicateProvider({ config })
  const service = createPredictionService({ provider })

  const recover = async () => {
    try {
      const result = await service.recoverStalePredictions(RECOVERY_BATCH_SIZE)
      if (result.inspected > 0) {
        console.info(
          `[replicate-recovery] inspected=${result.inspected} recovered=${result.recovered} failed=${result.failed}`,
        )
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[replicate-recovery] ${message}`)
    }
  }

  void recover()
  const timer = trackedInterval('replicate-recovery', 'Восстановление задач Replicate', RECOVERY_INTERVAL_MS, recover)
  timer.unref?.()

  nitro.hooks.hook("close", () => {
    clearInterval(timer)
  })
})
