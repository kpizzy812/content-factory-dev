/**
 * Заливка видео в облачное устройство DuoPlus (Этап 3, стратегия A1 — REST-only),
 * push-модель через Cloud Drive.
 *
 * Раньше устройство САМО качало видео по GCS signed-URL (`curl` в `cloudPhone/
 * command`) — это было хрупко: длинный URL + 10с-лимит команды → `sshExecError`,
 * заливка ложно падала (media_push_failed). Теперь надёжный путь: НАШ сервер уже
 * скачал видео из GCS в локальный tmp (video-fetcher), а здесь мы заливаем готовый
 * файл через нативный Cloud Drive DuoPlus — без curl-по-URL на телефоне.
 *
 * Поток (см. researcher: Upload Local Files to Cloud Drive / File push):
 *   1. signedUrl → PUT (stream) локального файла на Alibaba OSS — регистрирует
 *      файл в Cloud Drive (наш сервер, не устройство).
 *   2. cloudDisk/list по имени → file.id (poll: OSS eventual consistency).
 *   3. cloudDisk/pushFiles {ids, image_ids, dest_dir=/sdcard/DCIM} — копирует
 *      файл из Cloud Drive на устройство (нативно, без curl).
 *   4. ls-poll готовности файла на устройстве (стабилизация размера, ≥90с).
 *   5. media-scanner broadcast — ОБЯЗАТЕЛЕН, иначе MediaStore приложений
 *      (YouTube/TikTok/Instagram) не видит свежий файл в галерее.
 *   6. cloudDisk/delFiles — cleanup Cloud Drive (файл уже на устройстве).
 *
 * Целевой каталог — `/sdcard/DCIM/Camera` (конечная папка Camera; DuoPlus
 * pushFiles требует полный путь, промежуточный `/sdcard/DCIM` он отвергает).
 */

import { getDuoplusClient, type DuoplusClient } from "../../utils/posting-provider/duoplus-client"

/**
 * Базовый каталог на устройстве, куда заливается видео. ОБЯЗАТЕЛЬНО конечная
 * папка Camera — DuoPlus pushFiles отвергает промежуточный `/sdcard/DCIM`
 * ошибкой «The selected dest dir is invalid» (нужен полный путь до папки).
 * Camera читается приложениями из галереи (YouTube/Instagram/TikTok) и видна
 * media-scanner'у.
 */
export const DEVICE_DCIM_DIR = "/sdcard/DCIM/Camera"

export interface PushVideoOptions {
  /** Таймаут ожидания появления файла на устройстве до стабильного размера (мс). По умолчанию 120с (≥90с). */
  readyTimeoutMs?: number
  /** Интервал между poll `ls -l` (мс). По умолчанию 3с. */
  pollIntervalMs?: number
}

const DEFAULT_READY_TIMEOUT_MS = 120_000 // ≥90с (правило проекта)
const DEFAULT_POLL_INTERVAL_MS = 3_000
/** Таймаут ожидания регистрации файла в Cloud Drive после PUT (eventual consistency). */
const CLOUD_FILE_VISIBLE_TIMEOUT_MS = 30_000
const CLOUD_FILE_VISIBLE_POLL_MS = 2_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Device-команда с retry на транзиентный sshExecError. DuoPlus иногда отдаёт
 * agentError/sshExecError на ровном месте (устройство под нагрузкой / agent не
 * успел) — короткий повтор спасает от ложного сбоя.
 */
async function commandWithRetry(imageId: string, cmd: string, retries = 3): Promise<string> {
  const client = getDuoplusClient()
  let lastErr: unknown
  for (let i = 0; i < retries; i++) {
    try {
      return await client.command(imageId, cmd)
    } catch (err) {
      lastErr = err
      if (i < retries - 1) await sleep(2_000)
    }
  }
  throw lastErr
}

/**
 * Безопасное имя файла на устройстве: только [A-Za-z0-9._-], остальное → `_`.
 * Защита от инъекции в shell-команду (ls/am/rm идут одной строкой).
 */
export function sanitizeDeviceFilename(filename: string): string {
  const cleaned = filename.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "")
  return cleaned || "video.mp4"
}

/**
 * Размер файла в байтах из вывода `ls -l` (поле размера — 5-й столбец). null,
 * если файла нет / формат неожиданный (ls вернул пусто или «No such file»).
 */
export function parseLsSize(lsOutput: string): number | null {
  const line = lsOutput.trim()
  if (!line || /no such file|not found/i.test(line)) return null
  // `-rw-rw---- 1 u0_a123 media_rw 5242880 2026-06-12 12:00 video.mp4`
  const cols = line.split(/\s+/)
  // Ищем первый числовой столбец после прав/ссылок/владельца/группы (индекс 4).
  const size = Number(cols[4])
  if (Number.isFinite(size) && size > 0) return size
  // Фоллбэк: первое «крупное» число в строке (на случай иной раскладки ls).
  for (const c of cols) {
    const n = Number(c)
    if (Number.isFinite(n) && n > 0) return n
  }
  return null
}

/**
 * Poll Cloud Drive до появления файла по имени (OSS eventual consistency после
 * PUT). Возвращает file.id для pushFiles. Точное совпадение имени обязательно —
 * чтобы не зацепить чужой файл при общем keyword.
 */
async function resolveCloudFileId(
  client: DuoplusClient,
  name: string,
  timeoutMs = CLOUD_FILE_VISIBLE_TIMEOUT_MS,
  pollMs = CLOUD_FILE_VISIBLE_POLL_MS,
): Promise<string> {
  const deadline = Date.now() + timeoutMs
  let firstPass = true
  while (Date.now() < deadline) {
    if (!firstPass) await sleep(pollMs)
    firstPass = false
    let list
    try {
      list = await client.cloudDiskList(name)
    } catch {
      continue // транзиентный сбой list — повторим
    }
    const file = list.find((f) => f.name === name)
    if (file?.id) return file.id
  }
  throw new Error(
    `Файл ${name} не появился в Cloud Drive за ${timeoutMs}мс ` +
      "(OSS eventual consistency / PUT не зарегистрировал файл — проверь x-oss-callback)",
  )
}

/**
 * ls-poll готовности файла на устройстве: ждём, пока файл существует И его размер
 * СТАБИЛЕН между двумя соседними поллами (копирование Cloud Drive→устройство
 * завершено). Транзиентный sshExecError на ls трактуем как «ещё не готов».
 */
async function waitForDeviceFile(
  client: DuoplusClient,
  imageId: string,
  devicePath: string,
  timeoutMs: number,
  pollMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let prevSize: number | null = null
  let firstPass = true
  while (Date.now() < deadline) {
    if (!firstPass) await sleep(pollMs)
    firstPass = false

    let ls: string
    try {
      ls = await client.command(imageId, `ls -l ${devicePath} 2>/dev/null`)
    } catch {
      prevSize = null
      continue
    }
    const size = parseLsSize(ls)
    if (size === null) {
      prevSize = null
      continue
    }
    if (prevSize !== null && size === prevSize) return // стабилен → готов
    prevSize = size
  }
  throw new Error(
    `Файл ${devicePath} не появился/не стабилизировался на устройстве за ${timeoutMs}мс`,
  )
}

/**
 * Заливает локальный видеофайл в устройство через Cloud Drive и делает его
 * видимым приложениям (media-scanner). НАШ сервер уже скачал видео из GCS —
 * сюда приходит локальный путь, не URL.
 *
 * @param imageId image_id устройства DuoPlus.
 * @param localFilePath путь к скачанному видео в os.tmpdir() (video-fetcher).
 * @param filename желаемое имя файла на устройстве (`<jobId>.mp4`).
 * @returns абсолютный device-путь к залитому видео (`/sdcard/DCIM/<name>`).
 * @throws Error если файл не залился / не появился на устройстве за таймаут.
 */
export async function pushVideoToDevice(
  imageId: string,
  localFilePath: string,
  filename: string,
  options: PushVideoOptions = {},
): Promise<string> {
  const client = getDuoplusClient()
  const safeName = sanitizeDeviceFilename(filename)
  const readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS

  // --- 1. Залить локальный файл в Cloud Drive (signedUrl → PUT stream на OSS) ---
  const signed = await client.uploadFileToCloudDrive(safeName, localFilePath)
  // DuoPlus сохраняет под фактическим именем (signed.name; при коллизии — суффикс).
  const cloudName = sanitizeDeviceFilename(signed.name || safeName)
  const devicePath = `${DEVICE_DCIM_DIR}/${cloudName}`

  // --- 2. Найти file.id в Cloud Drive (poll: OSS eventual consistency) ---
  const fileId = await resolveCloudFileId(client, signed.name || safeName)

  let pushAccepted = false
  try {
    // --- 3. Отправить файл из Cloud Drive на устройство ---
    const result = await client.cloudDiskPushFiles([fileId], [imageId], DEVICE_DCIM_DIR)
    const ok = (result.success ?? []).some((s) => s.image_id === imageId)
    if (!ok) {
      throw new Error(
        `pushFiles не принял файл для устройства ${imageId}: ${JSON.stringify(result.fail ?? [])}`,
      )
    }
    pushAccepted = true

    // --- 4. ls-poll готовности файла на устройстве ---
    await waitForDeviceFile(client, imageId, devicePath, readyTimeoutMs, pollIntervalMs)

    // --- 5. media-scanner broadcast (ОБЯЗАТЕЛЕН) ---
    await commandWithRetry(
      imageId,
      `am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE ` +
        `-d file://${devicePath}`,
    )

    // --- 6. cleanup Cloud Drive (файл уже на устройстве) — best-effort ---
    await client.cloudDiskDelFiles([fileId]).catch(() => {})
    return devicePath
  } catch (err) {
    // Ошибка ДО принятия push'а — файл точно не копируется на устройство, чистим
    // Cloud Drive сразу. Если push уже принят (ls-poll timeout) — НЕ трогаем файл
    // в Cloud Drive (копирование могло ещё идти), уйдёт по TTL.
    if (!pushAccepted) {
      await client.cloudDiskDelFiles([fileId]).catch(() => {})
    }
    throw err
  }
}

/** Удаление залитого видео с устройства (best-effort, для cleanup в finally). */
export async function removeDeviceVideo(imageId: string, devicePath: string): Promise<void> {
  try {
    await getDuoplusClient().command(imageId, `rm -f ${devicePath}`)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[media-push] rm ${devicePath} не удался (best-effort):`, (err as Error)?.message)
  }
}
