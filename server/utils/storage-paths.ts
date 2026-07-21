/**
 * Единая точка истины путей пользовательского storage.
 *
 * До этого 12 модулей дублировали `join(process.cwd(), "storage", "uploads")`
 * как константу — это ломалось на платформах, где persistent disk монтируется
 * в другую точку ФС (Saturn / Render / Fly / Heroku-like), и не было способа
 * перенаправить storage без правки кода.
 *
 * Теперь — env `UPLOADS_STORAGE_PATH` перебивает дефолт. Если задан абсолютный
 * путь — используется он, иначе склейка с cwd. Все подпапки (videos/, assets/,
 * subtitles/, app-references/, _mock_cache/) считаются от этого корня.
 *
 * Функция, а не const, чтобы тесты могли динамически менять `process.env` без
 * перезапуска процесса. Цена — лишний join() на каждый вызов, что несравнимо
 * дешевле любого I/O рядом.
 */
import { isAbsolute, join } from "node:path"

export function getUploadsBase(): string {
  const override = process.env.UPLOADS_STORAGE_PATH
  if (override && override.trim().length > 0) {
    return isAbsolute(override) ? override : join(process.cwd(), override)
  }
  return join(process.cwd(), "storage", "uploads")
}

export function getVideosBase(): string {
  return join(getUploadsBase(), "videos")
}

export function getAssetsBase(): string {
  return join(getUploadsBase(), "assets")
}

export function getAssetsDirFor(videoId: number): string {
  return join(getAssetsBase(), String(videoId))
}

export function getAppReferencesBase(): string {
  return join(getUploadsBase(), "app-references")
}

export function getMockCacheBase(): string {
  return join(getUploadsBase(), "_mock_cache")
}

export function getSubtitlesBase(): string {
  return join(getUploadsBase(), "subtitles")
}
