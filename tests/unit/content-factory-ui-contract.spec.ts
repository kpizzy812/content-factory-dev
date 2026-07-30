import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

import { nodeTypeDescriptions, nodeTypeIcons, nodeTypeLabels } from "~~/app/utils/pipeline-node-meta"
import { NODE_TYPES } from "~~/shared/utils/pipeline-node-registry"

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

  it("describes every registered node type in the editor metadata", () => {
    const missing = NODE_TYPES.filter(type =>
      !nodeTypeLabels[type] || !nodeTypeDescriptions[type] || !nodeTypeIcons[type])
    expect(missing).toEqual([])
  })

  it("offers strategy and quality gate blocks in the palette and on the canvas", () => {
    const sidebar = file("app/components/pipeline/PipelineSidebar.vue")
    expect(sidebar).toContain("type: 'content_strategy'")
    expect(sidebar).toContain("type: 'quality_gate'")

    const canvas = file("app/components/pipeline/PipelineCanvas.vue")
    expect(canvas).toContain("content_strategy:")
    expect(canvas).toContain("quality_gate:")
  })

  it("validates imported pipelines against the shared node registry", () => {
    const modal = file("app/components/pipeline/PipelineImportModal.vue")
    expect(modal).toContain("isKnownNodeType")
    expect(modal).not.toContain("const KNOWN_NODE_TYPES = [")
  })
})

describe("presenter source clip library contract", () => {
  it("types presenter clips for the UI", () => {
    const types = file("shared/types/character.ts")
    expect(types).toContain("export interface PresenterSourceClip {")
    expect(types).toContain("sourceClips?: PresenterSourceClip[]")
  })

  it("uploads and retires clips through the official character endpoints", () => {
    const component = file("app/components/character/CharacterPresenterSourceClips.vue")
    expect(component).toContain("import type { PresenterSourceClip } from '~~/shared/types/character'")
    expect(component).toContain("/source-clips")
    expect(component).toContain("method: 'DELETE'")
  })

  it("mounts the clip library on the character page", () => {
    const page = file("app/pages/characters/[id].vue")
    expect(page).toContain("<CharacterPresenterSourceClips")
    expect(page).toContain(':character-id="character.id"')
  })
})