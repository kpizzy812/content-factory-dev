/**
 * Извлечение реальных метаданных видео по URL.
 * Источники: oEmbed API (YouTube), OG-теги HTML-страницы (все платформы).
 * Не выдумывает данные — возвращает только то, что реально извлечено.
 */

export interface VideoMetadata {
  title: string | null
  description: string | null
  authorName: string | null
  thumbnailUrl: string | null
  duration: string | null
  platform: 'youtube' | 'tiktok' | 'instagram' | null
  /** Число просмотров, если доступно */
  viewCount: number | null
  /** Хештеги, если доступны */
  hashtags: string[]
  /** Источник метаданных для прозрачности */
  metadataSource: 'oembed' | 'og_tags' | 'both' | 'none'
}

type VideoPlatform = 'youtube' | 'tiktok' | 'instagram' | null

function detectPlatform(url: string): VideoPlatform {
  const lower = url.toLowerCase()
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'youtube'
  if (lower.includes('tiktok.com') || lower.includes('vm.tiktok.com')) return 'tiktok'
  if (lower.includes('instagram.com')) return 'instagram'
  return null
}

/**
 * YouTube oEmbed — бесплатный, без API-ключа, возвращает title, author, thumbnail.
 */
async function fetchYouTubeOEmbed(url: string): Promise<Partial<VideoMetadata>> {
  try {
    const data = await $fetch<Record<string, unknown>>(
      'https://www.youtube.com/oembed',
      {
        query: { url, format: 'json' },
        timeout: 10_000,
      },
    )

    return {
      title: typeof data.title === 'string' ? data.title : null,
      authorName: typeof data.author_name === 'string' ? data.author_name : null,
      thumbnailUrl: typeof data.thumbnail_url === 'string' ? data.thumbnail_url : null,
    }
  } catch {
    return {}
  }
}

/**
 * TikTok oEmbed — бесплатный, возвращает title, author.
 */
async function fetchTikTokOEmbed(url: string): Promise<Partial<VideoMetadata>> {
  try {
    const data = await $fetch<Record<string, unknown>>(
      'https://www.tiktok.com/oembed',
      {
        query: { url },
        timeout: 10_000,
      },
    )

    return {
      title: typeof data.title === 'string' ? data.title : null,
      authorName: typeof data.author_name === 'string' ? data.author_name : null,
      thumbnailUrl: typeof data.thumbnail_url === 'string' ? data.thumbnail_url : null,
    }
  } catch {
    return {}
  }
}

/**
 * Извлекает Open Graph теги из HTML-страницы.
 * Работает для YouTube, TikTok, Instagram и других платформ.
 */
async function fetchOgTags(url: string): Promise<Partial<VideoMetadata>> {
  try {
    const html = await $fetch<string>(url, {
      timeout: 15_000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MarketingCamp/1.0)',
        'Accept': 'text/html',
        'Accept-Language': 'ru,en;q=0.9',
      },
    })

    if (typeof html !== 'string') return {}

    // Ограничиваем парсинг первыми 50KB (мета-теги всегда в <head>)
    const head = html.slice(0, 50_000)

    const result: Partial<VideoMetadata> = {}

    // og:title
    const titleMatch = head.match(/<meta\s+(?:property|name)=["']og:title["']\s+content=["']([^"']+)["']/i)
      || head.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']og:title["']/i)
    if (titleMatch?.[1]) result.title = decodeHtmlEntities(titleMatch[1])

    // og:description
    const descMatch = head.match(/<meta\s+(?:property|name)=["']og:description["']\s+content=["']([^"']+)["']/i)
      || head.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']og:description["']/i)
    if (descMatch?.[1]) result.description = decodeHtmlEntities(descMatch[1])

    // og:image
    const imgMatch = head.match(/<meta\s+(?:property|name)=["']og:image["']\s+content=["']([^"']+)["']/i)
      || head.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']og:image["']/i)
    if (imgMatch?.[1]) result.thumbnailUrl = imgMatch[1]

    // og:video:duration или video:duration
    const durMatch = head.match(/<meta\s+(?:property|name)=["'](?:og:)?video:duration["']\s+content=["']([^"']+)["']/i)
    if (durMatch?.[1]) result.duration = durMatch[1]

    // Хештеги из description
    if (result.description) {
      const tags = result.description.match(/#[\wа-яА-ЯёЁ]+/g)
      if (tags) result.hashtags = tags.map(t => t.slice(1)).slice(0, 20)
    }

    // <title> как fallback
    if (!result.title) {
      const titleTagMatch = head.match(/<title[^>]*>([^<]+)<\/title>/i)
      if (titleTagMatch?.[1]) result.title = decodeHtmlEntities(titleTagMatch[1].trim())
    }

    return result
  } catch {
    return {}
  }
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
}

/**
 * Основная функция: извлекает реальные метаданные видео по URL.
 * Комбинирует oEmbed + OG-теги для максимальной полноты.
 */
export async function fetchVideoMetadata(url: string): Promise<VideoMetadata> {
  const platform = detectPlatform(url)

  const result: VideoMetadata = {
    title: null,
    description: null,
    authorName: null,
    thumbnailUrl: null,
    duration: null,
    platform,
    viewCount: null,
    hashtags: [],
    metadataSource: 'none',
  }

  // Параллельно запускаем oEmbed и OG-теги
  const [oembed, og] = await Promise.all([
    platform === 'youtube' ? fetchYouTubeOEmbed(url)
      : platform === 'tiktok' ? fetchTikTokOEmbed(url)
        : Promise.resolve({} as Partial<VideoMetadata>),
    fetchOgTags(url),
  ])

  const hasOembed = !!(oembed.title || oembed.authorName)
  const hasOg = !!(og.title || og.description)

  // oEmbed имеет приоритет для title и author, OG — для description
  result.title = oembed.title || og.title || null
  result.description = og.description || null
  result.authorName = oembed.authorName || null
  result.thumbnailUrl = oembed.thumbnailUrl || og.thumbnailUrl || null
  result.duration = og.duration || null
  result.hashtags = og.hashtags || []

  if (hasOembed && hasOg) result.metadataSource = 'both'
  else if (hasOembed) result.metadataSource = 'oembed'
  else if (hasOg) result.metadataSource = 'og_tags'

  return result
}
