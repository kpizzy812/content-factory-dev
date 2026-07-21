/**
 * `fetch(url) -> storage.uploadBuffer(key)`. Без промежуточного локального файла,
 * вся ответственность за временные пути остаётся у вызывающего кода (или
 * `withTempFile`). mock:// URLs обрабатываются через существующий
 * `generateMockPlaceholder`, чтобы FAL_MOCK_MODE pipeline'ы работали так же,
 * как раньше через downloadFile().
 *
 * Возвращает StorageObject — sha256/sizeBytes пригодятся для записи в БД.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { generateMockPlaceholder, isMockUrl } from "~~/server/utils/mock/fal-mock"

import { getStorageDriver } from "./index"
import type { StorageObject, UploadOptions } from "./types"

export async function downloadToStorage(
  url: string,
  storageKey: string,
  opts?: UploadOptions,
): Promise<StorageObject> {
  if (isMockUrl(url)) {
    // mock-плейсхолдер сначала кладётся в /tmp (ffmpeg требует output path),
    // потом читается и заливается в storage.
    const tmp = await mkdtemp(path.join(tmpdir(), "mock-dl-"))
    const tmpFile = path.join(tmp, path.basename(storageKey))
    try {
      await generateMockPlaceholder(url, tmpFile)
      const buffer = await readFile(tmpFile)
      return getStorageDriver().uploadBuffer(storageKey, buffer, opts)
    } finally {
      await rm(tmp, { recursive: true, force: true }).catch(() => {})
    }
  }

  const response = await $fetch.raw(url, {
    responseType: "arrayBuffer",
  } as Parameters<typeof $fetch>[1])
  const buffer = Buffer.from(response._data as ArrayBuffer)
  return getStorageDriver().uploadBuffer(storageKey, buffer, opts)
}

/**
 * Legacy-совместимый URL для UI: `/api/files/{encoded-storage-key}`.
 * Использовать когда нужно заполнить filePath/fileUrl в БД, чтобы старый UI
 * (читающий video.filePath напрямую) продолжал работать без правок.
 *
 * Идемпотентен: повторный вызов на уже сформированном URL `/api/files/...`
 * возвращает значение без изменений — это спасает от двойного префикса
 * `/api/files//api/files/...` если helper случайно вызвали дважды.
 */
export function storageKeyToLegacyUrl(storageKey: string): string {
  if (storageKey.startsWith("/api/files/")) return storageKey
  return `/api/files/${encodeURIComponent(storageKey)}`
}
