/**
 * Раскрытие AI-генерации при публикации.
 *
 * С 2 августа 2026 EU AI Act (Regulation 2024/1689) требует раскрывать
 * AI-происхождение контента для аудитории в EU — включая площадки за пределами
 * EU, работающие на эту аудиторию. У платформ для этого есть штатные поля, и
 * они разные:
 *
 *   - TikTok Content Posting API — `post_info.is_aigc`;
 *   - YouTube Data API v3 — `status.containsSyntheticMedia`, доступно с
 *     30 октября 2024 в `videos.insert` и `videos.update`;
 *   - Instagram Graph API такого параметра не имеет: Meta размечает контент по
 *     метаданным файла, а не по полю запроса.
 *
 * Наши ролики синтетические по построению: речь синтезирована, кадры
 * сгенерированы, ведущий бывает AI-аватаром. Поэтому флаг не выводится из
 * настроек ролика, а ставится по факту производства — решение принимает
 * вызывающий, здесь только перевод в формат площадки.
 *
 * Отправлять несуществующее поле нельзя: площадка отвергнет запрос целиком, и
 * публикация упадёт на ровном месте.
 */

export type AiDisclosurePlatform = "tiktok" | "youtube" | "instagram" | string

/** Площадки, где раскрыть AI параметром запроса нельзя. */
export const AI_DISCLOSURE_UNSUPPORTED_PLATFORMS: readonly string[] = Object.freeze([
  "instagram",
])

export function supportsAiDisclosure(platform: AiDisclosurePlatform): boolean {
  return platform === "tiktok" || platform === "youtube"
}

/**
 * Кусок payload площадки с раскрытием. Пустой объект означает «у площадки нет
 * поля» — вызывающий просто разворачивает его в свой запрос и ничего не ломает.
 *
 * Явный `false` там, где поле есть, отправляется намеренно: это утверждение
 * «контент не синтетический», а пропуск поля означал бы «мы не ответили».
 */
export function buildAiDisclosure(
  platform: AiDisclosurePlatform,
  isAiGenerated: boolean,
): Record<string, boolean> {
  if (platform === "tiktok") return { is_aigc: isAiGenerated }
  if (platform === "youtube") return { containsSyntheticMedia: isAiGenerated }
  return {}
}
