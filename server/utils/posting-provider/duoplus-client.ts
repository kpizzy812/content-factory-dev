/**
 * DuoPlus REST-клиент (Этап 3, фаза P1).
 *
 * Типизированный клиент поверх `openapi.duoplus.net`. Управление облачными
 * Android-устройствами (cloud phones) через REST. Контракты подтверждены
 * LIVE-POC (см. researcher/duoplus_integration_research.md).
 *
 * КЛЮЧЕВЫЕ ПРАВИЛА (НЕ нарушать):
 * - Ключ ТОЛЬКО из env `DUOPLUS_API_KEY` (заголовок `DuoPlus-API-Key`). НЕ хардкод.
 * - Успех определяется по `data.success` (boolean у command, массив у power*),
 *   НЕ по HTTP-коду (всегда 200). Ошибка выполнения команды → `data.message`
 *   содержит `sshExecError`.
 * - QPS=1 на эндпоинт → пул `ProviderRateLimiter` (maxRpm=60) на каждый путь.
 * - Retry ≥3 на сетевые/5xx (exp backoff). `sshExecError` — НЕ retry на уровне
 *   клиента (это логика команды, не транспорта; решает вызывающий хелпер).
 * - Таймаут HTTP-запроса ≥90с (правило проекта). Сама device-команда ≤10с на
 *   стороне DuoPlus, но HTTP-обёртку держим щедро.
 * - Mock-режим: `DUOPLUS_MOCK_MODE=true` → base = `DUOPLUS_MOCK_URL`.
 */

import { readFile } from "node:fs/promises"

import { ProviderRateLimiter } from "./rate-limiter"
import type {
  DuoplusCloudDiskFile,
  DuoplusCloudDiskListResponse,
  DuoplusCommandData,
  DuoplusCommandResponse,
  DuoplusDevice,
  DuoplusEnvelope,
  DuoplusInitProxyData,
  DuoplusInitProxyResponse,
  DuoplusListFilter,
  DuoplusListResponse,
  DuoplusPowerData,
  DuoplusPowerResponse,
  DuoplusPushFilesData,
  DuoplusPushFilesResponse,
  DuoplusSignedUrlData,
  DuoplusSignedUrlResponse,
} from "./duoplus-types"

const DEFAULT_API_BASE = "https://openapi.duoplus.net"
const REQUEST_TIMEOUT_MS = 90_000
/** Таймаут PUT-заливки файла на OSS (большое видео ≤500MB) — щедрый. */
const OSS_PUT_TIMEOUT_MS = 180_000
const MAX_RETRIES = 3
const RETRY_BASE_DELAY_MS = 500
const RATE_LIMIT_RPM = 60 // QPS=1

/** Ошибка транспорта/протокола (сеть, не-200 HTTP, невалидный конверт, code!=200). */
export class DuoplusApiError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly endpoint: string,
    readonly code?: number,
  ) {
    super(message)
    this.name = "DuoplusApiError"
  }
}

/**
 * Ошибка выполнения shell-команды на устройстве. HTTP=200, но `data.success:false`.
 * `sshExecError` в `data.message` — НЕ retry на уровне клиента (это логика команды).
 */
export class DuoplusCommandError extends Error {
  constructor(
    message: string,
    readonly content: string,
    readonly imageId: string,
  ) {
    super(message)
    this.name = "DuoplusCommandError"
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRetryableHttp(status: number): boolean {
  return status >= 500 || status === 429 || status === 408
}

export interface DuoplusClientOptions {
  /** Override базы (тесты). По умолчанию резолвится из env. */
  baseUrl?: string
  /** Override ключа (тесты). По умолчанию из env DUOPLUS_API_KEY. */
  apiKey?: string
}

export class DuoplusClient {
  private readonly baseUrl: string
  private readonly apiKey: string
  /** Один лимитер на эндпоинт (QPS=1/эндпоинт). */
  private readonly limiters = new Map<string, ProviderRateLimiter>()

  constructor(opts: DuoplusClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? resolveBaseUrl()).replace(/\/+$/, "")
    // Ключ ТОЛЬКО из env (или явный override для тестов). Никогда не хардкод.
    this.apiKey = opts.apiKey ?? process.env.DUOPLUS_API_KEY ?? ""
  }

  private limiterFor(endpoint: string): ProviderRateLimiter {
    let limiter = this.limiters.get(endpoint)
    if (!limiter) {
      limiter = new ProviderRateLimiter({ maxRpm: RATE_LIMIT_RPM })
      this.limiters.set(endpoint, limiter)
    }
    return limiter
  }

  /**
   * Низкоуровневый POST: rate-limit → fetch с таймаутом → retry на сети/5xx →
   * парсинг конверта { code, data, message }. Бросает DuoplusApiError на
   * транспортных проблемах. НЕ интерпретирует data.success (это делают методы).
   */
  private async post<T>(endpoint: string, body: unknown): Promise<DuoplusEnvelope<T>> {
    if (!this.apiKey) {
      throw new DuoplusApiError(
        "DUOPLUS_API_KEY не задан (env). Клиент не может аутентифицироваться.",
        0,
        endpoint,
      )
    }

    const url = `${this.baseUrl}${endpoint}`
    const limiter = this.limiterFor(endpoint)

    let lastErr: unknown
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
      await limiter.acquire()

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "DuoPlus-API-Key": this.apiKey,
          },
          body: JSON.stringify(body ?? {}),
          signal: controller.signal,
        })

        if (isRetryableHttp(res.status)) {
          lastErr = new DuoplusApiError(
            `DuoPlus ${endpoint}: HTTP ${res.status}`,
            res.status,
            endpoint,
          )
          if (attempt < MAX_RETRIES) {
            await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1))
            continue
          }
          throw lastErr
        }

        if (!res.ok) {
          throw new DuoplusApiError(
            `DuoPlus ${endpoint}: HTTP ${res.status}`,
            res.status,
            endpoint,
          )
        }

        const json = (await res.json()) as DuoplusEnvelope<T>
        if (json == null || typeof json !== "object" || typeof json.code !== "number") {
          throw new DuoplusApiError(
            `DuoPlus ${endpoint}: невалидный конверт ответа`,
            res.status,
            endpoint,
          )
        }
        if (json.code !== 200) {
          throw new DuoplusApiError(
            `DuoPlus ${endpoint}: code=${json.code} ${json.message ?? ""}`.trim(),
            res.status,
            endpoint,
            json.code,
          )
        }
        return json
      } catch (err) {
        clearTimeout(timer)
        // DuoplusApiError из ветки !res.ok / невалидного конверта / code!=200 —
        // не ретраим (это не транспортный сбой).
        if (err instanceof DuoplusApiError && !isRetryableHttp(err.httpStatus)) {
          throw err
        }
        lastErr = err
        if (attempt < MAX_RETRIES) {
          await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1))
          continue
        }
        if (err instanceof DuoplusApiError) throw err
        throw new DuoplusApiError(
          `DuoPlus ${endpoint}: ${(err as Error)?.message ?? "network error"}`,
          0,
          endpoint,
        )
      } finally {
        clearTimeout(timer)
      }
    }
    // Недостижимо, но TS требует возврата.
    throw (lastErr instanceof Error
      ? lastErr
      : new DuoplusApiError(`DuoPlus ${endpoint}: retries exhausted`, 0, endpoint))
  }

  /** Список облачных устройств. */
  async listCloudPhones(filter: DuoplusListFilter = {}): Promise<DuoplusDevice[]> {
    const res = (await this.post<DuoplusListResponse["data"]>("/api/v1/cloudPhone/list", {
      page: filter.page ?? 1,
      pagesize: filter.pagesize ?? 100, // покрыть весь парк одной страницей (powerOnDevice ищет по id)
    }))
    return res.data?.list ?? []
  }

  /** Включение устройств. Возвращает массивы success/fail (по id). */
  async powerOn(imageIds: string[]): Promise<DuoplusPowerData> {
    const res = (await this.post<DuoplusPowerResponse["data"]>(
      "/api/v1/cloudPhone/powerOn",
      { image_ids: imageIds },
    ))
    return res.data
  }

  /** Выключение устройств. */
  async powerOff(imageIds: string[]): Promise<DuoplusPowerData> {
    const res = (await this.post<DuoplusPowerResponse["data"]>(
      "/api/v1/cloudPhone/powerOff",
      { image_ids: imageIds },
    ))
    return res.data
  }

  /**
   * Одна атомарная shell-команда (≤10с на стороне DuoPlus). Возвращает stdout.
   * Бросает DuoplusCommandError при `data.success:false` (sshExecError и пр.) —
   * вызывающий хелпер сам решает, ретраить ли (НЕ ретраим на уровне клиента).
   */
  async command(imageId: string, cmd: string): Promise<string> {
    // Ярлык команды для диагностики: «agentError 500» / «sshExecError» сами по
    // себе не говорят, ЧТО упало на устройстве. Включаем команду в сообщение ошибки.
    const cmdTag = cmd.length > 120 ? `${cmd.slice(0, 120)}…` : cmd
    let res
    try {
      res = await this.post<DuoplusCommandResponse["data"]>(
        "/api/v1/cloudPhone/command",
        { image_id: imageId, command: cmd },
      )
    } catch (err) {
      if (err instanceof DuoplusApiError) {
        throw new DuoplusApiError(
          `${err.message} [cmd: ${cmdTag}]`,
          err.httpStatus,
          err.endpoint,
          err.code,
        )
      }
      throw err
    }
    const data: DuoplusCommandData = res.data
    if (!data || data.success !== true) {
      throw new DuoplusCommandError(
        `${data?.message || "command failed"} [cmd: ${cmdTag}]`,
        data?.content ?? "",
        imageId,
      )
    }
    return data.content ?? ""
  }

  /** Привязка/инициализация прокси. Контракт уточняется live (P7). */
  async initProxy(imageId: string, params: Record<string, unknown> = {}): Promise<DuoplusInitProxyData> {
    const res = (await this.post<DuoplusInitProxyResponse["data"]>(
      "/api/v1/cloudPhone/initProxy",
      { image_id: imageId, ...params },
    ))
    return res.data
  }

  // ----- Cloud Drive (push-модель заливки медиа) ---------------------------

  /**
   * Запросить presigned PUT-URL Alibaba OSS для загрузки файла в Cloud Drive.
   * `data.name` — фактическое имя в Cloud Drive (может отличаться от запрошенного
   * при коллизии); ИМЕННО его передавать в cloudDiskList для поиска file.id.
   */
  async cloudDiskSignedUrl(name: string): Promise<DuoplusSignedUrlData> {
    const res = await this.post<DuoplusSignedUrlResponse["data"]>(
      "/api/v1/cloudDisk/signedUrl",
      { name },
    )
    return res.data
  }

  /**
   * Залить локальный файл в Cloud Drive: signedUrl → PUT (stream) на OSS.
   * Возвращает SignedUrlData (поле `name` — для последующего поиска в /list).
   * PUT идёт на сторонний OSS-URL (НЕ openapi.duoplus.net), потоком — большое
   * видео не грузится в память. Обязательные `x-oss-callback*` заголовки берутся
   * из ответа signedUrl (без них файл не регистрируется в системе DuoPlus).
   */
  async uploadFileToCloudDrive(name: string, localFilePath: string): Promise<DuoplusSignedUrlData> {
    const signed = await this.cloudDiskSignedUrl(name)
    await this.putToOss(signed, localFilePath)
    return signed
  }

  /** PUT файла на presigned OSS-URL с retry на сети/5xx. */
  private async putToOss(signed: DuoplusSignedUrlData, localFilePath: string): Promise<void> {
    if (!signed?.signedUrl) {
      throw new DuoplusApiError("cloudDisk/signedUrl не вернул signedUrl", 0, "cloudDisk/oss-put")
    }
    // Читаем файл в память (Buffer) — fetch сам выставит корректный Content-Length,
    // и заливка работает в любом fetch-окружении (undici/полифилл), в отличие от
    // Node-stream body (тот в части окружений сериализуется как "[object Object]").
    // Видео-шортсы малы, джобы сериализованы — память не проблема (лимит 500MB).
    const buf = await readFile(localFilePath)
    // Заголовки строго из ответа подписи (x-oss-callback / x-oss-callback-var):
    // их пропуск → файл не появится в /list. Свой Content-Type НЕ навязываем —
    // несовпадение с подписанным даёт 403 (см. open-вопрос probe).
    const headers: Record<string, string> = { ...(signed.headers ?? {}) }

    let lastErr: unknown
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), OSS_PUT_TIMEOUT_MS)
      try {
        const res = await fetch(signed.signedUrl, {
          method: "PUT",
          headers,
          body: buf,
          signal: controller.signal,
        })
        if (!res.ok) {
          const text = await res.text().catch(() => "")
          const err = new DuoplusApiError(
            `OSS PUT: HTTP ${res.status} ${text.slice(0, 200)}`.trim(),
            res.status,
            "cloudDisk/oss-put",
          )
          // 4xx (403 callback/Content-Type mismatch) — не транзиентно, не ретраим.
          if (isRetryableHttp(res.status) && attempt < MAX_RETRIES) {
            lastErr = err
            await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1))
            continue
          }
          throw err
        }
        return // успех
      } catch (err) {
        if (err instanceof DuoplusApiError && !isRetryableHttp(err.httpStatus)) {
          throw err
        }
        lastErr = err
        if (attempt < MAX_RETRIES) {
          await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1))
          continue
        }
        if (err instanceof DuoplusApiError) throw err
        throw new DuoplusApiError(
          `OSS PUT: ${(err as Error)?.message ?? "network error"}`,
          0,
          "cloudDisk/oss-put",
        )
      } finally {
        clearTimeout(timer)
      }
    }
    throw (lastErr instanceof Error
      ? lastErr
      : new DuoplusApiError("OSS PUT: retries exhausted", 0, "cloudDisk/oss-put"))
  }

  /** Поиск файлов в Cloud Drive по имени (keyword = SignedUrlData.name). */
  async cloudDiskList(keyword: string): Promise<DuoplusCloudDiskFile[]> {
    const res = await this.post<DuoplusCloudDiskListResponse["data"]>(
      "/api/v1/cloudDisk/list",
      { keyword, page: 1, pagesize: 20 },
    )
    return res.data?.list ?? []
  }

  /**
   * Отправить файлы из Cloud Drive на устройства (копирование в `dest_dir`).
   * Проверять надо `data.fail` (верхний `message` может быть "Failed" при
   * частичном успехе). Вероятно асинхронно — готовность файла на устройстве
   * подтверждается ls-poll'ом вызывающим хелпером.
   */
  async cloudDiskPushFiles(
    ids: string[],
    imageIds: string[],
    destDir: string,
  ): Promise<DuoplusPushFilesData> {
    const res = await this.post<DuoplusPushFilesResponse["data"]>(
      "/api/v1/cloudDisk/pushFiles",
      { ids, image_ids: imageIds, dest_dir: destDir },
    )
    return res.data
  }

  /** Удалить файлы из Cloud Drive (cleanup после отправки на устройство). */
  async cloudDiskDelFiles(ids: string[]): Promise<void> {
    await this.post("/api/v1/cloudDisk/delFiles", { ids })
  }
}

/**
 * Резолв базового URL: mock-режим перебивает прод. Ключ резолвится отдельно в
 * конструкторе (всегда из env). Здесь — только base.
 */
export function resolveBaseUrl(): string {
  if (process.env.DUOPLUS_MOCK_MODE === "true" && process.env.DUOPLUS_MOCK_URL) {
    return process.env.DUOPLUS_MOCK_URL
  }
  return process.env.DUOPLUS_API_BASE || DEFAULT_API_BASE
}

let singleton: DuoplusClient | null = null

/** Ленивый синглтон клиента (один на процесс — общий пул лимитеров). */
export function getDuoplusClient(): DuoplusClient {
  if (!singleton) singleton = new DuoplusClient()
  return singleton
}

/** Сброс синглтона (для тестов между сценариями env). */
export function resetDuoplusClient(): void {
  singleton = null
}
