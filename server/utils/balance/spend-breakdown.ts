/**
 * Расход за период с разбивкой по типам операций.
 *
 * Источник — тот же, что и у стоимости шага конвейера: журнал списаний
 * `AiAuditLog` (action='external_api_call', costUsd + stepKey + service). Его
 * пишет `cost-ledger` в момент, когда исполнитель шага видео узнаёт настоящую
 * сумму от провайдера. `Video.totalCostActual` и `WorkflowStep.costActual` —
 * агрегаты этих же строк, только по ролику и по блоку конвейера; здесь та же
 * сумма разложена по операциям.
 *
 * Категории собраны по реальным ключам шагов, а не по красивым названиям:
 * группа существует, только если в неё что-то может попасть.
 *
 * Валюта — USD, как и весь остальной учёт.
 */

export interface SpendGroup {
  key: string
  label: string
  amountUsd: number
}

export interface SpendBreakdown {
  /** Начало окна, ISO. */
  since: string
  windowHours: number
  groups: SpendGroup[]
  totalUsd: number
  /** Роликов завершено за окно. 0 — значит делить не на что. */
  videoCount: number
  /** Стоимость ролика: total / videoCount. null, когда роликов за окно нет. */
  perVideoUsd: number | null
}

interface GroupDefinition {
  key: string
  label: string
  stepKeys: string[]
}

/**
 * Разбивка по операциям. Порядок фиксирован — от самой дорогой операции к
 * самой дешёвой, чтобы полоски в панели читались сверху вниз.
 *
 * «Рендер» — локальный ffmpeg, он всегда ноль. Строка оставлена намеренно:
 * оператор спрашивает «а сборка сколько стоит», и постоянный ноль отвечает на
 * это лучше, чем отсутствие строки.
 */
export const SPEND_GROUPS: GroupDefinition[] = [
  {
    key: 'video',
    label: 'Lip-sync и видео',
    stepKeys: ['lip_sync_generation', 'clip_generation', 'image_generation', 'shot_background'],
  },
  {
    key: 'audio',
    label: 'Синтез речи и музыка',
    stepKeys: ['voiceover_generation', 'transcription', 'music_generation'],
  },
  {
    key: 'text',
    label: 'Сценарии и критик',
    stepKeys: ['prompt_generation', 'edit_plan'],
  },
  {
    key: 'render',
    label: 'Рендер',
    stepKeys: ['assembly'],
  },
]

/** Куда попадает списание без stepKey — например ручная генерация референса. */
const OTHER_GROUP: GroupDefinition = { key: 'other', label: 'Прочее', stepKeys: [] }

const GROUP_BY_STEP_KEY = new Map<string, string>()
for (const group of SPEND_GROUPS) {
  for (const stepKey of group.stepKeys) GROUP_BY_STEP_KEY.set(stepKey, group.key)
}

const HOUR_MS = 3_600_000

/**
 * Считает расход за окно и стоимость ролика.
 *
 * @param windowHours окно в часах, по умолчанию сутки
 */
export async function computeSpendBreakdown(windowHours = 24): Promise<SpendBreakdown> {
  const hours = Math.min(24 * 90, Math.max(1, Math.round(windowHours)))
  const since = new Date(Date.now() - hours * HOUR_MS)

  const [rows, videoCount] = await Promise.all([
    prisma.aiAuditLog.groupBy({
      by: ['stepKey'],
      where: { costUsd: { not: null }, createdAt: { gte: since } },
      _sum: { costUsd: true },
    }),
    prisma.video.count({
      where: { status: 'completed', finishedAt: { gte: since } },
    }),
  ])

  const totals = new Map<string, number>()
  for (const group of [...SPEND_GROUPS, OTHER_GROUP]) totals.set(group.key, 0)

  for (const row of rows) {
    const amount = Number(row._sum.costUsd ?? 0)
    if (!Number.isFinite(amount) || amount === 0) continue
    const groupKey = (row.stepKey && GROUP_BY_STEP_KEY.get(row.stepKey)) || OTHER_GROUP.key
    totals.set(groupKey, (totals.get(groupKey) ?? 0) + amount)
  }

  const groups: SpendGroup[] = SPEND_GROUPS.map(group => ({
    key: group.key,
    label: group.label,
    amountUsd: totals.get(group.key) ?? 0,
  }))

  // «Прочее» показываем, только если туда что-то попало: пустая строка
  // «Прочее 0» ничего не объясняет, в отличие от постоянного нуля у рендера.
  const other = totals.get(OTHER_GROUP.key) ?? 0
  if (other > 0) {
    groups.push({ key: OTHER_GROUP.key, label: OTHER_GROUP.label, amountUsd: other })
  }

  const totalUsd = groups.reduce((sum, group) => sum + group.amountUsd, 0)

  return {
    since: since.toISOString(),
    windowHours: hours,
    groups,
    totalUsd,
    videoCount,
    perVideoUsd: videoCount > 0 ? totalUsd / videoCount : null,
  }
}
