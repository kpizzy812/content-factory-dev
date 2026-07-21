/**
 * Конфигурация субтитров на уровне пайплайна (контейнера).
 *
 * Хранится в Pipeline.subtitleStyle (Json?). При генерации видео берётся как дефолт
 * для Video.subtitlePreset / Video.subtitlesStyle, но per-video редактирование может
 * перебить значение.
 */

import type { SubtitlePresetKey } from './subtitle-preset'
import type { SubtitleStyleProfile } from './story'

export interface PipelineSubtitleConfig {
  /** Дефолтный пресет для всех видео контейнера. */
  presetKey: SubtitlePresetKey
  /** Override отдельных полей SubtitleStyleProfile (typography/visual/animation). */
  overrides?: Partial<SubtitleStyleProfile>
  /** Принудительно включить AI-keyword-detector даже если preset.needsKeywordDetection=false. */
  enableKeywordEmphasis?: boolean
}
