import { tokenState } from './AccountStatusMap'

/**
 * Четыре отметки готовности из макета `06-accounts-queue`: видно не «готов / не
 * готов», а чего именно не хватает.
 *
 * Состав отметок отличается от макета, потому что данных из макета в API нет.
 * В `/api/accounts` приезжают токен, стиль-профиль, прокси и профиль устройства —
 * их и показываем. Права на публикацию платформа нам не отдаёт, а прогрев лежит
 * в `/api/admin/accounts-health` и виден на своей странице.
 */
export type MarkTone = 'ok' | 'warn' | 'fail' | 'none'

export interface ReadinessMark {
  /** Три буквы в моноширинной отметке. */
  code: string
  /** Полная подпись для тултипа и панели деталей. */
  label: string
  /** Что именно не так — одной строкой. */
  detail: string
  tone: MarkTone
}

export interface ReadinessAccount {
  status: string
  expiresAt?: string | null
  postingMethod?: string | null
  proxyId?: string | null
  proxy?: { label: string, status: string } | null
  deviceProfileId?: string | null
  styleProfile?: { status: string } | null
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

export function readinessMarks(account: ReadinessAccount): ReadinessMark[] {
  const usesBrowser = account.postingMethod === 'browser_automation'

  const token = tokenState(account.status, account.expiresAt)
  const tokenMark: ReadinessMark = {
    code: 'ТКН',
    label: 'Токен',
    detail: {
      ok: account.expiresAt ? `Действителен до ${fmtDate(account.expiresAt)}` : 'Действителен',
      soon: account.expiresAt ? `Истекает ${fmtDate(account.expiresAt)}` : 'Скоро истекает',
      gone: account.status === 'revoked' ? 'Отозван платформой' : 'Истёк',
      unknown: 'Срок действия платформа не сообщила',
    }[token],
    tone: ({ ok: 'ok', soon: 'warn', gone: 'fail', unknown: 'ok' } as const)[token],
  }

  const styleStatus = account.styleProfile?.status ?? 'not_set'
  const styleMark: ReadinessMark = {
    code: 'ПРФ',
    label: 'Стиль-профиль',
    detail: {
      complete: 'Заполнен',
      partial: 'Заполнен частично',
      not_set: 'Не задан — подписи собираются без правил аккаунта',
    }[styleStatus] ?? styleStatus,
    tone: ({ complete: 'ok', partial: 'warn', not_set: 'none' } as const)[
      styleStatus as 'complete' | 'partial' | 'not_set'
    ] ?? 'none',
  }

  const proxyMark: ReadinessMark = usesBrowser
    ? {
        code: 'ПРК',
        label: 'Прокси',
        detail: account.proxy
          ? `${account.proxy.label} · ${account.proxy.status}`
          : account.proxyId
            ? 'Привязан, статус неизвестен'
            : 'Не привязан — постинг заблокирован',
        tone: account.proxy?.status === 'healthy'
          ? 'ok'
          : account.proxyId
            ? 'warn'
            : 'fail',
      }
    : {
        code: 'ПРК',
        label: 'Прокси',
        detail: 'Не требуется: постинг идёт через официальный API',
        tone: 'none',
      }

  const deviceMark: ReadinessMark = usesBrowser
    ? {
        code: 'УСТР',
        label: 'Устройство',
        detail: account.deviceProfileId
          ? `Профиль ${account.deviceProfileId.slice(0, 8)}…`
          : 'Не привязан — автоматизация не запустится',
        tone: account.deviceProfileId ? 'ok' : 'fail',
      }
    : {
        code: 'УСТР',
        label: 'Устройство',
        detail: 'Не требуется: постинг идёт через официальный API',
        tone: 'none',
      }

  return [tokenMark, styleMark, proxyMark, deviceMark]
}

/** Аккаунт требует внимания, если хоть одна отметка красная или жёлтая. */
export function needsAttention(account: ReadinessAccount): boolean {
  return readinessMarks(account).some(m => m.tone === 'fail' || m.tone === 'warn')
}
