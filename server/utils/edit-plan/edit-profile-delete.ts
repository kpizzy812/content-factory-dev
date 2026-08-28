/**
 * Удаление монтажного профиля: что можно, что нельзя и что станет с профилем
 * приложения по умолчанию.
 *
 * Файл отдельный от `edit-profile-api.ts` (там разбор входа и запись новых
 * значений) по одной причине: удаление — единственная операция над профилем,
 * решение по которой принимается не по телу запроса, а по СВЯЗЯМ строки. Всё
 * рассуждение о связях собрано здесь, а ручка остаётся тонкой.
 *
 * ── Факт 1: ролики. `Video.editProfileId Int?` с `onDelete: SetNull`
 * (`prisma/schema.prisma`). Удаление строки профиля ролик не роняет — оно
 * обнуляет у него ссылку; это прибито интеграционным тестом «удаление
 * монтажного профиля не уносит ролик — обнуляет editProfileId».
 *
 * Проблема не в потере ролика, а в том, ЧЕМ становится обнулённая ссылка.
 * Снимка разрешённого профиля на ролике нет нигде: `resolveEditProfile`
 * пересчитывает правила на каждом прогоне из `video.editProfile` ИЛИ профиля
 * приложения по умолчанию (`video-pipeline.ts`, `video-pipeline-steps.ts`), а
 * `VideoShot` хранит план и факт КАДРА (фон, стоимость, причина деградации), но
 * не правила, по которым кадры нарезаны. Значит `editProfileId: null` на уже
 * смонтированном ролике читается как «собран по профилю приложения по
 * умолчанию» — по чужим правилам, которых в момент сборки могло не быть вовсе.
 * Это не потеря ссылки, а подмена истории, и молча делать её нельзя.
 *
 * Поэтому выбран ОТКАЗ, а не отвязка: профиль, на который ссылается хотя бы
 * один ролик, не удаляется, и оператору называется число роликов. Отвязка была
 * бы уместна, если бы ролик хранил снимок правил — тогда ссылка была бы
 * удобством, а не единственным свидетельством. Сегодня она единственная.
 *
 * ── Факт 2: профиль по умолчанию. `EditProfile.isDefault` прикрыт ОБЫЧНЫМ
 * индексом `@@index([appId, isDefault])`, а не уникальным частичным, и конвейер
 * ищет дефолт через `findFirst({ where: { appId, isDefault: true } })`. Если
 * удалить дефолтный профиль у приложения, где есть другие, приложение окажется
 * со списком профилей, из которых не действует НИ ОДИН: `findFirst` вернёт
 * null, и конвейер молча свалится на встроенные значения. Оператор при этом
 * видит непустой список и уверен, что правила работают.
 *
 * Поэтому дефолт переезжает на преемника В ТОЙ ЖЕ ТРАНЗАКЦИИ, что и удаление.
 * Преемник выбирается тем же порядком, каким список показан оператору
 * (`orderBy: [{ isDefault: desc }, { createdAt: desc }]` в
 * `edit-profiles/index.get.ts`) — то есть самый свежий из оставшихся: это
 * первая строка списка после ухода удаляемой. При равном `createdAt` порядок
 * доопределён большим `id`, иначе выбор был бы недетерминированным ровно там,
 * где два профиля созданы в одну миллисекунду.
 *
 * Последний профиль приложения удалить МОЖНО: приложение без профиля —
 * штатное, задокументированное состояние (`Video.editProfileId`: «null —
 * правила берутся из профиля приложения по умолчанию, а если и его нет — из
 * констант edit-plan/profile.ts»). Оператору про эти константы говорится прямо.
 *
 * Общий шаблон (`appId: null`) преемника не назначает: дефолт приложения
 * ищется по конкретному `appId`, и шаблон в этом поиске не участвует.
 */
import { formatMoney } from "~~/shared/utils/money"

import { DEFAULT_EDIT_PROFILE } from "./profile"

export interface EditProfileDeletionTarget {
  id: number
  appId: number | null
  name: string
  isDefault: boolean
}

/** Остальные профили того же приложения — кандидаты в преемники дефолта. */
export interface EditProfileSibling {
  id: number
  name: string
  createdAt: Date | string
}

export interface EditProfileDeletionInput {
  profile: EditProfileDeletionTarget
  /** Сколько роликов ссылаются на профиль (`Video.editProfileId`). */
  videoCount: number
  siblings: EditProfileSibling[]
}

export type EditProfileDeletionPlan =
  | { allowed: false, statusCode: 409, message: string }
  | {
    allowed: true
    /** Кому передать `isDefault`. `null` — передавать некому или незачем. */
    promoteDefaultId: number | null
    promoteDefaultName: string | null
    /** Что сказать оператору по итогу. */
    note: string
  }

function timeOf(value: Date | string): number {
  const time = value instanceof Date ? value.getTime() : Date.parse(value)
  return Number.isFinite(time) ? time : 0
}

/**
 * Преемник дефолта — первая строка списка после ухода удаляемого профиля:
 * самый свежий, при равенстве — с большим `id`.
 */
export function pickDefaultSuccessor(siblings: EditProfileSibling[]): EditProfileSibling | null {
  if (siblings.length === 0) return null
  return [...siblings].sort((a, b) => {
    const diff = timeOf(b.createdAt) - timeOf(a.createdAt)
    return diff !== 0 ? diff : b.id - a.id
  })[0]!
}

/** Отказ словами: что мешает и что с этим делать. */
export function editProfileInUseMessage(name: string, videoCount: number): string {
  const roliki = videoCount === 1 ? "ролик" : "ролика/роликов"
  return `Профиль «${name}» удалить нельзя: на него ссылается ${videoCount} ${roliki}. `
    + "Удаление обнулило бы у них ссылку на профиль, и уже смонтированный ролик стал бы читаться "
    + "как собранный по профилю приложения по умолчанию или по встроенным значениям — "
    + "снимка правил монтажа на ролике не хранится, ссылка и есть вся история. "
    + "Переведите эти ролики на другой профиль и повторите."
}

export function planEditProfileDeletion(input: EditProfileDeletionInput): EditProfileDeletionPlan {
  const { profile, videoCount, siblings } = input

  if (videoCount > 0) {
    return {
      allowed: false,
      statusCode: 409,
      message: editProfileInUseMessage(profile.name, videoCount),
    }
  }

  // Дефолт переезжает только у профиля приложения: у общего шаблона
  // (`appId: null`) дефолта приложения нет и наследовать его некому.
  const successor = profile.isDefault && profile.appId !== null
    ? pickDefaultSuccessor(siblings)
    : null

  if (successor) {
    return {
      allowed: true,
      promoteDefaultId: successor.id,
      promoteDefaultName: successor.name,
      note: `Профилем по умолчанию стал «${successor.name}»: без этого у приложения остался бы `
        + "список профилей, из которых не действует ни один.",
    }
  }

  if (siblings.length === 0) {
    return {
      allowed: true,
      promoteDefaultId: null,
      promoteDefaultName: null,
      // Числа собраны из `DEFAULT_EDIT_PROFILE`, а не переписаны строкой: смена
      // встроенного значения обязана менять и то, что обещано оператору.
      note: "Это был последний монтажный профиль приложения. Ролики теперь собираются по встроенным "
        + `значениям: доля перебивок ${String(DEFAULT_EDIT_PROFILE.brollRatio).replace(".", ",")}, `
        + `потолок расхода на картинки ${formatMoney(DEFAULT_EDIT_PROFILE.imageBudgetUsd)}, `
        + `генеративное видео ${DEFAULT_EDIT_PROFILE.generativeVideoEnabled ? "включено" : "выключено"}.`,
    }
  }

  return {
    allowed: true,
    promoteDefaultId: null,
    promoteDefaultName: null,
    note: "Профиль по умолчанию не менялся.",
  }
}

/**
 * Удаление и передача дефолта ОДНОЙ транзакцией — тем же приёмом, что в
 * `createEditProfileExclusive`/`updateEditProfileExclusive`: между удалением
 * дефолтного профиля и назначением преемника конкурентный прогон ролика застал
 * бы приложение вовсе без действующих правил.
 */
export async function deleteEditProfileExclusive(
  id: number,
  promoteDefaultId: number | null,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.editProfile.delete({ where: { id } })
    if (promoteDefaultId !== null) {
      await tx.editProfile.update({ where: { id: promoteDefaultId }, data: { isDefault: true } })
    }
  })
}
