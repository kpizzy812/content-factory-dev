/**
 * Счётчики у пунктов навигации: сколько ждёт решения, сколько упало.
 *
 * Пока агрегирующего endpoint нет — раздёргивать шесть списков поллингом раз в
 * 5 секунд ради цифр в меню дороже, чем они стоят. Форма зафиксирована здесь,
 * значения появятся вместе с `/api/dashboard/summary` в этапе 6 (дашборд),
 * который считает те же величины для блока «Требует внимания».
 *
 * До тех пор счётчики просто не рисуются. Пустое место лучше выдуманного числа.
 */
export interface NavCounters {
  activeRuns?: number
  trends?: number
  scenariosOnReview?: number
  videosFailed?: number
  postingQueued?: number
  accountsAttention?: number
}

export function useNavCounters() {
  const counters = useState<NavCounters>('nav-counters', () => ({}))
  return { counters }
}
