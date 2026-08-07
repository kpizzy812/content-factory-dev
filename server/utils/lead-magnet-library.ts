/**
 * Библиотека лид-магнитов: жизненный цикл статуса и подбор готового материала.
 *
 * ПОЧЕМУ этот модуль существует:
 *  1. Флагманский пресет требует утверждённый лид-магнит (`requireApprovedLeadMagnet`),
 *     а гейт качества (`content-quality-gate.ts`) сравнивает статус со строкой
 *     'approved'. Раз статус — это ворота к запуску партии, переходы между
 *     статусами должны быть явными и проверяемыми, а не «любая строка из тела
 *     запроса». Иначе оператор одним PATCH переведёт архивный материал в
 *     утверждённый и партия уедет в производство с отозванным магнитом.
 *  2. Раньше на КАЖДЫЙ прогон партии создавался новый черновик магнита (до 300
 *     штук в сутки), хотя в библиотеке приложения уже лежал подходящий и часто
 *     уже утверждённый материал. Подбор из библиотеки — единственный способ
 *     не плодить мусор и не заставлять оператора утверждать одно и то же заново.
 */

/** Статусы лид-магнита. Совпадают со значениями, которые пишет API создания. */
export const LEAD_MAGNET_STATUSES = ['draft', 'approved', 'archived'] as const

export type LeadMagnetStatus = (typeof LEAD_MAGNET_STATUSES)[number]

/**
 * Разрешённые переходы. Осознанно НЕТ перехода archived → approved:
 * архивный материал сначала возвращают в черновик и перечитывают, и только
 * потом утверждают — иначе «утверждение» становится формальностью.
 */
export const LEAD_MAGNET_STATUS_TRANSITIONS: Record<LeadMagnetStatus, readonly LeadMagnetStatus[]> = {
  draft: ['approved', 'archived'],
  approved: ['draft', 'archived'],
  archived: ['draft'],
}

export function isLeadMagnetStatus(value: unknown): value is LeadMagnetStatus {
  return typeof value === 'string' && (LEAD_MAGNET_STATUSES as readonly string[]).includes(value)
}

/**
 * Допустим ли переход. Переход «в самого себя» допустимым НЕ считается:
 * вызывающий код должен сам решить, что это — идемпотентный no-op (как в PATCH)
 * или ошибка. Так решение видно в коде, а не прячется в этой таблице.
 */
export function canTransitionLeadMagnetStatus(from: unknown, to: unknown): boolean {
  if (!isLeadMagnetStatus(from) || !isLeadMagnetStatus(to)) return false
  return LEAD_MAGNET_STATUS_TRANSITIONS[from].includes(to)
}

/** Человекочитаемое объяснение отказа — уходит оператору в тело ошибки. */
export function describeLeadMagnetTransition(from: unknown, to: unknown): string {
  if (!isLeadMagnetStatus(to)) {
    return `Неизвестный статус лид-магнита. Допустимы: ${LEAD_MAGNET_STATUSES.join(', ')}`
  }
  if (!isLeadMagnetStatus(from)) return 'У лид-магнита неизвестный текущий статус'
  const allowed = LEAD_MAGNET_STATUS_TRANSITIONS[from]
  return allowed.length
    ? `Переход «${from}» → «${to}» запрещён. Из «${from}» можно только в: ${allowed.join(', ')}`
    : `Из статуса «${from}» переходы запрещены`
}

// ───────────────────────── подбор из библиотеки ─────────────────────────

/** Минимальная доля совпавших основ, при которой материал считаем подходящим. */
export const LEAD_MAGNET_REUSE_MIN_SCORE = 0.4

/** Приоритет статуса при равной близости: утверждённый ценнее черновика. */
const STATUS_RANK: Record<string, number> = { approved: 2, draft: 1 }

/**
 * Грубая основа слова: первые 4 символа. Полноценной морфологии тут не нужно —
 * задача отличить «про вечерние срывы на сладкое» от «про холодный душ», а не
 * построить поисковый движок. Префикс склеивает «срывы/срывов» и «вечером/вечерние».
 */
function stems(text: string): string[] {
  return text
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(word => word.length >= 4)
    .map(word => word.slice(0, 4))
}

function stemSet(parts: Array<string | null | undefined>): Set<string> {
  const result = new Set<string>()
  for (const part of parts) {
    if (!part) continue
    for (const stem of stems(part)) result.add(stem)
  }
  return result
}

/** Тема материала: то, по чему мы решаем «это про то же самое или нет». */
export interface LeadMagnetTopic {
  title?: string | null
  problem?: string | null
  audience?: string | null
}

export interface ReusableLeadMagnetCandidate extends LeadMagnetTopic {
  id: string
  status: string
  updatedAt?: Date | null
}

/**
 * Доля основ искомой темы, найденных у кандидата: 0 — ничего общего, 1 — тема
 * кандидата покрывает искомую целиком. Считаем именно от искомой темы, чтобы
 * длинный «универсальный» материал не выигрывал за счёт объёма.
 */
export function leadMagnetTopicScore(wanted: LeadMagnetTopic, candidate: LeadMagnetTopic): number {
  const wantedStems = stemSet([wanted.title, wanted.problem, wanted.audience])
  if (wantedStems.size === 0) return 0
  const candidateStems = stemSet([candidate.title, candidate.problem, candidate.audience])
  let matched = 0
  for (const stem of wantedStems) {
    if (candidateStems.has(stem)) matched++
  }
  return matched / wantedStems.size
}

/**
 * Выбирает материал из библиотеки под тему. Порядок предпочтения:
 * утверждённый → более близкий по теме → более свежий. Архивные и любые
 * незнакомые статусы отсекаются: отдать зрителю отозванный материал хуже,
 * чем сгенерировать новый.
 */
export function pickReusableLeadMagnet<T extends ReusableLeadMagnetCandidate>(
  candidates: T[],
  wanted: LeadMagnetTopic,
  minScore: number = LEAD_MAGNET_REUSE_MIN_SCORE,
): T | null {
  const scored = candidates
    .filter(candidate => (STATUS_RANK[candidate.status] ?? 0) > 0)
    .map(candidate => ({ candidate, score: leadMagnetTopicScore(wanted, candidate) }))
    .filter(entry => entry.score >= minScore)
    .sort((left, right) => {
      const rank = (STATUS_RANK[right.candidate.status] ?? 0) - (STATUS_RANK[left.candidate.status] ?? 0)
      if (rank !== 0) return rank
      if (right.score !== left.score) return right.score - left.score
      const rightAt = right.candidate.updatedAt?.getTime() ?? 0
      const leftAt = left.candidate.updatedAt?.getTime() ?? 0
      return rightAt - leftAt
    })

  return scored[0]?.candidate ?? null
}

/** Минимум от prisma-клиента (или транзакции), который нужен подбору. */
export interface LeadMagnetLibraryClient {
  leadMagnet: {
    findMany: (args: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>
  }
}

/** Сколько последних материалов приложения просматриваем при подборе. */
export const LEAD_MAGNET_LIBRARY_LOOKUP_LIMIT = 50

/**
 * Ищет в библиотеке приложения материал под тему. Возвращает полную строку
 * LeadMagnet (её кладут в гипотезу и в воронку) либо null, если подходящего нет.
 */
export async function findReusableLeadMagnet(
  client: LeadMagnetLibraryClient,
  appId: number,
  wanted: LeadMagnetTopic,
  minScore: number = LEAD_MAGNET_REUSE_MIN_SCORE,
): Promise<Record<string, unknown> | null> {
  const rows = await client.leadMagnet.findMany({
    where: { appId, status: { in: ['approved', 'draft'] } },
    orderBy: { updatedAt: 'desc' },
    take: LEAD_MAGNET_LIBRARY_LOOKUP_LIMIT,
  })
  const candidates = rows.map(row => ({
    id: String(row.id),
    status: String(row.status),
    title: typeof row.title === 'string' ? row.title : null,
    problem: typeof row.problem === 'string' ? row.problem : null,
    audience: typeof row.audience === 'string' ? row.audience : null,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt : null,
    row,
  }))
  return pickReusableLeadMagnet(candidates, wanted, minScore)?.row ?? null
}
