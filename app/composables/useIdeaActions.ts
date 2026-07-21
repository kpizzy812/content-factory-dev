export function useIdeaActions() {
  async function createIdea(data: {
    sourceUrl: string
    appId?: number
    language?: string
  }) {
    return await $fetch('/api/ideas', {
      method: 'POST',
      body: data,
    })
  }

  async function updateIdea(id: number, data: Record<string, unknown>) {
    return await $fetch(`/api/ideas/${id}`, {
      method: 'PUT',
      body: data,
    })
  }

  async function deleteIdea(id: number) {
    return await $fetch(`/api/ideas/${id}`, {
      method: 'DELETE',
    })
  }

  async function toScenario(id: number, variantsCount?: number) {
    return await $fetch(`/api/ideas/${id}/to-scenario`, {
      method: 'POST',
      body: variantsCount ? { variantsCount } : undefined,
    })
  }

  async function reanalyze(id: number) {
    return await $fetch(`/api/ideas/${id}/reanalyze`, {
      method: 'POST',
    })
  }

  async function analyzeReference(id: number) {
    return await $fetch(`/api/ideas/${id}/analyze-reference`, {
      method: 'POST',
    })
  }

  return { createIdea, updateIdea, deleteIdea, toScenario, reanalyze, analyzeReference }
}
