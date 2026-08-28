/**
 * Ссылка на файл фона для карточки библиотеки (§9 «Библиотека фонов»).
 *
 * Ручки библиотеки отдавали `storageKey` — технический ключ, по которому
 * браузер файл получить не может. Карточка рисовала иконку по типу, и оператор
 * выбирал фон вслепую.
 *
 * ТРЕТЬЕГО механизма ссылок здесь не заводится. В проекте он один —
 * `resolvePublicMediaUrl` (`server/utils/social/public-media.ts`), и он уже
 * разводит два разных драйвера:
 *   - `gcs` — подписанная ссылка самого провайдера, файл идёт мимо приложения;
 *   - остальные (`local`, `mock`) — отдача через своё приложение по
 *     подписанному токену `/api/public/media/:token`, потому что подписывать
 *     ссылку там некому.
 * `playback-url.get.ts` решает ту же задачу для финального mp4 ролика, но он
 * завязан на `Video` (проверка `file_missing`, перевод статуса) и для строки
 * `BackgroundClip` не подходит.
 *
 * Отличие от публикации ролика — тип содержимого. Общий механизм по умолчанию
 * объявляет файл как `video/mp4` (единственным потребителем была отправка
 * ролика в Instagram), а библиотека фонов держит ещё и картинки: png,
 * объявленный видео, в `<img>` не покажется. Поэтому тип берётся из записи.
 *
 * Ошибка сборки ссылки НЕ роняет список. Причины отказа реальны и не связаны с
 * самим фоном: не настроен `CONTENT_FACTORY_PUBLIC_URL`, короткий секрет
 * подписи, ключ, не прошедший PrefixGuard. Ответ 500 на весь список из-за
 * одного такого клипа отнял бы у оператора и остальные фоны, поэтому у клипа
 * появляется `previewUrl: null`, а карточка честно говорит, что превью нет.
 */
import { publicMediaContentType, resolvePublicMediaUrl } from "~~/server/utils/social/public-media"
import type { StorageDriver } from "~~/server/utils/storage/types"

/** Минимум полей строки `BackgroundClip`, из которых собирается ссылка. */
export interface BackgroundPreviewSource {
  storageKey: string
  mimeType: string | null
}

export interface BackgroundPreviewOptions {
  driver?: StorageDriver
  baseUrl?: string
  secret?: string
  now?: number
  ttlSeconds?: number
}

/**
 * Адрес отдачи через своё приложение — ОТНОСИТЕЛЬНЫЙ.
 *
 * Общий механизм по умолчанию собирает абсолютный адрес из
 * `CONTENT_FACTORY_PUBLIC_URL` и без него бросает: единственному прежнему
 * потребителю (публикация ролика в Instagram) абсолютный адрес обязателен —
 * файл тянет чужая сторона. Превью фона показывает наш собственный экран, тем
 * же браузером и с того же источника, поэтому публичный адрес ему не нужен, а
 * его отсутствие не должно гасить превью на стендах, где он просто не настроен.
 */
const RELATIVE_BASE_URL = ""

/**
 * Тип содержимого фона: сначала то, что записано при загрузке, потом расширение
 * ключа. `null` — тип неизвестен, и навязывать провайдеру выдуманный не надо.
 */
export function backgroundPreviewContentType(clip: BackgroundPreviewSource): string | null {
  const declared = (clip.mimeType || "").trim().toLowerCase()
  if (declared) return declared
  return publicMediaContentType(clip.storageKey)
}

/**
 * Ссылка на один фон. `null` — собрать не удалось; причина уходит в лог
 * вызывающего, а не в ответ: она про конфигурацию сервера, а не про фон.
 */
export async function resolveBackgroundPreviewUrl(
  clip: BackgroundPreviewSource,
  options: BackgroundPreviewOptions = {},
): Promise<string | null> {
  try {
    const contentType = backgroundPreviewContentType(clip)
    return await resolvePublicMediaUrl(
      { storageKey: clip.storageKey },
      {
        driver: options.driver,
        baseUrl: options.baseUrl ?? RELATIVE_BASE_URL,
        secret: options.secret,
        now: options.now,
        ttlSeconds: options.ttlSeconds,
        ...(contentType ? { responseContentType: contentType } : {}),
      },
    )
  }
  catch {
    return null
  }
}

/**
 * Тот же список клипов плюс `previewUrl` у каждого. Драйвер берётся ОДИН раз на
 * весь список: `getStorageDriver()` внутри общего механизма — синглтон, но
 * явная передача заодно позволяет проверить обе ветки драйверов тестом.
 */
export async function withBackgroundPreviewUrls<T extends BackgroundPreviewSource>(
  clips: T[],
  options: BackgroundPreviewOptions = {},
): Promise<Array<T & { previewUrl: string | null }>> {
  return Promise.all(clips.map(async clip => ({
    ...clip,
    previewUrl: await resolveBackgroundPreviewUrl(clip, options),
  })))
}
