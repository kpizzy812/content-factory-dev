/**
 * Структура диагностической ошибки в UI аккаунтов.
 * Используется AccountDiagnosticPanel для отображения human/JSON формы.
 */
export interface AccountDiagnosticError {
  /** Человекочитаемое сообщение */
  message: string
  /** HTTP-код, если ошибка с бэкенда */
  statusCode?: number
  /** Этап на котором случилась ошибка (e.g. 'create' | 'credentials' | 'proxy_bind' | 'indigo_link') */
  phase?: string
  /** URL endpoint'а если ошибка относится к network-вызову */
  url?: string
  /** Техническая причина (e.g. validation key) */
  cause?: string
  /** Подсказка оператору, что делать */
  suggestion?: string
  /** Полный raw error для JSON-режима */
  raw?: unknown
  /** Время возникновения */
  timestamp: string
  /** Part D: storageKey скриншота при browser automation ошибке. */
  screenshotKey?: string
  /** Part D: фаза postingPhase из PostingPhaseError (e.g. "login_check" | "file_upload"). */
  postingPhase?: string
}

/**
 * Утилита: построить AccountDiagnosticError из перехваченного исключения.
 * Автоматически распаковывает `code`, `suggestion` и `message` из `error.data`
 * (gating endpoints возвращают их именно так — см. accounts/index.post.ts,
 * posting-jobs/index.post.ts, indigo/profiles/[id]/start.post.ts).
 */
export function toDiagnosticError(
  err: unknown,
  context: {
    phase?: string
    url?: string
    suggestion?: string
  } = {},
): AccountDiagnosticError {
  const e = err as {
    name?: string
    message?: string
    statusCode?: number
    statusMessage?: string
    phase?: string
    screenshotKey?: string
    data?: {
      message?: string
      cause?: string
      code?: string
      suggestion?: string
      phase?: string
      screenshotKey?: string
      postingPhase?: string
    }
  } | undefined

  // PostingPhaseError имеет публичное свойство `phase` (см. server/automation/posters/types.ts).
  // Также phase/screenshotKey могут приехать в e.data из createError() на сервере.
  const isPostingPhaseError = e?.name === "PostingPhaseError" && typeof e?.phase === "string"
  const postingPhase =
    (isPostingPhaseError ? e?.phase : undefined)
    ?? e?.data?.postingPhase
    ?? e?.data?.phase

  const screenshotKey = e?.screenshotKey ?? e?.data?.screenshotKey

  return {
    message:
      e?.data?.message
      ?? e?.statusMessage
      ?? e?.message
      ?? (err instanceof Error ? err.message : "Неизвестная ошибка"),
    statusCode: e?.statusCode,
    phase: context.phase,
    url: context.url,
    cause: e?.data?.cause ?? e?.data?.code ?? e?.statusMessage,
    suggestion: context.suggestion ?? e?.data?.suggestion,
    raw: err,
    timestamp: new Date().toISOString(),
    ...(screenshotKey ? { screenshotKey } : {}),
    ...(postingPhase ? { postingPhase } : {}),
  }
}
