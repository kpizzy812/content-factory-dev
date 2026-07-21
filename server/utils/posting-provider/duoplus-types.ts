/**
 * Типы ответов DuoPlus REST API (`openapi.duoplus.net`).
 *
 * Контракты подтверждены LIVE-POC (см. researcher/duoplus_integration_research.md).
 * КРИТИЧНО: HTTP-код всегда 200; реальный успех — в `data.success`
 * (boolean у command, массив у power*).
 */

/** Статус облачного устройства DuoPlus (поле `status` в list). */
export const DUOPLUS_DEVICE_STATUS = {
  UNCONFIGURED: 0,
  ON: 1,
  OFF: 2,
  EXPIRED: 3,
  UNPAID: 4,
  POWERING_ON: 10,
  CONFIGURING: 11,
  CONFIG_ERROR: 12,
} as const

export type DuoplusDeviceStatus =
  (typeof DUOPLUS_DEVICE_STATUS)[keyof typeof DUOPLUS_DEVICE_STATUS]

/** Терминальные статусы — повтор powerOn не поможет. */
export const DUOPLUS_TERMINAL_STATUSES: ReadonlySet<number> = new Set([
  DUOPLUS_DEVICE_STATUS.EXPIRED,
  DUOPLUS_DEVICE_STATUS.UNPAID,
  DUOPLUS_DEVICE_STATUS.CONFIG_ERROR,
])

/** Один элемент списка cloudPhone/list. */
export interface DuoplusDevice {
  /** image_id устройства (наш ключ DeviceProfile.indigoId). */
  id: string
  name: string
  status: number
  os: string
  size: string
  created_at?: string
  expired_at?: string
  ip?: string
  area?: string
  remark?: string
  /** Пусто до status=1, после — `host:port`. */
  adb: string
  adb_password: string
  group?: string
  [extra: string]: unknown
}

/** Обёртка ответа DuoPlus: { code, data, message }. */
export interface DuoplusEnvelope<T> {
  code: number
  data: T
  message: string
}

export interface DuoplusListData {
  list: DuoplusDevice[]
  page: number
  pagesize: number
  total: number
  total_page: number
}

/** Ответ power on/off: успех/провал по массиву id. */
export interface DuoplusPowerData {
  success: string[]
  fail: string[]
  fail_reason?: Record<string, string>
}

/** Ответ command: успех по boolean `success`, stdout в `content`. */
export interface DuoplusCommandData {
  success: boolean
  content: string
  message: string
}

export interface DuoplusInitProxyData {
  success: boolean
}

export type DuoplusListResponse = DuoplusEnvelope<DuoplusListData>
export type DuoplusPowerResponse = DuoplusEnvelope<DuoplusPowerData>
export type DuoplusCommandResponse = DuoplusEnvelope<DuoplusCommandData>
export type DuoplusInitProxyResponse = DuoplusEnvelope<DuoplusInitProxyData>

export interface DuoplusListFilter {
  page?: number
  pagesize?: number
}

// ---------------------------------------------------------------------------
// Cloud Drive (Этап 3, заливка медиа push-моделью). Наш сервер скачивает видео
// из GCS локально и заливает в Cloud Drive (signedUrl→PUT на OSS), затем
// отправляет на устройство (pushFiles) — без curl-по-URL на телефоне.
// ---------------------------------------------------------------------------

/**
 * Ответ `cloudDisk/signedUrl`: presigned PUT-URL Alibaba OSS + обязательные
 * callback-заголовки. `name` может отличаться от запрошенного при коллизии имён
 * (дубликат → `file1.mp4`) — для поиска в /list использовать ИМЕННО `data.name`.
 */
export interface DuoplusSignedUrlData {
  /** Обычно "PUT". */
  method?: string
  /** Presigned URL Alibaba OSS — PUT идёт СЮДА, не на openapi.duoplus.net. */
  signedUrl: string
  /**
   * Заголовки, которые ОБЯЗАТЕЛЬНО передать в PUT (если подписаны): без
   * `x-oss-callback` файл не зарегистрируется в системе DuoPlus (не появится в /list).
   */
  headers?: Record<string, string>
  /** Фактическое имя файла в Cloud Drive (может отличаться от запрошенного). */
  name: string
  original_file_name?: string
}

/** Один файл в Cloud Drive (`cloudDisk/list`). */
export interface DuoplusCloudDiskFile {
  /** ID файла — нужен для pushFiles/delFiles. */
  id: string
  name: string
  original_file_name?: string
  [extra: string]: unknown
}

export interface DuoplusCloudDiskListData {
  list: DuoplusCloudDiskFile[]
  total: number
}

/** Ответ `cloudDisk/pushFiles`: отправка файлов из Cloud Drive на устройства. */
export interface DuoplusPushFilesData {
  message?: string
  /** Успешно отправленные пары (file_id × image_id). */
  success: Array<{ image_id: string; id: string }>
  /** Провалившиеся пары (с причиной, если есть). */
  fail: Array<{ image_id?: string; id?: string; reason?: string }>
}

export type DuoplusSignedUrlResponse = DuoplusEnvelope<DuoplusSignedUrlData>
export type DuoplusCloudDiskListResponse = DuoplusEnvelope<DuoplusCloudDiskListData>
export type DuoplusPushFilesResponse = DuoplusEnvelope<DuoplusPushFilesData>
