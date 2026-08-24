import type { EntityStatus } from '~~/shared/utils/entity-status'

/** Приведение статусов видео и его шагов к общему словарю системы. */
export const VIDEO_STATUS_TO_ENTITY: Record<string, EntityStatus> = {
  pending: 'queued',
  configuring: 'draft',
  generating_prompts: 'running',
  generating_images: 'running',
  generating_clips: 'running',
  generating_voiceover: 'running',
  generating_music: 'running',
  assembling: 'running',
  completed: 'done',
  failed: 'failed',
  timeout: 'failed',
  canceled: 'cancelled',
}

export const VIDEO_STEP_TO_ENTITY: Record<string, EntityStatus> = {
  pending: 'queued',
  queued: 'queued',
  running: 'running',
  completed: 'done',
  failed: 'failed',
  timeout: 'failed',
  canceled: 'cancelled',
  skipped: 'cancelled',
}

/** Человеческие названия шагов генерации. */
export const VIDEO_STEP_LABELS: Record<string, string> = {
  prompt_generation: 'Подготовка промтов',
  image_generation: 'Генерация изображений',
  clip_generation: 'Генерация клипов',
  voiceover_generation: 'Синтез речи',
  transcription: 'Транскрипция',
  edit_plan: 'План монтажа',
  shot_background: 'Фоны кадров',
  music_generation: 'Музыка',
  lip_sync_generation: 'Lip-sync',
  assembly: 'Сборка',
}

/**
 * Шаги, которые можно перезапустить прямо из строки.
 *
 * Правило: бесплатное и локальное — в строку, оплачиваемое — через меню с
 * ценой. Сборка не дёргает платные модели, остальное дёргает Replicate.
 */
export const VIDEO_STEP_IS_CHEAP: Record<string, boolean> = {
  prompt_generation: false,
  image_generation: false,
  clip_generation: false,
  voiceover_generation: false,
  transcription: true,
  edit_plan: true,
  shot_background: false,
  music_generation: false,
  lip_sync_generation: false,
  assembly: true,
}

export function videoStatus(raw: string | null | undefined): EntityStatus {
  return VIDEO_STATUS_TO_ENTITY[raw ?? ''] ?? 'draft'
}

export function videoStepStatus(raw: string | null | undefined): EntityStatus {
  return VIDEO_STEP_TO_ENTITY[raw ?? ''] ?? 'queued'
}
