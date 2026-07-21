/**
 * Client-side TOTP generator (RFC 6238) на базе otpauth.
 *
 * Использование:
 *   const { setSecret, code, remainingSec, progress } = useTotp()
 *   setSecret('JBSWY3DPEHPK3PXP')  // base32 secret из reveal
 *   // code — reactive 6-значный код, обновляется каждую секунду
 *
 * Component unmount → clearInterval + reset.
 *
 * otpauth подгружается lazy через dynamic import только на клиенте,
 * чтобы пакет не попал в Nitro server bundle (где он не нужен и где
 * deployment может не сохранять node_modules).
 */
import { computed, onBeforeUnmount, ref, shallowRef } from "vue"

const PERIOD_SEC = 30
const DIGITS = 6

type TotpCtor = new (opts: {
  secret: string
  algorithm: string
  digits: number
  period: number
}) => { generate: (opts?: { timestamp?: number }) => string }

let totpClassPromise: Promise<TotpCtor> | null = null

function loadTotpClass(): Promise<TotpCtor> | null {
  if (!import.meta.client) return null
  if (!totpClassPromise) {
    totpClassPromise = import("otpauth").then((m) => m.TOTP as unknown as TotpCtor)
  }
  return totpClassPromise
}

export function useTotp() {
  const secret = ref<string | null>(null)
  const now = ref<number>(Date.now())
  const TotpClass = shallowRef<TotpCtor | null>(null)
  let intervalId: ReturnType<typeof setInterval> | null = null

  if (import.meta.client) {
    loadTotpClass()?.then((cls) => {
      TotpClass.value = cls
    })
  }

  function startTicking() {
    if (intervalId) return
    intervalId = setInterval(() => {
      now.value = Date.now()
    }, 1000)
  }

  function stopTicking() {
    if (intervalId) {
      clearInterval(intervalId)
      intervalId = null
    }
  }

  function setSecret(s: string | null) {
    if (s && s.trim().length > 0) {
      secret.value = s.trim().replace(/\s+/g, "").toUpperCase()
      now.value = Date.now()
      startTicking()
    } else {
      secret.value = null
      stopTicking()
    }
  }

  const code = computed<string | null>(() => {
    if (!secret.value || !TotpClass.value) return null
    try {
      const totp = new TotpClass.value({
        secret: secret.value,
        algorithm: "SHA1",
        digits: DIGITS,
        period: PERIOD_SEC,
      })
      return totp.generate({ timestamp: now.value })
    } catch {
      return null
    }
  })

  /** Сколько секунд осталось до следующей ротации (30..1). */
  const remainingSec = computed(() => {
    const secondsInPeriod = Math.floor(now.value / 1000) % PERIOD_SEC
    return PERIOD_SEC - secondsInPeriod
  })

  /** Прогресс 0..1 — сколько прошло из текущего 30-сек окна. */
  const progress = computed(() => {
    return (PERIOD_SEC - remainingSec.value) / PERIOD_SEC
  })

  onBeforeUnmount(() => {
    stopTicking()
    secret.value = null
  })

  return {
    setSecret,
    code,
    remainingSec,
    progress,
  }
}
