/**
 * Извлечение транскриптов/субтитров из видео по URL.
 * YouTube: парсинг captionTracks из playerResponse → fetch timedtext XML.
 * TikTok/Instagram: fallback на описание из OG-тегов.
 * Прямые видео URL: без транскрипта.
 */

import type { TranscriptData, TranscriptSegment } from '~~/shared/types/reference'

/**
 * Попытка извлечь транскрипт из YouTube по URL.
 * Парсит watch page HTML для получения captionTracks из ytInitialPlayerResponse.
 */
async function extractYouTubeTranscript(url: string): Promise<TranscriptData | null> {
  try {
    const html = await $fetch<string>(url, {
      timeout: 15_000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'ru,en;q=0.9',
      },
    })

    if (typeof html !== 'string') return null

    // Ищем captionTracks в ytInitialPlayerResponse
    const playerResponseMatch = html.match(
      /ytInitialPlayerResponse\s*=\s*(\{.+?\});/s,
    )

    let captionsUrl: string | null = null
    let captionLang: string | null = null

    if (playerResponseMatch?.[1]) {
      try {
        const playerData = JSON.parse(playerResponseMatch[1])
        const captions = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks
        if (Array.isArray(captions) && captions.length > 0) {
          // Приоритет: русский → английский → первый доступный
          const ruTrack = captions.find((t: { languageCode: string }) => t.languageCode === 'ru')
          const enTrack = captions.find((t: { languageCode: string }) => t.languageCode === 'en')
          const track = ruTrack || enTrack || captions[0]

          captionsUrl = track.baseUrl
          captionLang = track.languageCode || null
        }
      }
      catch {
        // JSON parse failed, try alternative extraction
      }
    }

    // Альтернативный поиск через паттерн "captions"
    if (!captionsUrl) {
      const captionMatch = html.match(/"captionTracks":\s*(\[.+?\])/)
      if (captionMatch?.[1]) {
        try {
          const tracks = JSON.parse(captionMatch[1])
          if (Array.isArray(tracks) && tracks.length > 0) {
            const ruTrack = tracks.find((t: { languageCode: string }) => t.languageCode === 'ru')
            const enTrack = tracks.find((t: { languageCode: string }) => t.languageCode === 'en')
            const track = ruTrack || enTrack || tracks[0]
            captionsUrl = track.baseUrl
            captionLang = track.languageCode || null
          }
        }
        catch {
          // ignore
        }
      }
    }

    if (!captionsUrl) return null

    // Fetch caption XML
    const separator = captionsUrl.includes('?') ? '&' : '?'
    const captionXml = await $fetch<string>(`${captionsUrl}${separator}fmt=srv3`, {
      timeout: 10_000,
    })

    if (typeof captionXml !== 'string') return null

    // Parse XML segments
    const segments: TranscriptSegment[] = []
    const segmentRegex = /<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([^<]*)<\/p>/g
    let match

    while ((match = segmentRegex.exec(captionXml)) !== null) {
      const start = parseInt(match[1]!, 10) / 1000
      const duration = parseInt(match[2]!, 10) / 1000
      const text = decodeXmlEntities(match[3]!.trim())
      if (text) {
        segments.push({ start, duration, text })
      }
    }

    // Fallback: SRT-подобный формат
    if (segments.length === 0) {
      const textRegex = /<text\s+start="([\d.]+)"\s+dur="([\d.]+)"[^>]*>([^<]*)<\/text>/g
      while ((match = textRegex.exec(captionXml)) !== null) {
        const start = parseFloat(match[1]!)
        const duration = parseFloat(match[2]!)
        const text = decodeXmlEntities(match[3]!.trim())
        if (text) {
          segments.push({ start, duration, text })
        }
      }
    }

    if (segments.length === 0) return null

    const fullText = segments.map(s => s.text).join(' ')

    return {
      fullText,
      segments,
      source: 'youtube_captions',
      language: captionLang,
    }
  }
  catch {
    return null
  }
}

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/\\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Попытка извлечь текст из описания страницы TikTok/Instagram.
 * Без доступа к API, транскрипт недоступен — возвращаем описание как fallback.
 */
async function extractPageDescription(url: string): Promise<TranscriptData | null> {
  try {
    const html = await $fetch<string>(url, {
      timeout: 15_000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MarketingCamp/1.0)',
        'Accept': 'text/html',
        'Accept-Language': 'ru,en;q=0.9',
      },
    })

    if (typeof html !== 'string') return null

    const head = html.slice(0, 50_000)

    // OG description
    const descMatch = head.match(/<meta\s+(?:property|name)=["']og:description["']\s+content=["']([^"']+)["']/i)
      || head.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']og:description["']/i)

    if (!descMatch?.[1]) return null

    const text = descMatch[1]
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .trim()

    if (text.length < 10) return null

    return {
      fullText: text,
      segments: [],
      source: 'page_extraction',
      language: null,
    }
  }
  catch {
    return null
  }
}

// --- Public API ---

/**
 * Определяет тип медиа по URL.
 */
export function detectMediaType(url: string): 'video' | 'image' | 'unknown' {
  const lower = url.toLowerCase()

  // Видео-платформы
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'video'
  if (lower.includes('tiktok.com') || lower.includes('vm.tiktok.com')) return 'video'
  if (lower.includes('instagram.com/reel') || lower.includes('instagram.com/p/')) return 'video'

  // Изображения по расширению
  const imageExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.svg']
  if (imageExts.some(ext => lower.endsWith(ext) || lower.includes(`${ext}?`))) return 'image'

  // Видео по расширению
  const videoExts = ['.mp4', '.mov', '.avi', '.webm', '.mkv']
  if (videoExts.some(ext => lower.endsWith(ext) || lower.includes(`${ext}?`))) return 'video'

  return 'unknown'
}

/**
 * Извлекает транскрипт/субтитры из видео по URL.
 * Стратегия зависит от платформы.
 *
 * @deprecated Используй `transcribeVideo` из `server/utils/video-content-analyzer.ts` —
 * она комбинирует timedText API (этот модуль), yt-dlp captions и fal whisper.
 * Эта функция остаётся как первый бесплатный шаг внутри `transcribeVideo` для YouTube.
 */
export async function extractTranscript(
  url: string,
  platform: string | null,
): Promise<TranscriptData | null> {
  if (platform === 'youtube' || url.includes('youtube.com') || url.includes('youtu.be')) {
    const yt = await extractYouTubeTranscript(url)
    if (yt) return yt
  }

  // Для TikTok/Instagram и fallback — пробуем описание страницы
  const pageDesc = await extractPageDescription(url)
  return pageDesc
}
