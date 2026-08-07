/**
 * Что именно сносится при перезапуске шага генерации видео.
 *
 * Шаги пайплайна переиспользуют готовое: в начале цикла они ищут VideoAsset
 * нужного типа и, если файл на диске жив, делают `continue`. Поэтому сброс
 * одних только статусов превращал rerunVideoStep в пустышку — шаг «отрабатывал»
 * за секунду и возвращал старые файлы. Плюс на шаге оставался falRequestId,
 * и falStepRequest делал reattach к уже завершённому remote job.
 *
 * Постоянное хранилище (bucket) НЕ чистим: ключи детерминированные
 * (videos/{id}/...), новая генерация перезапишет объект по тому же ключу.
 */

import { isAbsolute, relative, resolve } from "node:path"
import type { StepKey } from "./video-pipeline-db"

/** Значения enum AssetType из schema.prisma. */
export type VideoAssetType
  = | "image"
    | "clip"
    | "music"
    | "voiceover"
    | "voiceover_mix"
    | "thumbnail"
    | "preview"

/**
 * Шаг → типы ассетов, которые он производит и обязан пересоздать.
 *
 * lip_sync_generation намеренно пустой: lip-sync не создаёт свой ассет, он
 * ПЕРЕЗАПИСЫВАЕТ файл существующего clip-ассета (см. lip-sync-runner). Снести
 * clip здесь нельзя — clip_generation при сбросе с этого шага не переигрывается,
 * и видео осталось бы вообще без клипов.
 *
 * assembly тоже пустой: финальный mp4 лежит в Video.filePath/storageKey, а не в
 * VideoAsset, и перезаписывается сборкой по тому же пути.
 */
export const STEP_ASSET_TYPES: Record<StepKey, readonly VideoAssetType[]> = {
  prompt_generation: [],
  image_generation: ["image"],
  clip_generation: ["clip"],
  voiceover_generation: ["voiceover", "voiceover_mix"],
  music_generation: ["music"],
  lip_sync_generation: [],
  assembly: [],
}

/** Объединение типов ассетов для набора сбрасываемых шагов (без дублей). */
export function assetTypesForSteps(stepKeys: readonly StepKey[]): VideoAssetType[] {
  const types = new Set<VideoAssetType>()
  for (const key of stepKeys) {
    for (const type of STEP_ASSET_TYPES[key] ?? []) types.add(type)
  }
  return [...types]
}

/**
 * Патч шага при перезапуске.
 *
 * Обнуляем не только статус, но и весь fal-трекинг: с сохранённым
 * falRequestId/falSubKey следующий запуск сделает reattach к старому job'у и
 * вернёт ровно тот результат, из-за которого оператор и нажал «перезапустить».
 * outputSnapshot чистим по той же причине — по нему шаг делает ранний return.
 */
export const STEP_RERUN_RESET_PATCH: Record<string, unknown> = {
  status: "pending",
  errorMessage: null,
  startedAt: null,
  finishedAt: null,
  actualCost: null,
  outputSnapshot: null,
  falRequestId: null,
  falSubKey: null,
  falEndpoint: null,
  falQueueStatus: null,
  falResultUrl: null,
  falSubmittedAt: null,
  falCompletedAt: null,
  falCanceledAt: null,
}

/**
 * Лежит ли путь внутри каталога.
 * Страховка перед rm: filePath приходит из БД, и удалять по нему что-то за
 * пределами каталога ассетов ролика мы не имеем права ни при какой порче данных.
 */
export function isPathInsideDir(dir: string, target: string): boolean {
  const rel = relative(resolve(dir), resolve(target))
  if (rel === "") return false
  return !rel.startsWith("..") && !isAbsolute(rel)
}

export interface AssetFileRemovalDeps {
  /** Удаление файла. Отсутствующий файл — не ошибка. */
  remove: (path: string) => Promise<void>
  log?: (message: string) => void
}

export interface AssetFileRemovalResult {
  removed: number
  skipped: number
  failed: number
}

/**
 * Best-effort удаление локальных файлов ассетов.
 * Ошибка одного файла не отменяет остальные: подвисший хендл на одном клипе не
 * повод оставить перезапуск шага пустышкой.
 */
export async function removeAssetFiles(
  paths: ReadonlyArray<string | null | undefined>,
  assetsDir: string,
  deps: AssetFileRemovalDeps,
): Promise<AssetFileRemovalResult> {
  const result: AssetFileRemovalResult = { removed: 0, skipped: 0, failed: 0 }

  for (const path of paths) {
    if (!path) continue
    if (!isPathInsideDir(assetsDir, path)) {
      result.skipped += 1
      deps.log?.(`пропускаю файл вне каталога ассетов: ${path}`)
      continue
    }
    try {
      await deps.remove(path)
      result.removed += 1
    }
    catch (error) {
      result.failed += 1
      deps.log?.(`не удалось удалить ${path}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return result
}

/** Продакшн-зависимости removeAssetFiles: rm с force (нет файла — нет проблемы). */
export function createAssetFileRemovalDeps(): AssetFileRemovalDeps {
  return {
    remove: async (path: string) => {
      const { rm } = await import("node:fs/promises")
      await rm(path, { force: true })
    },
    log: message => console.warn(`[video-pipeline-reset] ${message}`),
  }
}
