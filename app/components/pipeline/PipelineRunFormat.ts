/**
 * Форматирование длительностей и времени в мониторе запусков.
 *
 * `shared/utils/pipeline-format` отдаёт «18.1мин» — в мониторе это не читается:
 * оператор сравнивает шаги между собой и ему нужны минуты с секундами. Файл
 * вне границ переноса, поэтому свой формат живёт рядом с компонентами.
 */
import { formatMoney } from '~~/shared/utils/money'

/** «12 с», «4 м 26 с», «1 ч 48 м». Ниже секунды — десятые доли. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms)) return '—'
  if (ms < 0) return '—'
  if (ms < 1000) return `${Math.round(ms)} мс`
  const totalSec = Math.round(ms / 1000)
  if (totalSec < 10) return `${(ms / 1000).toFixed(1)} с`.replace('.', ',')
  if (totalSec < 60) return `${totalSec} с`
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  if (min < 60) return sec ? `${min} м ${String(sec).padStart(2, '0')} с` : `${min} м`
  const hours = Math.floor(min / 60)
  const restMin = min % 60
  return restMin ? `${hours} ч ${restMin} м` : `${hours} ч`
}

/** Длительность по паре дат; незакрытый интервал считается до `until`. */
export function durationBetween(
  start: string | null | undefined,
  end: string | null | undefined,
  until?: number,
): number | null {
  if (!start) return null
  const from = new Date(start).getTime()
  const to = end ? new Date(end).getTime() : until
  if (to == null || Number.isNaN(from)) return null
  return Math.max(0, to - from)
}

/** «14:26:11» — время без даты, для хронологии внутри одного запуска. */
export function formatClock(value: string | null | undefined, withSeconds = true): string {
  if (!value) return '—'
  return new Date(value).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' } : {}),
  })
}

/** Заголовок группы истории: «Сегодня», «Вчера», иначе дата. */
export function formatDayLabel(value: string, now: Date): string {
  const date = new Date(value)
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000)
  if (diffDays === 0) return 'Сегодня'
  if (diffDays === 1) return 'Вчера'
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

const TERMINAL_RUN_STATUSES = new Set(['success', 'failed', 'cancelled', 'no_data'])

/**
 * Стоимость запуска для строки списка и шапки.
 *
 * Агрегат — сумма шагов, у которых сумма известна: у логических блоков это
 * честный ноль, у платных она появляется в момент завершения шага. Пока запуск
 * идёт, ноль означает «платные шаги ещё не отчитались», а не «бесплатно», и
 * показывать его нельзя — цифру примут за итог. На завершённом запуске ноль
 * уже сообщение: денег не потрачено.
 */
export function runCostLabel(run: { status: string; costActual: number | null }): string | null {
  if (run.costActual == null) return null
  if (run.costActual === 0 && !TERMINAL_RUN_STATUSES.has(run.status)) return null
  return formatMoney(run.costActual)
}

/**
 * Кто запустил: «Д. Кузнецов». Фамилия целиком, имя инициалом — в строке
 * списка на полное имя места нет, а фамилия различает людей лучше.
 * Без фамилии — имя, без имени — почта до собаки.
 */
export function runAuthorLabel(
  user: { name?: string | null; surname?: string | null; email?: string } | null | undefined,
): string | null {
  if (!user) return null
  const name = user.name?.trim()
  const surname = user.surname?.trim()
  if (surname) return name ? `${name[0]!.toUpperCase()}. ${surname}` : surname
  if (name) return name
  const email = user.email?.trim()
  return email ? email.split('@')[0]! : null
}

/** Ключ группы истории — календарный день в местной зоне. */
export function dayKey(value: string): string {
  const d = new Date(value)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}
