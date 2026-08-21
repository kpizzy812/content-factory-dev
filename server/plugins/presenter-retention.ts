/**
 * Nitro-плагин: суточная автоочистка записей ведущего.
 *
 * Правило — server/utils/presenter/recording-retention.ts (planRecordingRetention):
 * auto-запись без активных клипов удаляется через 180 дней, любая не-keep
 * запись старше 30 дней переводится в холодный класс хранения (cooledAt
 * фиксирует момент, а фактическую смену класса делает lifecycle-правило GCS
 * bucket по префиксу `recordings/`, см. docs/operations/presenter-library.md).
 * Пометка `keep` не трогается никогда.
 *
 * Без этого правила хранилище растёт линейно и навсегда: минута нормализованной
 * записи — 30-37 МБ, поток около 300 единиц материала в месяц — это от ~20 до
 * ~110 ГБ в месяц (spec §6.1).
 */

const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000

export default defineNitroPlugin((nitro) => {
  // Гейт scheduler'ов (тестовая инфраструктура). См. .env.test. Без него
  // проход будет удалять записи и файлы на стенде и в тестах.
  if (process.env.SCHEDULERS_ENABLED === "false") return

  const timer = trackedInterval("presenter-retention", "Автоочистка записей ведущего", RETENTION_INTERVAL_MS, async () => {
    try {
      const decisions = await applyRecordingRetention()
      const deleted = decisions.filter(d => d.action === "delete").length
      const cooled = decisions.filter(d => d.action === "cool").length
      // Пустой проход (нет кандидатов) не спамит лог — только когда правило
      // реально что-то сделало.
      if (deleted === 0 && cooled === 0) return

      await logAgent(
        "presenter-retention",
        "info",
        `Автоочистка записей ведущего: удалено ${deleted}, переведено в холодный класс ${cooled} `
        + `(проверено всего ${decisions.length})`,
      )
    }
    catch (error) {
      const message = error instanceof Error ? error.message : "Неизвестная ошибка"
      await logAgent("presenter-retention", "error", `Автоочистка записей ведущего: ${message}`).catch(() => {})
    }
  })

  nitro.hooks.hook("close", () => {
    clearInterval(timer)
  })
})
