/**
 * Парсеры SRT/VTT субтитров → TranscriptSegment[].
 *
 * Время:
 *  - SRT: HH:MM:SS,mmm
 *  - VTT: HH:MM:SS.mmm (или MM:SS.mmm)
 */

import type { TranscriptSegment } from '~~/shared/types/reference'

/** Парсит timestamp вида "HH:MM:SS.mmm" или "MM:SS.mmm" → секунды. */
function parseTimecode(tc: string): number {
  const cleaned = tc.trim().replace(',', '.')
  const parts = cleaned.split(':')
  if (parts.length === 3) {
    const [h, m, s] = parts
    return Number(h) * 3600 + Number(m) * 60 + Number(s)
  }
  if (parts.length === 2) {
    const [m, s] = parts
    return Number(m) * 60 + Number(s)
  }
  const single = Number(cleaned)
  return Number.isFinite(single) ? single : 0
}

function cleanLine(line: string): string {
  return line
    // удалить VTT/SRT inline-теги <c>, <v Speaker>, <00:00:01.000>, &amp;
    .replace(/<[^>]+>/g, '')
    .replace(/\{[^}]+\}/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .trim()
}

/** Парсит SRT-строку в массив сегментов. Ошибки в отдельных блоках игнорируются. */
export function parseSrtToSegments(srt: string): TranscriptSegment[] {
  if (!srt || typeof srt !== 'string') return []
  const segments: TranscriptSegment[] = []
  const blocks = srt.replace(/\r\n/g, '\n').split(/\n\n+/)

  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean)
    if (lines.length < 2) continue
    // Возможно первая строка — индекс блока (число), вторая — timecode line
    const tcLine = lines.find(l => l.includes('-->'))
    if (!tcLine) continue
    const tcIndex = lines.indexOf(tcLine)
    const m = tcLine.match(/(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3})/)
    if (!m) continue
    const start = parseTimecode(m[1]!)
    const end = parseTimecode(m[2]!)
    const duration = Math.max(0, end - start)
    const textLines = lines.slice(tcIndex + 1).map(cleanLine).filter(Boolean)
    const text = textLines.join(' ').trim()
    if (text) segments.push({ start, duration, text })
  }
  return segments
}

/** Парсит WebVTT-строку в массив сегментов. */
export function parseVttToSegments(vtt: string): TranscriptSegment[] {
  if (!vtt || typeof vtt !== 'string') return []
  const segments: TranscriptSegment[] = []
  // Удалить WEBVTT-заголовок и NOTE-блоки
  const body = vtt.replace(/\r\n/g, '\n').replace(/^WEBVTT[^\n]*\n/, '')
  const blocks = body.split(/\n\n+/)

  for (const rawBlock of blocks) {
    const block = rawBlock.trim()
    if (!block || block.startsWith('NOTE') || block.startsWith('STYLE')) continue
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean)
    const tcLine = lines.find(l => l.includes('-->'))
    if (!tcLine) continue
    const tcIndex = lines.indexOf(tcLine)
    const m = tcLine.match(/((?:\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*((?:\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3})/)
    if (!m) continue
    const start = parseTimecode(m[1]!)
    const end = parseTimecode(m[2]!)
    const duration = Math.max(0, end - start)
    const textLines = lines.slice(tcIndex + 1).map(cleanLine).filter(Boolean)
    const text = textLines.join(' ').trim()
    if (text) segments.push({ start, duration, text })
  }

  // Дедупликация: yt-dlp auto-subs часто содержат накапливающие повторы
  const deduped: TranscriptSegment[] = []
  for (const seg of segments) {
    const last = deduped[deduped.length - 1]
    if (last && last.text === seg.text) continue
    deduped.push(seg)
  }
  return deduped
}
