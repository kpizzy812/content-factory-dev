/**
 * Библиотека портретов персонажа из одного референса.
 *
 * Ротация портретов (`avatar-source.ts`) размазывает нагрузку по кадрам
 * персонажа: наименее использованный идёт первым, и сцены ролика перестают
 * показывать одно и то же лицо в одной и той же позе. Но работает она только
 * когда кадров несколько, а приносит их сегодня заказчик — 5-10 фотографий
 * человека. Это главное требование к нему и главный тормоз запуска.
 *
 * Способность `image_to_image` (FLUX Kontext) правит существующий кадр по
 * инструкции, сохраняя лицо. Значит из одного портрета получается набор:
 * ракурс, одежда, обстановка и свет разные, человек тот же.
 *
 * Спецификация — docs/superpowers/specs/2026-08-14-avatar-pipeline.md, этап 5.
 */

import type { CharacterReferenceKind } from "~~/shared/types/character"

/** По какой оси вариация отличается от исходного кадра. */
export type ReferenceVariationAxis = "angle" | "outfit" | "setting" | "light"

export interface ReferenceVariationPreset {
  /** Стабильный ключ: он же слот идемпотентности, менять нельзя. */
  key: string
  axis: ReferenceVariationAxis
  /**
   * Вид кадра для `CharacterReferenceImage.kind`.
   *
   * Всегда `face`, и это не формальность: `compareAvatarPortraits` ставит
   * портрет лица впереди любого другого кадра, поэтому вариация с `body` или
   * `outfit` не будет выбрана ротацией, пока у персонажа есть хоть один
   * портрет лица. Кадр не в `face` — это кадр мимо ротации, ради которой всё
   * и делается.
   */
  kind: CharacterReferenceKind
  /** Инструкция правки, дословно уходит в промпт модели. */
  instruction: string
  /** Подпись для интерфейса и логов. */
  label: string
}

/**
 * Требование идентичности. Kontext принимает ИНСТРУКЦИЮ правки, а не описание
 * с нуля: без явного «тот же человек» модель рисует похожего, и библиотека
 * портретов наполняется незнакомцами, которых ротация честно перемешает.
 */
const IDENTITY_CLAUSE
  = "Keep the same person: identical face, facial features, hair and skin tone. Do not change the identity."

/**
 * Требование кадра. Портрет уходит в `speech_to_video`, где мимика и губы
 * выводятся из речи: кадр со спины, в полный профиль или с перекрытым ртом
 * там бесполезен, а узнаём мы об этом уже после оплаты клипа.
 */
const FRAMING_CLAUSE
  = "Keep a head-and-shoulders portrait framing, face fully visible, mouth unobstructed, eyes toward the camera."

export const REFERENCE_VARIATION_PRESETS: readonly ReferenceVariationPreset[] = Object.freeze([
  Object.freeze({
    key: "angle_three_quarter_left",
    axis: "angle" as const,
    kind: "face" as const,
    instruction: "Turn the person slightly to their left, three-quarter view of the face.",
    label: "Ракурс три четверти влево",
  }),
  Object.freeze({
    key: "angle_three_quarter_right",
    axis: "angle" as const,
    kind: "face" as const,
    instruction: "Turn the person slightly to their right, three-quarter view of the face.",
    label: "Ракурс три четверти вправо",
  }),
  Object.freeze({
    key: "outfit_business",
    axis: "outfit" as const,
    kind: "face" as const,
    instruction: "Change the clothing to a dark tailored blazer over a plain top.",
    label: "Одежда: деловой пиджак",
  }),
  Object.freeze({
    key: "outfit_casual",
    axis: "outfit" as const,
    kind: "face" as const,
    instruction: "Change the clothing to a casual knit sweater in a muted colour.",
    label: "Одежда: свитер",
  }),
  Object.freeze({
    key: "setting_office",
    axis: "setting" as const,
    kind: "face" as const,
    instruction: "Place the person in a modern office interior, background softly out of focus.",
    label: "Обстановка: офис",
  }),
  Object.freeze({
    key: "setting_home",
    axis: "setting" as const,
    kind: "face" as const,
    instruction: "Place the person in a warm home interior, background softly out of focus.",
    label: "Обстановка: дом",
  }),
  Object.freeze({
    key: "light_window",
    axis: "light" as const,
    kind: "face" as const,
    instruction: "Relight the scene with soft daylight coming from a window to one side.",
    label: "Свет: дневной из окна",
  }),
  Object.freeze({
    key: "light_evening",
    axis: "light" as const,
    kind: "face" as const,
    instruction: "Relight the scene with warm evening light and gentle contrast.",
    label: "Свет: тёплый вечерний",
  }),
])

/**
 * Потолок кадров за один запрос.
 *
 * Кадр стоит $0.025, и без потолка одна опечатка в поле «сколько» превращается
 * в счёт на десятки долларов. Восемь — весь набор пресетов: больше за раз
 * просить нечего, дальше начались бы повторы одной и той же правки.
 */
export const MAX_REFERENCE_VARIATIONS = REFERENCE_VARIATION_PRESETS.length

/**
 * Набор пресетов на этот запрос.
 *
 * `startIndex` двигает окно: второй запуск для того же персонажа обязан дать
 * новые ракурсы, иначе оператор оплачивает те же кадры повторно. Вызывающий
 * передаёт сюда число уже сделанных вариаций.
 */
export function planReferenceVariations(
  count: number,
  options?: { startIndex?: number },
): ReferenceVariationPreset[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("Вариации портрета: count должен быть целым числом от 1")
  }
  if (count > MAX_REFERENCE_VARIATIONS) {
    throw new Error(
      `Вариации портрета: за раз можно просить не больше ${MAX_REFERENCE_VARIATIONS} кадров, запрошено ${count}`,
    )
  }

  const total = REFERENCE_VARIATION_PRESETS.length
  const start = Math.max(0, Math.trunc(options?.startIndex ?? 0)) % total
  return Array.from({ length: count }, (_, index) =>
    REFERENCE_VARIATION_PRESETS[(start + index) % total]!)
}

/**
 * Промпт вариации: сначала сохранить человека, потом править кадр.
 *
 * Заметка оператора добавляется в конец и инструкцию пресета НЕ замещает:
 * «без очков» — это уточнение к «повернуть на три четверти», а не другая
 * задача.
 */
export function buildVariationPrompt(
  preset: ReferenceVariationPreset,
  note?: string | null,
): string {
  return [
    IDENTITY_CLAUSE,
    preset.instruction,
    FRAMING_CLAUSE,
    note?.trim() || null,
  ].filter(Boolean).join(" ")
}

/**
 * Область идемпотентности слота вариации.
 *
 * Слот — это пара «исходный кадр + пресет»: повтор того же пресета на том же
 * исходнике обязан переиспользовать уже оплаченный результат, а не покупать
 * его второй раз. Персонаж в ключ не входит: исходный кадр и так принадлежит
 * ровно одному персонажу, а лишнее поле в ключе означало бы, что перенос
 * референса обнуляет оплаченное.
 */
export function buildVariationIdentityScope(
  sourceReferenceId: string,
  presetKey: string,
): string {
  return `character-reference:${sourceReferenceId}:variation:${presetKey}`
}
