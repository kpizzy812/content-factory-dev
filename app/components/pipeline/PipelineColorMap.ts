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
}

const PIPELINE_COLORS: Record<string, PipelineColorClasses> = {
  '': { bg: 'bg-neutral-bg border border-neutral-border', text: 'text-muted' },
  primary: { bg: 'bg-accent-bg border border-accent-border', text: 'text-accent' },
  secondary: { bg: 'bg-neutral-bg border border-neutral-border', text: 'text-fg' },
  accent: { bg: 'bg-accent-bg border border-accent-border', text: 'text-accent' },
  info: { bg: 'bg-info-bg border border-info-border', text: 'text-info' },
  success: { bg: 'bg-success-bg border border-success-border', text: 'text-success' },
  warning: { bg: 'bg-warning-bg border border-warning-border', text: 'text-warning' },
  error: { bg: 'bg-danger-bg border border-danger-border', text: 'text-danger' },
}

export function pipelineColor(color: string | null | undefined): PipelineColorClasses {
  return PIPELINE_COLORS[color ?? ''] ?? PIPELINE_COLORS['']!
}
