import { describe, expect, it } from "vitest"
import {
  ENTITY_STATUS_META,
  ENTITY_STATUSES,
  isEntityStatus,
} from "../../shared/utils/entity-status"
import { TREND_STATUS_TO_ENTITY, trendStatus } from "../../app/components/trend/TrendStatusMap"
import {
  VIDEO_STATUS_TO_ENTITY,
  VIDEO_STEP_IS_CHEAP,
  VIDEO_STEP_TO_ENTITY,
  videoStatus,
  videoStepStatus,
} from "../../app/components/video/VideoStatusMap"
import { STEP_ORDER, type StepKey } from "../../server/utils/video-pipeline-db"

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
      // Пошаговый режим (§9): ролик ждёт решения оператора, прогона за ним нет.
      "awaiting_operator",
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

  /**
   * Вторая половина ruling S8-1 (первую — `mapStepKeyToService` по всем ключам
   * `STEP_ORDER` — закрывает `tests/unit/balance-cost-attribution.spec.ts`).
   *
   * `VIDEO_STEP_IS_CHEAP` решает, покажется ли оператору инлайн-кнопка
   * перезапуска ПРЯМО В СТРОКЕ (`VideoStepsPanel.vue:44`) или шаг уйдёт в меню
   * с ценой. До этого теста поле не проверял НИ ОДИН тест: подмена
   * `shot_background: false → true` оставляла всю сьюту зелёной, а оператор
   * получал кнопку перезапуска самого дорогого шага маршрута ($0.03–1.00 за
   * прогон) без модалки с ценой — в один клик.
   *
   * `Record<StepKey, boolean>` с умыслом, тем же приёмом, что и таблица
   * `mapStepKeyToService`: добавят новый ключ в `StepKey`, а ожидание сюда не
   * допишут — TypeScript откажется собирать файл.
   */
  describe("таблица: VIDEO_STEP_IS_CHEAP размечает КАЖДЫЙ ключ STEP_ORDER (ruling S8-1)", () => {
    /** true — только локальное/копеечное; всё, что дёргает платные медиа-модели, обязано быть false. */
    const EXPECTATIONS: Record<StepKey, boolean> = {
      prompt_generation: false,
      image_generation: false,
      clip_generation: false,
      voiceover_generation: false,
      transcription: true,
      edit_plan: true,
      // Самый денежный шаг маршрута «монтаж от звука»: картинки на кадр плюс
      // генеративное видео (§7). В строку он попасть не имеет права.
      shot_background: false,
      music_generation: false,
      lip_sync_generation: false,
      assembly: true,
    }

    it.each(STEP_ORDER)("%s размечен и совпадает с таблицей", (stepKey) => {
      expect(VIDEO_STEP_IS_CHEAP[stepKey], stepKey).toBe(EXPECTATIONS[stepKey])
    })

    it("в карте нет ключей сверх STEP_ORDER — мёртвая разметка не решает судьбу кнопки", () => {
      expect(Object.keys(VIDEO_STEP_IS_CHEAP).sort()).toEqual([...STEP_ORDER].sort())
    })

    it("платные медиа-шаги перезапускаются только через меню с ценой", () => {
      const paidMediaSteps: StepKey[] = ["image_generation", "clip_generation", "lip_sync_generation", "shot_background"]
      for (const stepKey of paidMediaSteps) {
        expect(VIDEO_STEP_IS_CHEAP[stepKey], stepKey).toBe(false)
      }
    })
  })

  it("неизвестное значение не притворяется готовым", () => {
    expect(trendStatus("что-то новое")).toBe("draft")
    expect(videoStatus(null)).toBe("draft")
    expect(videoStepStatus(undefined)).toBe("queued")
  })
})
