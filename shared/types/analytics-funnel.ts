/**
 * Контракт сквозной аналитики: воронка производства и продаж, рейтинги,
 * динамика по дням и разбор одной публикации.
 *
 * Воронка склеена из двух источников. Стадии производства (тренды, сценарии,
 * ролики) и публикации считаются по нашим таблицам; переходы, заявки и продажи
 * приходят из `AttributionEvent` — событий по tracking token, которые нам
 * присылают мессенджер и conversion sink.
 */

export type AnalyticsPeriodPreset = '24h' | '7d' | '30d' | 'custom'

export interface AnalyticsPeriod {
  /** Начало окна, ISO. */
  from: string
  /** Конец окна, ISO. */
  to: string
  preset: AnalyticsPeriodPreset
  /** Предыдущее окно той же длины — база для дельт. */
  previousFrom: string
  previousTo: string
}

export type FunnelStageKey =
  | 'trends'
  | 'scenarios'
  | 'videos'
  | 'publications'
  | 'views'
  | 'clicks'
  | 'leads'
  | 'sales'

/**
 * Откуда стадия берёт число. От этого зависит, какие фильтры к ней применимы:
 * отбор по площадке и аккаунту сужает только `publication` и `attribution`.
 */
export type FunnelStageScope = 'production' | 'publication' | 'attribution'

/** Как читать `ratio` стадии: доля, множитель или «столько-то на штуку». */
export type FunnelRatioKind = 'share' | 'multiplier' | 'per'

/**
 * В чём измеряется стадия. Столбики сравнимы только внутри одной величины:
 * восемьсот тысяч просмотров и сорок роликов на одной шкале превращают все
 * стадии, кроме просмотров, в невидимую полоску.
 */
export type FunnelUnitGroup = 'items' | 'views' | 'events'

export interface FunnelStage {
  key: FunnelStageKey
  label: string
  value: number
  scope: FunnelStageScope
  /** Отношение к базовой стадии. null — базы нет или она нулевая. */
  ratio: number | null
  ratioOf: FunnelStageKey | null
  ratioKind: FunnelRatioKind | null
  unitGroup: FunnelUnitGroup
  /** Высота столбика, 0…1. Считается от крупнейшей стадии своей величины. */
  share: number
  /** Стадия просела относительно прошлого окна. */
  alert: boolean
  /** Куда ведёт клик по стадии. null — списка за ней нет. */
  href: string | null
}

export type AnalyticsKpiUnit = 'count' | 'rate' | 'money'

export interface AnalyticsKpi {
  key: string
  label: string
  /** null — величину не из чего посчитать (делить не на что, данных нет). */
  value: number | null
  unit: AnalyticsKpiUnit
  /** Тот же показатель за предыдущее окно. null — сравнивать не с чем. */
  previous: number | null
  /** В какую сторону рост показателя считается хорошим. */
  better: 'up' | 'down'
}

export interface FunnelResult {
  period: AnalyticsPeriod
  stages: FunnelStage[]
  kpis: AnalyticsKpi[]
  /**
   * Включён отбор по площадке или аккаунту: стадии производства им не
   * сужаются, и об этом надо сказать прямо под воронкой.
   */
  productionScopeNote: boolean
  /** Событий атрибуции за окно нет вовсе — три последние стадии пустые. */
  hasAttribution: boolean
}

/**
 * Кому достаётся заслуга за заявку. `last` — публикация, на которой заявка
 * записана (сходится с CRM), `first` — первое касание того же человека,
 * сшитое по `messengerUserId`.
 */
export type AttributionModel = 'first' | 'last'

export interface RankedVideo {
  uploadId: number
  videoId: number | null
  title: string
  code: string
  accountName: string | null
  platform: 'tiktok' | 'instagram' | 'youtube' | null
  views: number
  clicks: number
  leads: number
}

export interface RankedAccount {
  socialAccountId: number
  name: string
  platform: 'tiktok' | 'instagram' | 'youtube'
  leads: number
}

export interface RankedHook {
  key: string
  label: string
  publications: number
  views: number
  clicks: number
  /** Доля 0…1: переходы к просмотрам. */
  ctr: number
}

export interface RankedTrendSource {
  key: string
  label: string
  trends: number
  sales: number
}

export interface GeoSlice {
  /** Код страны из тренда-источника. */
  geo: string
  leads: number
}

export interface AbVariantSide {
  variantIndex: number
  hook: string
  uploadId: number | null
  views: number
  clicks: number
  leads: number
  /** Доля 0…1. */
  ctr: number
}

export interface AbComparison {
  scenarioId: number
  title: string
  code: string
  variants: AbVariantSide[]
  /** Индекс победителя в `variants`; null — разница не читается. */
  winnerIndex: number | null
}

export interface RankingsResult {
  model: AttributionModel
  period: AnalyticsPeriod
  topVideos: RankedVideo[]
  byAccount: RankedAccount[]
  geo: GeoSlice[]
  hooks: RankedHook[]
  trendSources: RankedTrendSource[]
  abTests: AbComparison[]
}

export type TimeseriesMetric = 'views' | 'clicks' | 'leads' | 'costPerLead'

export interface TimeseriesPoint {
  /** Календарный день `YYYY-MM-DD` в зоне сервера. */
  day: string
  value: number | null
  /** Публикаций вышло за этот день — наложение на график. */
  publications: number
  /** День ещё не закончился: столбик штрихуется, данные неполные. */
  partial: boolean
}

export interface TimeseriesResult {
  metric: TimeseriesMetric
  period: AnalyticsPeriod
  points: TimeseriesPoint[]
  /** Точек меньше порога — график не рисуется, вместо него объяснение. */
  enoughData: boolean
  minPoints: number
}

export interface ChainStep {
  kind: 'trend' | 'scenario' | 'video' | 'publication' | 'result'
  label: string
  title: string
  /** Вторая строка карточки: платформа, стоимость, метрики. */
  meta: string | null
  href: string | null
}

export interface TouchEvent {
  type: string
  label: string
  occurredAt: string
  source: string
  /** Опознанный человек в мессенджере; null — сшить не с чем. */
  messengerUserId: string | null
  payloadText: string | null
}

export interface PublicationChainResult {
  uploadId: number
  title: string
  trackingToken: string | null
  publishedAt: string | null
  chain: ChainStep[]
  /** Касаний до заявки; null — заявок по этой публикации нет. */
  touchCount: number | null
  firstTouch: TouchEvent | null
  lastTouch: TouchEvent | null
  events: TouchEvent[]
  leads: number
  sales: number
  leadMagnetTitle: string | null
  /** Публикация не заведена в фабричном контуре — атрибуции у неё нет. */
  hasPublication: boolean
}
