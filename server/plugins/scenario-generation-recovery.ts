import { releaseInterruptedScenarioGenerations } from "../utils/scenario-generation-runner"

const SWEEP_INTERVAL_MS = 5 * 60 * 1000

/**
 * Генерация сценария живёт в памяти процесса. Рестарт её теряет, а запись
 * остаётся в статусе `generating` и блокирует тренд: повторный запуск отвечает
 * 409, и раньше это лечилось только удалением сценария руками.
 *
 * Подметание освобождает такие записи — и на старте, и периодически, потому что
 * процесс может умереть и без последующего чтения этого кода.
 */
export default defineNitroPlugin(() => {
  if (process.env.SCHEDULERS_ENABLED !== "true") return

  const sweep = async () => {
    try {
      const released = await releaseInterruptedScenarioGenerations()
      if (released > 0) {
        console.info(`[scenario-generation-recovery] освобождено сценариев: ${released}`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[scenario-generation-recovery] ${message}`)
    }
  }

  void sweep()
  const timer = setInterval(sweep, SWEEP_INTERVAL_MS)
  timer.unref?.()
})
