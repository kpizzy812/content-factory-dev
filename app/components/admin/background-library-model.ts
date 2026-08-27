/**
 * Чистая логика библиотеки фонов: что браузер вправе отправить и что означает
 * ответ сервера.
 *
 * Главное здесь — честный разбор результата загрузки. Сервер
 * (`server/utils/edit-plan/background-store.ts`) отвечает 200 в ТРЁХ разных
 * случаях: файл принят, файл байт-в-байт уже лежал в библиотеке (`deduped`),
 * файл похож по первому кадру на уже принятые (`similarClipIds`). Если показать
 * все три одинаковой галочкой «загружено», оператор будет копить дубли и не
 * поймёт, почему счётчик библиотеки не растёт.
 */
import type { BackgroundClip, BackgroundClipKind } from '~~/shared/types/edit-console'
import { BACKGROUND_CLIP_KIND_LABELS } from '~~/shared/types/edit-console'

/**
 * Форматы — зеркало `ALLOWED_BACKGROUND_MIME` на сервере. Расхождение ловится
 * тестом, который читает серверный файл: браузер не должен отправлять 300 МБ
 * ради 415-го в ответ.
 */
export const BACKGROUND_ACCEPT_MIME = [
  'video/mp4',
  'video/quicktime',
  'image/png',
  'image/jpeg',
  'image/webp',
] as const

/** `BACKGROUND_CLIP_MAX_BYTES` на сервере — 500 МБ. */
export const BACKGROUND_MAX_BYTES = 500 * 1024 * 1024

export const BACKGROUND_ACCEPT_ATTR = BACKGROUND_ACCEPT_MIME.join(',')

export const BACKGROUND_KIND_OPTIONS: Array<{ value: BackgroundClipKind | '', label: string }> = [
  { value: '', label: 'Определить по файлу' },
  { value: 'screen_recording', label: BACKGROUND_CLIP_KIND_LABELS.screen_recording },
  { value: 'footage', label: BACKGROUND_CLIP_KIND_LABELS.footage },
  { value: 'image', label: BACKGROUND_CLIP_KIND_LABELS.image },
]

/** Что пришло от сервера на загрузку одного файла. */
export interface BackgroundUploadResult {
  clip: BackgroundClip
  deduped: boolean
  similarClipIds: string[]
}

export type BackgroundNoticeTone = 'success' | 'info' | 'warning'

export interface BackgroundUploadNotice {
  tone: BackgroundNoticeTone
  text: string
  /** Имена похожих фонов — чтобы оператор мог их открыть, а не гадать по id. */
  similarNames: string[]
}

/** Проверка файла ДО отправки: те же 415 и 413, что вернул бы сервер. */
export function validateBackgroundFile(file: { name: string, type: string, size: number }): string | null {
  const mime = (file.type || '').toLowerCase()
  if (!mime) {
    return `Браузер не определил формат файла «${file.name}». Библиотека принимает MP4, MOV, PNG, JPEG и WebP.`
  }
  if (!(BACKGROUND_ACCEPT_MIME as readonly string[]).includes(mime)) {
    return `Формат ${mime} не поддерживается. Библиотека принимает MP4, MOV, PNG, JPEG и WebP.`
  }
  if (file.size > BACKGROUND_MAX_BYTES) {
    return `Файл больше ${Math.floor(BACKGROUND_MAX_BYTES / (1024 * 1024))} МБ — сервер такой не примет.`
  }
  return null
}

export function clipTitle(clip: Pick<BackgroundClip, 'name' | 'id'>): string {
  return clip.name?.trim() || `Фон ${clip.id.slice(0, 8)}`
}

/**
 * Читает ответ загрузки и превращает его в то, что оператор увидит.
 *
 * `knownClipIds` — id фонов, которые были в списке ДО загрузки. Без них дубль
 * действующего фона нельзя отличить от возврата ранее удалённого: сервер в
 * обоих случаях отвечает `deduped: true` и той же строкой, но для оператора это
 * два разных события («ничего не изменилось» против «фон вернулся в список»).
 */
export function describeBackgroundUpload(
  result: BackgroundUploadResult,
  context: { knownClipIds: string[], clipsById: Record<string, BackgroundClip> },
): BackgroundUploadNotice {
  const title = clipTitle(result.clip)

  if (result.deduped) {
    const wasVisible = context.knownClipIds.includes(result.clip.id)
    return {
      tone: 'info',
      text: wasVisible
        ? `«${title}» уже был в библиотеке байт в байт — новая запись не создана, счётчик фонов не вырос.`
        : `«${title}» уже был в библиотеке, но числился погашенным — файл вернулся в список, новая запись не создана.`,
      similarNames: [],
    }
  }

  const similarNames = result.similarClipIds.map((id) => {
    const clip = context.clipsById[id]
    return clip ? clipTitle(clip) : id
  })

  if (similarNames.length > 0) {
    return {
      tone: 'warning',
      text: `«${title}» добавлен, но по первому кадру он похож на уже принятые фоны. `
        + 'Похожесть заливку не блокирует — второй ракурс той же локации бывает нужен, '
        + 'но если это дубль, удалите лишний.',
      similarNames,
    }
  }

  return { tone: 'success', text: `«${title}» добавлен в библиотеку.`, similarNames: [] }
}

/** Prisma отдаёт BigInt строкой — считаем только для показа. */
export function clipBytes(clip: Pick<BackgroundClip, 'bytes'>): number | null {
  if (clip.bytes === null || clip.bytes === undefined) return null
  const value = typeof clip.bytes === 'string' ? Number(clip.bytes) : clip.bytes
  return Number.isFinite(value) ? value : null
}

export function formatClipDuration(clip: Pick<BackgroundClip, 'durationSec' | 'kind'>): string {
  if (clip.durationSec === null || !Number.isFinite(clip.durationSec)) return 'картинка'
  const total = Math.round(clip.durationSec)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function clipKindLabel(kind: string): string {
  return BACKGROUND_CLIP_KIND_LABELS[kind as BackgroundClipKind] ?? kind
}

/** Итог по библиотеке для шапки: сколько фонов и сколько места они занимают. */
export function summarizeLibrary(clips: BackgroundClip[]): { count: number, bytes: number } {
  return {
    count: clips.length,
    bytes: clips.reduce((sum, clip) => sum + (clipBytes(clip) ?? 0), 0),
  }
}
