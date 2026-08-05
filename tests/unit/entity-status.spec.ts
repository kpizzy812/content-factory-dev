import { describe, expect, it } from "vitest"
import {
  ENTITY_STATUS_META,
  ENTITY_STATUSES,
  isEntityStatus,
} from "../../shared/utils/entity-status"
import { TREND_STATUS_TO_ENTITY, trendStatus } from "../../app/components/trend/TrendStatusMap"
import {
  VIDEO_STATUS_TO_ENTITY,
  VIDEO_STEP_TO_ENTITY,
  videoStatus,
  videoStepStatus,
} from "../../app/components/video/VideoStatusMap"

/**
 * Единая семантика статусов — контракт на всё приложение. На неё завязаны
 * все списки и детальные страницы, поэтому расхождения здесь дороже, чем
 * где-либо ещё: доменный маппер, вернувший неизвестное значение, молча
 * покрасит объект в «черновик».
 */
describe("словарь статусов", () => {
  it("у каждого статуса есть подпись, тон и иконка", () => {
    for (const status of ENTITY_STATUSES) {
      const meta = ENTITY_STATUS_META[status]
      expect(meta, status).toBeDefined()
      expect(meta.label.length, status).toBeGreaterThan(0)
      expect(meta.icon, status).toMatch(/^mingcute:/)
      expect(["neutral", "info", "success", "warning", "danger"]).toContain(meta.tone)
    }
  })

  it("подписи не повторяются — иначе два состояния не различить в интерфейсе", () => {
    const labels = ENTITY_STATUSES.map(s => ENTITY_STATUS_META[s].label)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it("пульсирует только то, что идёт прямо сейчас", () => {
    const live = ENTITY_STATUSES.filter(s => ENTITY_STATUS_META[s].live)
    expect(live).toEqual(["running"])
  })

  it("приглушены только тупиковые состояния", () => {
    const muted = ENTITY_STATUSES.filter(s => ENTITY_STATUS_META[s].muted)
    expect(muted.sort()).toEqual(["blocked", "cancelled"])
  })

  it("isEntityStatus отсекает чужие значения", () => {
    expect(isEntityStatus("running")).toBe(true)
    expect(isEntityStatus("in_work")).toBe(false)
  })
})

describe("доменные мапперы", () => {
  const mappers: Array<[string, Record<string, string>]> = [
    ["тренд", TREND_STATUS_TO_ENTITY],
    ["видео", VIDEO_STATUS_TO_ENTITY],
    ["шаг видео", VIDEO_STEP_TO_ENTITY],
  ]

  it.each(mappers)("%s отображается только в известные статусы", (_name, map) => {
    for (const value of Object.values(map)) {
      expect(isEntityStatus(value)).toBe(true)
    }
  })

  it("покрывают весь enum TrendStatus из схемы", () => {
    expect(Object.keys(TREND_STATUS_TO_ENTITY).sort()).toEqual(
      ["completed", "dismissed", "in_work", "new", "reviewed"],
    )
  })

  it("покрывают весь enum VideoStatus из схемы", () => {
    expect(Object.keys(VIDEO_STATUS_TO_ENTITY).sort()).toEqual([
      "assembling",
      "canceled",
      "completed",
      "configuring",
      "failed",
      "generating_clips",
      "generating_images",
      "generating_music",
      "generating_prompts",
      "generating_voiceover",
      "pending",
      "timeout",
    ])
  })

  it("покрывают весь enum VideoStepStatus из схемы", () => {
    expect(Object.keys(VIDEO_STEP_TO_ENTITY).sort()).toEqual([
      "canceled",
      "completed",
      "failed",
      "pending",
      "queued",
      "running",
      "skipped",
      "timeout",
    ])
  })

  it("таймаут — это ошибка, а не отмена: его повторяют", () => {
    expect(videoStatus("timeout")).toBe("failed")
    expect(videoStepStatus("timeout")).toBe("failed")
  })

  it("пропущенный шаг не выглядит успешным", () => {
    expect(videoStepStatus("skipped")).toBe("cancelled")
  })

  it("неизвестное значение не притворяется готовым", () => {
    expect(trendStatus("что-то новое")).toBe("draft")
    expect(videoStatus(null)).toBe("draft")
    expect(videoStepStatus(undefined)).toBe("queued")
  })
})
