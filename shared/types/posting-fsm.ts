/**
 * Платформо-обобщённый re-export-слой FSM постинга (PR1).
 *
 * Зачем отдельный файл, а не переименование `youtube-posting-fsm.ts`:
 * YouTube-типы используются в 15+ местах под YouTube-именами. Переименование =
 * массовый risk-touch отлаженного кода. Вместо этого вводим ТОНКИЙ слой алиасов:
 * новый Instagram-код (PR2+) импортирует платформо-нейтральные имена ОТСЮДА,
 * а существующий YouTube-код продолжает импортировать из `youtube-posting-fsm.ts`
 * без изменений. Поведение прода — нулевое изменение.
 *
 * Технически: `YouTubePostingStateData` уже на ~90% платформо-агностичен
 * (progress/classWindows/phaseAttempts/lastTransitionAt и т.д.), а IG-специфика
 * выражена опциональными ADD-only полями (platformPostShortcode / platformPostUrl).
 * Поэтому общие типы = алиасы YouTube-типов, а не дубликаты.
 *
 * @see .claude/agent-memory/architect/instagram_posting_plan.md
 */

import type {
  PhaseObserver as YouTubePhaseObserver,
  ResumePlan as YouTubeResumePlan,
  YouTubePostingPhase,
  YouTubePostingProgress,
  YouTubePostingStateData,
} from "./youtube-posting-fsm"

/**
 * Платформо-нейтральное persisted-состояние FSM постинга. Алиас
 * YouTubePostingStateData (содержит опциональные IG-поля platformPostShortcode /
 * platformPostUrl). Новый IG-код пишет в ту же форму — общий retry/recovery-каркас
 * работает без форка.
 */
export type PostingStateData = YouTubePostingStateData

/** Платформо-нейтральный progress (substatus duplicate-upload guard). Алиас YouTubePostingProgress. */
export type PostingProgress = YouTubePostingProgress

/**
 * Платформо-нейтральный фазовый union. Алиас расширенного YouTubePostingPhase,
 * который уже включает ig_* значения (см. youtube-posting-fsm.ts, PR1 аддитивно).
 */
export type PostingPhase = YouTubePostingPhase

/** Платформо-нейтральный план возобновления job. Алиас ResumePlan. */
export type PostingResumePlan = YouTubeResumePlan

/** Платформо-нейтральный наблюдатель фаз. Алиас PhaseObserver (включает опц. captureShortcode для IG). */
export type PostingPhaseObserver = YouTubePhaseObserver
