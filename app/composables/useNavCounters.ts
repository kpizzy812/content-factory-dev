import type { DashboardCounters, DashboardSummary } from '~~/shared/types/dashboard-summary'

/**
 * Счётчики у пунктов навигации и очередь «требует внимания».
 *
 * Один источник на всё приложение — `/api/dashboard/summary`. Раздёргивать
 * шесть списков ради тех же цифр было бы дороже, чем посчитать их одним
 * запросом, поэтому дашборд и сайдбар читают одно и то же.
 *
 * Интервал 30 секунд, а не 5: счётчики в меню — фоновая информация, и опрос
 * их с частотой активного списка создаёт лишнюю нагрузку без пользы. Живой
 * прогресс запусков обновляется на своих экранах.
 */
const REFRESH_MS = 30_000

export function useNavCounters() {
  const { data, refresh, pending } = useFetch<{ data: DashboardSummary }>('/api/dashboard/summary', {
    key: 'dashboard-summary',
    // Сводку не ждём при переходе между страницами: цифра в меню не должна
    // задерживать рендер раздела.
    lazy: true,
    default: () => null as unknown as { data: DashboardSummary },
  })

  const counters = computed<Partial<DashboardCounters>>(() => data.value?.data.counters ?? {})
  const attention = computed(() => data.value?.data.attention ?? [])
  const computedAt = computed(() => data.value?.data.computedAt ?? null)

  // Один таймер на приложение: composable вызывается из сайдбара, топбара и
  // дашборда одновременно, и каждый заводил бы свой.
  const timerOwner = useState('nav-counters-timer', () => false)
  if (import.meta.client && !timerOwner.value) {
    timerOwner.value = true
    const timer = setInterval(() => refresh(), REFRESH_MS)
    onScopeDispose(() => {
      clearInterval(timer)
      timerOwner.value = false
    })
  }

  return { counters, attention, computedAt, pending, refresh }
}
