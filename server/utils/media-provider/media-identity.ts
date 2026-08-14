/**
 * Идентичность медиазадачи: что считать «той же самой» попыткой, а что —
 * сущностью, на которую выделен бюджет повторов.
 *
 * Обобщение `buildLipSyncIdentity` на все способности (§3.5 спецификации
 * docs/superpowers/specs/2026-08-07-replicate-media-contour.md):
 *
 *   attemptCeilingScope = "{capability}:v1:video:{videoId}:scene:{sceneOrder}:model:{modelId}"
 *   attemptScope = idempotencyKey = attemptCeilingScope + ":input:" + sha256(вход)
 *
 * Раскладку ключа lip-sync НЕ меняем: она уже лежит в БД, и любая правка
 * ослепила бы `countSpentAttemptsInScope` — уже созданные записи перестали бы
 * попадать в свою область бюджета, а миграция данных стала бы обязательной.
 * Поэтому для lip_sync здесь только делегирование в прежнюю функцию.
 *
 * Для остальных способностей входных файлов может не быть вовсе, поэтому
 * отпечаток строится по НОРМАЛИЗОВАННОМУ PAYLOAD модели (промпт, размер,
 * длительность после квантования, флаги, seed). Payload берётся из `mapInput`
 * той же спеки — то есть в ключ автоматически попадает всё, за что мы платим,
 * и ничего, что на результат не влияет.
 *
 * Файлы-входы (скриншот для image_to_video, видео и аудио для lip-sync) в
 * отпечаток входят своим sha256, а НЕ временным URL заливки: URL меняется на
 * каждую загрузку, и ключ перестал бы совпадать сам с собой — идемпотентность
 * превратилась бы в фикцию, а каждая повторная попытка стоила бы денег.
 */

import { createHash } from "node:crypto"
import { buildLipSyncIdentity } from "./lip-sync-identity"
import type { MediaCapability } from "./types"

export interface MediaIdentity {
  /** Узкая область бюджета: конкретный набор входов. Совпадает с ключом. */
  attemptScope: string
  /** Широкая область: ролик + сцена + модель. Строгий префикс attemptScope. */
  attemptCeilingScope: string
  /** Полный ключ идемпотентности. */
  idempotencyKey: string
}

export interface MediaIdentityInput {
  capability: MediaCapability
  /** Ролик, которому принадлежит задача. Нет ролика — нужен `subjectScope`. */
  videoId?: number | null
  sceneOrder?: number
  /**
   * Область субъекта для задач вне ролика: `character:{id}:variation:{n}`.
   * Ролика у вариаций портрета нет, а платный prediction есть, и повтор
   * запроса не должен оплачиваться второй раз.
   */
  subjectScope?: string | null
  modelId: string
  /** Payload модели, где поля-файлы заменены их отпечатками. */
  payload: Record<string, unknown>
  /**
   * Отпечатки файлов по полям нормализованного входа. Для lip_sync обязательны
   * `videoUrl` и `audioUrl` — из них собирается прежняя раскладка ключа.
   */
  fingerprints?: Readonly<Record<string, string>>
}

export function buildMediaIdentity(input: MediaIdentityInput): MediaIdentity {
  if (!input.modelId.trim()) {
    throw new Error("Идентификатор модели не может быть пустым")
  }

  const subjectScope = input.subjectScope?.trim()
  if (input.videoId === null || input.videoId === undefined) {
    if (!subjectScope) {
      throw new Error(
        "Идентичность медиазадачи требует videoId либо subjectScope — безымянного ключа не бывает",
      )
    }
  }

  // Прежняя раскладка lip-sync — единственная, что уже лежит в БД.
  if (input.capability === "lip_sync") {
    const sourceFingerprint = input.fingerprints?.videoUrl
    const audioFingerprint = input.fingerprints?.audioUrl
    if (!sourceFingerprint || !audioFingerprint) {
      throw new Error(
        "Идентичность lip-sync требует отпечатков исходного видео и аудио",
      )
    }
    if (input.videoId === null || input.videoId === undefined) {
      throw new Error("Идентичность lip-sync существует только внутри ролика")
    }
    return buildLipSyncIdentity({
      videoId: input.videoId,
      sceneOrder: input.sceneOrder ?? 0,
      modelId: input.modelId,
      sourceFingerprint,
      audioFingerprint,
    })
  }

  // Задача ролика описывается сценой, задача вне ролика — своим субъектом.
  // Раскладку ключа роликов трогать нельзя: она уже лежит в БД.
  const scope = input.videoId === null || input.videoId === undefined
    ? [subjectScope]
    : ["video", input.videoId, "scene", input.sceneOrder ?? 0]

  const attemptCeilingScope = [
    input.capability,
    "v1",
    ...scope,
    "model",
    input.modelId,
  ].join(":")

  const idempotencyKey = `${attemptCeilingScope}:input:${hashPayload(input.payload)}`
  return { attemptScope: idempotencyKey, attemptCeilingScope, idempotencyKey }
}

/**
 * Отпечаток payload'а. Ключи сортируются рекурсивно: порядок полей в объекте
 * зависит от того, в каком порядке их положил маппер, и от него ключ зависеть
 * не должен — иначе безобидная перестановка строк в спеке обнулила бы
 * идемпотентность всех незавершённых роликов.
 */
export function hashPayload(payload: unknown): string {
  return createHash("sha256").update(stableStringify(payload)).digest("hex")
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null"
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    return `{${entries.join(",")}}`
  }
  return JSON.stringify(value)
}
