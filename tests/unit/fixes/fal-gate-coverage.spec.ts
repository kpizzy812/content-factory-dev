/**
 * P0-10: провайдер-зависимый fal-preflight в двух оставшихся точках запуска.
 *
 * До фикса `server/api/videos/generate.post.ts` и `server/utils/pipeline-engine.ts`
 * жили по правилу «любой статус != available валит запуск» и пробивали fal-пробой
 * ЛЮБУЮ настроенную модель. Из-за этого:
 *   1. транзиентный probe_error (5xx/таймаут fal) убивал прогон целиком;
 *   2. отсутствие FAL_KEY останавливало даже прогон на моделях Replicate,
 *      хотя по docs/PROJECT_CONTEXT.md §5 основной провайдер — Replicate,
 *      а fal только резерв;
 *   3. пробивались модели нод, которые в этом прогоне не исполняются
 *      (pinnedOutput / уже выполненная нода при resume).
 *
 * Сьюта чистая: ни сети, ни БД. Логика решения вынесена в
 * server/utils/fal-preflight-plan.ts, поэтому проверяем её напрямую, а обе точки
 * запуска — контрактом по исходнику (старый предикат не должен вернуться).
 *
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  evaluateFalPreflight,
  isFalHostedModel,
  planFalPreflightTargets,
} from "../../../server/utils/fal-preflight-plan"

// process.cwd(), а не import.meta.url — так же, как в остальных контракт-тестах.
const readSource = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8")

const GENERATE_ENDPOINT = "server/api/videos/generate.post.ts"
const PIPELINE_ENGINE = "server/utils/pipeline-engine.ts"

describe("P0-10: набор моделей для fal-preflight", () => {
  it("модель Replicate не попадает в probe — иначе прогон без FAL_KEY падает зря", () => {
    expect(isFalHostedModel("kwaivgi/kling-lip-sync")).toBe(false)
    expect(isFalHostedModel("black-forest-labs/flux-dev")).toBe(false)
    expect(isFalHostedModel("fal-ai/flux/dev")).toBe(true)

    expect(planFalPreflightTargets([
      "kwaivgi/kling-lip-sync",
      "black-forest-labs/flux-dev",
    ])).toEqual([])
  })

  it("оставляет только fal-модели, без дублей и пустых значений", () => {
    expect(planFalPreflightTargets([
      "fal-ai/flux/dev",
      null,
      undefined,
      "",
      "fal-ai/flux/dev",
      "kwaivgi/kling-lip-sync",
      "fal-ai/kling-video/v3/standard/text-to-video",
    ])).toEqual([
      "fal-ai/flux/dev",
      "fal-ai/kling-video/v3/standard/text-to-video",
    ])
  })
})

describe("P0-10: трактовка вердикта probe", () => {
  it("probe_error не блокирует, а даёт предупреждение", () => {
    const verdict = evaluateFalPreflight(new Map([
      ["fal-ai/flux/dev", { status: "probe_error", reason: "fal.ai вернул 503" }],
    ]))
    expect(verdict.blocking).toEqual([])
    expect(verdict.warnings).toEqual([
      { endpoint: "fal-ai/flux/dev", status: "probe_error", reason: "fal.ai вернул 503" },
    ])
  })

  it("no_api_key и blocked_by_access блокируют запуск", () => {
    const verdict = evaluateFalPreflight(new Map([
      ["fal-ai/flux/dev", { status: "no_api_key", reason: "API-ключ fal.ai не настроен (FAL_KEY)" }],
      ["fal-ai/kling-video/v3/standard/text-to-video", { status: "blocked_by_access", reason: "нет доступа" }],
    ]))
    expect(verdict.warnings).toEqual([])
    expect(verdict.blocking.map(b => b.endpoint)).toEqual([
      "fal-ai/flux/dev",
      "fal-ai/kling-video/v3/standard/text-to-video",
    ])
  })

  it("available не даёт ни блокировки, ни предупреждения", () => {
    const verdict = evaluateFalPreflight(new Map([
      ["fal-ai/flux/dev", { status: "available", reason: "Модель доступна" }],
    ]))
    expect(verdict).toEqual({ blocking: [], warnings: [] })
  })

  it("пустой probe (моделей fal в прогоне нет) — пустой вердикт", () => {
    expect(evaluateFalPreflight(null)).toEqual({ blocking: [], warnings: [] })
    expect(evaluateFalPreflight(new Map())).toEqual({ blocking: [], warnings: [] })
  })
})

describe("P0-10: обе точки запуска переведены на общий гейт", () => {
  for (const file of [GENERATE_ENDPOINT, PIPELINE_ENGINE]) {
    it(`${file} не валит запуск по «status !== available»`, () => {
      const source = readSource(file)
      // Старая семантика: любой не-available статус = отказ.
      expect(source).not.toMatch(/status\s*!==\s*['"]available['"]/)
      expect(source).toContain("evaluateFalPreflight")
      expect(source).toContain("planFalPreflightTargets")
    })
  }

  it("pipeline-engine не пробивает ноды с pinnedOutput и уже выполненные", () => {
    const source = readSource(PIPELINE_ENGINE)
    expect(source).toMatch(/type === 'video' && !n\.data\?\.pinnedOutput/)
    expect(source).toContain("pendingVideoNodes")
    expect(source).toContain("COMPLETED_STEP_STATUSES")
  })

  it("generate.post.ts возвращает предупреждения preflight вместо отказа", () => {
    const source = readSource(GENERATE_ENDPOINT)
    expect(source).toContain("preflightWarnings")
  })
})
