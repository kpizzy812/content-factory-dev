/**
 * Runtime-конфиг phase-FSM (PR5B + PR1 platform-aware обобщение).
 *
 * Единственный резолвер «включён ли FSM для этого job'а» с явным precedence и
 * безопасным rollback. ЧИСТЫЙ (читает только process.env) — тестируется матрицей.
 *
 * PR1: FSM перестал быть YouTube-only. Множество FSM-able платформ = {youtube,
 * instagram}. Каждая платформа имеет СВОЙ набор env-флагов и СВОЙ code-default,
 * но логика precedence идентична. YouTube-резолв БАЙТ-В-БАЙТ как прежде
 * (YOUTUBE_FSM_CODE_DEFAULT=true). Instagram стартует OFF
 * (INSTAGRAM_FSM_CODE_DEFAULT=false) — включается после E2E-валидации без деплоя.
 *
 * Precedence (сверху вниз), per-platform:
 *   1. платформа НЕ в FSM-able множестве → OFF (источник non_fsm_platform;
 *      TikTok и прочие идут legacy всегда, без дрейфа).
 *   2. <PLATFORM>_POSTING_FSM_ENABLED → явный override оператора:
 *        "true"  → ON  (источник env_enabled)
 *        "false" → OFF (источник env_enabled) — EMERGENCY ROLLBACK без передеплоя.
 *   3. <PLATFORM>_POSTING_FSM_DEFAULT → дефолт деплоя, когда ENABLED не задан
 *        (источник env_default).
 *   4. иначе → <PLATFORM>_FSM_CODE_DEFAULT (источник code_default).
 *
 * Откат: выставить <PLATFORM>_POSTING_FSM_ENABLED=false (мгновенно, без деплоя)
 * ИЛИ сменить code-default-константу. Legacy-путь и worker fallback НЕ удалены.
 *
 * @see docs/architecture/youtube-posting-fsm.md (PR5B)
 * @see .claude/agent-memory/architect/instagram_posting_plan.md (PR1)
 */

/**
 * Код-дефолт эффективного режима FSM для YouTube, когда НЕ задано ни
 * YOUTUBE_POSTING_FSM_ENABLED, ни YOUTUBE_POSTING_FSM_DEFAULT.
 * PR5B: true (flip ON для YouTube). Сменить на false = вернуть прежний OFF-дефолт.
 */
export const YOUTUBE_FSM_CODE_DEFAULT = true

/**
 * Код-дефолт эффективного режима FSM для Instagram, когда НЕ задано ни
 * INSTAGRAM_POSTING_FSM_ENABLED, ни INSTAGRAM_POSTING_FSM_DEFAULT.
 * PR1: false (IG стартует OFF) — флип на true после зелёного E2E на Saturn.
 */
export const INSTAGRAM_FSM_CODE_DEFAULT = false

/**
 * Платформо-зависимые имена env-флагов и code-default. Источник истины для
 * resolvePostingFsmMode. Платформа отсутствует в этой карте → FSM не применяется.
 */
interface PlatformFsmConfig {
  enabledEnv: string
  defaultEnv: string
  codeDefault: boolean
}

const FSM_PLATFORM_CONFIG: Record<string, PlatformFsmConfig> = {
  youtube: {
    enabledEnv: "YOUTUBE_POSTING_FSM_ENABLED",
    defaultEnv: "YOUTUBE_POSTING_FSM_DEFAULT",
    codeDefault: YOUTUBE_FSM_CODE_DEFAULT,
  },
  instagram: {
    enabledEnv: "INSTAGRAM_POSTING_FSM_ENABLED",
    defaultEnv: "INSTAGRAM_POSTING_FSM_DEFAULT",
    codeDefault: INSTAGRAM_FSM_CODE_DEFAULT,
  },
}

/** Платформа, для которой по умолчанию резолвим при отсутствии явной (legacy/startup-лог). */
const DEFAULT_FSM_PLATFORM = "youtube"

export type FsmModeSource =
  | "non_fsm_platform"
  | "env_enabled"
  | "env_default"
  | "code_default"

export interface FsmModeResolution {
  /** Эффективно ли включён FSM для запрошенного контекста. */
  enabled: boolean
  /** Платформа, для которой считали (или null — глобальный дефолтный резолв). */
  platform: string | null
  /** Источник эффективного значения (для диагностики/лога). */
  source: FsmModeSource
  /** Сырое значение <PLATFORM>_POSTING_FSM_ENABLED (как в env), либо null. */
  envEnabled: string | null
  /** Сырое значение <PLATFORM>_POSTING_FSM_DEFAULT (как в env), либо null. */
  envDefault: string | null
  /** Код-дефолт платформы (<PLATFORM>_FSM_CODE_DEFAULT). */
  codeDefault: boolean
  /**
   * Применяется ли FSM к этой платформе вообще (есть в FSM-able множестве).
   * Заменяет прежний всегда-true youtubeOnly: теперь FSM-able {youtube, instagram}.
   */
  fsmAble: boolean
}

function parseBoolEnv(raw: string | undefined): boolean | null {
  if (raw === "true") return true
  if (raw === "false") return false
  return null
}

/**
 * Платформо-обобщённый резолв режима FSM (PR1). platform опционален: без неё
 * резолвим дефолтную (youtube) — для startup-лога / endpoint / legacy-вызовов.
 * Платформа вне FSM-able множества → всегда OFF (zero-drift legacy).
 */
export function resolvePostingFsmMode(platform?: string | null): FsmModeResolution {
  const resolvedPlatform = platform ?? DEFAULT_FSM_PLATFORM
  const cfg = FSM_PLATFORM_CONFIG[resolvedPlatform]

  // 1. Платформа не управляется FSM (TikTok и прочие) → OFF.
  if (!cfg) {
    return {
      enabled: false,
      platform: platform ?? null,
      source: "non_fsm_platform",
      envEnabled: null,
      envDefault: null,
      codeDefault: false,
      fsmAble: false,
    }
  }

  const envEnabled = process.env[cfg.enabledEnv] ?? null
  const envDefault = process.env[cfg.defaultEnv] ?? null
  const base = {
    platform: platform ?? null,
    envEnabled,
    envDefault,
    codeDefault: cfg.codeDefault,
    fsmAble: true as const,
  }

  // 2. Явный override оператора (вкл/выкл, в т.ч. emergency rollback).
  const explicit = parseBoolEnv(envEnabled ?? undefined)
  if (explicit !== null) {
    return { ...base, enabled: explicit, source: "env_enabled" }
  }

  // 3. Дефолт деплоя.
  const deployDefault = parseBoolEnv(envDefault ?? undefined)
  if (deployDefault !== null) {
    return { ...base, enabled: deployDefault, source: "env_default" }
  }

  // 4. Код-дефолт платформы.
  return { ...base, enabled: cfg.codeDefault, source: "code_default" }
}

/**
 * @deprecated PR1: используйте resolvePostingFsmMode(platform). Оставлено как
 * тонкая обёртка на 1 PR для безопасности импортов (startup-лог, fsm-mode endpoint).
 * Для platform="youtube" возвращает БАЙТ-В-БАЙТ тот же результат, что и раньше.
 */
export function resolveYoutubeFsmMode(platform?: string | null): FsmModeResolution {
  return resolvePostingFsmMode(platform)
}
