import { describe, expect, it } from "vitest"
import {
  isTerminalPredictionStatus,
  sanitizePredictionSnapshot,
  transitionPredictionStatus,
} from "../../../server/utils/replicate/prediction-state"

describe("Replicate prediction state", () => {
  it("accepts the normal starting to processing to succeeded flow", () => {
    const processing = transitionPredictionStatus("starting", "processing")
    const succeeded = transitionPredictionStatus(processing.status, "succeeded")

    expect(processing).toEqual({ status: "processing", changed: true, terminal: false })
    expect(succeeded).toEqual({ status: "succeeded", changed: true, terminal: true })
  })

  it("treats a duplicate terminal event as a no-op", () => {
    expect(transitionPredictionStatus("succeeded", "succeeded")).toEqual({
      status: "succeeded",
      changed: false,
      terminal: true,
    })
  })

  it("rejects a late non-terminal event after success", () => {
    expect(() => transitionPredictionStatus("succeeded", "processing"))
      .toThrow("terminal prediction")
  })

  it("recognizes every terminal state", () => {
    expect(isTerminalPredictionStatus("succeeded")).toBe(true)
    expect(isTerminalPredictionStatus("failed")).toBe(true)
    expect(isTerminalPredictionStatus("canceled")).toBe(true)
    expect(isTerminalPredictionStatus("processing")).toBe(false)
  })

  it("redacts secrets recursively before persistence", () => {
    expect(sanitizePredictionSnapshot({
      input: { video_url: "https://cdn.example.com/video.mp4" },
      authorization: "Bearer secret",
      nested: {
        apiToken: "secret-token",
        signing_secret: "secret-signature",
        keep: "safe",
      },
    })).toEqual({
      input: { video_url: "https://cdn.example.com/video.mp4" },
      authorization: "[REDACTED]",
      nested: {
        apiToken: "[REDACTED]",
        signing_secret: "[REDACTED]",
        keep: "safe",
      },
    })
  })
})
