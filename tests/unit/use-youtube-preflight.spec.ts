/**
 * Unit-тест useYoutubePreflight — 5 проверок для YouTube postинга.
 *
 * Caption-проверка фетчит /api/videos/:id/captions — мокаем через
 * vi.stubGlobal('$fetch', ...). Account/video приходят как Ref'ы от родителя.
 *
 * Покрытие: video missing / proxy missing / proxy unhealthy / indigo missing /
 * login missing / login stale / caption missing / caption approved (happy path).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { effectScope, ref } from "vue"

const NOW_ISO = new Date().toISOString()
const STALE_ISO = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

const $fetchMock = vi.fn()

// stubGlobal до import composable — composable обращается к $fetch как к global.
vi.stubGlobal("$fetch", $fetchMock)

const useYoutubePreflight = await import("../../app/composables/useYoutubePreflight").then(
  (m) => m.useYoutubePreflight,
)

type Preflight = ReturnType<typeof useYoutubePreflight>

interface SetupArgs {
  account: Parameters<typeof useYoutubePreflight>[0]["account"]["value"]
  video: Parameters<typeof useYoutubePreflight>[0]["video"]["value"]
}

function runInScope(args: SetupArgs): {
  preflight: Preflight
  dispose: () => void
} {
  const account = ref(args.account)
  const video = ref(args.video)
  const scope = effectScope()
  let preflight: Preflight | undefined
  scope.run(() => {
    preflight = useYoutubePreflight({ account, video })
  })
  return { preflight: preflight!, dispose: () => scope.stop() }
}

function makeAccount(over: Partial<NonNullable<SetupArgs["account"]>> = {}) {
  return {
    id: 1,
    platform: "youtube",
    status: "active",
    postingMethod: "browser_automation",
    proxyId: "p1",
    deviceProfileId: "i1",
    proxy: { id: "p1", label: "P", status: "healthy" },
    loginCheckedStatus: true,
    loginCheckedAt: NOW_ISO,
    loginCheckedUsername: "user",
    ...over,
  }
}

const validCaption = [
  {
    id: "c1",
    videoId: 10,
    platform: "youtube",
    title: "x",
    description: null,
    hashtags: [],
    charsTitle: 1,
    charsHashtagsTotal: 0,
    fitsLimits: true,
    modelVersion: "x",
    promptVersion: "v1",
    generationCost: null,
    runId: null,
    pipelineId: null,
    approvedAt: NOW_ISO,
    approvedById: 1,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  },
]

describe("useYoutubePreflight", () => {
  beforeEach(() => {
    $fetchMock.mockReset()
  })

  afterEach(() => {
    vi.clearAllTimers()
  })

  it("happy path: всё зелёное → не blocking", async () => {
    $fetchMock.mockResolvedValue({ data: validCaption })
    const { preflight, dispose } = runInScope({
      account: makeAccount(),
      video: { id: 10, status: "completed" },
    })
    // Дать debounce таймеру сработать
    await new Promise((r) => setTimeout(r, 300))
    expect(preflight.state.value.blocking).toBe(false)
    const keys = preflight.state.value.checks.map((c) => c.key)
    expect(keys).toContain("video")
    expect(keys).toContain("proxy")
    expect(keys).toContain("indigo")
    expect(keys).toContain("login")
    expect(keys).toContain("caption")
    dispose()
  })

  it("video не выбран → blocker", () => {
    $fetchMock.mockResolvedValue({ data: [] })
    const { preflight, dispose } = runInScope({
      account: makeAccount(),
      video: null,
    })
    const video = preflight.state.value.checks.find((c) => c.key === "video")
    expect(video?.status).toBe("blocker")
    expect(preflight.state.value.blocking).toBe(true)
    dispose()
  })

  it("video статус не completed → blocker", () => {
    $fetchMock.mockResolvedValue({ data: [] })
    const { preflight, dispose } = runInScope({
      account: makeAccount(),
      video: { id: 10, status: "rendering" },
    })
    const video = preflight.state.value.checks.find((c) => c.key === "video")
    expect(video?.status).toBe("blocker")
    dispose()
  })

  it("прокси отсутствует → blocker proxy", () => {
    $fetchMock.mockResolvedValue({ data: [] })
    const { preflight, dispose } = runInScope({
      account: makeAccount({ proxyId: null, proxy: null }),
      video: { id: 10, status: "completed" },
    })
    const proxy = preflight.state.value.checks.find((c) => c.key === "proxy")
    expect(proxy?.status).toBe("blocker")
    dispose()
  })

  it("прокси unhealthy → blocker proxy", () => {
    $fetchMock.mockResolvedValue({ data: [] })
    const { preflight, dispose } = runInScope({
      account: makeAccount({
        proxy: { id: "p1", label: "P", status: "dead" },
      }),
      video: { id: 10, status: "completed" },
    })
    const proxy = preflight.state.value.checks.find((c) => c.key === "proxy")
    expect(proxy?.status).toBe("blocker")
    dispose()
  })

  it("indigo profile отсутствует (browser_automation) → blocker indigo", () => {
    $fetchMock.mockResolvedValue({ data: [] })
    const { preflight, dispose } = runInScope({
      account: makeAccount({ deviceProfileId: null }),
      video: { id: 10, status: "completed" },
    })
    const indigo = preflight.state.value.checks.find((c) => c.key === "indigo")
    expect(indigo?.status).toBe("blocker")
    dispose()
  })

  it("loginCheckedStatus=false → blocker login", () => {
    $fetchMock.mockResolvedValue({ data: [] })
    const { preflight, dispose } = runInScope({
      account: makeAccount({ loginCheckedStatus: false }),
      video: { id: 10, status: "completed" },
    })
    const login = preflight.state.value.checks.find((c) => c.key === "login")
    expect(login?.status).toBe("blocker")
    dispose()
  })

  it("browser + loginCheckedStatus=null (заморозка DuoPlus) → login warn, НЕ blocking (Alice)", async () => {
    $fetchMock.mockResolvedValue({ data: validCaption })
    const { preflight, dispose } = runInScope({
      account: makeAccount({ loginCheckedStatus: null, loginCheckedAt: null }),
      video: { id: 10, status: "completed" },
    })
    await new Promise((r) => setTimeout(r, 300))
    const login = preflight.state.value.checks.find((c) => c.key === "login")
    // Заморозка миграции DuoPlus: login честный warn (не врёт зелёным), но НЕ blocker
    // → кнопка «Создать задачу» разблокирована для browser-аккаунта.
    expect(login?.status).toBe("warn")
    expect(preflight.state.value.blocking).toBe(false)
    dispose()
  })

  it("login stale (>7д) → warn (не blocker)", () => {
    $fetchMock.mockResolvedValue({ data: validCaption })
    const { preflight, dispose } = runInScope({
      account: makeAccount({ loginCheckedAt: STALE_ISO }),
      video: { id: 10, status: "completed" },
    })
    const login = preflight.state.value.checks.find((c) => c.key === "login")
    expect(login?.status).toBe("warn")
    dispose()
  })

  it("caption не утверждён → warn (не blocker, оператор может отредактировать в форме)", async () => {
    $fetchMock.mockResolvedValue({
      data: [
        {
          ...validCaption[0],
          approvedAt: null, // не утверждён
        },
      ],
    })
    const { preflight, dispose } = runInScope({
      account: makeAccount(),
      video: { id: 10, status: "completed" },
    })
    await new Promise((r) => setTimeout(r, 300))
    const caption = preflight.state.value.checks.find((c) => c.key === "caption")
    // Caption есть, но не utверждён → warn. Оператор подтянет в форму
    // (PostingJobYoutubeFields через fetchYoutubeCaption fallback на unapproved)
    // и сможет отредактировать перед submit'ом.
    expect(caption?.status).toBe("warn")
    dispose()
  })

  it("caption для youtube не существует (пустой массив) → blocker caption", async () => {
    $fetchMock.mockResolvedValue({ data: [] })
    const { preflight, dispose } = runInScope({
      account: makeAccount(),
      video: { id: 10, status: "completed" },
    })
    await new Promise((r) => setTimeout(r, 300))
    const caption = preflight.state.value.checks.find((c) => c.key === "caption")
    expect(caption?.status).toBe("blocker")
    dispose()
  })

  it("api postingMethod → не требует indigo и login", () => {
    $fetchMock.mockResolvedValue({ data: [] })
    const { preflight, dispose } = runInScope({
      account: makeAccount({
        postingMethod: "api",
        deviceProfileId: null,
        loginCheckedStatus: null,
        loginCheckedAt: null,
      }),
      video: { id: 10, status: "completed" },
    })
    const keys = preflight.state.value.checks.map((c) => c.key)
    expect(keys).not.toContain("indigo")
    expect(keys).not.toContain("login")
    dispose()
  })
})
