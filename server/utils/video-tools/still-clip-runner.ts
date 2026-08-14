/**
 * Запуск ffmpeg для перебивки из кадра.
 *
 * Отдельно от `still-clip.ts` по той же причине, что и у хешера кадров: сборка
 * аргументов — данные и проверяется без процесса, а здесь только spawn и разбор
 * кода возврата.
 */

import { spawn } from "node:child_process"
import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"

import { buildStillClipArgs, type StillClipRequest } from "./still-clip"

const FFMPEG_BIN = process.env.FFMPEG_PATH || process.env.FFMPEG_BIN || "ffmpeg"
/** Кадр в клип кодируется секунды; минута — это уже зависший процесс. */
const STILL_CLIP_TIMEOUT_MS = 120_000

export async function renderStillClip(request: StillClipRequest): Promise<void> {
  await mkdir(dirname(request.outputPath), { recursive: true })
  const args = buildStillClipArgs(request)

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, args, { stdio: ["ignore", "ignore", "pipe"] })
    let stderr = ""

    const timer = setTimeout(() => {
      try { proc.kill("SIGKILL") }
      catch { /* процесс уже мёртв */ }
      reject(new Error(`ffmpeg: таймаут ${Math.round(STILL_CLIP_TIMEOUT_MS / 1000)}s на перебивке`))
    }, STILL_CLIP_TIMEOUT_MS)

    proc.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8") })
    proc.on("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    proc.on("close", (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(`ffmpeg завершился с кодом ${code}: ${stderr.slice(-400)}`))
        return
      }
      resolve()
    })
  })
}
