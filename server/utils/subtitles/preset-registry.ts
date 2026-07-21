/**
 * Реестр пресетов субтитров — единая точка истины для UI и render-pipeline.
 *
 * Содержит 10 пресетов по плану архитектора:
 * classic (drawtext fast path), tiktok_white, tiktok_neon, karaoke,
 * hormozi, beast, wave, popup, minimal_subtle, boxed.
 *
 * Backward-compat через LEGACY_ALIASES — старые ключи из БД (tiktok_classic и т.п.)
 * резолвятся в новые. Старые видео при пересборке выглядят без сюрпризов.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type {
  SubtitlePresetKey,
  SubtitlePresetMeta,
  AnySubtitlePresetKey,
  LegacySubtitlePresetKey,
} from '~~/shared/types/subtitle-preset'
import { DEFAULT_SUBTITLE_PRESET } from '~~/shared/types/subtitle-preset'

/** Render-параметры для ASS-генератора и drawtext-fallback. */
export interface SubtitlePresetDef {
  /** Базовый размер шрифта для portrait 1080×1920 (px = ASS Style.Fontsize при PlayResY=1920). */
  fontSizePortrait: number
  /** Базовый размер шрифта для landscape 1920×1080. */
  fontSizeLandscape: number
  /** Цвет текста в hex (#RRGGBB). */
  textColor: string
  /** Цвет outline в hex или null для no-outline. */
  outlineColor: string | null
  /** Толщина outline в px (ASS Outline). */
  outlineWidth: number
  /** Цвет акцента (для karaoke active word, hormozi keyword color и т.д.) или null. */
  accentColor: string | null
  /** Цвет фоновой плашки (#RRGGBBAA с alpha) или null если нет плашки. */
  backgroundColor: string | null
  /** Тень: смещение в px (0 = выкл). */
  shadowOffset: number
  /** Тип входной анимации. */
  entrance: 'none' | 'fade_short' | 'fade_long' | 'pop' | 'slide_up'
  /** Тип акцентной анимации (на keyword словах). */
  emphasis: 'none' | 'color' | 'color_scale' | 'karaoke_sweep'
  /** Принудительный uppercase (полезно для Hormozi/Beast). */
  forceUppercase: boolean
  /** Доп. эффект: glow (для neon), wave (для wave). */
  effect: 'none' | 'glow' | 'wave'
  /** Bold flag для ASS Style.Bold. */
  bold: boolean
}

export type FullSubtitlePreset = SubtitlePresetMeta & SubtitlePresetDef

const SAMPLE_DIR = '/subtitle-presets'

const PRESETS: Record<SubtitlePresetKey, FullSubtitlePreset> = {
  classic: {
    key: 'classic',
    label: 'Классика',
    description: 'Белый текст с чёрной обводкой. Быстрый рендер через drawtext, без анимаций.',
    tags: ['classic'],
    renderer: 'drawtext',
    needsKeywordDetection: false,
    fontFamily: 'system',
    sampleVideoUrl: `${SAMPLE_DIR}/classic.mp4`,
    sampleImageUrl: null,
    previewTextColor: '#FFFFFF',
    previewAccentColor: null,
    previewExtraNote: 'Быстро, для всех тем',
    fontSizePortrait: 62,
    fontSizeLandscape: 48,
    textColor: '#FFFFFF',
    outlineColor: '#000000',
    outlineWidth: 7,
    accentColor: null,
    backgroundColor: null,
    shadowOffset: 2,
    entrance: 'none',
    emphasis: 'none',
    forceUppercase: false,
    effect: 'none',
    bold: true,
  },
  tiktok_white: {
    key: 'tiktok_white',
    label: 'TikTok White',
    description: 'Жирный белый Montserrat с короткой fade-анимацией. Универсал для любого видео.',
    tags: ['classic', 'bold'],
    renderer: 'ass',
    needsKeywordDetection: false,
    fontFamily: 'Montserrat',
    sampleVideoUrl: `${SAMPLE_DIR}/tiktok_white.mp4`,
    sampleImageUrl: null,
    previewTextColor: '#FFFFFF',
    previewAccentColor: null,
    previewExtraNote: null,
    fontSizePortrait: 62,
    fontSizeLandscape: 48,
    textColor: '#FFFFFF',
    outlineColor: '#000000',
    outlineWidth: 5,
    accentColor: null,
    backgroundColor: null,
    shadowOffset: 2,
    entrance: 'fade_short',
    emphasis: 'none',
    forceUppercase: false,
    effect: 'none',
    bold: true,
  },
  tiktok_neon: {
    key: 'tiktok_neon',
    label: 'TikTok Neon',
    description: 'Циановое свечение с glow. AI-detector выделяет ключевые слова.',
    tags: ['neon', 'animated'],
    renderer: 'ass',
    needsKeywordDetection: true,
    fontFamily: 'Montserrat',
    sampleVideoUrl: `${SAMPLE_DIR}/tiktok_neon.mp4`,
    sampleImageUrl: null,
    previewTextColor: '#FFFFFF',
    previewAccentColor: '#00FFFF',
    previewExtraNote: 'AI ~$0.001/видео',
    fontSizePortrait: 64,
    fontSizeLandscape: 50,
    textColor: '#FFFFFF',
    outlineColor: '#000000',
    outlineWidth: 4,
    accentColor: '#00FFFF',
    backgroundColor: null,
    shadowOffset: 0,
    entrance: 'fade_short',
    emphasis: 'color',
    forceUppercase: false,
    effect: 'glow',
    bold: true,
  },
  karaoke: {
    key: 'karaoke',
    label: 'Karaoke',
    description: 'Слова подсвечиваются по очереди (sweep). Активное слово белое, остальные серые.',
    tags: ['karaoke', 'animated'],
    renderer: 'ass',
    needsKeywordDetection: false,
    fontFamily: 'Montserrat',
    sampleVideoUrl: `${SAMPLE_DIR}/karaoke.mp4`,
    sampleImageUrl: null,
    previewTextColor: '#AAAAAA',
    previewAccentColor: '#FFFFFF',
    previewExtraNote: null,
    fontSizePortrait: 70,
    fontSizeLandscape: 54,
    textColor: '#AAAAAA',
    outlineColor: '#000000',
    outlineWidth: 5,
    accentColor: '#FFFFFF',
    backgroundColor: null,
    shadowOffset: 0,
    entrance: 'fade_short',
    emphasis: 'karaoke_sweep',
    forceUppercase: false,
    effect: 'none',
    bold: true,
  },
  hormozi: {
    key: 'hormozi',
    label: 'Hormozi',
    description: 'Жирный Anton ВСЕ ЗАГЛАВНЫЕ + жёлтый pop на ключевых словах. Стиль Алекса Хормози.',
    tags: ['bold', 'creator-style', 'animated'],
    renderer: 'ass',
    needsKeywordDetection: true,
    fontFamily: 'Anton',
    sampleVideoUrl: `${SAMPLE_DIR}/hormozi.mp4`,
    sampleImageUrl: null,
    previewTextColor: '#FFFFFF',
    previewAccentColor: '#FFE500',
    previewExtraNote: 'AI ~$0.001/видео',
    fontSizePortrait: 80,
    fontSizeLandscape: 62,
    textColor: '#FFFFFF',
    outlineColor: '#000000',
    outlineWidth: 6,
    accentColor: '#FFE500',
    backgroundColor: null,
    shadowOffset: 3,
    entrance: 'pop',
    emphasis: 'color_scale',
    forceUppercase: true,
    effect: 'none',
    bold: true,
  },
  beast: {
    key: 'beast',
    label: 'Beast',
    description: 'Anton CAPS + красный акцент + slide-up. Для high-energy crypto/business контента.',
    tags: ['bold', 'creator-style', 'animated'],
    renderer: 'ass',
    needsKeywordDetection: true,
    fontFamily: 'Anton',
    sampleVideoUrl: `${SAMPLE_DIR}/beast.mp4`,
    sampleImageUrl: null,
    previewTextColor: '#FFFFFF',
    previewAccentColor: '#FF4500',
    previewExtraNote: 'AI ~$0.001/видео',
    fontSizePortrait: 76,
    fontSizeLandscape: 60,
    textColor: '#FFFFFF',
    outlineColor: '#000000',
    outlineWidth: 6,
    accentColor: '#FF4500',
    backgroundColor: null,
    shadowOffset: 3,
    entrance: 'slide_up',
    emphasis: 'color_scale',
    forceUppercase: true,
    effect: 'none',
    bold: true,
  },
  wave: {
    key: 'wave',
    label: 'Wave',
    description: 'Лёгкое волнообразное вращение строки. Подходит для дрим/lo-fi/моушн контента.',
    tags: ['animated'],
    renderer: 'ass',
    needsKeywordDetection: false,
    fontFamily: 'Montserrat',
    sampleVideoUrl: `${SAMPLE_DIR}/wave.mp4`,
    sampleImageUrl: null,
    previewTextColor: '#FFFFFF',
    previewAccentColor: null,
    previewExtraNote: null,
    fontSizePortrait: 68,
    fontSizeLandscape: 52,
    textColor: '#FFFFFF',
    outlineColor: '#000000',
    outlineWidth: 5,
    accentColor: null,
    backgroundColor: null,
    shadowOffset: 2,
    entrance: 'fade_short',
    emphasis: 'none',
    forceUppercase: false,
    effect: 'wave',
    bold: true,
  },
  popup: {
    key: 'popup',
    label: 'Popup',
    description: 'Слова появляются с pop-эффектом (масштаб 60%→100%). Для динамичной озвучки.',
    tags: ['animated'],
    renderer: 'ass',
    needsKeywordDetection: false,
    fontFamily: 'Montserrat',
    sampleVideoUrl: `${SAMPLE_DIR}/popup.mp4`,
    sampleImageUrl: null,
    previewTextColor: '#FFFFFF',
    previewAccentColor: null,
    previewExtraNote: null,
    fontSizePortrait: 68,
    fontSizeLandscape: 52,
    textColor: '#FFFFFF',
    outlineColor: '#000000',
    outlineWidth: 5,
    accentColor: null,
    backgroundColor: null,
    shadowOffset: 2,
    entrance: 'pop',
    emphasis: 'none',
    forceUppercase: false,
    effect: 'none',
    bold: true,
  },
  minimal_subtle: {
    key: 'minimal_subtle',
    label: 'Minimal',
    description: 'Тонкий Inter, мягкий fade. Для cinematic / premium / lifestyle.',
    tags: ['minimal'],
    renderer: 'ass',
    needsKeywordDetection: false,
    fontFamily: 'Inter',
    sampleVideoUrl: `${SAMPLE_DIR}/minimal_subtle.mp4`,
    sampleImageUrl: null,
    previewTextColor: '#FFFFFF',
    previewAccentColor: null,
    previewExtraNote: null,
    fontSizePortrait: 56,
    fontSizeLandscape: 44,
    textColor: '#FFFFFF',
    outlineColor: '#000000',
    outlineWidth: 2,
    accentColor: null,
    backgroundColor: null,
    shadowOffset: 2,
    entrance: 'fade_long',
    emphasis: 'none',
    forceUppercase: false,
    effect: 'none',
    bold: false,
  },
  boxed: {
    key: 'boxed',
    label: 'Boxed',
    description: 'Inter Bold на тёмной полупрозрачной плашке + жёлтый акцент. Максимум читаемости.',
    tags: ['bold', 'animated'],
    renderer: 'ass',
    needsKeywordDetection: true,
    fontFamily: 'Inter',
    sampleVideoUrl: `${SAMPLE_DIR}/boxed.mp4`,
    sampleImageUrl: null,
    previewTextColor: '#FFFFFF',
    previewAccentColor: '#FFE500',
    previewExtraNote: 'AI ~$0.001/видео',
    fontSizePortrait: 64,
    fontSizeLandscape: 50,
    textColor: '#FFFFFF',
    outlineColor: '#000000',
    outlineWidth: 2,
    accentColor: '#FFE500',
    backgroundColor: '#000000B3',
    shadowOffset: 0,
    entrance: 'pop',
    emphasis: 'color',
    forceUppercase: false,
    effect: 'none',
    bold: true,
  },
}

/**
 * Маппинг старых ключей → новые. Видео в БД с subtitlePreset='tiktok_classic' при пересборке
 * получают пресет 'classic' (drawtext fast path) и выглядят идентично прежнему. Аналогично
 * 'tiktok_bold_yellow' → 'hormozi' (визуально близкий жёлтый бренд), 'tiktok_boxed' → 'boxed',
 * 'minimal' → 'minimal_subtle'.
 */
export const LEGACY_ALIASES: Record<LegacySubtitlePresetKey, SubtitlePresetKey> = {
  tiktok_classic: 'classic',
  tiktok_bold_yellow: 'hormozi',
  tiktok_boxed: 'boxed',
  minimal: 'minimal_subtle',
}

/** Резолв любого ключа (новый или legacy) в полное определение пресета. Fallback — DEFAULT. */
export function getPresetByKey(key: string | null | undefined): FullSubtitlePreset {
  if (!key) return PRESETS[DEFAULT_SUBTITLE_PRESET]
  if (key in PRESETS) return PRESETS[key as SubtitlePresetKey]
  if (key in LEGACY_ALIASES) {
    return PRESETS[LEGACY_ALIASES[key as LegacySubtitlePresetKey]]
  }
  return PRESETS[DEFAULT_SUBTITLE_PRESET]
}

/** Резолвит публичный URL → реальный путь в public/. SAMPLE_DIR начинается с '/'. */
function resolvePublicAssetPath(url: string | null): string | null {
  if (!url) return null
  const rel = url.startsWith('/') ? url.slice(1) : url
  return join(process.cwd(), 'public', rel)
}

/**
 * Список всех пресетов для UI (без legacy aliases — те внутренние).
 *
 * `sampleVideoUrl` null-ится если файл физически не существует в public/. Это спасает
 * UI от пустых серых карточек: при отсутствии файла фронт показывает CSS-имитацию,
 * а не битый <video> элемент с 404 (на котором event 'error' не всегда срабатывает,
 * особенно если dev-сервер отдаёт SPA fallback HTML вместо честного 404).
 */
export function listPresets(): SubtitlePresetMeta[] {
  return (Object.keys(PRESETS) as SubtitlePresetKey[]).map((key) => {
    const p = PRESETS[key]
    const videoFsPath = resolvePublicAssetPath(p.sampleVideoUrl)
    const imageFsPath = resolvePublicAssetPath(p.sampleImageUrl)
    const meta: SubtitlePresetMeta = {
      key: p.key,
      label: p.label,
      description: p.description,
      tags: p.tags,
      renderer: p.renderer,
      needsKeywordDetection: p.needsKeywordDetection,
      fontFamily: p.fontFamily,
      sampleVideoUrl: videoFsPath && existsSync(videoFsPath) ? p.sampleVideoUrl : null,
      sampleImageUrl: imageFsPath && existsSync(imageFsPath) ? p.sampleImageUrl : null,
      previewTextColor: p.previewTextColor,
      previewAccentColor: p.previewAccentColor,
      previewExtraNote: p.previewExtraNote,
    }
    return meta
  })
}

/** Все известные ключи (новые + legacy) — для validation в API endpoint'ах. */
export function listAllKnownKeys(): AnySubtitlePresetKey[] {
  return [
    ...(Object.keys(PRESETS) as SubtitlePresetKey[]),
    ...(Object.keys(LEGACY_ALIASES) as LegacySubtitlePresetKey[]),
  ]
}

/** Проверка, что ключ известен (для API validation). */
export function isKnownPresetKey(key: unknown): key is AnySubtitlePresetKey {
  if (typeof key !== 'string') return false
  return key in PRESETS || key in LEGACY_ALIASES
}
