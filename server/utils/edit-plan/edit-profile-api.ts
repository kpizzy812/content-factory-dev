/**
 * Валидация входа и подготовка ответа HTTP-слоя монтажных профилей
 * (`server/api/edit-profiles/*`, §9 «Монтажный профиль»).
 *
 * ВАЖНО, и об этом явно просит бриф задачи: это НЕ то же самое, что зажатие
 * значений в `resolveEditProfile` (profile.ts), и объединять их нельзя.
 *
 * `resolveEditProfile` обязан пережить мусор, который уже МОЖЕТ лежать в
 * БД — прежде всего в `Video.editOverrides` (это произвольный Json, куда
 * оператор или старая версия клиента могли положить что угодно, включая
 * `brollRatio: 2`), и не уронить прогон ролика из-за него: он зажимает такое
 * значение до 1 и едет дальше.
 *
 * Этот файл — единственная ДВЕРЬ, через которую в БД попадают НОВЫЕ значения
 * профиля. На входе мусор нужно ОТВЕРГАТЬ, а не подчищать: если бы API молча
 * зажимал `brollRatio: 2` до `1`, оператор увидел бы в форме тихо изменившееся
 * число и не понял бы, что его ввод не был принят как есть. 400 здесь и клэмп
 * там — два разных рубежа обороны (эшелонированная защита), а не два места
 * одной и той же проверки: если это когда-нибудь объединить, резолвер
 * перестанет переживать мусор, который лежит в БД уже сегодня.
 */
import type { ResolvedEditProfile } from "./profile"
import { GENERATIVE_VIDEO_RESOLUTIONS, PIP_POSITIONS, resolveEditProfile } from "./profile"
import type { PipPosition } from "./types"

/**
 * Нижняя граница ВХОДА API, а не порог толерантности резолвера.
 * Численно совпадает с MIN_VALID_SHOT_CHANGE_SEC в profile.ts (обе границы
 * выражают одну и ту же продуктовую идею — «короче уже не монтаж, а
 * мигание»), но это СОВПАДЕНИЕ, а не общая константа: значение здесь может
 * ужесточиться по чисто формо-валидационным причинам независимо от того, что
 * резолвер обязан продолжать прощать записям, уже лежащим в БД.
 */
const MIN_SHOT_CHANGE_SEC_INPUT = 0.8

/** Диапазон входа PiP-окна — по смыслу тот же, что MIN/MAX_PIP_SIZE в profile.ts,
 *  но объявлен отдельно по той же причине (см. докстринг файла). */
const MIN_PIP_SIZE_INPUT = 0.1
const MAX_PIP_SIZE_INPUT = 0.5

export interface EditProfileWriteFields {
  name?: string
  description?: string | null
  isDefault?: boolean
  editPrompt?: string | null
  brollRatio?: number
  shotChangeSec?: number
  pipEnabled?: boolean
  pipPosition?: PipPosition
  pipSize?: number
  imageGenerationEnabled?: boolean
  imageBudgetUsd?: number
  generativeVideoEnabled?: boolean
  generativeVideoBudgetUsd?: number
  generativeVideoResolution?: string
  stepwiseApproval?: boolean
  llmModelId?: string | null
}

function badRequest(message: string): never {
  throw createError({ statusCode: 400, message })
}

function has(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined
}

function readBoolean(body: Record<string, unknown>, key: string): boolean {
  const value = body[key]
  if (typeof value !== "boolean") badRequest(`Поле "${key}" должно быть boolean`)
  return value as boolean
}

function readNullableString(body: Record<string, unknown>, key: string): string | null {
  const value = body[key]
  if (value === null) return null
  if (typeof value !== "string") badRequest(`Поле "${key}" должно быть строкой или null`)
  return value as string
}

function readFiniteNumber(body: Record<string, unknown>, key: string): number {
  const value = body[key]
  if (typeof value !== "number" || !Number.isFinite(value)) badRequest(`Поле "${key}" должно быть числом`)
  return value as number
}

/**
 * Разбирает и валидирует тело POST/PUT `edit-profiles`. Присутствуют в
 * результате только поля, реально переданные в body (кроме `name` при
 * `requireName: true`) — PUT обязан оставаться частичным обновлением и не
 * затирать несданные поля дефолтами.
 */
export function parseEditProfileWrite(
  rawBody: unknown,
  opts: { requireName: boolean },
): EditProfileWriteFields {
  const body = (rawBody && typeof rawBody === "object" ? rawBody : {}) as Record<string, unknown>
  const out: EditProfileWriteFields = {}

  if (has(body, "name")) {
    const name = body.name
    if (typeof name !== "string" || name.trim().length === 0) {
      badRequest("Поле \"name\" должно быть непустой строкой")
    }
    out.name = (name as string).trim()
  }
  else if (opts.requireName) {
    badRequest("Поле \"name\" обязательно")
  }

  if (has(body, "description")) out.description = readNullableString(body, "description")
  if (has(body, "isDefault")) out.isDefault = readBoolean(body, "isDefault")
  if (has(body, "editPrompt")) out.editPrompt = readNullableString(body, "editPrompt")

  if (has(body, "brollRatio")) {
    const value = readFiniteNumber(body, "brollRatio")
    if (value < 0 || value > 1) badRequest("Поле \"brollRatio\" должно быть в диапазоне 0..1")
    out.brollRatio = value
  }

  if (has(body, "shotChangeSec")) {
    const value = readFiniteNumber(body, "shotChangeSec")
    if (value < MIN_SHOT_CHANGE_SEC_INPUT) {
      badRequest(`Поле "shotChangeSec" должно быть не меньше ${MIN_SHOT_CHANGE_SEC_INPUT}`)
    }
    out.shotChangeSec = value
  }

  if (has(body, "pipEnabled")) out.pipEnabled = readBoolean(body, "pipEnabled")

  if (has(body, "pipPosition")) {
    const value = body.pipPosition
    if (typeof value !== "string" || !PIP_POSITIONS.includes(value as PipPosition)) {
      badRequest(`Поле "pipPosition" должно быть одним из: ${PIP_POSITIONS.join(", ")}`)
    }
    out.pipPosition = value as PipPosition
  }

  if (has(body, "pipSize")) {
    const value = readFiniteNumber(body, "pipSize")
    if (value < MIN_PIP_SIZE_INPUT || value > MAX_PIP_SIZE_INPUT) {
      badRequest(`Поле "pipSize" должно быть в диапазоне ${MIN_PIP_SIZE_INPUT}..${MAX_PIP_SIZE_INPUT}`)
    }
    out.pipSize = value
  }

  if (has(body, "imageGenerationEnabled")) out.imageGenerationEnabled = readBoolean(body, "imageGenerationEnabled")

  if (has(body, "imageBudgetUsd")) {
    const value = readFiniteNumber(body, "imageBudgetUsd")
    if (value < 0) badRequest("Поле \"imageBudgetUsd\" должно быть неотрицательным")
    out.imageBudgetUsd = value
  }

  if (has(body, "generativeVideoEnabled")) out.generativeVideoEnabled = readBoolean(body, "generativeVideoEnabled")

  if (has(body, "generativeVideoBudgetUsd")) {
    const value = readFiniteNumber(body, "generativeVideoBudgetUsd")
    if (value < 0) badRequest("Поле \"generativeVideoBudgetUsd\" должно быть неотрицательным")
    out.generativeVideoBudgetUsd = value
  }

  if (has(body, "generativeVideoResolution")) {
    const value = body.generativeVideoResolution
    if (typeof value !== "string" || !GENERATIVE_VIDEO_RESOLUTIONS.includes(value)) {
      badRequest(`Поле "generativeVideoResolution" должно быть одним из: ${GENERATIVE_VIDEO_RESOLUTIONS.join(", ")}`)
    }
    out.generativeVideoResolution = value
  }

  if (has(body, "stepwiseApproval")) out.stepwiseApproval = readBoolean(body, "stepwiseApproval")
  if (has(body, "llmModelId")) out.llmModelId = readNullableString(body, "llmModelId")

  return out
}

/**
 * Создаёт профиль, гарантируя единственный дефолтный профиль на `appId`.
 *
 * Без этого два профиля с `isDefault: true` в одном приложении дают
 * недетерминированный монтаж: `video-pipeline.ts` берёт дефолтный профиль
 * через `findFirst({ where: { appId, isDefault: true } })` БЕЗ `orderBy`
 * (осознанно — порядок не гарантирован Prisma/Postgres при отсутствии
 * `ORDER BY`), и один и тот же ролик собрался бы то по одному набору правил
 * бренда, то по другому. В схеме уникальности на `isDefault` нет (только
 * обычный индекс `@@index([appId, isDefault])`) — это НЕ уникальный частичный
 * индекс, добавлять его в эту задачу не входит (отдельное решение о миграции).
 * Единственность держится здесь, в одной транзакции с записью: снятие флага у
 * остальных и создание новой строки атомарны, иначе конкурентный запрос между
 * ними мог бы застать оба профиля дефолтными.
 */
export async function createEditProfileExclusive(
  appId: number,
  fields: EditProfileWriteFields & { name: string },
) {
  return prisma.$transaction(async (tx) => {
    if (fields.isDefault) {
      await tx.editProfile.updateMany({ where: { appId, isDefault: true }, data: { isDefault: false } })
    }
    return tx.editProfile.create({ data: { appId, ...fields } })
  })
}

/** То же самое для обновления — минус сам обновляемый профиль, тем же приёмом. */
export async function updateEditProfileExclusive(
  id: number,
  appId: number | null,
  fields: EditProfileWriteFields,
) {
  return prisma.$transaction(async (tx) => {
    if (fields.isDefault) {
      await tx.editProfile.updateMany({
        where: { appId, isDefault: true, id: { not: id } },
        data: { isDefault: false },
      })
    }
    return tx.editProfile.update({ where: { id }, data: fields })
  })
}

/**
 * Форма строки `EditProfile` из Prisma. Поля-enum'ы (`pipPosition`,
 * `generativeVideoResolution`) в колонке — просто `string`, а не узкий union:
 * сама Prisma не сужает их (в схеме это `String @default(...)`), и именно
 * поэтому строка может стать мусорной в обход API (ручная правка, миграция) —
 * см. докстринг ниже. Приводить их к `Partial<ResolvedEditProfile>`
 * структурной совместимостью нельзя (`string` не `PipPosition`); в
 * `resolveEditProfile` они уходят тем же приёмом, что и в video-pipeline.ts:
 * `as unknown as Partial<ResolvedEditProfile>` — резолвер валидирует каждое
 * поле заново и на некорректный тип он и рассчитан.
 */
interface EditProfileRow {
  id: number
  appId: number | null
  name: string
  description: string | null
  isDefault: boolean
  createdAt: Date
  updatedAt: Date
  editPrompt: string | null
  brollRatio: number
  shotChangeSec: number
  pipEnabled: boolean
  pipPosition: string
  pipSize: number
  imageGenerationEnabled: boolean
  imageBudgetUsd: number
  generativeVideoEnabled: boolean
  generativeVideoBudgetUsd: number
  generativeVideoResolution: string
  stepwiseApproval: boolean
  llmModelId: string | null
}

/**
 * Ответ API — РАЗРЕШЁННЫЕ значения профиля (прогнанные через
 * `resolveEditProfile`), а не сырые колонки с `null`. Это защита в глубину:
 * даже если строка в БД когда-то стала невалидной в обход API (миграция,
 * ручная правка), список профилей не покажет её как есть.
 */
export function presentEditProfile(row: EditProfileRow) {
  const resolved = resolveEditProfile(row as unknown as Partial<ResolvedEditProfile>, null)
  return {
    id: row.id,
    appId: row.appId,
    name: row.name,
    description: row.description,
    isDefault: row.isDefault,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...resolved,
  }
}
