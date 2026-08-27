/**
 * Обращения библиотеки фонов к серверу (`/api/apps/:id/background-clips`).
 *
 * `fetcher` параметром — как в `edit-profile-client.ts`: проверка файла обязана
 * доказуемо срабатывать ДО сети. Фон весит до полутора сотен мегабайт, и
 * отправлять его ради 415-го ответа — это минуты ожидания оператора впустую.
 */
import type { BackgroundClip } from '~~/shared/types/edit-console'
import type { AdminFetcher } from './edit-profile-client'
import type { BackgroundUploadResult } from './background-library-model'
import { validateBackgroundFile } from './background-library-model'

/** Файл не прошёл проверку — запрос не формировался. */
export class BackgroundFileRejectedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackgroundFileRejectedError'
  }
}

/**
 * Загружает ОДИН фон. Ручка принимает ровно один файл за запрос
 * (`readMultipartFormData` ищет поле `file`), поэтому пачка отправляется
 * последовательно вызывающим — так каждый файл получает свой честный вердикт
 * (принят / дубль / похож), а не один общий на всю пачку.
 */
export function uploadBackgroundClip(
  fetcher: AdminFetcher,
  appId: number,
  input: { file: File, name?: string, kind?: string, tags?: string },
): Promise<{ data: BackgroundUploadResult }> {
  const rejection = validateBackgroundFile({ name: input.file.name, type: input.file.type, size: input.file.size })
  if (rejection) {
    return Promise.reject(new BackgroundFileRejectedError(rejection))
  }

  const form = new FormData()
  form.append('file', input.file)
  if (input.name?.trim()) form.append('name', input.name.trim())
  if (input.kind) form.append('kind', input.kind)
  if (input.tags?.trim()) form.append('tags', input.tags.trim())

  return fetcher<{ data: BackgroundUploadResult }>(`/api/apps/${appId}/background-clips`, {
    method: 'POST',
    body: form,
  })
}

/**
 * Гасит фон. Удаление мягкое (`isActive: false`) — на фон могут ссылаться кадры
 * уже собранных роликов. Сервер возвращает обновлённый список активных.
 */
export function deleteBackgroundClip(
  fetcher: AdminFetcher,
  appId: number,
  clipId: string,
): Promise<{ data: BackgroundClip[] }> {
  return fetcher<{ data: BackgroundClip[] }>(`/api/apps/${appId}/background-clips/${clipId}`, {
    method: 'DELETE',
  })
}
