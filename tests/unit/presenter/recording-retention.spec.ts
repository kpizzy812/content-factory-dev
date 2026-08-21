import { describe, expect, it } from "vitest"

import { planRecordingRetention } from "~~/server/utils/presenter/recording-retention"

const DAY = 24 * 60 * 60 * 1000
const NOW = 1_700_000_000_000

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: "rec-1",
    retention: "auto",
    activeClipCount: 0,
    createdAtMs: NOW - 200 * DAY,
    cooledAtMs: null,
    ...overrides,
  }
}

describe("правило хранения записей ведущего", () => {
  it("удаляет auto-запись без активных клипов после срока", () => {
    const [decision] = planRecordingRetention({ candidates: [candidate()], now: NOW })

    expect(decision).toMatchObject({ action: "delete" })
  })

  it("не трогает запись, помеченную keep", () => {
    // Ручная пометка — единственная защита ценного материала: пересъёмка стоит
    // дороже гигабайтов.
    const [decision] = planRecordingRetention({
      candidates: [candidate({ retention: "keep" })],
      now: NOW,
    })

    expect(decision).toMatchObject({ action: "keep" })
  })

  it("не удаляет запись, у которой остались живые клипы", () => {
    // Клип уехал в готовые ролики; снести его родителя значит потерять
    // возможность перенарезать материал, ради которой запись и хранится.
    const [decision] = planRecordingRetention({
      candidates: [candidate({ activeClipCount: 4 })],
      now: NOW,
    })

    expect(decision.action).not.toBe("delete")
  })

  it("переводит в холодный класс через 30 дней, а не сразу", () => {
    const fresh = planRecordingRetention({
      candidates: [candidate({ createdAtMs: NOW - 5 * DAY, activeClipCount: 3 })],
      now: NOW,
    })[0]!
    const old = planRecordingRetention({
      candidates: [candidate({ createdAtMs: NOW - 40 * DAY, activeClipCount: 3 })],
      now: NOW,
    })[0]!

    expect(fresh.action).toBe("keep")
    expect(old.action).toBe("cool")
  })

  it("уже охлаждённую запись второй раз не охлаждает", () => {
    const [decision] = planRecordingRetention({
      candidates: [candidate({ createdAtMs: NOW - 40 * DAY, activeClipCount: 3, cooledAtMs: NOW - 3 * DAY })],
      now: NOW,
    })

    expect(decision.action).toBe("keep")
  })

  it("принимает свои сроки — политика настраивается без правки кода", () => {
    const [decision] = planRecordingRetention({
      candidates: [candidate({ createdAtMs: NOW - 10 * DAY })],
      now: NOW,
      deleteAfterMs: 7 * DAY,
    })

    expect(decision.action).toBe("delete")
  })
})
