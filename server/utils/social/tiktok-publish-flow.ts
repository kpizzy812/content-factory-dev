/**
 * Решения по ходу публикации в TikTok, вынесенные из адаптера.
 *
 * Здесь нет ни сети, ни диска: адаптер только исполняет вердикт. Вынесено
 * отдельно потому, что оба решения (ждать/падать и «пост правда опубликован»)
 * стоили нам невосстановимых загрузок, а проверять их через живой TikTok нельзя.
 */
import { TIKTOK_PUBLIC_PRIVACY_LEVEL } from "./tiktok-api"

/** Статус, в котором TikTok всё ещё ждёт от нас байты файла. */
export const TIKTOK_PROCESSING_UPLOAD = "PROCESSING_UPLOAD"

export type TikTokPollDecision =
  | { action: "complete" }
  | { action: "wait" }
  | { action: "fail"; message: string }

export interface TikTokPollInput {
  publishId: string
  status: string
  failReason?: string | null
  /** Публикация продолжена по сохранённому publish_id, а не начата в этом прогоне. */
  resumed: boolean
  now: number
  /** Общий дедлайн поллинга. */
  deadline: number
  /** Дедлайн для возобновлённой публикации, застрявшей на приёме файла. */
  stuckUploadDeadline: number
}

/**
 * Что делать с очередным статусом публикации.
 *
 * Отдельная ветка у возобновления: upload_url мы нигде не храним, дослать
 * недостающие чанки в старую публикацию физически невозможно. Поэтому если
 * возобновлённая публикация продолжает ждать файл — это не «TikTok думает»,
 * а тупик, и десять минут молчания вместо внятной ошибки только прячут его.
 */
export function decideTikTokPoll(input: TikTokPollInput): TikTokPollDecision {
  if (input.status === "PUBLISH_COMPLETE") return { action: "complete" }

  if (input.status === "FAILED") {
    return {
      action: "fail",
      message: `TikTok отклонил публикацию ${input.publishId}: ${input.failReason || "причина не указана"}`,
    }
  }

  if (
    input.resumed
    && input.status === TIKTOK_PROCESSING_UPLOAD
    && input.now >= input.stuckUploadDeadline
  ) {
    return {
      action: "fail",
      message:
        `TikTok: возобновлённая публикация ${input.publishId} так и не вышла из ${TIKTOK_PROCESSING_UPLOAD} — `
        + "файл в прошлой попытке доехал не полностью, а дослать чанки в неё уже нельзя. "
        + "Очистите platformContainerId у загрузки, чтобы опубликовать ролик заново.",
    }
  }

  if (input.now >= input.deadline) {
    return {
      action: "fail",
      message:
        `TikTok не завершил публикацию ${input.publishId} за отведённое время (статус ${input.status})`,
    }
  }

  return { action: "wait" }
}

export type TikTokPublishOutcome =
  /** Пост виден всем: у него есть публичный id, из которого собирается ссылка. */
  | { kind: "public"; postId: string }
  /** Оператор сам выбрал непубличный уровень — публичного id у поста и не будет. */
  | { kind: "restricted" }
  /** Публикация закрылась без публичного id там, где он обязан быть. */
  | { kind: "incomplete"; message: string }

/**
 * Чем закончилась публикация.
 *
 * Пустой список публичных id при уровне «всем» — это не успех с пустой ссылкой:
 * такой ролик уходил в published, оператор получал алерт «Видео загружено», а
 * сборщик метрик потом вечно не находил пост в Display API.
 */
export function resolveTikTokPublishOutcome(input: {
  publishId: string
  postIds: string[]
  privacyLevel: string
}): TikTokPublishOutcome {
  const postId = input.postIds.find(id => Boolean(id))
  if (postId) return { kind: "public", postId }

  if (input.privacyLevel !== TIKTOK_PUBLIC_PRIVACY_LEVEL) return { kind: "restricted" }

  return {
    kind: "incomplete",
    message:
      `TikTok закрыл публикацию ${input.publishId} со статусом PUBLISH_COMPLETE, но публичного id поста `
      + `не вернул, хотя уровень приватности — ${TIKTOK_PUBLIC_PRIVACY_LEVEL}. `
      + "Считать такую загрузку опубликованной нельзя: поста в ленте нет.",
  }
}
