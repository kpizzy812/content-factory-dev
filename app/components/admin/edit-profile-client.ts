/**
 * Обращения формы монтажного профиля к серверу.
 *
 * `fetcher` приходит параметром, а не берётся из глобального `$fetch`, по той
 * же причине, что и в `app/components/video/edit-console-api.ts`: только так
 * можно доказать тестом, что невалидное ДЕНЕЖНОЕ значение не уходит в сеть —
 * промис отклоняется до формирования запроса, а не после серверного 400.
 */
import type { EditProfile } from '~~/shared/types/edit-console'
import type { EditProfileFormErrors, EditProfileFormState } from './edit-profile-form-model'
import { readEditProfileForm } from './edit-profile-form-model'

export interface AdminFetchOptions {
  method?: string
  body?: BodyInit | Record<string, unknown> | null
}

/** Совместим по форме с `$fetch` — компонент передаёт его как есть. */
export type AdminFetcher = <T = unknown>(url: string, options?: AdminFetchOptions) => Promise<T>

/** Форма не прошла проверку — запрос не формировался. */
export class EditProfileValidationError extends Error {
  readonly errors: EditProfileFormErrors

  constructor(errors: EditProfileFormErrors) {
    super('Профиль не сохранён: поля заполнены неверно')
    this.name = 'EditProfileValidationError'
    this.errors = errors
  }
}

/**
 * Создаёт или обновляет профиль.
 *
 * `profileId: null` — создание (POST с `appId` в теле), иначе частичное
 * обновление (PUT, `appId` не передаётся вовсе: сервер отвергает попытку его
 * сменить).
 */
export function saveEditProfile(
  fetcher: AdminFetcher,
  input: { appId: number, profileId: number | null, form: EditProfileFormState },
): Promise<{ data: EditProfile }> {
  const { errors, body } = readEditProfileForm(input.form)
  if (body === null) {
    return Promise.reject(new EditProfileValidationError(errors))
  }

  if (input.profileId === null) {
    return fetcher<{ data: EditProfile }>('/api/edit-profiles', {
      method: 'POST',
      body: { appId: input.appId, ...body },
    })
  }

  return fetcher<{ data: EditProfile }>(`/api/edit-profiles/${input.profileId}`, {
    method: 'PUT',
    body,
  })
}

/** Сообщение сервера, а не код: оператору нужна причина, а не «400». */
export function adminErrorText(error: unknown, fallback: string): string {
  const e = error as { data?: { message?: string }, message?: string } | null
  return e?.data?.message || e?.message || fallback
}
