/**
 * AdbAutomationEngine — движок автоматизации постинга поверх DuoPlus (Этап 3,
 * фаза P2, стратегия A1 — REST-only). Реализует AutomationEngine.
 *
 * На P2 — КАРКАС device-lifecycle, без конкретных постеров (P4 YouTube / P8
 * TikTok+IG). `postVideo`:
 *   1. резолвит image_id устройства,
 *   2. `powerOnDevice` — включает + poll `listCloudPhones` до status=1 (≥90с),
 *   3. dispatch по `input.platform` → платформенный постер (НЕ реализован на P2
 *      → бросает структурированную ошибку `poster_not_implemented`),
 *   4. `powerOffDevice` в `finally` (best-effort, никогда не блокирует результат).
 *
 * Media-push (P3) встроится между powerOn и постером позже.
 *
 * КЛЮЧЕВЫЕ ПРАВИЛА:
 * - Ожидание powerOn = poll списка, НЕ фиксированный sleep-в-команде. Реальная
 *   задержка между поллами — `setTimeout`-await на стороне движка (HTTP-уровень),
 *   НЕ device-side sleep (тот упёрся бы в 10с-лимит → sshExecError).
 * - Статусы 12 (config error) / 3 (expired) / 4 (unpaid) → terminal (повтор не
 *   поможет). 2→10→1 — нормальный цикл включения (~75с реально).
 * - powerOff никогда не бросает наружу из finally (лог + проглот).
 */

import { getDuoplusClient } from "../../utils/posting-provider/duoplus-client"
import {
  DUOPLUS_DEVICE_STATUS,
  DUOPLUS_TERMINAL_STATUSES,
  type DuoplusDevice,
} from "../../utils/posting-provider/duoplus-types"
import { downloadVideoForPosting, type FetchedVideo } from "../video-fetcher"
import { disableAnimations } from "./adb-shell"
import { pushVideoToDevice, removeDeviceVideo } from "./media-push"
import { postYouTubeShort } from "./posters/youtube-poster"
import { postInstagramReel } from "./posters/instagram-poster"
import type { AutomationEngine } from "./types"
import { PostingPhaseError, type PostInput, type PostResult } from "../posters/types"

/** Код terminal-ошибки: для платформы ещё нет ADB-постера (реализуется P4/P8). */
export const POSTER_NOT_IMPLEMENTED = "poster_not_implemented" as const

/** Код terminal-ошибки device-цикла (config error / expired / unpaid). */
export const DEVICE_CONFIG_ERROR = "device_config_error" as const
/** Код retry-ошибки: powerOn не достиг status=1 за таймаут / устройство в fail[]. */
export const DEVICE_POWER_FAILED = "device_power_failed" as const
/**
 * Код retry-ошибки: устройство уже ON (status=1) → занято другой публикацией.
 * Сериализация 1:1:1 — два постинга на одно устройство не идут параллельно
 * (иначе media-push второй задачи упирается в занятый ADB → sshExecError).
 */
export const DEVICE_BUSY = "device_busy" as const
/**
 * Код retry-ошибки: устройство в powering_on (10) / configuring (11) → остывает
 * после предыдущего постинга. DuoPlus залипает в configuring на ~180с+ после
 * частых powerOn/powerOff — лезть на него сразу = sshExecError. Повтор с кулдауном.
 */
export const DEVICE_COOLDOWN = "device_cooldown" as const

/** Структурированная ошибка ADB-движка с terminal-флагом для retry-policy. */
export class AdbEngineError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly terminal: boolean,
  ) {
    super(message)
    this.name = "AdbEngineError"
  }
}

/**
 * Расширение PostInput для ADB-движка: ему нужен image_id устройства DuoPlus.
 * На P5 poster-runner пробросит `deviceProfileId`/`imageId`; здесь принимаем
 * imageId напрямую (engine читает DeviceProfile.indigoId как image_id выше по
 * стеку). posters/types не трогаем — расширяем локально.
 */
export interface AdbPostInput extends PostInput {
  /** image_id устройства DuoPlus (DeviceProfile.indigoId). */
  imageId?: string
  /**
   * GCS storageKey видео (`Video.storageKey`, под `zavodcamp/`). Движок скачивает
   * файл из GCS в локальный tmp (video-fetcher) и заливает на устройство через
   * Cloud Drive (push-модель) — устройство больше НЕ качает по URL.
   */
  storageKey?: string
  /** Video.id — нужен video-fetcher'у для имени tmp-файла и логов. */
  videoId?: number
  /**
   * Handle канала (`camil_smith`) для best-effort захвата URL поста (YouTube).
   * Резолвится poster-runner'ом из SocialAccount.platformHandle.
   */
  channelHandle?: string | null
}

export interface AdbEngineOptions {
  /** Таймаут ожидания powerOn до status=1 (мс). Реально ~75с, держим ≥90с. */
  powerOnTimeoutMs?: number
  /** Интервал между поллами list при ожидании powerOn (мс). */
  powerOnPollIntervalMs?: number
  /** Таймаут ожидания докачки видео в устройство (мс). По умолчанию из media-push. */
  mediaReadyTimeoutMs?: number
  /** Интервал poll `ls -l` при заливке видео (мс). По умолчанию из media-push. */
  mediaPollIntervalMs?: number
}

// ≥90с; реально ~75с, НО после частых powerOn/powerOff устройство залипает в
// configuring (status 10) на ~180с+ (находка на живом устройстве) → держим 300с.
const DEFAULT_POWER_ON_TIMEOUT_MS = 300_000
const DEFAULT_POWER_ON_POLL_INTERVAL_MS = 10_000

/** Код retry-ошибки заливки медиа в устройство (download GCS / Cloud Drive / poll готовности). */
export const MEDIA_PUSH_FAILED = "media_push_failed" as const

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class AdbAutomationEngine implements AutomationEngine {
  readonly kind = "adb"

  private readonly powerOnTimeoutMs: number
  private readonly powerOnPollIntervalMs: number
  private readonly mediaReadyTimeoutMs?: number
  private readonly mediaPollIntervalMs?: number

  constructor(opts: AdbEngineOptions = {}) {
    this.powerOnTimeoutMs = opts.powerOnTimeoutMs ?? DEFAULT_POWER_ON_TIMEOUT_MS
    this.powerOnPollIntervalMs = opts.powerOnPollIntervalMs ?? DEFAULT_POWER_ON_POLL_INTERVAL_MS
    this.mediaReadyTimeoutMs = opts.mediaReadyTimeoutMs
    this.mediaPollIntervalMs = opts.mediaPollIntervalMs
  }

  /**
   * Включает устройство и поллит list до status=1. Возвращает device-запись
   * (с adb-адресом, заполненным при ON). НЕ sleep-в-команде — задержка между
   * поллами на стороне движка. Таймаут ≥90с.
   */
  async powerOnDevice(imageId: string): Promise<DuoplusDevice> {
    const client = getDuoplusClient()

    // --- Pre-check статуса ПЕРЕД powerOn (Этап 3: per-device кулдаун/сериализация).
    // Защита от коллизии «устройство занято / остывает после прошлого постинга»:
    // вместо media-push sshExecError превращаем в дружелюбный авто-повтор (retryable).
    const preList = await client.listCloudPhones()
    const pre = preList.find((d) => d.id === imageId)
    if (!pre) {
      throw new AdbEngineError(
        `Устройство ${imageId} отсутствует в списке DuoPlus`,
        DEVICE_CONFIG_ERROR,
        true, // конфиг-сбой (устройство удалено из аккаунта) — terminal.
      )
    }
    if (DUOPLUS_TERMINAL_STATUSES.has(pre.status)) {
      throw new AdbEngineError(
        `Устройство ${imageId} в terminal-статусе ${pre.status} ` +
          "(config error / expired / unpaid) — powerOn бесполезен",
        DEVICE_CONFIG_ERROR,
        true,
      )
    }
    if (pre.status === DUOPLUS_DEVICE_STATUS.ON) {
      // Устройство уже ON. Воркер-семафор browser_automation=1 (worker.ts) +
      // инвариант 1:1:1 гарантируют, что ДРУГОЙ живой сессии постинга на это
      // устройство нет. Значит ON здесь — ОСИРОТЕВШЕЕ включение: процесс прошлой
      // попытки умер до finally/powerOff (рестарт Nitro при деплое / краш), либо
      // powerOff молча провалился, либо лаг статуса DuoPlus после powerOff. Слепой
      // device_busy тут самовоспроизводится до исчерпания попыток (наблюдалось 4/5
      // в проде). Поэтому ГАСИМ залипшее устройство best-effort и уходим в cooldown —
      // следующая попытка увидит OFF и включит его начисто.
      await this.powerOffDevice(imageId)
      throw new AdbEngineError(
        "Устройство было залипшим во включённом состоянии — погасили, повтор после остывания.",
        DEVICE_COOLDOWN,
        false, // retryable через cooldown-backoff (≥180с): успеет погаснуть.
      )
    }
    if (
      pre.status === DUOPLUS_DEVICE_STATUS.POWERING_ON ||
      pre.status === DUOPLUS_DEVICE_STATUS.CONFIGURING
    ) {
      // Устройство ещё прогревается/конфигурируется после предыдущего постинга.
      throw new AdbEngineError(
        "Устройство остывает после предыдущего постинга (~3 мин) — повтор автоматически.",
        DEVICE_COOLDOWN,
        false, // retryable.
      )
    }
    // status 2 (off) / 0 (unconfigured) → продолжаем обычный powerOn + poll.

    const power = await client.powerOn([imageId])
    if (power.fail.includes(imageId)) {
      const reason = power.fail_reason?.[imageId] ?? "unknown"
      throw new AdbEngineError(
        `powerOn устройства ${imageId} провалился: ${reason}`,
        DEVICE_POWER_FAILED,
        false, // retryable — устройство может быть временно недоступно
      )
    }

    const deadline = Date.now() + this.powerOnTimeoutMs
    // Первый poll — сразу (без задержки), затем с интервалом.
    let firstPass = true
    while (Date.now() < deadline) {
      if (!firstPass) await sleep(this.powerOnPollIntervalMs)
      firstPass = false

      const list = await client.listCloudPhones()
      const dev = list.find((d) => d.id === imageId)
      if (!dev) {
        throw new AdbEngineError(
          `Устройство ${imageId} отсутствует в списке DuoPlus`,
          DEVICE_CONFIG_ERROR,
          true, // конфиг-сбой (устройство удалено из аккаунта) — terminal, иначе FSM ретраит и жжёт деньги на powerOn
        )
      }

      if (DUOPLUS_TERMINAL_STATUSES.has(dev.status)) {
        throw new AdbEngineError(
          `Устройство ${imageId} в terminal-статусе ${dev.status} ` +
            "(config error / expired / unpaid) — powerOn бесполезен",
          DEVICE_CONFIG_ERROR,
          true,
        )
      }

      if (dev.status === DUOPLUS_DEVICE_STATUS.ON) {
        return dev
      }
      // status 2 (off) / 10 (powering_on) / 11 (configuring) — продолжаем poll.
    }

    throw new AdbEngineError(
      `Устройство ${imageId} не достигло status=ON за ${this.powerOnTimeoutMs}мс`,
      DEVICE_POWER_FAILED,
      false,
    )
  }

  /** Best-effort выключение устройства. Никогда не бросает наружу. */
  async powerOffDevice(imageId: string): Promise<void> {
    try {
      await getDuoplusClient().powerOff([imageId])
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[adb-engine] powerOff ${imageId} не удался (best-effort):`, (err as Error)?.message)
    }
  }

  /**
   * Резолв image_id из входа. На P2 — только из `input.imageId`. На P5
   * poster-runner подставит его из DeviceProfile.indigoId до вызова engine.
   */
  private resolveImageId(input: AdbPostInput): string {
    const imageId = input.imageId?.trim()
    if (!imageId) {
      throw new AdbEngineError(
        "AdbAutomationEngine: не передан imageId устройства (DeviceProfile.indigoId)",
        DEVICE_POWER_FAILED,
        false,
      )
    }
    return imageId
  }

  /**
   * Скачивает видео из GCS по storageKey в локальный tmp (video-fetcher) и
   * возвращает FetchedVideo (localPath + cleanup). Файл заливается на устройство
   * через Cloud Drive (push-модель) — устройство больше НЕ качает по URL.
   * cleanup ОБЯЗАТЕЛЬНО вызвать в finally (удаляет tmp на деплое).
   */
  private async resolveVideoFile(input: AdbPostInput): Promise<FetchedVideo> {
    const storageKey = input.storageKey?.trim()
    if (!storageKey) {
      throw new AdbEngineError(
        "AdbAutomationEngine: не передан storageKey видео (Video.storageKey) для заливки в устройство",
        MEDIA_PUSH_FAILED,
        true, // config-проблема сборки input — повтор не поможет (terminal).
      )
    }
    if (typeof input.videoId !== "number") {
      throw new AdbEngineError(
        "AdbAutomationEngine: не передан videoId видео для скачивания из GCS",
        MEDIA_PUSH_FAILED,
        true,
      )
    }
    try {
      return await downloadVideoForPosting({ storageKey, videoId: input.videoId })
    } catch (err) {
      throw new AdbEngineError(
        `Не удалось скачать видео ${storageKey} из GCS: ${(err as Error)?.message ?? "unknown"}`,
        MEDIA_PUSH_FAILED,
        false, // terminal=false → retryable (storage/сеть временно недоступны)
      )
    }
  }

  /**
   * Lifecycle постинга: powerOn → скачать видео из GCS в tmp → залить на устройство
   * через Cloud Drive (signedUrl → PUT → pushFiles → poll → media-scanner) →
   * dispatch постера (YouTube/Instagram) → в finally: rm с устройства + cleanup tmp
   * + powerOff (best-effort, никогда не блокирует результат). Устройство НЕ должно
   * оставаться включённым — powerOff обязателен (биллинг по времени работы).
   */
  async postVideo(input: PostInput): Promise<PostResult> {
    const adbInput = input as AdbPostInput
    const imageId = this.resolveImageId(adbInput)

    await this.powerOnDevice(imageId)
    // Отключаем анимации устройства (раз на сессию): иначе uiautomator dump виснет
    // на анимированных экранах YouTube (крутящийся прогресс загрузки never-idle)
    // → timeout 405. Best-effort, не блокирует постинг. Доказано probe на 4kwGy.
    await disableAnimations(imageId)
    let devicePath: string | null = null
    let fetched: FetchedVideo | null = null
    try {
      fetched = await this.resolveVideoFile(adbInput)
      const filename = `${adbInput.jobId}.mp4`
      try {
        devicePath = await pushVideoToDevice(imageId, fetched.localPath, filename, {
          readyTimeoutMs: this.mediaReadyTimeoutMs,
          pollIntervalMs: this.mediaPollIntervalMs,
        })
      } catch (err) {
        throw new AdbEngineError(
          `Заливка видео в устройство ${imageId} провалилась: ${(err as Error)?.message ?? "unknown"}`,
          MEDIA_PUSH_FAILED,
          // terminal=false → RETRYABLE: Cloud Drive/сеть/sshExecError транзиентны —
          // повтор с backoff помогает.
          false,
        )
      }
      return await this.dispatchPoster(imageId, adbInput, devicePath)
    } finally {
      if (devicePath) await removeDeviceVideo(imageId, devicePath)
      if (fetched) await fetched.cleanup() // удалить локальный tmp на деплое
      await this.powerOffDevice(imageId)
    }
  }

  /**
   * Dispatch по платформе. На P3 постеры не реализованы → terminal-ошибка
   * `poster_not_implemented`. На P4 — youtube, на P8 — tiktok/instagram.
   * `devicePath` — путь к уже залитому видео (P3 media-push), для постера.
   */
  private async dispatchPoster(
    imageId: string,
    input: AdbPostInput,
    devicePath: string,
  ): Promise<PostResult> {
    switch (input.platform) {
      case "youtube": {
        // YouTube Short: caption = title (Short-подпись), fallback на caption.
        const caption = (input.title?.trim() || input.caption?.trim()) ?? ""
        const result = await postYouTubeShort({
          imageId,
          deviceVideoPath: devicePath,
          caption,
          channelHandle: input.channelHandle,
        })
        return {
          success: true,
          // URL поста — best-effort: серверный fetch публичной страницы канала по
          // handle (мобильная навигация к Share хрупкая). undefined, если handle
          // не задан / видео ещё не попало в SSR канала — не влияет на success.
          platformPostUrl: result.platformPostUrl,
          // Чем доказана публикация (device_tile / channel_fetch) — для honest-лога.
          verificationMethod: result.verificationMethod,
        }
      }
      case "instagram": {
        // Instagram Reel: единое поле caption (fallback на title).
        const caption = (input.caption?.trim() || input.title?.trim()) ?? ""
        await postInstagramReel({ imageId, deviceVideoPath: devicePath, caption })
        return {
          success: true,
          // IG Reel публикуется публично сразу; post-id из UI-flow не извлекается.
        }
      }
      case "tiktok":
        // TikTok застрял на splash при калибровке — не реализован (требует ручного
        // разбора оператором, см. researcher/duoplus_instagram_poster_calibration.md).
        throw new AdbEngineError(
          `ADB-постер для платформы "${input.platform}" ещё не реализован`,
          POSTER_NOT_IMPLEMENTED,
          true,
        )
      default:
        throw new AdbEngineError(
          `Неизвестная платформа для ADB-постинга: ${String(input.platform)}`,
          POSTER_NOT_IMPLEMENTED,
          true,
        )
    }
  }
}

// Re-export для удобства тестов / вызывающих, чтобы classify PostingPhaseError.
export { PostingPhaseError }
