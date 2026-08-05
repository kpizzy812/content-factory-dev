/**
 * Запуск генерации сценария.
 *
 * Сервер отвечает сразу и делает работу в фоне: полный проход агентов идёт пять
 * и больше минут, а прокси рвёт HTTP-запрос на сотой секунде. Поэтому здесь
 * опрос статуса, а не ожидание ответа.
 */

const POLL_INTERVAL_MS = 5_000
const POLL_TIMEOUT_MS = 15 * 60 * 1000

interface ScenarioStatus {
  id: number
  status: string
  generationStatus: string | null
}

export function useGenerateScenarios() {
  const isGenerating = ref(false)
  const error = ref<string | null>(null)

  async function generate(trendId: number, variantsCount?: number, profileId?: number | null) {
    isGenerating.value = true
    error.value = null

    try {
      const started = await $fetch<{ data: { id: number } }>('/api/scenarios/generate', {
        method: 'POST',
        body: { trendId, variantsCount, profileId: profileId || undefined },
      })

      const scenarioId = started?.data?.id
      if (!scenarioId) throw new Error('Сервер не вернул id сценария')

      const deadline = Date.now() + POLL_TIMEOUT_MS
      while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))

        const polled = await $fetch<{ data: ScenarioStatus }>(`/api/scenarios/${scenarioId}`)
        const scenario = polled?.data
        if (!scenario) continue

        if (scenario.status !== 'generating') {
          // Раннер кладёт причину в generationStatus и возвращает сценарий в draft.
          if (scenario.generationStatus?.startsWith('failed')) {
            throw new Error(scenario.generationStatus.replace(/^failed:\s*/, ''))
          }
          return polled
        }
      }

      throw new Error('Генерация не завершилась за 15 минут — проверьте статус сценария вручную')
    } catch (e: unknown) {
      const message =
        (e as { data?: { message?: string } })?.data?.message
        ?? (e instanceof Error ? e.message : 'Неизвестная ошибка')
      error.value = message
      return null
    } finally {
      isGenerating.value = false
    }
  }

  return { isGenerating, error, generate }
}
