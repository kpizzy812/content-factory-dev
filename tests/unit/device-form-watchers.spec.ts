/**
 * Unit-тесты shared/utils/device-form-watchers — pure helpers, повторяющие логику
 * двух smart-watchers в `DeviceProfileEditModal.vue`.
 *
 * Watcher'ы в компоненте просто вызывают эти функции и spread'ят результат в form,
 * поэтому тест pure-функций гарантирует корректность реальной логики формы без
 * необходимости mount'ить Vue-компонент.
 *
 * Что покрываем:
 *   - applyPlatformDefaults — перезаписывает untouched поля при смене platformType,
 *     но сохраняет userTouched поля.
 *   - applyProxyDefaults — suggest language/timezone только если поля пустые И
 *     не userTouched.
 */
import { describe, expect, it } from "vitest"
import {
  applyPlatformDefaults,
  applyProxyDefaults,
} from "../../shared/utils/device-form-watchers"
import { DEVICE_DEFAULTS_BY_PLATFORM } from "../../shared/data/device-presets"

const desktopDefaults = DEVICE_DEFAULTS_BY_PLATFORM.desktop
const androidDefaults = DEVICE_DEFAULTS_BY_PLATFORM.mobile_android

describe("applyPlatformDefaults", () => {
  it("заполняет пустую форму defaults новой платформы (initial create)", () => {
    const changes = applyPlatformDefaults(
      { os: "", screenResolution: "", userAgent: "", fingerprint: {} as never },
      "desktop",
      null,
      {
        os: false,
        screenResolution: false,
        userAgent: false,
        fingerprint: false,
      },
    )
    expect(changes.os).toBe(desktopDefaults.os)
    expect(changes.screenResolution).toBe(desktopDefaults.resolution)
    expect(changes.userAgent).toBe(desktopDefaults.userAgent)
    expect(changes.fingerprint?.touchEnabled).toBe(desktopDefaults.touchEnabled)
  })

  it("перезаписывает поле, равное oldDefault (юзер не менял default)", () => {
    // Изначально desktop → user не трогал UA → переключение на android должно
    // перезаписать UA, потому что текущий UA это default desktop'а.
    const changes = applyPlatformDefaults(
      {
        os: desktopDefaults.os,
        screenResolution: desktopDefaults.resolution,
        userAgent: desktopDefaults.userAgent,
        fingerprint: {} as never,
      },
      "mobile_android",
      "desktop",
      {
        os: false,
        screenResolution: false,
        userAgent: false,
        fingerprint: false,
      },
    )
    expect(changes.os).toBe(androidDefaults.os)
    expect(changes.userAgent).toBe(androidDefaults.userAgent)
    expect(changes.screenResolution).toBe(androidDefaults.resolution)
  })

  it("сохраняет userTouched поля (юзер ввёл custom UA — не трогаем)", () => {
    const customUA = "Custom-UA/9.9.9"
    const changes = applyPlatformDefaults(
      {
        os: "Windows 10",
        screenResolution: "1440x900",
        userAgent: customUA,
        fingerprint: { foo: "bar" } as never,
      },
      "mobile_android",
      "desktop",
      {
        // userTouched=true для всех — значит юзер явно ввёл значения.
        os: true,
        screenResolution: true,
        userAgent: true,
        fingerprint: true,
      },
    )
    // os: текущий 'Windows 10' != oldDefault 'Windows 11' && userTouched → оставить
    expect(changes.os).toBeUndefined()
    // screen: '1440x900' != oldDefault '1920x1080' && userTouched → оставить
    expect(changes.screenResolution).toBeUndefined()
    // UA: custom != oldDefault && userTouched → оставить
    expect(changes.userAgent).toBeUndefined()
    // fingerprint userTouched → не трогаем
    expect(changes.fingerprint).toBeUndefined()
  })

  it("обновляет fingerprint только если НЕ userTouched.fingerprint", () => {
    const changes = applyPlatformDefaults(
      {
        os: "",
        screenResolution: "",
        userAgent: "",
        fingerprint: { foo: "bar" } as never,
      },
      "mobile_ios",
      "desktop",
      {
        os: false,
        screenResolution: false,
        userAgent: false,
        fingerprint: true, // юзер трогал fingerprint
      },
    )
    expect(changes.fingerprint).toBeUndefined()
  })

  it("возвращает {} для неизвестной платформы", () => {
    const changes = applyPlatformDefaults(
      { os: "", screenResolution: "", userAgent: "", fingerprint: {} as never },
      "unknown" as never,
      null,
      { os: false, screenResolution: false, userAgent: false, fingerprint: false },
    )
    expect(changes).toEqual({})
  })
})

describe("applyProxyDefaults", () => {
  it("suggests language/timezone из expectedCountry для пустых untouched полей", () => {
    const changes = applyProxyDefaults(
      { language: "", timezone: "" },
      { expectedCountry: "DE" },
      { language: false, timezone: false },
    )
    expect(changes.language).toBe("de-DE")
    expect(changes.timezone).toBe("Europe/Berlin")
  })

  it("не трогает уже заполненные поля (юзер выбрал en-US, прокси UK — оставляем)", () => {
    const changes = applyProxyDefaults(
      { language: "en-US", timezone: "America/New_York" },
      { expectedCountry: "GB" },
      { language: false, timezone: false }, // даже untouched — поля непустые
    )
    expect(changes.language).toBeUndefined()
    expect(changes.timezone).toBeUndefined()
  })

  it("не трогает userTouched поля даже если они пустые", () => {
    const changes = applyProxyDefaults(
      { language: "", timezone: "" },
      { expectedCountry: "FR" },
      { language: true, timezone: true },
    )
    expect(changes.language).toBeUndefined()
    expect(changes.timezone).toBeUndefined()
  })

  it("использует city-specific timezone для US", () => {
    const changes = applyProxyDefaults(
      { language: "", timezone: "" },
      { expectedCountry: "US", expectedCity: "Los Angeles" },
      { language: false, timezone: false },
    )
    expect(changes.language).toBe("en-US")
    expect(changes.timezone).toBe("America/Los_Angeles")
  })

  it("возвращает {} если у прокси нет expectedCountry", () => {
    expect(
      applyProxyDefaults(
        { language: "", timezone: "" },
        { expectedCountry: null },
        { language: false, timezone: false },
      ),
    ).toEqual({})
    expect(
      applyProxyDefaults(
        { language: "", timezone: "" },
        null,
        { language: false, timezone: false },
      ),
    ).toEqual({})
  })
})
