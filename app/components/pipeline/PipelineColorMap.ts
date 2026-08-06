/**
 * Цвет конвейера в токенах системы.
 *
 * `shared/utils/pipeline-meta` хранит имена классов DaisyUI (`bg-primary/20`,
 * `text-error`), которых после перестройки слоя не существует — цвет просто не
 * рисовался. Сам файл вне границ переноса, поэтому сопоставление живёт здесь,
 * рядом с компонентами конвейера.
 */
export interface PipelineColorClasses {
  /** Подложка иконки. */
  bg: string
  /** Цвет самой иконки. */
  text: string
  /** Заливка образца в выборе цвета. */
  swatch: string
  label: string
}

const PIPELINE_COLORS: Record<string, PipelineColorClasses> = {
  '': { bg: 'bg-neutral-bg border border-neutral-border', text: 'text-muted', swatch: 'bg-neutral', label: 'По умолчанию' },
  primary: { bg: 'bg-accent-bg border border-accent-border', text: 'text-accent', swatch: 'bg-accent', label: 'Основной' },
  secondary: { bg: 'bg-neutral-bg border border-neutral-border', text: 'text-fg', swatch: 'bg-neutral', label: 'Вторичный' },
  accent: { bg: 'bg-accent-bg border border-accent-border', text: 'text-accent', swatch: 'bg-accent', label: 'Акцент' },
  info: { bg: 'bg-info-bg border border-info-border', text: 'text-info', swatch: 'bg-info', label: 'Инфо' },
  success: { bg: 'bg-success-bg border border-success-border', text: 'text-success', swatch: 'bg-success', label: 'Успех' },
  warning: { bg: 'bg-warning-bg border border-warning-border', text: 'text-warning', swatch: 'bg-warning', label: 'Внимание' },
  error: { bg: 'bg-danger-bg border border-danger-border', text: 'text-danger', swatch: 'bg-danger', label: 'Ошибка' },
}

export function pipelineColor(color: string | null | undefined): PipelineColorClasses {
  return PIPELINE_COLORS[color ?? ''] ?? PIPELINE_COLORS['']!
}

/** Значения для выбора цвета: те же ключи, что принимает API. */
export const PIPELINE_COLOR_OPTIONS = Object.entries(PIPELINE_COLORS)
  .filter(([key]) => key !== 'secondary' && key !== 'accent')
  .map(([value, meta]) => ({ value, ...meta }))
