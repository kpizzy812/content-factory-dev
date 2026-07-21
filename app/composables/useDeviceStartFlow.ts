import type { DeviceStartProfileResponse } from "~~/shared/types/device-profile"

/**
 * useDeviceStartFlow — state machine для UX старта device-профиля.
 *
 * Без этого composable: одиночный POST /start; при CORE_DOWNLOADING_STARTED
 * 500 пользователь видел диагностическую модалку с raw JSON ошибки.
 *
 * С этим composable: state machine с шагами visible в UI:
 *   idle → launcher_call → [downloading_core (loop polling)] → running / failed
 *
 * Запуск:
 *   const flow = useDeviceStartFlow()
 *   await flow.start(profileId, automation)
 *   // flow.state.step реактивно меняется, UI render'ит stepper
 *
 * При downloading_core retry POST /start автоматически каждые 5s до получения
 * state='started' или error. Cleanup при unmount.
 *
 * Timer обновляет elapsedMs (общее) и stepElapsedMs (на текущем шаге) каждые
 * 250ms - smooth UI display "Загрузка ядра... 14.5с".
 */

export type StartFlowStep =
  | "idle"
  | "launcher_call"
  | "downloading_core"
  | "running"
  | "failed"

export type DownloadingCoreCode =
  | "CORE_DOWNLOADING_STARTED"
  | "LOCK_PROFILE_ERROR"
  | null

export interface StartFlowState {
  step: StartFlowStep
  startedAt: number
  stepStartedAt: number
  elapsedMs: number
  stepElapsedMs: number
  port: number | null
  message: string | null
  error: { message: string; phase?: string; indigoBody?: unknown } | null
  // Tracks ли flow проходил через downloading_core (для рендеринга step в stepper
  // даже после перехода в running).
  hadDownload: boolean
  // Текущий Indigo error code когда step='downloading_core':
  //   CORE_DOWNLOADING_STARTED - lazy download Chromium (~2-5 мин, 60 retries × 5s)
  //   LOCK_PROFILE_ERROR - Indigo lock на профиле (обычно <15s, 5 retries × 3s)
  //   null - legacy/неизвестный код (fallback на CORE retry policy)
  downloadingCode: DownloadingCoreCode
  // Retry counters раздельно для CORE и LOCK чтобы exceeded max policy работало.
  coreRetries: number
  lockRetries: number
}

interface ServerActionError {
  statusCode: number
  message: string
  phase: string
  indigoStatus: number
  indigoBody: unknown
  url: string
  method: string
  errorClass?: string
  stackHead?: string
}

// Retry policies по коду ошибки Indigo:
//   CORE: длительный download Chromium (~2-5 мин), интервал 5s, до 60 попыток
//   LOCK: lock обычно освобождается за секунды, короткий retry 3s до 5 попыток
const CORE_POLL_INTERVAL_MS = 5_000
const CORE_MAX_RETRIES = 60
const LOCK_POLL_INTERVAL_MS = 3_000
const LOCK_MAX_RETRIES = 5
const TIMER_TICK_MS = 250

function freshState(): StartFlowState {
  return {
    step: "idle",
    startedAt: 0,
    stepStartedAt: 0,
    elapsedMs: 0,
    stepElapsedMs: 0,
    port: null,
    message: null,
    error: null,
    hadDownload: false,
    downloadingCode: null,
    coreRetries: 0,
    lockRetries: 0,
  }
}

export function useDeviceStartFlow() {
  const state = ref<StartFlowState>(freshState())

  let timerId: ReturnType<typeof setInterval> | null = null
  let pollTimerId: ReturnType<typeof setTimeout> | null = null
  let cancelled = false

  function setStep(step: StartFlowStep) {
    state.value.step = step
    state.value.stepStartedAt = Date.now()
    state.value.stepElapsedMs = 0
    if (step === "downloading_core") {
      state.value.hadDownload = true
    }
  }

  function startTimer() {
    stopTimer()
    timerId = setInterval(() => {
      const now = Date.now()
      state.value.elapsedMs = now - state.value.startedAt
      state.value.stepElapsedMs = now - state.value.stepStartedAt
    }, TIMER_TICK_MS)
  }

  function stopTimer() {
    if (timerId) {
      clearInterval(timerId)
      timerId = null
    }
  }

  function stopPolling() {
    if (pollTimerId) {
      clearTimeout(pollTimerId)
      pollTimerId = null
    }
  }

  function reset() {
    cancelled = false
    state.value = freshState()
    stopTimer()
    stopPolling()
  }

  function cancel() {
    cancelled = true
    stopTimer()
    stopPolling()
    if (state.value.step !== "running" && state.value.step !== "failed") {
      state.value.step = "idle"
    }
  }

  async function pollStart(profileId: string, automation: boolean): Promise<void> {
    if (cancelled) return
    try {
      const res = await $fetch<{
        data: DeviceStartProfileResponse | null
        error: ServerActionError | null
      }>(`/api/device-profiles/${profileId}/start`, {
        method: "POST",
        body: { automation },
      })
      if (cancelled) return

      if (res.error) {
        setStep("failed")
        state.value.error = {
          message: res.error.message,
          phase: res.error.phase,
          indigoBody: res.error.indigoBody,
        }
        stopTimer()
        return
      }

      if (!res.data) {
        setStep("failed")
        state.value.error = { message: "Пустой response от /start" }
        stopTimer()
        return
      }

      if (res.data.state === "started") {
        setStep("running")
        state.value.port = res.data.port
        stopTimer()
        return
      }

      // downloading_core: разные retry policies по code. Switch на step если
      // ещё не там, increment counter, проверить max - exceeded → failed.
      const code = (res.data.code ?? "CORE_DOWNLOADING_STARTED") as DownloadingCoreCode
      if (state.value.step !== "downloading_core" || state.value.downloadingCode !== code) {
        setStep("downloading_core")
        state.value.downloadingCode = code
      }
      state.value.message = res.data.message
        ?? (code === "LOCK_PROFILE_ERROR"
          ? "Устройство DuoPlus держит блокировку профиля"
          : "Загрузка ядра устройства")

      if (code === "LOCK_PROFILE_ERROR") {
        state.value.lockRetries += 1
        if (state.value.lockRetries >= LOCK_MAX_RETRIES) {
          setStep("failed")
          state.value.error = {
            message:
              `Устройство DuoPlus держит блокировку профиля дольше ${LOCK_MAX_RETRIES * LOCK_POLL_INTERVAL_MS / 1000} секунд. `
              + `Профиль числится запущенным в облаке устройства. `
              + `Откройте устройство DuoPlus → найдите профиль → `
              + `снимите блокировку, затем повторите запуск.`,
          }
          stopTimer()
          return
        }
        pollTimerId = setTimeout(() => pollStart(profileId, automation), LOCK_POLL_INTERVAL_MS)
        return
      }

      // CORE_DOWNLOADING_STARTED (или legacy без code)
      state.value.coreRetries += 1
      if (state.value.coreRetries >= CORE_MAX_RETRIES) {
        setStep("failed")
        state.value.error = {
          message:
            `Загрузка Chromium ядра занимает дольше ${Math.round(CORE_MAX_RETRIES * CORE_POLL_INTERVAL_MS / 60000)} минут. `
            + `Проверьте Saturn logs (/tmp/indigo-agent.log) на ошибки download.`,
        }
        stopTimer()
        return
      }
      pollTimerId = setTimeout(() => pollStart(profileId, automation), CORE_POLL_INTERVAL_MS)
    } catch (err) {
      if (cancelled) return
      setStep("failed")
      // P6: серверный /start вызывает DuoPlus powerOn и всегда возвращает 200
      // с {data,error}. Сюда попадаем только при сетевом сбое/4xx auth.
      const message = err instanceof Error ? err.message : String(err)
      state.value.error = { message }
      stopTimer()
    }
  }

  async function start(profileId: string, automation = false): Promise<void> {
    reset()
    state.value.startedAt = Date.now()
    setStep("launcher_call")
    startTimer()
    await pollStart(profileId, automation)
  }

  const isActive = computed(() =>
    state.value.step === "launcher_call" || state.value.step === "downloading_core",
  )

  const isComplete = computed(() =>
    state.value.step === "running" || state.value.step === "failed",
  )

  onBeforeUnmount(() => {
    cancelled = true
    stopTimer()
    stopPolling()
  })

  return {
    state: readonly(state),
    start,
    cancel,
    reset,
    isActive,
    isComplete,
  }
}
