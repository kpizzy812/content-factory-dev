import { resolveYoutubeFsmMode } from "~~/server/utils/posting/fsm-config"

/**
 * GET /api/posting-jobs/fsm-mode
 * Текущий эффективный режим YouTube posting FSM (PR5B) — чтобы оператор видел,
 * включён ли FSM по умолчанию и каким источником, + как откатить. Без секретов.
 * Статический сегмент перебивает динамический [id].
 */
export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canRead"],
    moduleSlug: "social-upload",
  })

  const youtube = resolveYoutubeFsmMode("youtube")
  return {
    fsm: {
      platformScope: "youtube",
      youtubeOnly: true,
      enabled: youtube.enabled,
      source: youtube.source,
      env: {
        YOUTUBE_POSTING_FSM_ENABLED: youtube.envEnabled,
        YOUTUBE_POSTING_FSM_DEFAULT: youtube.envDefault,
      },
      codeDefault: youtube.codeDefault,
      rollbackHint: "Выставьте YOUTUBE_POSTING_FSM_ENABLED=false для мгновенного отката к legacy без передеплоя.",
    },
  }
})
