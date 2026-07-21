/**
 * Извлечение URL опубликованного YouTube Short БЕЗ устройства — серверным
 * HTTP-fetch публичной страницы канала.
 *
 * DuoPlus-постер (ADB) не отдаёт URL из UI-flow: мобильная навигация к Share
 * хрупкая (тапы по Shorts-сетке промахиваются — доказано probe). Надёжнее:
 * страница youtube.com/@<handle>/shorts в SSR содержит для каждого Short
 *   "shortsLockupViewModel":{"entityId":"shorts-shelf-item-<videoId>",
 *    "accessibilityText":"<caption> …"}
 * Находим наш Short по началу caption → videoId из соседнего entityId.
 * Проверено на 4 видео (вкл. кириллицу) — 4/4 совпадение.
 *
 * BEST-EFFORT: при любой неудаче (нет handle, fetch fail, видео ещё не в SSR,
 * caption не совпал) — undefined. Публикация уже подтверждена verifyPublished;
 * URL лишь обогащает результат и НЕ влияет на success джобы.
 */

const YT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

export async function extractYoutubeShortUrl(
  channelHandle: string | null | undefined,
  caption: string,
): Promise<string | undefined> {
  const handle = channelHandle?.trim().replace(/^@/, "")
  const needle = caption.trim().slice(0, 38)
  if (!handle || needle.length < 6) return undefined

  let html: string
  try {
    const res = await fetch(`https://www.youtube.com/@${handle}/shorts`, {
      headers: { "user-agent": YT_UA, "accept-language": "en-US,en;q=0.9", cookie: "CONSENT=YES+1" },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return undefined
    html = await res.text()
  } catch {
    return undefined
  }

  const idx = html.indexOf(needle)
  if (idx < 0) return undefined
  // entityId стоит ПЕРЕД accessibilityText внутри одного shortsLockupViewModel.
  const before = html.slice(Math.max(0, idx - 220), idx)
  const m = before.match(/shorts-shelf-item-([\w-]{11})/)
  return m ? `https://www.youtube.com/shorts/${m[1]}` : undefined
}
