/**
 * Общие константы для metadata конвейеров: цвета, иконки, утилиты.
 * Используются в PipelineCreateModal, PipelinePreviewModal, PipelineCard и др.
 */

export const pipelineColors = [
  { value: '', label: 'По умолчанию', css: 'bg-base-300', bg20: 'bg-primary/20', text: 'text-primary', textContent: 'text-base-content' },
  { value: 'primary', label: 'Основной', css: 'bg-primary', bg20: 'bg-primary/20', text: 'text-primary', textContent: 'text-primary-content' },
  { value: 'secondary', label: 'Вторичный', css: 'bg-secondary', bg20: 'bg-secondary/20', text: 'text-secondary', textContent: 'text-secondary-content' },
  { value: 'accent', label: 'Акцент', css: 'bg-accent', bg20: 'bg-accent/20', text: 'text-accent', textContent: 'text-accent-content' },
  { value: 'info', label: 'Инфо', css: 'bg-info', bg20: 'bg-info/20', text: 'text-info', textContent: 'text-info-content' },
  { value: 'success', label: 'Успех', css: 'bg-success', bg20: 'bg-success/20', text: 'text-success', textContent: 'text-success-content' },
  { value: 'warning', label: 'Внимание', css: 'bg-warning', bg20: 'bg-warning/20', text: 'text-warning', textContent: 'text-warning-content' },
  { value: 'error', label: 'Ошибка', css: 'bg-error', bg20: 'bg-error/20', text: 'text-error', textContent: 'text-error-content' },
] as const

/** Получить статические CSS-классы для цвета конвейера (без динамической интерполяции). */
export function getPipelineColorClasses(color: string | null | undefined) {
  const found = pipelineColors.find(c => c.value === (color || ''))
  return found ?? pipelineColors[0]
}

export const pipelineIcons = [
  { value: '', label: 'По умолчанию', icon: 'mingcute:git-merge-line' },
  { value: 'mingcute:git-merge-line', label: 'Конвейер', icon: 'mingcute:git-merge-line' },
  { value: 'mingcute:rocket-line', label: 'Ракета', icon: 'mingcute:rocket-line' },
  { value: 'mingcute:video-line', label: 'Видео', icon: 'mingcute:video-line' },
  { value: 'mingcute:chart-bar-line', label: 'Аналитика', icon: 'mingcute:chart-bar-line' },
  { value: 'mingcute:globe-line', label: 'Интеграция', icon: 'mingcute:globe-line' },
  { value: 'mingcute:bulb-line', label: 'Идея', icon: 'mingcute:bulb-line' },
  { value: 'mingcute:shield-line', label: 'Защита', icon: 'mingcute:shield-line' },
  { value: 'mingcute:share-forward-line', label: 'Дистрибуция', icon: 'mingcute:share-forward-line' },
  { value: 'mingcute:refresh-2-line', label: 'Автоматизация', icon: 'mingcute:refresh-2-line' },
  { value: 'mingcute:code-line', label: 'Код', icon: 'mingcute:code-line' },
  { value: 'mingcute:eye-line', label: 'Мониторинг', icon: 'mingcute:eye-line' },
  { value: 'mingcute:layout-11-line', label: 'Шаблон', icon: 'mingcute:layout-11-line' },
  { value: 'mingcute:git-branch-line', label: 'Ветвление', icon: 'mingcute:git-branch-line' },
  { value: 'mingcute:route-line', label: 'Маршрут', icon: 'mingcute:route-line' },
] as const
