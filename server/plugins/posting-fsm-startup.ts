/**
 * Nitro-плагин: громкий startup-лог эффективного режима YouTube posting FSM (PR5B).
 *
 * Печатает один раз при старте процесса разрешённый режим (env_enabled /
 * env_default / code_default) + сырые env — чтобы оператор по логам деплоя сразу
 * видел, включён ли FSM по умолчанию и каким источником. Не влияет на runtime.
 *
 * @see server/utils/posting/fsm-config.ts (resolveYoutubeFsmMode)
 */

import { resolveYoutubeFsmMode } from "../utils/posting/fsm-config"

export default defineNitroPlugin(() => {
  // В тестовой среде не шумим (SCHEDULERS_ENABLED=false в .env.test).
  if (process.env.SCHEDULERS_ENABLED === "false") return

  const m = resolveYoutubeFsmMode("youtube")
  console.info(
    `[posting_fsm_default] effective(youtube)=${m.enabled ? "ON" : "OFF"} source=${m.source} `
    + `env.YOUTUBE_POSTING_FSM_ENABLED=${m.envEnabled ?? "(unset)"} `
    + `env.YOUTUBE_POSTING_FSM_DEFAULT=${m.envDefault ?? "(unset)"} `
    + `codeDefault=${m.codeDefault} youtubeOnly=true | rollback: set YOUTUBE_POSTING_FSM_ENABLED=false`,
  )
})
