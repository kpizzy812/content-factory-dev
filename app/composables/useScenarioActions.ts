export function useScenarioActions() {
  async function selectVariant(scenarioId: number, variantId: number) {
    return await $fetch(`/api/scenarios/${scenarioId}/select`, {
      method: 'PUT',
      body: { variantId },
    })
  }

  async function rejectVariant(scenarioId: number, variantId: number, reason?: string) {
    return await $fetch(`/api/scenarios/${scenarioId}/reject`, {
      method: 'PUT',
      body: { variantId, reason },
    })
  }

  async function reworkVariant(scenarioId: number, variantId: number, reason?: string) {
    return await $fetch(`/api/scenarios/${scenarioId}/rework`, {
      method: 'PUT',
      body: { variantId, reason },
    })
  }

  async function deleteScenario(scenarioId: number) {
    return await $fetch(`/api/scenarios/${scenarioId}`, {
      method: 'DELETE',
    })
  }

  async function updateVariant(scenarioId: number, variantId: number, data: Record<string, string>) {
    return await $fetch(`/api/scenarios/${scenarioId}`, {
      method: 'PUT',
      body: { variantId, ...data },
    })
  }

  async function regenerateBlock(
    scenarioId: number,
    variantId: number,
    blockType: string,
    reason?: string,
  ) {
    return await $fetch(`/api/scenarios/${scenarioId}/regenerate-block`, {
      method: 'POST',
      body: { variantId, blockType, reason },
    })
  }

  async function improveVisualStyle(scenarioId: number, variantId: number) {
    return await $fetch(`/api/scenarios/${scenarioId}/improve-visual-style`, {
      method: 'POST',
      body: { variantId },
    })
  }

  async function reworkRegenerate(scenarioId: number, variantId: number) {
    return await $fetch(`/api/scenarios/${scenarioId}/rework-regenerate`, {
      method: 'POST',
      body: { variantId },
    })
  }

  return {
    selectVariant,
    rejectVariant,
    reworkVariant,
    deleteScenario,
    updateVariant,
    regenerateBlock,
    improveVisualStyle,
    reworkRegenerate,
  }
}
