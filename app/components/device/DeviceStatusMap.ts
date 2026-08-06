import type { DeviceSessionState, DeviceSyncStatus } from '~~/shared/types/device-profile'
import { deviceStatusMeta } from '~~/shared/types/device-profile'
import type { StatusTone } from '~~/shared/utils/entity-status'

/**
 * Статусы устройств в общем словаре системы.
 *
 * Подписи остаются доменными: «Не в облаке», «Прогрет», «Срок истёк» точнее
 * общих «Черновик» и «Ошибка». Из словаря берётся только тон, как у
 * `ProxyHealthBadge`.
 */
export const DEVICE_TONE_CLASS: Record<StatusTone, string> = {
  neutral: 'border-neutral-border bg-neutral-bg text-neutral',
  info: 'border-info-border bg-info-bg text-info',
  success: 'border-success-border bg-success-bg text-success',
  warning: 'border-warning-border bg-warning-bg text-warning',
  danger: 'border-danger-border bg-danger-bg text-danger',
}

export const DEVICE_BADGE_SIZE = {
  xs: 'h-[18px] gap-1 px-1.5 text-micro',
  sm: 'h-[22px] gap-[5px] px-2 text-sm',
  md: 'h-[26px] gap-1.5 px-2.5 text-base',
}

export interface DeviceBadgeMeta {
  label: string
  tone: StatusTone
  icon: string
  /** Состояние идёт прямо сейчас — точка пульсирует. */
  live?: boolean
}

/** Состояние облачного устройства (config.duoplus.deviceStatus). */
export function deviceCloudStatus(status: number | null | undefined): DeviceBadgeMeta {
  const meta = deviceStatusMeta(status)
  const tone: StatusTone = meta.tone === 'error' ? 'danger' : meta.tone
  const live = status === 10 || status === 11
  return {
    label: meta.label,
    tone,
    icon: live ? 'mingcute:loading-line' : status === 1 ? 'mingcute:power-line' : 'mingcute:pause-circle-line',
    live,
  }
}

export const DEVICE_SYNC_META: Record<DeviceSyncStatus, DeviceBadgeMeta> = {
  synced: { label: 'Синхронизирован', tone: 'success', icon: 'mingcute:check-circle-line' },
  local_only: { label: 'Не в облаке', tone: 'warning', icon: 'mingcute:save-line' },
  remote_only: { label: 'Только в облаке', tone: 'info', icon: 'mingcute:cloud-line' },
  conflict: { label: 'Конфликт', tone: 'warning', icon: 'mingcute:alert-line' },
  deleted_remote: { label: 'Удалён в облаке', tone: 'danger', icon: 'mingcute:delete-2-line' },
  error: { label: 'Ошибка', tone: 'danger', icon: 'mingcute:close-circle-line' },
  archived: { label: 'Архивирован', tone: 'neutral', icon: 'mingcute:archive-line' },
}

/** Состояние сессии профиля. `warmup` — та же семантика словами оператора постинга. */
export function deviceSessionMeta(
  state: DeviceSessionState,
  port: number | null | undefined,
  variant: 'session' | 'warmup' = 'session',
): DeviceBadgeMeta {
  if (variant === 'warmup') {
    if (state === 'running') {
      return {
        label: port ? `Прогрет :${port}` : 'Прогрет',
        tone: 'success',
        icon: 'mingcute:check-circle-line',
      }
    }
    if (state === 'starting') {
      return { label: 'Прогревается', tone: 'warning', icon: 'mingcute:loading-line', live: true }
    }
    return { label: 'Не прогрет', tone: 'neutral', icon: 'mingcute:fire-line' }
  }

  if (state === 'running') {
    return {
      label: port ? `Запущен :${port}` : 'Запущен',
      tone: 'success',
      icon: 'mingcute:play-circle-line',
    }
  }
  if (state === 'starting') {
    return { label: 'Запускается', tone: 'warning', icon: 'mingcute:loading-line', live: true }
  }
  return { label: 'Остановлен', tone: 'neutral', icon: 'mingcute:pause-circle-line' }
}

/** Проверка страны прокси — от неё зависит, можно ли привязывать аккаунты. */
export function deviceProxyGuardMeta(
  guard: string,
  expectedCountry?: string | null,
): DeviceBadgeMeta {
  switch (guard) {
    case 'us_proxy_ok':
      return { label: 'Прокси US', tone: 'success', icon: 'mingcute:earth-line' }
    case 'wrong_country':
      return { label: `Не US · ${expectedCountry ?? '?'}`, tone: 'warning', icon: 'mingcute:earth-line' }
    case 'unknown':
      return { label: 'Страна не задана', tone: 'warning', icon: 'mingcute:earth-line' }
    default:
      return { label: 'Без прокси', tone: 'danger', icon: 'mingcute:earth-line' }
  }
}
