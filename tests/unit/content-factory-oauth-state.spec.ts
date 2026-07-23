import { describe, expect, it } from "vitest"

import {
  createSocialOAuthState,
  verifySocialOAuthState,
} from "../../server/utils/social/oauth-state"

const secret = "a".repeat(64)

describe("social OAuth state", () => {
  it("round-trips a short-lived state bound to user and app", () => {
    const state = createSocialOAuthState({
      platform: "instagram",
      appId: 12,
      userId: 4,
      expiresAt: 2_000,
      nonce: "nonce",
    }, secret)

    expect(verifySocialOAuthState(state, secret, 1_500)).toEqual({
      platform: "instagram",
      appId: 12,
      userId: 4,
      expiresAt: 2_000,
      nonce: "nonce",
    })
  })

  it("rejects tampering and expired state", () => {
    const state = createSocialOAuthState({
      platform: "instagram",
      appId: 12,
      userId: 4,
      expiresAt: 2_000,
      nonce: "nonce",
    }, secret)

    expect(() => verifySocialOAuthState(`${state}x`, secret, 1_500)).toThrow()
    expect(() => verifySocialOAuthState(state, secret, 2_001)).toThrow("expired")
  })
})
