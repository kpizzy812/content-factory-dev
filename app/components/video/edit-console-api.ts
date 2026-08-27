import { VOICE_CLONE_USD } from '~~/shared/types/edit-console'
import type {
  StepwiseApprovalAction,
  TrackRegenerationPreview,
} from '~~/shared/types/edit-console'
import { readTrackRegenerationPreview } from './edit-console-model'

/**
 * Обращения монтажной консоли к серверу.
 *
 * Функции берут `fetcher` параметром, а не зовут глобальный `$fetch`: два
 * действия здесь стоят реальных денег (перегенерация трека и клон голоса), и
 * «кнопка не отправляет запрос без подтверждения суммы» обязано быть доказуемо
 * тестом, а не обещанием в комментарии. Компоненты передают сюда `$fetch`.
 */

export interface ConsoleFetchOptions {
  method?: string
  body?: BodyInit | Record<string, unknown> | null
}

/** Совместим по форме с `$fetch`, чтобы компонент передавал его как есть. */
export type ConsoleFetcher = <T = unknown>(url: string, options?: ConsoleFetchOptions) => Promise<T>

/** Дорогое действие вызвано без подтверждения суммы — до сети дело не дошло. */
export class UnconfirmedExpensiveActionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnconfirmedExpensiveActionError'
  }
}

// ─── Дёшево: замена одной фразы ──────────────────────────────────────────────

export interface ReplaceSegmentResponse {
  data: {
    id: number
    sceneOrder: number
    status: string
    deltaSec: number
    invalidatedSceneOrders: number[]
    costUsd: number
    reused: boolean
    trackDurationSec: number
    warnings: string[]
  }
}

/**
 * Пересинтез одной фразы. Подтверждения не спрашиваем сознательно: цена
 * копеечная, а лишнее подтверждение обесценивает те два, что действительно
 * нужны.
 */
export function replaceSegment(
  fetcher: ConsoleFetcher,
  videoId: number,
  input: { sceneOrder: number, newText: string },
): Promise<ReplaceSegmentResponse> {
  return fetcher<ReplaceSegmentResponse>(`/api/videos/${videoId}/voiceover/replace-segment`, {
    method: 'POST',
    body: { sceneOrder: input.sceneOrder, newText: input.newText },
  })
}

// ─── Дорого: перегенерация всего трека ───────────────────────────────────────

/**
 * Запрос сметы: тот же endpoint без `confirmExpensive`.
 *
 * Сервер отвечает 400 и кладёт смету в тело — то есть даже «случайный» вызов
 * ничего не запускает и не списывает. Возвращаем смету, а не бросаем.
 */
export async function previewTrackRegeneration(
  fetcher: ConsoleFetcher,
  videoId: number,
): Promise<{ preview: TrackRegenerationPreview | null, error: unknown }> {
  try {
    // Тело намеренно без `confirmExpensive`: это запрос сметы, а не работы.
    const done = await fetcher(`/api/videos/${videoId}/voiceover/regenerate-track`, {
      method: 'POST',
      body: {},
    })
    // 200 сюда приходит только когда перегенерировать нечего — смета внутри.
    const data = (done as { data?: { preview?: TrackRegenerationPreview } } | null)?.data
    return { preview: data?.preview ?? null, error: null }
  }
  catch (error) {
    return { preview: readTrackRegenerationPreview(error), error }
  }
}

/**
 * Собственно перегенерация. Без подтверждённой суммы запрос не уходит вовсе —
 * второй рубеж после серверного 400.
 */
export function regenerateTrack(
  fetcher: ConsoleFetcher,
  videoId: number,
  options: { acknowledged: boolean, force?: boolean },
): Promise<unknown> {
  if (options.acknowledged !== true) {
    return Promise.reject(new UnconfirmedExpensiveActionError(
      'Перегенерация трека обесценивает все кадры ролика — подтвердите сумму',
    ))
  }
  return fetcher(`/api/videos/${videoId}/voiceover/regenerate-track`, {
    method: 'POST',
    body: { confirmExpensive: true, ...(options.force ? { force: true } : {}) },
  })
}

// ─── Дорого: клон голоса ─────────────────────────────────────────────────────

/**
 * Клонирование голоса. Сервер требует `confirmUsd` строго равным цене прогона;
 * здесь та же проверка на клиенте — файл в 20 МБ не должен уходить в сеть,
 * если оператор не подтвердил списание.
 */
export function cloneVoice(
  fetcher: ConsoleFetcher,
  characterId: string,
  input: {
    file: File
    targetModel: string
    confirmedUsd: number
    noiseReduction?: boolean
    volumeNormalization?: boolean
  },
): Promise<unknown> {
  if (input.confirmedUsd !== VOICE_CLONE_USD) {
    return Promise.reject(new UnconfirmedExpensiveActionError(
      `Прогон клонирования стоит ${VOICE_CLONE_USD} $ — подтвердите сумму`,
    ))
  }
  const form = new FormData()
  form.append('file', input.file)
  form.append('targetModel', input.targetModel)
  form.append('confirmUsd', String(VOICE_CLONE_USD))
  if (input.noiseReduction) form.append('noiseReduction', 'true')
  if (input.volumeNormalization) form.append('volumeNormalization', 'true')

  return fetcher(`/api/characters/${characterId}/clone-voice`, { method: 'POST', body: form })
}

// ─── Бесплатно: кадры и пошаговый режим ──────────────────────────────────────

export function rerenderShot(
  fetcher: ConsoleFetcher,
  videoId: number,
  order: number,
): Promise<unknown> {
  return fetcher(`/api/videos/${videoId}/shots/${order}/rerender`, { method: 'POST' })
}

export function setStepwise(
  fetcher: ConsoleFetcher,
  videoId: number,
  stepwiseApproval: boolean | null,
): Promise<unknown> {
  // Ключ обязан присутствовать: `null` — законное значение «наследовать профиль»,
  // и пропуск поля сервер отвергнет.
  return fetcher(`/api/videos/${videoId}/stepwise`, {
    method: 'POST',
    body: { stepwiseApproval },
  })
}

export function approveStep(
  fetcher: ConsoleFetcher,
  videoId: number,
  action: StepwiseApprovalAction,
): Promise<unknown> {
  return fetcher(`/api/videos/${videoId}/approve-step`, { method: 'POST', body: { action } })
}

/** Сообщение сервера, а не код: оператору нужна причина, а не 409. */
export function consoleErrorText(error: unknown, fallback: string): string {
  const e = error as { data?: { message?: string }, message?: string } | null
  return e?.data?.message || e?.message || fallback
}
