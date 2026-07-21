import { marked } from 'marked'
import DOMPurify from 'isomorphic-dompurify'

/**
 * Безопасный рендеринг Markdown → sanitized HTML.
 * Использует marked для парсинга и DOMPurify для защиты от XSS.
 */

// Настройка marked — без опасных опций
marked.setOptions({
  gfm: true,
  breaks: true,
})

// Белый список тегов и атрибутов для DOMPurify
const PURIFY_CONFIG: DOMPurify.Config = {
  ALLOWED_TAGS: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'br', 'hr',
    'ul', 'ol', 'li',
    'strong', 'em', 'b', 'i', 'u', 's', 'del', 'ins',
    'code', 'pre', 'blockquote',
    'a',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'img',
    'span', 'div',
    'details', 'summary',
  ],
  ALLOWED_ATTR: [
    'href', 'title', 'alt', 'src',
    'class',
    'target', 'rel',
  ],
  ALLOW_DATA_ATTR: false,
  ADD_ATTR: ['target'],
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'select'],
  FORBID_ATTR: ['onerror', 'onclick', 'onload', 'onmouseover', 'onfocus', 'onblur'],
}

// Хук: все ссылки открываются в новом окне с noopener
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

export function renderMarkdownSafe(markdown: string): string {
  if (!markdown || typeof markdown !== 'string') return ''
  const rawHtml = marked.parse(markdown, { async: false }) as string
  return DOMPurify.sanitize(rawHtml, PURIFY_CONFIG)
}

export function useMarkdownSafe(source: Ref<string | null | undefined> | ComputedRef<string | null | undefined>) {
  return computed(() => {
    const md = unref(source)
    if (!md) return ''
    return renderMarkdownSafe(md)
  })
}
