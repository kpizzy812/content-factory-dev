import { describe, expect, it } from "vitest"

import {
  UnconfirmedExpensiveActionError,
  approveStep,
  cloneVoice,
  previewTrackRegeneration,
  regenerateTrack,
  replaceSegment,
  rerenderShot,
  setStepwise,
} from "../../../app/components/video/edit-console-api"
import { VOICE_CLONE_USD } from "../../../shared/types/edit-console"

/**
 * Главное требование монтажной консоли: дорогое действие не должно выглядеть и
 * вести себя как дешёвое. Компонентных тестов в проекте нет, поэтому доказывать
 * приходится на слое, который реально ходит в сеть: без подтверждения суммы
 * запрос не уходит вовсе.
 */

interface Call { url: string, method?: string, body?: unknown }

function recorder() {
  const calls: Call[] = []
  const fetcher = async <T = unknown>(url: string, options?: { method?: string, body?: unknown }) => {
    calls.push({ url, method: options?.method, body: options?.body })
    return { data: {} } as T
  }
  return { calls, fetcher }
}

function sampleFile() {
  return new File([new Uint8Array([1, 2, 3])], "sample.mp3", { type: "audio/mpeg" })
}

describe("перегенерация трека — подтверждение суммы", () => {
  it("без подтверждения не делает ни одного запроса", async () => {
    const { calls, fetcher } = recorder()

    await expect(regenerateTrack(fetcher, 42, { acknowledged: false }))
      .rejects.toBeInstanceOf(UnconfirmedExpensiveActionError)

    expect(calls).toHaveLength(0)
  })

  it("подтверждённая перегенерация шлёт confirmExpensive: true", async () => {
    const { calls, fetcher } = recorder()

    await regenerateTrack(fetcher, 42, { acknowledged: true })

    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe("/api/videos/42/voiceover/regenerate-track")
    expect(calls[0]!.method).toBe("POST")
    expect(calls[0]!.body).toEqual({ confirmExpensive: true })
  })

  it("force не подменяет подтверждение", async () => {
    const { calls, fetcher } = recorder()

    await expect(regenerateTrack(fetcher, 42, { acknowledged: false, force: true }))
      .rejects.toBeInstanceOf(UnconfirmedExpensiveActionError)
    expect(calls).toHaveLength(0)

    await regenerateTrack(fetcher, 42, { acknowledged: true, force: true })
    expect(calls[0]!.body).toEqual({ confirmExpensive: true, force: true })
  })

  it("запрос сметы идёт БЕЗ confirmExpensive — сервер на него ничего не запускает", async () => {
    const { calls, fetcher } = recorder()

    await previewTrackRegeneration(fetcher, 7)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.body).toEqual({})
    expect(JSON.stringify(calls[0]!.body)).not.toContain("confirmExpensive")
  })

  it("смету достаёт из ответа 400, а не роняет экран", async () => {
    const preview = {
      sceneCount: 20,
      characters: 1830,
      changedSceneOrders: [3, 7],
      voiceChanged: false,
      shotsToRebuild: 42,
      lipSyncSecondsToRepay: 61.4,
      estimatedCostUsd: 14.31,
    }
    const failing = async () => {
      // Форма ofetch: тело ошибки в err.data, наши данные h3 кладёт ещё в data.
      throw Object.assign(new Error("400"), { data: { data: { preview } } })
    }

    const result = await previewTrackRegeneration(failing, 7)

    expect(result.preview).toEqual(preview)
    expect(result.error).toBeTruthy()
  })
})

describe("клон голоса — подтверждение суммы", () => {
  it("без подтверждения файл в сеть не уходит", async () => {
    const { calls, fetcher } = recorder()

    await expect(cloneVoice(fetcher, "chr_1", {
      file: sampleFile(),
      targetModel: "speech-02-turbo",
      confirmedUsd: 0,
    })).rejects.toBeInstanceOf(UnconfirmedExpensiveActionError)

    expect(calls).toHaveLength(0)
  })

  it("подтверждение другой суммой не считается подтверждением", async () => {
    const { calls, fetcher } = recorder()

    await expect(cloneVoice(fetcher, "chr_1", {
      file: sampleFile(),
      targetModel: "speech-02-turbo",
      confirmedUsd: 1,
    })).rejects.toBeInstanceOf(UnconfirmedExpensiveActionError)

    expect(calls).toHaveLength(0)
  })

  it("подтверждённый клон шлёт confirmUsd, равный цене прогона", async () => {
    const { calls, fetcher } = recorder()

    await cloneVoice(fetcher, "chr_1", {
      file: sampleFile(),
      targetModel: "speech-02-hd",
      confirmedUsd: VOICE_CLONE_USD,
      noiseReduction: true,
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe("/api/characters/chr_1/clone-voice")
    const form = calls[0]!.body as FormData
    expect(form.get("confirmUsd")).toBe(String(VOICE_CLONE_USD))
    expect(form.get("targetModel")).toBe("speech-02-hd")
    expect(form.get("noiseReduction")).toBe("true")
    // Не запрошенные опции не досылаются — сервер их не должен домысливать.
    expect(form.get("volumeNormalization")).toBeNull()
  })
})

describe("дешёвые действия подтверждения не спрашивают", () => {
  it("замена фразы уходит сразу", async () => {
    const { calls, fetcher } = recorder()

    await replaceSegment(fetcher, 42, { sceneOrder: 3, newText: "Новая фраза" })

    expect(calls).toEqual([{
      url: "/api/videos/42/voiceover/replace-segment",
      method: "POST",
      body: { sceneOrder: 3, newText: "Новая фраза" },
    }])
  })

  it("пересборка кадра адресуется по номеру кадра, тела нет", async () => {
    const { calls, fetcher } = recorder()

    await rerenderShot(fetcher, 42, 7)

    expect(calls[0]!.url).toBe("/api/videos/42/shots/7/rerender")
    expect(calls[0]!.body).toBeUndefined()
  })

  it("пошаговый режим шлёт ключ даже при null — это законное значение", async () => {
    const { calls, fetcher } = recorder()

    await setStepwise(fetcher, 42, null)

    expect(calls[0]!.body).toEqual({ stepwiseApproval: null })
    expect(Object.keys(calls[0]!.body as object)).toContain("stepwiseApproval")
  })

  it("решение оператора передаётся явным действием", async () => {
    const { calls, fetcher } = recorder()

    await approveStep(fetcher, 42, "reject")

    expect(calls[0]!.url).toBe("/api/videos/42/approve-step")
    expect(calls[0]!.body).toEqual({ action: "reject" })
  })
})
