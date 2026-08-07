/**
 * Резолвер активной воронки юнита для генерации сценария.
 *
 * Живёт отдельным модулем, потому что путей два (ручной эндпоинт и нода
 * конвейера), а формат для генератора обязан быть одинаковым: иначе автопрогон
 * уезжает в CTA «назови приложение и скачай» вместо кодового слова в директ
 * (docs/PROJECT_CONTEXT.md §9).
 *
 * Обращение к БД вынесено в подставляемую функцию lookup — так выбор воронки
 * проверяется тестом без базы.
 */

/** Воронка в объёме, который понимает генератор сценария (см. ScenarioFunnel). */
export interface ScenarioFunnelPayload {
  keyword: string
  leadMagnetTitle: string | null
}

export interface ScenarioFunnelRecord {
  id: string
  keyword: string
  leadMagnet?: { title: string } | null
}

export interface ResolveScenarioFunnelResult {
  funnel: ScenarioFunnelPayload | null
  /** Откуда взята воронка: явный id партии фабрики или последняя активная у юнита. */
  source: "factory" | "active" | "none"
  /**
   * Расхождение, которое стоит показать оператору. Логирует вызывающий —
   * модуль намеренно не знает про logAgent, чтобы оставаться DB/IO-free.
   */
  warning: string | null
}

export type ScenarioFunnelLookup = (args: {
  appId: number
  funnelId?: string
}) => Promise<ScenarioFunnelRecord | null>

/** Дефолтный поиск: только активные воронки юнита, самая свежая по updatedAt. */
const prismaFunnelLookup: ScenarioFunnelLookup = async ({ appId, funnelId }) => {
  return prisma.contentFunnel.findFirst({
    where: { appId, status: "active", ...(funnelId ? { id: funnelId } : {}) },
    orderBy: { updatedAt: "desc" },
    select: { id: true, keyword: true, leadMagnet: { select: { title: true } } },
  })
}

function toPayload(record: ScenarioFunnelRecord): ScenarioFunnelPayload {
  return { keyword: record.keyword, leadMagnetTitle: record.leadMagnet?.title ?? null }
}

/**
 * @param appId  юнит, для которого генерируется сценарий
 * @param funnelId  воронка из контекста фабрики — у неё приоритет: партия уже
 *                  выбрала, каким кодовым словом собирает лиды
 */
export async function resolveScenarioFunnel(
  appId: number,
  funnelId?: string,
  lookup: ScenarioFunnelLookup = prismaFunnelLookup,
): Promise<ResolveScenarioFunnelResult> {
  let warning: string | null = null

  if (funnelId) {
    const explicit = await lookup({ appId, funnelId })
    if (explicit) {
      return { funnel: toPayload(explicit), source: "factory", warning: null }
    }
    // Воронку партии могли выключить или перепривязать к другому юниту — не
    // молчим, но и не валим прогон: берём то, что у юнита активно сейчас.
    warning = `Воронка ${funnelId} из контекста фабрики не активна у юнита ${appId} — берём последнюю активную воронку юнита.`
  }

  const active = await lookup({ appId })
  if (active) {
    return { funnel: toPayload(active), source: "active", warning }
  }

  return { funnel: null, source: "none", warning }
}
