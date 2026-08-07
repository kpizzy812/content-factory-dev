/**
 * Сигнал адаптера «поста на площадке больше нет».
 *
 * Зачем отдельный тип ошибки: сборщик метрик обязан различать два внешне
 * одинаковых провала запроса.
 *  - площадка ответила «такого поста нет» — это НЕ авария сбора, а факт о
 *    публикации: ролик удалён или заблокирован, и его нужно так и пометить
 *    в `Upload.postStatus` (иначе поле остаётся мёртвым, а таблица роликов
 *    показывает удалённый пост живым);
 *  - запрос упал по любой другой причине (таймаут, 5xx, протухший токен,
 *    недостающий scope) — это временная беда. Менять статус по ней нельзя:
 *    один сбой TikTok API объявил бы «удалёнными» все ролики аккаунта.
 *
 * Поэтому статус меняем только там, где адаптер бросил именно эту ошибку.
 */
export type UnavailablePostStatus = "deleted" | "blocked"

export class PostUnavailableError extends Error {
  /**
   * Метка вместо `instanceof`: сборщик и адаптеры в Nitro могут прийти из
   * разных копий модуля (dev-HMR, отдельные бандлы), и тогда `instanceof`
   * молча вернёт false — публикация останется с неверным статусом.
   */
  readonly postUnavailable = true

  constructor(
    readonly postStatus: UnavailablePostStatus,
    message: string,
  ) {
    super(message)
    this.name = "PostUnavailableError"
  }
}

/**
 * Достаёт из ошибки статус публикации, если это сигнал недоступности поста.
 * Для всех прочих ошибок — null: статус трогать нельзя.
 */
export function postUnavailableStatus(error: unknown): UnavailablePostStatus | null {
  if (!error || typeof error !== "object") return null
  const candidate = error as { postUnavailable?: unknown; postStatus?: unknown }
  if (candidate.postUnavailable !== true) return null
  if (candidate.postStatus === "deleted" || candidate.postStatus === "blocked") {
    return candidate.postStatus
  }
  return null
}
