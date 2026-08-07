/**
 * Официальный замер числа подписчиков аккаунта.
 *
 * Отдельный интерфейс, а не поле в `SocialPlatformAdapter`: подписчиков умеют
 * отдавать не все площадки. У Instagram это `followers_count` в Graph API, у
 * YouTube — `statistics.subscriberCount` канала, а у TikTok в текущем наборе
 * scope (`user.info.basic`, `video.*`) официального способа нет вовсе.
 * Обязательный метод в общем интерфейсе заставил бы TikTok-адаптер возвращать
 * ноль или кидать заглушку — то есть ровно тот выдуманный ноль, из-за которого
 * дашборд и врал. Здесь площадка либо умеет мерить, либо честно не умеет, и
 * сборщик пишет «не измерено».
 *
 * Скрапер публичного профиля (Apify) сюда не подключается намеренно:
 * `docs/PROJECT_CONTEXT.md` §4 разрешает в основном контуре только белые
 * инструменты, а обход публичной страницы к ним не относится.
 */
import type { DecryptedAccount } from "./types"

/**
 * Замер профиля аккаунта. Подписчики обязательны — ради них всё и затевалось.
 * Остальное площадка может не отдать: `null` означает «не измерено», и в снимок
 * такое поле уходит пустым, а не нулём.
 */
export interface FollowerCount {
  followers: number
  following?: number | null
  postsCount?: number | null
}

export interface FollowerCountProvider {
  /**
   * Текущее число подписчиков аккаунта из официального API площадки.
   * Не отдала площадка величину — бросаем ошибку: ноль здесь неотличим от
   * «аккаунт растерял всех подписчиков» и уехал бы в отчёт как факт.
   */
  getFollowerCount(account: DecryptedAccount): Promise<FollowerCount>
}

/**
 * Умеет ли адаптер мерить подписчиков.
 *
 * Проверка структурная, а не по списку платформ: фабрика адаптеров
 * (`social/factory.ts`) типизирована общим `SocialPlatformAdapter` и метод
 * теряет из виду, а держать рядом второй список «кто что умеет» — верный
 * способ однажды его не обновить.
 */
export function asFollowerCountProvider(adapter: unknown): FollowerCountProvider | null {
  if (!adapter || typeof adapter !== "object") return null
  const candidate = adapter as Partial<FollowerCountProvider>
  return typeof candidate.getFollowerCount === "function"
    ? (adapter as FollowerCountProvider)
    : null
}
