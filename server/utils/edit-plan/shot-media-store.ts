/**
 * Локальные файлы фонов кадра.
 *
 * `BackgroundClip` хранится ТОЛЬКО по `storageKey` — колонок `fileUrl`/`filePath`
 * у него нет, и в механизм доставки референсов
 * (`media-provider/reference-frame.ts`) он не влезает: `ResolvedReferenceFrame`
 * требует непустой `fileUrl`. Поэтому здесь свой минимальный materialize.
 *
 * `AppReferenceImage` устроен наоборот: `fileUrl` обязателен, а `storageKey`
 * необязателен — записи, залитые до перехода на объектное хранилище, живут
 * только локальным файлом. Обе ветки обязаны работать.
 *
 * Модуль ЛИСТОВОЙ: ни ffmpeg, ни Prisma, ни storage-драйвера — всё приходит
 * через `ShotMediaDeps`. Так он проверяется без сети и без БД, и так его
 * безопасно импортировать откуда угодно.
 */

import { join } from "node:path"

import { getAppReferencesBase } from "../storage-paths"

export interface ShotMediaDeps {
  downloadToFile: (storageKey: string, localPath: string) => Promise<void>
  fileExists: (localPath: string) => Promise<boolean>
  ensureDir: (dirPath: string) => Promise<void>
}

export interface BackgroundClipRef {
  id: string
  storageKey: string
  sha1: string
  mimeType: string | null
  kind: string
}

export interface AppReferenceRef {
  id: string
  appId: number
  sha1: string
  mimeType: string | null
  storageKey: string | null
}

/** Расширение по mime, а не по ключу хранилища: ключ мог быть записан без него. */
const EXT_BY_MIME: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
}

function extFor(mimeType: string | null, fallback: string): string {
  if (!mimeType) return fallback
  return EXT_BY_MIME[mimeType.toLowerCase()] ?? fallback
}

/**
 * Имя детерминировано и включает `sha1`: пересборка ролика обязана взять ТОТ ЖЕ
 * файл, иначе кэш нормализации и отпечаток уникальности разъедутся между
 * прогонами.
 */
export function backgroundClipLocalPath(assetsDir: string, clip: BackgroundClipRef): string {
  const ext = extFor(clip.mimeType, clip.kind === "image" ? "png" : "mp4")
  return join(assetsDir, `bg_${clip.sha1}.${ext}`)
}

export function appReferenceLocalPath(assetsDir: string, ref: AppReferenceRef): string {
  return join(assetsDir, `screen_${ref.sha1}.${extFor(ref.mimeType, "png")}`)
}

export async function materializeBackgroundClip(
  clip: BackgroundClipRef, assetsDir: string, deps: ShotMediaDeps,
): Promise<string> {
  const localPath = backgroundClipLocalPath(assetsDir, clip)
  if (await deps.fileExists(localPath)) return localPath
  await deps.ensureDir(assetsDir)
  await deps.downloadToFile(clip.storageKey, localPath)
  return localPath
}

export async function materializeAppReference(
  ref: AppReferenceRef, assetsDir: string, deps: ShotMediaDeps,
): Promise<string> {
  // Legacy-запись без ключа хранилища: файл лежит локально там, куда его
  // положила заливка референсов. Качать нечего и неоткуда.
  if (!ref.storageKey) {
    return join(getAppReferencesBase(), String(ref.appId), `${ref.sha1}.${extFor(ref.mimeType, "png")}`)
  }
  const localPath = appReferenceLocalPath(assetsDir, ref)
  if (await deps.fileExists(localPath)) return localPath
  await deps.ensureDir(assetsDir)
  await deps.downloadToFile(ref.storageKey, localPath)
  return localPath
}
