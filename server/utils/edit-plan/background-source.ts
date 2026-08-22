/**
 * Чем закрыть задний план кадра и во сколько это обойдётся.
 *
 * Порядок дешевизны §7: библиотека и скрин приложения бесплатны, картинка с
 * движением стоит $0.025 за кадр, генеративное видео — от $0.225 за клип.
 *
 * Потолок стоимости обязателен: на 300 роликов в сутки разница между $0.025 и
 * $0.225 за перебивку — это разница между рабочим сервисом и несогласованным
 * счётом. При исчерпании потолка кадр не ломается, а деградирует до картинки, и
 * причина возвращается наружу, чтобы вызывающий записал её в лог шага.
 *
 * Функция чистая: тарифы приходят из спек моделей, а не читаются здесь.
 * `generativeVideoUsdPerSec` ОБЯЗАН приходить из `replicateVideoBilling()`
 * (`server/utils/media-provider/model-specs.ts`), а не из константы на стороне
 * вызывающего — ставка Kling 1.6 подтверждена страницей модели (14.08.2026,
 * «or 20 seconds for $1») как $0.05/с. Прежняя цифра $0.045/с была занижена на
 * 11% (смета бралась «как оплачивалось на стенде», без проверки), и заниженная
 * смета уводит партию за пределы кошелька молча — ровно то, чему посвящён этот
 * модуль. $0.045/с отдельно фигурирует у `p-video-avatar` (speech_to_video,
 * аватарный маршрут) — это ДРУГАЯ модель и другая причина цифры, к генерации
 * фона отношения не имеет (см. комментарий у `GENERATIVE_VIDEO_RESOLUTIONS` в
 * `profile.ts`).
 */

import type { ResolvedEditProfile } from "./profile"
import type { ShotBackground } from "./types"

export interface BackgroundPickInput {
  durationSec: number
  profile: ResolvedEditProfile
  /** Что попросила модель. */
  requested: ShotBackground
  /** Сколько уже потрачено на генеративные фоны этого ролика. */
  spentUsd: number
  hasLibraryCandidate: boolean
  hasAppScreen: boolean
  /** $/сек генеративного видео — брать из `replicateVideoBilling()`, не хардкодить. */
  generativeVideoUsdPerSec: number
  imageUsd: number
  /** Нижняя граница квантования генеративного видео: 5 с (`REPLICATE_KLING_16_DURATIONS[0]`). */
  minGenerativeVideoSec: number
  /**
   * Верхняя граница квантования ОДНОГО клипа генеративного видео: 10 с
   * (`REPLICATE_KLING_16_DURATIONS[1]`, `model-specs.ts`). Поле добавлено
   * сверх брифа (см. отчёт задачи, поправка 3) — без него `billedSeconds`
   * молча занижала бы смету на кадре длиннее 10 с, округляя его к тем же
   * 10 с, как и обычный 6-10-секундный кадр. Это реальный, а не гипотетический
   * случай: `validate.ts`/`repair.ts` (Task 3) ограничивают потолком lip-sync
   * только PRESENTER-кадры (`presenter_too_long`) — кадр БЕЗ ведущего (чистая
   * перебивка) такого ограничения не имеет и может прийти длиннее 10 с, а
   * заказать один клип Kling длиннее 10 с физически нельзя
   * (`durationOptions: REPLICATE_KLING_16_DURATIONS` в спеке модели).
   *
   * Провайдерный адаптер (`mapKlingTextToVideo`/`pickDuration` в
   * `model-specs.ts`) на такой случай отвечает иначе: он молча квантует ВНИЗ
   * до 10 с и принимает недостачу («лишнее подрежет монтаж, а недостачу
   * восполнить нечем» — так у него и задокументировано). Здесь, на уровне
   * ПЛАНИРОВАНИЯ стоимости, выбрано другое: честно деградировать до картинки
   * с движением, а не тихо согласиться на видео короче заказанного кадра —
   * смета обязана отражать то, что реально будет доставлено, а не то, что
   * округление провайдера решит подрезать по факту.
   */
  maxGenerativeVideoSec: number
}

export interface BackgroundPick {
  background: ShotBackground
  costUsd: number
  /** Почему просьбу модели не выполнили. null — выполнили. */
  degradeReason: string | null
}

/**
 * Небольшой допуск на шум плавающей точки в сравнениях длительности и
 * денежных сумм (тот же приём, что `RATIO_FLOAT_GUARD` в `validate.ts`):
 * `durationSec` и `costUsd` в проде обычно приходят как результат вычитания
 * (`endSec - startSec`, накопленная сумма потраченного), и кадр РОВНО на
 * границе (5с, 10с, ровно в потолок бюджета) не должен из-за шума округления
 * считаться то по одну, то по другую сторону условия.
 */
const FLOAT_GUARD = 1e-9

/**
 * Длительность, за которую реально выставят счёт.
 *
 * Модели продают 5 или 10 секунд (`REPLICATE_KLING_16_DURATIONS`), поэтому
 * шестисекундный кадр оплачивается как десятисекундный. Считать по фактической
 * длине значило бы занижать смету вдвое. Вызывающий обязан убедиться, что
 * `durationSec` уже проверен на верхнюю границу (`maxGenerativeVideoSec`) —
 * эта функция считает только квантование ВНУТРИ допустимого диапазона.
 */
function billedSeconds(durationSec: number, minGenerativeVideoSec: number, maxGenerativeVideoSec: number): number {
  return durationSec <= minGenerativeVideoSec + FLOAT_GUARD ? minGenerativeVideoSec : maxGenerativeVideoSec
}

export function pickBackgroundSource(input: BackgroundPickInput): BackgroundPick {
  const image = (reason: string | null): BackgroundPick =>
    ({ background: "image", costUsd: input.imageUsd, degradeReason: reason })

  if (input.requested === "none") {
    return { background: "none", costUsd: 0, degradeReason: null }
  }
  if (input.requested === "library") {
    return input.hasLibraryCandidate
      ? { background: "library", costUsd: 0, degradeReason: null }
      : image("В библиотеке нет подходящего фона — кадр идёт картинкой с движением")
  }
  if (input.requested === "app_screen") {
    return input.hasAppScreen
      ? { background: "app_screen", costUsd: 0, degradeReason: null }
      : image("Скрина приложения нет — кадр идёт картинкой с движением")
  }
  if (input.requested === "image") {
    return { background: "image", costUsd: input.imageUsd, degradeReason: null }
  }

  // Дальше только генеративное видео — самый дорогой источник.
  if (!input.profile.generativeVideoEnabled) {
    return image("Генеративное видео выключено в профиле — кадр идёт картинкой с движением")
  }
  if (input.durationSec < input.minGenerativeVideoSec - FLOAT_GUARD) {
    return image(
      `Кадр короче ${input.minGenerativeVideoSec}с — генеративное видео такой длины не продаётся, `
      + `кадр идёт картинкой с движением`,
    )
  }
  if (input.durationSec > input.maxGenerativeVideoSec + FLOAT_GUARD) {
    // Поправка 3: кадр длиннее того, что умещается в один оплаченный клип —
    // см. докстринг `maxGenerativeVideoSec` выше.
    return image(
      `Кадр длиннее ${input.maxGenerativeVideoSec}с — один клип генеративного видео такой длины не заказать, `
      + `кадр идёт картинкой с движением`,
    )
  }

  const cost = billedSeconds(input.durationSec, input.minGenerativeVideoSec, input.maxGenerativeVideoSec)
    * input.generativeVideoUsdPerSec
  if (input.spentUsd + cost > input.profile.generativeVideoBudgetUsd + FLOAT_GUARD) {
    return image(
      `Потолок генеративного видео $${input.profile.generativeVideoBudgetUsd.toFixed(2)} исчерпан `
      + `(потрачено $${input.spentUsd.toFixed(3)}, кадр стоил бы $${cost.toFixed(3)}) — `
      + `кадр идёт картинкой с движением`,
    )
  }

  return { background: "video", costUsd: cost, degradeReason: null }
}
