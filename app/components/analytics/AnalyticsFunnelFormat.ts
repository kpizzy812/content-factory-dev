/**
 * Подписи воронки и KPI.
 *
 * Сервер отдаёт числа, а не готовый текст: «34 % трендов» и «×2,6 к сценариям»
 * — это язык интерфейса, и собирается он рядом с компонентами, как и остальные
 * доменные словари раздела.
 */

import type {
  AnalyticsKpi,
  FunnelStage,
  FunnelStageKey,
  TimeseriesMetric,
} from '#shared/types/analytics-funnel'
import { formatMoney } from '#shared/utils/money'
import { formatCount, formatRate } from './AnalyticsFormat'

/** Родительный падеж стадии: «34 % трендов», «92 % роликов». */
const STAGE_OF: Record<FunnelStageKey, string> = {
  trends: 'трендов',
  scenarios: 'сценариев',
  videos: 'роликов',
  publications: 'публикаций',
  views: 'просмотров',
  clicks: 'переходов',
  leads: 'заявок',
  sales: 'продаж',
}

/** Дательный падеж: «×2,6 к сценариям». */
const STAGE_TO: Record<FunnelStageKey, string> = {
  trends: 'трендам',
  scenarios: 'сценариям',
  videos: 'роликам',
  publications: 'публикациям',
  views: 'просмотрам',
  clicks: 'переходам',
  leads: 'заявкам',
  sales: 'продажам',
}

/** Единственное число для «7 132 на публикацию». */
const STAGE_PER: Partial<Record<FunnelStageKey, string>> = {
  scenarios: 'на сценарий',
  videos: 'на ролик',
  publications: 'на публикацию',
}

/** Подпись под числом стадии. */
export function stageHint(stage: FunnelStage): string {
  if (stage.key === 'trends') return 'импортировано'
  if (stage.ratio == null || stage.ratioOf == null) return 'не с чем сравнить'

  if (stage.ratioKind === 'share') {
    // У долей меньше процента один знак после запятой превращает 0,08 % в
    // 0,1 % — и стадия расходится с тем же числом в KPI.
    return `${formatRate(stage.ratio, stage.ratio < 0.01 ? 2 : 1)} ${STAGE_OF[stage.ratioOf]}`
  }
  if (stage.ratioKind === 'multiplier') {
    const value = stage.ratio.toFixed(1).replace('.', ',')
    return `×${value} к ${STAGE_TO[stage.ratioOf]}`
  }
  return `${formatCount(stage.ratio)} ${STAGE_PER[stage.ratioOf] ?? `на ${STAGE_OF[stage.ratioOf]}`}`
}

/** Значение KPI по его единице измерения. */
export function kpiValue(kpi: AnalyticsKpi): string {
  if (kpi.value == null) return '—'
  if (kpi.unit === 'rate') return formatRate(kpi.value, 2)
  if (kpi.unit === 'money') return formatMoney(kpi.value) ?? '—'
  return formatCount(kpi.value)
}

export interface KpiDelta {
  text: string
  tone: 'success' | 'danger' | 'subtle'
}

/**
 * Дельта к прошлому окну. У долей — в процентных пунктах: «−0,14 пп»,
 * потому что «CTR упал на 33 %» и «CTR упал на 0,14 пп» — разные утверждения,
 * и второе проверяемо.
 */
export function kpiDelta(kpi: AnalyticsKpi): KpiDelta | null {
  if (kpi.value == null || kpi.previous == null) return null

  if (kpi.unit === 'rate') {
    const points = (kpi.value - kpi.previous) * 100
    if (Math.abs(points) < 0.005) return { text: 'без изменений', tone: 'subtle' }
    const sign = points > 0 ? '+' : '−'
    const good = points > 0 ? kpi.better === 'up' : kpi.better === 'down'
    return {
      text: `${sign}${Math.abs(points).toFixed(2).replace('.', ',')} пп`,
      tone: good ? 'success' : 'danger',
    }
  }

  if (kpi.previous === 0) {
    return kpi.value === 0 ? { text: 'без изменений', tone: 'subtle' } : { text: 'ново', tone: 'subtle' }
  }

  const percent = Math.round(((kpi.value - kpi.previous) / kpi.previous) * 100)
  if (percent === 0) return { text: 'без изменений', tone: 'subtle' }
  const good = percent > 0 ? kpi.better === 'up' : kpi.better === 'down'
  return {
    text: `${percent > 0 ? '+' : '−'}${Math.abs(percent)} %`,
    tone: good ? 'success' : 'danger',
  }
}

export const TIMESERIES_LABELS: Record<TimeseriesMetric, string> = {
  views: 'Просмотры',
  clicks: 'Переходы',
  leads: 'Заявки',
  costPerLead: 'Стоимость заявки',
}

/** Значение точки графика в подписи и подсказке. */
export function timeseriesValue(metric: TimeseriesMetric, value: number | null): string {
  if (value == null) return '—'
  return metric === 'costPerLead' ? formatMoney(value) ?? '—' : formatCount(value)
}

/** «29 июл» — короткая подпись дня под столбиком. */
export function shortDay(day: string): string {
  const parsed = new Date(`${day}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return day
  return String(parsed.getDate())
}

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

/**
 * «29 июл — 5 авг» в шапке экрана. Собирается руками, а не через `Intl`:
 * сервер и браузер расходятся в сокращениях месяцев, и Vue бросает поддерево
 * при гидратации.
 */
export function periodLabel(from: string, to: string): string {
  const start = new Date(from)
  const end = new Date(to)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return ''
  // Дата берётся в UTC: сервер и браузер живут в разных зонах, и локальные
  // getDate() дали бы разные подписи на одну и ту же строку данных.
  return `${start.getUTCDate()} ${MONTHS[start.getUTCMonth()]} — ${end.getUTCDate()} ${MONTHS[end.getUTCMonth()]}`
}
