/**
 * Unit-тест useAccountReadiness — чистая computed функция, тест без HTTP моков.
 *
 * Покрытие: 4 проверки (proxy/indigo/deep-check signal/login) в разных
 * сочетаниях. Главное — что для browser_automation требуется всё, а для api
 * требуется только proxy (остальные "Не требуется").
 */
import { describe, expect, it } from "vitest"
import { ref } from "vue"

import type { PreflightAccount } from "../../app/composables/useYoutubePreflight"
import { useAccountReadiness } from "../../app/composables/useAccountReadiness"

const NOW_ISO = new Date().toISOString()
const STALE_ISO = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

function makeAccount(over: Partial<PreflightAccount> = {}): PreflightAccount {
  return {
    id: 1,
    platform: "youtube",
    status: "active",
    postingMethod: "browser_automation",
    proxyId: "p1",
    deviceProfileId: "i1",
    proxy: { id: "p1", label: "Proxy NL", status: "healthy" },
    loginCheckedStatus: true,
    loginCheckedAt: NOW_ISO,
    loginCheckedUsername: "testuser",
    ...over,
  }
}

describe("useAccountReadiness", () => {
  it("браузерный аккаунт со всеми зелёными → 4/4 ready=true", () => {
    const account = ref(makeAccount())
    const { state } = useAccountReadiness(account)
    expect(state.value.score).toBe(4)
    expect(state.value.ready).toBe(true)
  })

  it("нет прокси → проверка proxy fails → score=3", () => {
    const account = ref(
      makeAccount({ proxyId: null, proxy: null }),
    )
    const { state } = useAccountReadiness(account)
    expect(state.value.score).toBe(3)
    expect(state.value.checks.find((c) => c.key === "proxy")?.passed).toBe(false)
  })

  it("прокси unhealthy → proxy fails", () => {
    const account = ref(
      makeAccount({
        proxy: { id: "p1", label: "P", status: "dead" },
      }),
    )
    const { state } = useAccountReadiness(account)
    expect(state.value.checks.find((c) => c.key === "proxy")?.passed).toBe(false)
  })

  it("нет indigo profile для browser_automation → indigo fails", () => {
    const account = ref(makeAccount({ deviceProfileId: null }))
    const { state } = useAccountReadiness(account)
    expect(state.value.checks.find((c) => c.key === "indigo")?.passed).toBe(false)
  })

  it("loginCheckedStatus=false → login fails", () => {
    const account = ref(
      makeAccount({ loginCheckedStatus: false }),
    )
    const { state } = useAccountReadiness(account)
    expect(state.value.checks.find((c) => c.key === "login")?.passed).toBe(false)
  })

  it("browser + loginCheckedStatus=null (заморозка DuoPlus) → login+deep заморожены, исключены из гейта, ready через proxy+device", () => {
    const account = ref(
      makeAccount({ loginCheckedStatus: null, loginCheckedAt: null }),
    )
    const { state } = useAccountReadiness(account)
    const login = state.value.checks.find((c) => c.key === "login")
    const deep = state.value.checks.find((c) => c.key === "deep_check")
    // Заморозка миграции: login не врёт зелёным (passed=false), но помечен frozen.
    expect(login?.frozen).toBe(true)
    expect(login?.passed).toBe(false)
    expect(deep?.frozen).toBe(true)
    // Замороженные проверки исключены из total → аккаунт готов через proxy+device.
    expect(state.value.total).toBe(2)
    expect(state.value.score).toBe(2)
    expect(state.value.ready).toBe(true)
  })

  it("loginCheckedAt устаревший (>7д) → login fails (stale)", () => {
    const account = ref(makeAccount({ loginCheckedAt: STALE_ISO }))
    const { state } = useAccountReadiness(account)
    expect(state.value.checks.find((c) => c.key === "login")?.passed).toBe(false)
  })

  it("deep_check fails если login fails (deep-check косвенно через login recency)", () => {
    const account = ref(
      makeAccount({ loginCheckedAt: STALE_ISO }),
    )
    const { state } = useAccountReadiness(account)
    expect(state.value.checks.find((c) => c.key === "deep_check")?.passed).toBe(
      false,
    )
  })

  it("api аккаунт → не требует indigo/deep-check/login, только proxy", () => {
    const account = ref(
      makeAccount({
        postingMethod: "api",
        deviceProfileId: null,
        loginCheckedAt: null,
        loginCheckedStatus: null,
      }),
    )
    const { state } = useAccountReadiness(account)
    expect(state.value.score).toBe(4) // proxy ok, остальные "не требуется" = passed
    expect(state.value.ready).toBe(true)
  })

  it("account=null → loading state", () => {
    const account = ref<PreflightAccount | null>(null)
    const { state } = useAccountReadiness(account)
    expect(state.value.loading).toBe(true)
    expect(state.value.checks).toHaveLength(0)
    expect(state.value.ready).toBe(false)
  })

  it("реактивность: смена account меняет score", async () => {
    const account = ref(makeAccount())
    const { state } = useAccountReadiness(account)
    expect(state.value.score).toBe(4)
    account.value = makeAccount({ proxyId: null, proxy: null })
    expect(state.value.score).toBe(3)
  })
})
