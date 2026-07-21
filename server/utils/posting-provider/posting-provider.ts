/**
 * Провайдер постинга (нейтральный слой).
 *
 * Этап 2 миграции на DuoPlus: заменяет старый `getAntidetectProvider()`,
 * который различал Indigo/Multilogin X — два антидетект-браузера через
 * CDP/WebDriver. DuoPlus — облачный Android (ADB/REST), браузерных провайдеров
 * после миграции не остаётся, поэтому union сжимается до единственного значения.
 */

/** Единственный провайдер постинга после миграции на DuoPlus. */
export type PostingProvider = "duoplus"

/**
 * Резолвер провайдера. После выпиливания Indigo/Multilogin провайдер один,
 * поэтому возвращается константа без чтения env. Сигнатура-функция сохранена
 * (а не голая константа) ради совместимости с местами вызова.
 */
export function getPostingProvider(): PostingProvider {
  return "duoplus"
}
