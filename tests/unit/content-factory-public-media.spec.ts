import { describe, expect, it } from "vitest"

import {
  createPublicMediaToken,
  verifyPublicMediaToken,
} from "../../server/utils/social/public-media"

const secret = "b".repeat(64)

describe("signed public media token", () => {
  it("allows a time-limited storage read", () => {
    const token = createPublicMediaToken({
      source: "storage",
      path: "zavodcamp/videos/1/final.mp4",
      expiresAt: 10_000,
    }, secret)

    expect(verifyPublicMediaToken(token, secret, 9_000)).toEqual({
      source: "storage",
      path: "zavodcamp/videos/1/final.mp4",
      expiresAt: 10_000,
    })
  })

  it("rejects modified and expired links", () => {
    const token = createPublicMediaToken({
      source: "storage",
      path: "zavodcamp/videos/1/final.mp4",
      expiresAt: 10_000,
    }, secret)

    expect(() => verifyPublicMediaToken(`${token}x`, secret, 9_000)).toThrow()
    expect(() => verifyPublicMediaToken(token, secret, 10_001)).toThrow("expired")
  })
})
