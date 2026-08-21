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
    ingestStatus: "completed",
    lastUsedAtMs: null,
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

  // Critical из ревью (фикс-раунд 1): audio-first-подбор берёт окно ИЗ
  // ЗАПИСИ напрямую (server/utils/presenter-recording-selector.ts,
  // reserveRecordingWindow), не спрашивая PresenterSourceClip вовсе. Запись
  // без единого активного клипа, но с недавним PresenterRecordingUsage,
  // реально используется каждую неделю — activeClipCount один этого не видит.
  it("не удаляет запись без активных клипов, если её недавно использовали напрямую (audio-first)", () => {
    const [decision] = planRecordingRetention({
      candidates: [candidate({ activeClipCount: 0, lastUsedAtMs: NOW - 3 * DAY })],
      now: NOW,
    })

    expect(decision.action).not.toBe("delete")
  })

  it("удаляет запись без активных клипов, если использование давно остыло (старше срока удаления)", () => {
    const [decision] = planRecordingRetention({
      candidates: [candidate({ activeClipCount: 0, lastUsedAtMs: NOW - 200 * DAY })],
      now: NOW,
    })

    expect(decision.action).toBe("delete")
  })

  // Мелочь 1 из ревью: защищена должна быть только ТОЧНАЯ строка "auto", а не
  // "всё, что не keep". Нераспознанное значение — баг вызывающего или будущее
  // расширение схемы — не должно ехать по auto-ветке.
  it("не удаляет запись с нераспознанным значением retention — безопаснее ошибиться в защиту", () => {
    const [decision] = planRecordingRetention({
      candidates: [candidate({ retention: "legal-hold" })],
      now: NOW,
    })

    expect(decision.action).toBe("keep")
  })

  // Мелочь 2 из ревью: гонка с reingestRecording — проход не должен сносить
  // файл или его класс хранения из-под работающей нарезки той же записи.
  it("не трогает запись, у которой нарезка (ingestStatus: running) идёт прямо сейчас", () => {
    const [decision] = planRecordingRetention({
      candidates: [candidate({ ingestStatus: "running" })],
      now: NOW,
    })

    expect(decision.action).toBe("keep")
  })
})
