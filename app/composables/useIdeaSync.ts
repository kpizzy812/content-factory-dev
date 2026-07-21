export function useIdeaSync() {
  async function importFromMc(params?: { appId?: number; limit?: number }) {
    return await $fetch('/api/ideas/sync/import', {
      method: 'POST',
      body: params ?? {},
    })
  }

  async function exportToMc(ideaIds: number[]) {
    return await $fetch('/api/ideas/sync/export', {
      method: 'POST',
      body: { ideaIds },
    })
  }

  async function resyncIdea(id: number, mode?: 'force_remote' | 'force_local') {
    return await $fetch(`/api/ideas/${id}/sync`, {
      method: 'POST',
      body: mode ? { mode } : {},
    })
  }

  function useSyncStatus() {
    return useFetch('/api/ideas/sync/status')
  }

  return { importFromMc, exportToMc, resyncIdea, useSyncStatus }
}
