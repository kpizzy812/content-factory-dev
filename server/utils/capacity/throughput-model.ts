/**
 * Модель пропускной способности фабрики.
 *
 * Требование docs/PROJECT_CONTEXT.md п.3 — до 300 готовых роликов в сутки, и п.12
 * требует нагрузочной проверки до масштабирования. Настоящий прогон 300 задач стоит
 * денег и времени, поэтому сначала считаем аналитически: сколько роликов в сутки
 * вытягивает конвейер при заданных длительностях шагов и параллелизме, и что именно
 * упирается первым — генерация или квоты площадок на публикацию.
 *
 * Модель намеренно грубая и пессимистичная: она отвечает на вопрос «хватит ли
 * порядка величины», а не предсказывает точное время. Все входные величины —
 * измеряемые: длительности шагов берутся из VideoGenerationStep, квоты — из
 * SocialAccount.publishingQuotaTotal.
 */

/** Длительности шагов одного ролика в секундах (медианы по факту, не оценки). */
export interface StageDurationsSec {
  /** Гипотеза, сценарий и его проверки — LLM. */
  scenario: number
  /** Генерация изображений (если включена). */
  images: number
  /** Генерация клипов — обычно самый долгий шаг. */
  clips: number
  /** Lip-sync по сценам с репликами. */
  lipSync: number
  /** Синтез речи и сведение дорожки. */
  voiceover: number
  /** Локальная сборка FFmpeg. */
  assembly: number
}

export interface CapacityInput {
  /** Сколько готовых роликов в сутки требуется. */
  targetPerDay: number
  stages: StageDurationsSec
  /** Сколько роликов одновременно обрабатывает конвейер. */
  concurrentRuns: number
  /**
   * Доля прогонов, которые придётся переделать (провал шага, отказ QA).
   * 0.2 означает, что на 100 готовых роликов уходит 120 прогонов.
   */
  retryRate: number
  /** Квоты публикаций на аккаунт за скользящие сутки. */
  accountQuotas: number[]
  /** Сколько площадок получает один ролик (кросспостинг умножает публикации). */
  publicationsPerVideo: number
}

export interface CapacityBottleneck {
  kind: 'generation' | 'publishing'
  /** Сколько роликов в сутки пропускает это место. */
  perDay: number
  /** Человеческое объяснение, что именно упирается. */
  reason: string
}

export interface CapacityReport {
  /** Время одного ролика от гипотезы до готового файла, секунды. */
  videoWallClockSec: number
  /** Пропускная способность генерации с учётом переделок. */
  generationPerDay: number
  /** Сколько публикаций в сутки выдерживают аккаунты. */
  publishingCapacityPerDay: number
  /** Сколько роликов в сутки это даёт с учётом кросспостинга. */
  publishingVideosPerDay: number
  /** Минимум из двух — фактическая мощность. */
  achievablePerDay: number
  /** Цель достигается? */
  meetsTarget: boolean
  /** Что упирается первым. */
  bottleneck: CapacityBottleneck
  /** Сколько параллельных прогонов нужно, чтобы закрыть цель по генерации. */
  requiredConcurrency: number
  /** Сколько аккаунтов средней квоты не хватает для цели по публикации. */
  missingAccounts: number
}

const SECONDS_PER_DAY = 86_400

function sumStages(stages: StageDurationsSec): number {
  return stages.scenario + stages.images + stages.clips
    + stages.lipSync + stages.voiceover + stages.assembly
}

function positive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

/**
 * Считает мощность контура.
 *
 * Генерация: параллельные прогоны делят сутки на время одного ролика. Переделки
 * съедают часть мощности, поэтому делим на (1 + retryRate) — на выходе именно
 * ГОТОВЫЕ ролики, а не запуски.
 *
 * Публикация: сумма квот аккаунтов за сутки, делённая на число площадок, куда
 * уходит один ролик. Квота у площадки скользящая, поэтому это верхняя оценка:
 * реальный график освобождения слотов рваный (см. publishing-capacity.ts).
 */
export function calculateCapacity(input: CapacityInput): CapacityReport {
  const videoWallClockSec = Math.max(1, sumStages(input.stages))
  const concurrency = Math.max(1, Math.trunc(positive(input.concurrentRuns, 1)))
  const retryRate = Math.max(0, input.retryRate)
  const publicationsPerVideo = Math.max(1, Math.trunc(positive(input.publicationsPerVideo, 1)))

  const runsPerDay = (SECONDS_PER_DAY / videoWallClockSec) * concurrency
  const generationPerDay = Math.floor(runsPerDay / (1 + retryRate))

  const publishingCapacityPerDay = input.accountQuotas
    .filter(quota => Number.isFinite(quota) && quota > 0)
    .reduce((sum, quota) => sum + Math.trunc(quota), 0)
  const publishingVideosPerDay = Math.floor(publishingCapacityPerDay / publicationsPerVideo)

  const achievablePerDay = Math.min(generationPerDay, publishingVideosPerDay)
  const target = Math.max(0, Math.trunc(input.targetPerDay))

  const bottleneck: CapacityBottleneck = generationPerDay <= publishingVideosPerDay
    ? {
        kind: 'generation',
        perDay: generationPerDay,
        reason: `Один ролик занимает ${Math.round(videoWallClockSec / 60)} мин, параллельно идёт ${concurrency}; `
          + `с долей переделок ${Math.round(retryRate * 100)}% это ${generationPerDay} готовых роликов в сутки.`,
      }
    : {
        kind: 'publishing',
        perDay: publishingVideosPerDay,
        reason: `Суммарная квота аккаунтов ${publishingCapacityPerDay} публикаций в сутки; `
          + `при ${publicationsPerVideo} площадках на ролик это ${publishingVideosPerDay} роликов.`,
      }

  // Сколько параллельных прогонов закрыло бы цель по генерации.
  const requiredConcurrency = target > 0
    ? Math.ceil((target * (1 + retryRate) * videoWallClockSec) / SECONDS_PER_DAY)
    : 0

  // Средняя квота — по живым аккаунтам; если их нет, считать нечего.
  const liveQuotas = input.accountQuotas.filter(q => Number.isFinite(q) && q > 0)
  const averageQuota = liveQuotas.length > 0
    ? liveQuotas.reduce((s, q) => s + q, 0) / liveQuotas.length
    : 0
  const neededPublications = target * publicationsPerVideo
  const missingAccounts = averageQuota > 0
    ? Math.max(0, Math.ceil((neededPublications - publishingCapacityPerDay) / averageQuota))
    : 0

  return {
    videoWallClockSec,
    generationPerDay,
    publishingCapacityPerDay,
    publishingVideosPerDay,
    achievablePerDay,
    meetsTarget: achievablePerDay >= target,
    bottleneck,
    requiredConcurrency,
    missingAccounts,
  }
}

/** Человекочитаемый отчёт — им пользуется скрипт нагрузочной оценки. */
export function formatCapacityReport(input: CapacityInput, report: CapacityReport): string {
  const lines: string[] = []
  lines.push(`Цель: ${input.targetPerDay} роликов в сутки`)
  lines.push(`Время одного ролика: ${Math.round(report.videoWallClockSec / 60)} мин (${report.videoWallClockSec} с)`)
  lines.push(`Параллельных прогонов: ${input.concurrentRuns}, доля переделок: ${Math.round(input.retryRate * 100)}%`)
  lines.push('')
  lines.push(`Генерация вытягивает: ${report.generationPerDay} роликов/сутки`)
  lines.push(`Публикация вытягивает: ${report.publishingVideosPerDay} роликов/сутки `
    + `(${report.publishingCapacityPerDay} публикаций по ${input.accountQuotas.length} аккаунтам)`)
  lines.push('')
  lines.push(`Фактическая мощность: ${report.achievablePerDay} роликов/сутки — `
    + (report.meetsTarget ? 'цель достижима' : 'цель НЕ достигается'))
  lines.push(`Упирается: ${report.bottleneck.kind === 'generation' ? 'генерация' : 'публикация'}. ${report.bottleneck.reason}`)
  if (!report.meetsTarget) {
    if (report.requiredConcurrency > input.concurrentRuns) {
      lines.push(`Нужно параллельных прогонов: ${report.requiredConcurrency} (сейчас ${input.concurrentRuns})`)
    }
    if (report.missingAccounts > 0) {
      lines.push(`Не хватает аккаунтов: ${report.missingAccounts} при текущей средней квоте`)
    }
  }
  return lines.join('\n')
}
