import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const file = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8")

describe("content factory pipeline editor contract", () => {
  it("renders editors for strategy and both quality gates", () => {
    expect(existsSync(resolve(process.cwd(), "app/components/pipeline/config/ContentStrategyConfig.vue"))).toBe(true)
    expect(existsSync(resolve(process.cwd(), "app/components/pipeline/config/QualityGateConfig.vue"))).toBe(true)
    const form = file("app/components/pipeline/PipelineNodeConfigForm.vue")
    expect(form).toContain("PipelineConfigContentStrategyConfig")
    expect(form).toContain("nodeType === 'content_strategy'")
    expect(form).toContain("PipelineConfigQualityGateConfig")
    expect(form).toContain("nodeType === 'quality_gate'")
  })

  it("shows factory-managed official publishing without asking for a static account", () => {
    const upload = file("app/components/pipeline/config/UploadConfig.vue")
    expect(upload).toContain("config.factoryAssignments === true")
    expect(upload).toContain('v-if="config.factoryAssignments !== true"')
  })
})