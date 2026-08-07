/**
 * Оценка пропускной способности фабрики под требование 300 роликов в сутки.
 *
 * Запуск: bun run scripts/estimate-capacity.ts [параллельныеПрогоны] [аккаунтов]
 *
 * Длительности шагов по умолчанию — медианы canary-прогона 06.08.2026 (девять сцен,
 * ролик 80 секунд). Их стоит пересчитывать по факту: медианы VideoGenerationStep
 * дают честные числа, а не оценку.
 */
import { calculateCapacity, formatCapacityReport } from "../server/utils/capacity/throughput-model"

const concurrency = Number(process.argv[2]) || 5
const accounts = Number(process.argv[3]) || 6

const input = {
  targetPerDay: 300,
  stages: { scenario: 300, images: 120, clips: 900, lipSync: 2400, voiceover: 180, assembly: 120 },
  concurrentRuns: concurrency,
  retryRate: 0.2,
  accountQuotas: Array.from({ length: accounts }, () => 50),
  publicationsPerVideo: 1,
}

console.log(formatCapacityReport(input, calculateCapacity(input)))
