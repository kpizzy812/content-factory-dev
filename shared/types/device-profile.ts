/**
 * Нейтральные shared-типы device-профиля постинг-провайдера (Этап 2 миграции DuoPlus).
 *
 * ПЕРВОИСТОЧНИК: эти device-имена — канонические. Старый Indigo-алиас-мост снесён
 * в R7 — все потребители переехали на device-имена.
 *
 * Используются и сервером (server/utils/posting-provider, API endpoints), и клиентом
 * (composables, components).
 */

export type DeviceSyncStatus =
  | "synced"
  | "local_only"
  | "remote_only"
  | "conflict"
  | "deleted_remote"
  | "error"
  | "archived"

export const DEVICE_SYNC_STATUSES: readonly DeviceSyncStatus[] = [
  "synced",
  "local_only",
  "remote_only",
  "conflict",
  "deleted_remote",
  "error",
  "archived",
] as const

/** Алиас для совместимости с планом-неймингом `DeviceSyncStatuses`. */
export const DeviceSyncStatuses = DEVICE_SYNC_STATUSES

export type DevicePlatformType = "desktop" | "mobile_android" | "mobile_ios"

export const DEVICE_PLATFORM_TYPES: readonly DevicePlatformType[] = [
  "desktop",
  "mobile_android",
  "mobile_ios",
] as const

export type DeviceSessionState = "idle" | "running" | "starting"

/**
 * Снапшот DuoPlus-полей устройства, читается из `DeviceProfile.config.duoplus`
 * (наполняется device-sync P7). Это last-known состояние — не запрашивается
 * на каждый GET (QPS=1 на DuoPlus API), обновляется только при синхронизации.
 */
export interface DeviceDuoplusInfo {
  /**
   * Статус устройства DuoPlus (last-known):
   * 0 не настроено · 1 включено · 2 выключено · 3 истёк срок ·
   * 4 просрочена оплата · 10 включается · 11 конфигурируется · 12 ошибка конфигурации.
   */
  deviceStatus: number | null
  /** Регион устройства (напр. "US"). */
  area: string | null
  /** ADB-адрес `host:port`. Пуст пока deviceStatus !== 1. */
  adbAddress: string | null
  /** Разрешение/размер экрана устройства (как отдаёт DuoPlus). */
  size: string | null
}

/**
 * Fingerprint-настройки anti-detect device-профиля. Хранится скрыто в
 * `config.fingerprint` (не редактируется в UI после R6); под DuoPlus Android
 * config переопределится в Этапе 3.
 */
export interface DeviceFingerprintDto {
  webrtc: "real" | "replace" | "disabled"
  canvas: "real" | "noise" | "off"
  webgl: "real" | "noise" | "off"
  audio: "real" | "noise" | "off"
  touchEnabled: boolean
  hardwareConcurrency: number
  deviceMemory: number
}

/**
 * Связка SocialAccount → DeviceProfile (Цикл M, N:N).
 * isPrimary дублируется в DeviceProfileDto.socialAccountId (denorm).
 */
export interface DeviceProfileLinkedAccountDto {
  id: number // SocialAccount.id
  displayName: string
  platform: string
  appName?: string
  appId: number
  status: string // active | disabled | locked
  isPrimary: boolean
  addedAt: string // ISO
  warmupStatus: string
}

/**
 * Результат проверки US-proxy гарда — для UI badge на карточке и блокировки
 * кнопки "Привязать ещё". Server решает по profile.proxy.expectedCountry.
 *  - us_proxy_ok: можно добавлять аккаунты.
 *  - no_proxy: у профиля нет proxy.
 *  - wrong_country: proxy.expectedCountry != 'US'.
 *  - unknown: proxy есть, но expectedCountry=null (оператор не указал).
 */
export type DeviceProxyCountryGuard =
  | "us_proxy_ok"
  | "no_proxy"
  | "wrong_country"
  | "unknown"

/**
 * DeviceProfile DTO для API responses (без шифрованных полей).
 * Поля links: socialAccount/proxy дают summary без внешних запросов.
 *
 * NB: cookies-поля (hasCookiesSnapshot/cookiesUpdatedAt) и fingerprint/preset-поля
 * НЕ входят в нейтральный device-DTO — они хранятся скрыто в `config` (см.
 * DeviceFingerprintDto / shared/schemas/device-fingerprint.ts).
 */
export interface DeviceProfileDto {
  id: string
  indigoId: string | null
  indigoFolderId: string | null
  // Denormalized "primary account" id (после M.1 multi-account). Совпадает с
  // accounts.find(a => a.isPrimary)?.id. Оставлен для backwards compat.
  socialAccountId: number | null
  proxyId: string | null
  name: string
  platformType: DevicePlatformType
  os: string | null
  userAgent: string | null
  screenResolution: string | null
  language: string | null
  timezone: string | null
  syncStatus: DeviceSyncStatus
  lastSyncedAt: string | null
  lastSyncError: string | null
  totalSessions: number
  lastSessionStartedAt: string | null
  lastSessionEndedAt: string | null
  lastSessionPort: number | null
  notes: string | null
  tags: string[]
  createdAt: string
  updatedAt: string
  // Denormalized links для UI (минимум данных) — primary account summary
  socialAccount: {
    id: number
    displayName: string
    platform: string
    appName?: string
  } | null
  proxy: {
    id: string
    label: string
    status: string
    type: string
    expectedCountry?: string | null
  } | null
  // Multi-account (M.3). Сортировка: isPrimary=true первым, потом по addedAt asc.
  accounts: DeviceProfileLinkedAccountDto[]
  // US-proxy guard результат — UI решает можно ли показать "Привязать ещё" и
  // что в tooltip.
  proxyCountryGuard: DeviceProxyCountryGuard
  sessionState: DeviceSessionState
  // Last-known DuoPlus device-info из config.duoplus (device-sync P7). null если
  // профиль ещё ни разу не синхронизировался (local_only без облачного снапшота).
  duoplus: DeviceDuoplusInfo | null
}

/**
 * Человекочитаемые метки + семантика DaisyUI-цвета для статуса DuoPlus-устройства.
 * Используется и Hardware/AdbStatus-компонентами, и карточкой/списком.
 */
export interface DeviceStatusMeta {
  label: string
  /** DaisyUI-семантика для badge: success/error/warning/info/neutral. */
  tone: "success" | "error" | "warning" | "info" | "neutral"
}

export const DEVICE_STATUS_META: Record<number, DeviceStatusMeta> = {
  0: { label: "Не настроено", tone: "neutral" },
  1: { label: "Включено", tone: "success" },
  2: { label: "Выключено", tone: "neutral" },
  3: { label: "Срок истёк", tone: "error" },
  4: { label: "Оплата просрочена", tone: "error" },
  10: { label: "Включается", tone: "info" },
  11: { label: "Конфигурируется", tone: "info" },
  12: { label: "Ошибка конфигурации", tone: "error" },
}

export function deviceStatusMeta(status: number | null | undefined): DeviceStatusMeta {
  if (status == null) return { label: "Неизвестно", tone: "neutral" }
  return DEVICE_STATUS_META[status] ?? { label: `Статус ${status}`, tone: "warning" }
}

export interface DeviceProfileCreateInput {
  name: string
  platformType?: DevicePlatformType
  os?: string | null
  userAgent?: string | null
  screenResolution?: string | null
  language?: string | null
  timezone?: string | null
  proxyId?: string | null
  socialAccountId?: number | null
  notes?: string | null
  tags?: string[]
  // fingerprint/devicePresetId — оператор шлёт скрыто (не редактируется в UI после R6);
  // хранятся в config, под DuoPlus Android переопределятся в Этапе 3.
  fingerprint?: Partial<DeviceFingerprintDto>
  devicePresetId?: string | null
}

export type DeviceProfileUpdateInput = Partial<DeviceProfileCreateInput>

export interface DeviceStartProfileResponse {
  // 'started' — браузер/устройство запущено, port есть если automation_type=selenium.
  // 'downloading_core' — провайдер lazy-качает core ИЛИ держит lock на профиле.
  //                     UI переключается на progress stepper и polling.
  state: "started" | "downloading_core"
  // port=null когда провайдер стартует standalone (без automation_type=selenium)
  // ИЛИ когда state='downloading_core'. Port есть только для automation success.
  port: number | null
  profileId: string
  indigoId: string
  // Сообщение от провайдера при downloading_core (для UX, не error).
  message?: string
  // Provider error_code когда state='downloading_core'. UI выбирает retry policy:
  // CORE - долго до 5 мин (download), LOCK - быстро до 15 сек (lock release).
  code?: "CORE_DOWNLOADING_STARTED" | "LOCK_PROFILE_ERROR"
}

export interface DeviceSyncResult {
  imported: number
  updated: number
  conflicted: number
  // skipped - дубликаты из remote workspace (тот же name+platformType уже в local
  // БД с другим indigoId, либо archived). НЕ ошибка - оператор просто видит
  // что remote workspace содержит дубли (failed create attempts).
  skipped: number
  errors: number
  total: number
}

/**
 * Результат dry-run test push к провайдеру + общая структура для диагностики ошибок
 * action-операций (start/stop). Возвращает полный response (status + body) для
 * дебага оператором. method расширен под все операции.
 */
export interface DeviceTestPushResult {
  ok: boolean
  status: number
  method: "create" | "partial_update" | "start" | "stop"
  url: string
  requestBody: Record<string, unknown>
  responseBody: unknown
  error: string | null
  // Phase где упало (для start/stop) — validate / proxy_check / token / launcher_call / save.
  phase?: string
  // Trace попыток получить folder_id если у профиля нет своего (только create flow).
  // Каждая попытка содержит endpoint + status + сколько folders нашли.
  folderProbe?: {
    attempts: Array<{
      method: string
      url: string
      status: number
      ok: boolean
      foundFolders: number
      error?: string
    }>
    resolvedFolderId: string | null
  }
  // Только для create flow если провайдер принял payload (2xx) — мы реально создали
  // профиль в workspace, и пытаемся его сразу удалить (honest dry-run). Если
  // didCleanup=false, оператор должен удалить вручную (createdIndigoId покажет id).
  cleanup?: {
    didCleanup: boolean
    createdIndigoId: string
    attempts: Array<{
      method: string
      url: string
      status: number
      ok: boolean
      error?: string
    }>
  }
}
