/**
 * Composable для обогащения приложения через store URL.
 * Поддерживает два режима:
 * 1. enrich(appId, storeUrl) — для существующих приложений (сохраняет в БД)
 * 2. enrichPreview(storeUrl, context) — для новых приложений (возвращает данные в memory)
 */
import type { AdminApp, AppEnrichResult } from '~~/shared/types/app'

export function useAppEnrich() {
  const enriching = ref(false)
  const enrichResult = ref<AppEnrichResult | null>(null)
  const enrichError = ref('')
  const enrichmentMeta = ref<Record<string, unknown> | null>(null)

  async function enrich(appId: number, storeUrl: string): Promise<{ app: AdminApp | null; result: AppEnrichResult | null }> {
    if (!storeUrl.trim()) {
      enrichError.value = 'Введите ссылку App Store или Google Play'
      return { app: null, result: null }
    }

    enriching.value = true
    enrichError.value = ''
    enrichResult.value = null

    try {
      const response = await $fetch<{ data: AdminApp; enrichResult: AppEnrichResult }>(
        `/api/admin/apps/${appId}/enrich`,
        { method: 'POST', body: { storeUrl: storeUrl.trim() } },
      )

      enrichResult.value = response.enrichResult
      return { app: response.data, result: response.enrichResult }
    }
    catch (e: any) {
      const msg = e?.data?.message || e?.message || 'Ошибка обогащения'
      enrichError.value = msg
      return { app: null, result: null }
    }
    finally {
      enriching.value = false
    }
  }

  /**
   * Pre-save enrichment: запрашивает parse + AI без сохранения в БД.
   * Возвращает formFields для заполнения формы и enrichmentMeta для передачи при create.
   */
  async function enrichPreview(
    storeUrl: string,
    context?: { appName?: string; description?: string; keywords?: string[]; geo?: string; language?: string; useUrlLocale?: boolean },
  ): Promise<{ formFields: Record<string, unknown> | null; result: AppEnrichResult | null }> {
    if (!storeUrl.trim()) {
      enrichError.value = 'Введите ссылку App Store или Google Play'
      return { formFields: null, result: null }
    }

    enriching.value = true
    enrichError.value = ''
    enrichResult.value = null
    enrichmentMeta.value = null

    try {
      const response = await $fetch<{
        data: AppEnrichResult
        formFields?: Record<string, unknown>
        enrichmentMeta?: Record<string, unknown>
      }>('/api/admin/apps/enrich-preview', {
        method: 'POST',
        body: {
          storeUrl: storeUrl.trim(),
          appName: context?.appName,
          description: context?.description,
          keywords: context?.keywords,
          geo: context?.geo,
          language: context?.language,
          useUrlLocale: context?.useUrlLocale,
        },
      })

      enrichResult.value = response.data
      enrichmentMeta.value = response.enrichmentMeta ?? null
      return { formFields: response.formFields ?? null, result: response.data }
    }
    catch (e: any) {
      const msg = e?.data?.message || e?.message || 'Ошибка обогащения'
      enrichError.value = msg
      return { formFields: null, result: null }
    }
    finally {
      enriching.value = false
    }
  }

  return {
    enriching: readonly(enriching),
    enrichResult: readonly(enrichResult),
    enrichError: readonly(enrichError),
    enrichmentMeta: readonly(enrichmentMeta),
    enrich,
    enrichPreview,
  }
}
