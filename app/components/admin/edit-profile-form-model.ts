/**
 * Чистая логика формы монтажного профиля: разбор ввода, валидация и сборка тела
 * запроса.
 *
 * Вынесено из компонента отдельным модулем по той же причине, по которой это
 * сделано в `app/components/video/edit-console-model.ts`: в форме две ДЕНЕЖНЫЕ
 * ручки (`imageBudgetUsd`, `generativeVideoBudgetUsd`), и требование «форма не
 * отправляет невалидное денежное значение» должно доказываться тестом, а не
 * обещанием в комментарии. Проверить это на компоненте нечем — чистая сьюта
 * гоняется в node без vue-плагина.
 *
 * Границы ниже — ЗЕРКАЛО серверных из `server/utils/edit-plan/edit-profile-api.ts`
 * (`parseEditProfileWrite`), а не отдельное продуктовое решение. Сервер на
 * выход за диапазон отвечает 400 и не подчищает значение молча; клиент обязан
 * ловить то же самое ДО запроса, иначе оператор получает «Ошибка 400» вместо
 * подписи под полем. Расхождение констант ловится тестом
 * `tests/unit/admin-edit-profile/edit-profile-form.spec.ts`, который читает
 * серверный файл и сверяет числа.
 */
import type { EditProfile, PipPosition } from '~~/shared/types/edit-console'
import { GENERATIVE_VIDEO_RESOLUTIONS, PIP_POSITION_LABELS } from '~~/shared/types/edit-console'

/** Границы входа API. Числа обязаны совпадать с серверными литералами. */
export const EDIT_PROFILE_LIMITS = {
  brollRatioMin: 0,
  brollRatioMax: 1,
  /** `MIN_SHOT_CHANGE_SEC_INPUT` на сервере. */
  shotChangeSecMin: 0.8,
  /** `MIN_PIP_SIZE_INPUT` / `MAX_PIP_SIZE_INPUT` на сервере. */
  pipSizeMin: 0.1,
  pipSizeMax: 0.5,
  /** Обе денежные ручки: сервер отвергает отрицательное. */
  budgetMin: 0,
} as const

/**
 * Дефолты профиля — копия `DEFAULT_EDIT_PROFILE` из
 * `server/utils/edit-plan/profile.ts`. Нужны форме создания: оператор должен
 * видеть, с чего начинает завод, а не пустые поля.
 */
export const EDIT_PROFILE_DEFAULTS = {
  brollRatio: 0.4,
  shotChangeSec: 1.8,
  pipEnabled: false,
  pipPosition: 'bottom_right' as PipPosition,
  pipSize: 0.28,
  imageGenerationEnabled: true,
  imageBudgetUsd: 1.5,
  generativeVideoEnabled: false,
  generativeVideoBudgetUsd: 0.5,
  generativeVideoResolution: '1080x1920',
  stepwiseApproval: false,
} as const

/**
 * Справочные тарифы для подписей под денежными полями.
 *
 * Это ОРИЕНТИР, а не счёт: обе ставки переопределяются окружением
 * (`REPLICATE_IMAGE_PRICE_USD`, `REPLICATE_VIDEO_PRICE_USD_PER_SEC` в
 * `server/utils/media-provider/model-specs.ts`), и подпись обязана это
 * говорить, а не выдавать прикидку за факт списания.
 */
export const IMAGE_USD_REFERENCE = 0.025
export const GENERATIVE_VIDEO_USD_PER_SEC_REFERENCE = 0.05
/** Клип генеративного видео продаётся квантами 5 или 10 с (`REPLICATE_KLING_16_DURATIONS`). */
export const GENERATIVE_VIDEO_MIN_SEC = 5

/**
 * Что происходит при исчерпании потолка — дословно то, что делает
 * `pickBackgroundSource` (`server/utils/edit-plan/background-source.ts`), а не
 * общие слова «превышен лимит».
 */
export const IMAGE_BUDGET_EXHAUSTED_NOTE
  = 'Потолок исчерпан — картинка не генерируется: задний план кадра остаётся пустым, '
    + 'кадр отдаётся ведущему, а причина пишется в сам кадр.'

export const VIDEO_BUDGET_EXHAUSTED_NOTE
  = 'Потолок исчерпан — кадр деградирует до картинки с движением. '
    + 'Если и потолок картинок выбран, задний план остаётся пустым и кадр отдаётся ведущему.'

export const IMAGE_GENERATION_OFF_NOTE
  = 'Выключено — картинки фона не генерируются вовсе: кадр без подходящего фона в библиотеке '
    + 'отдаётся ведущему на весь экран.'

export const STEPWISE_NOTE
  = 'Каждый новый ролик этого профиля будет останавливаться после каждого шага и ждать решения. '
    + 'На отдельном ролике режим можно переопределить.'

export interface EditProfileFormState {
  name: string
  description: string
  isDefault: boolean
  editPrompt: string
  /** Числовые поля живут строками: пустой ввод обязан отличаться от нуля. */
  brollRatio: string
  shotChangeSec: string
  pipEnabled: boolean
  pipPosition: PipPosition
  pipSize: string
  imageGenerationEnabled: boolean
  imageBudgetUsd: string
  generativeVideoEnabled: boolean
  generativeVideoBudgetUsd: string
  generativeVideoResolution: string
  stepwiseApproval: boolean
  llmModelId: string
}

export type EditProfileFormErrors = Partial<Record<keyof EditProfileFormState, string>>

/** Тело POST/PUT `/api/edit-profiles` — ровно поля `EditProfileWriteFields`. */
export interface EditProfileWriteBody {
  name: string
  description: string | null
  isDefault: boolean
  editPrompt: string | null
  brollRatio: number
  shotChangeSec: number
  pipEnabled: boolean
  pipPosition: PipPosition
  pipSize: number
  imageGenerationEnabled: boolean
  imageBudgetUsd: number
  generativeVideoEnabled: boolean
  generativeVideoBudgetUsd: number
  generativeVideoResolution: string
  stepwiseApproval: boolean
  llmModelId: string | null
}

/** Число в поле формы: дробная часть принимается и через запятую. */
export function parseDecimalInput(raw: string): number | null {
  const text = raw.trim().replace(',', '.')
  // `Number('')` — это 0, и без явной проверки пустое денежное поле уехало бы
  // на сервер нулевым потолком, то есть выключило бы генерацию молча.
  if (text.length === 0) return null
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

export function editProfileFormFrom(profile: EditProfile | null): EditProfileFormState {
  return {
    name: profile?.name ?? '',
    description: profile?.description ?? '',
    isDefault: profile?.isDefault ?? false,
    editPrompt: profile?.editPrompt ?? '',
    brollRatio: String(profile?.brollRatio ?? EDIT_PROFILE_DEFAULTS.brollRatio),
    shotChangeSec: String(profile?.shotChangeSec ?? EDIT_PROFILE_DEFAULTS.shotChangeSec),
    pipEnabled: profile?.pipEnabled ?? EDIT_PROFILE_DEFAULTS.pipEnabled,
    pipPosition: profile?.pipPosition ?? EDIT_PROFILE_DEFAULTS.pipPosition,
    pipSize: String(profile?.pipSize ?? EDIT_PROFILE_DEFAULTS.pipSize),
    imageGenerationEnabled: profile?.imageGenerationEnabled ?? EDIT_PROFILE_DEFAULTS.imageGenerationEnabled,
    imageBudgetUsd: (profile?.imageBudgetUsd ?? EDIT_PROFILE_DEFAULTS.imageBudgetUsd).toFixed(2),
    generativeVideoEnabled: profile?.generativeVideoEnabled ?? EDIT_PROFILE_DEFAULTS.generativeVideoEnabled,
    generativeVideoBudgetUsd: (profile?.generativeVideoBudgetUsd ?? EDIT_PROFILE_DEFAULTS.generativeVideoBudgetUsd).toFixed(2),
    generativeVideoResolution: profile?.generativeVideoResolution ?? EDIT_PROFILE_DEFAULTS.generativeVideoResolution,
    stepwiseApproval: profile?.stepwiseApproval ?? EDIT_PROFILE_DEFAULTS.stepwiseApproval,
    llmModelId: profile?.llmModelId ?? '',
  }
}

function inRange(value: number, min: number, max: number): boolean {
  return value >= min && value <= max
}

/**
 * Разбирает форму и одновременно её проверяет.
 *
 * Одна функция, а не пара «validate + build»: разъехавшись, они дали бы
 * ровно тот дефект, ради которого модуль и написан — тело собралось из
 * значения, которое проверка не одобряла.
 */
export function readEditProfileForm(
  form: EditProfileFormState,
): { errors: EditProfileFormErrors, body: EditProfileWriteBody | null } {
  const errors: EditProfileFormErrors = {}

  const name = form.name.trim()
  if (name.length === 0) errors.name = 'Название обязательно'

  const brollRatio = parseDecimalInput(form.brollRatio)
  if (brollRatio === null) errors.brollRatio = 'Введите число'
  else if (!inRange(brollRatio, EDIT_PROFILE_LIMITS.brollRatioMin, EDIT_PROFILE_LIMITS.brollRatioMax)) {
    errors.brollRatio = `Доля перебивок — от ${EDIT_PROFILE_LIMITS.brollRatioMin} до ${EDIT_PROFILE_LIMITS.brollRatioMax}`
  }

  const shotChangeSec = parseDecimalInput(form.shotChangeSec)
  if (shotChangeSec === null) errors.shotChangeSec = 'Введите число'
  else if (shotChangeSec < EDIT_PROFILE_LIMITS.shotChangeSecMin) {
    errors.shotChangeSec = `Не меньше ${EDIT_PROFILE_LIMITS.shotChangeSecMin} с — короче это мигание, а не монтаж`
  }

  const pipSize = parseDecimalInput(form.pipSize)
  if (pipSize === null) errors.pipSize = 'Введите число'
  else if (!inRange(pipSize, EDIT_PROFILE_LIMITS.pipSizeMin, EDIT_PROFILE_LIMITS.pipSizeMax)) {
    errors.pipSize = `Размер окна — от ${EDIT_PROFILE_LIMITS.pipSizeMin} до ${EDIT_PROFILE_LIMITS.pipSizeMax} ширины кадра`
  }

  const imageBudgetUsd = parseDecimalInput(form.imageBudgetUsd)
  if (imageBudgetUsd === null) errors.imageBudgetUsd = 'Введите сумму в долларах'
  else if (imageBudgetUsd < EDIT_PROFILE_LIMITS.budgetMin) {
    errors.imageBudgetUsd = 'Потолок не может быть отрицательным'
  }

  const generativeVideoBudgetUsd = parseDecimalInput(form.generativeVideoBudgetUsd)
  if (generativeVideoBudgetUsd === null) errors.generativeVideoBudgetUsd = 'Введите сумму в долларах'
  else if (generativeVideoBudgetUsd < EDIT_PROFILE_LIMITS.budgetMin) {
    errors.generativeVideoBudgetUsd = 'Потолок не может быть отрицательным'
  }

  if (!Object.prototype.hasOwnProperty.call(PIP_POSITION_LABELS, form.pipPosition)) {
    errors.pipPosition = 'Выберите угол из списка'
  }

  if (!(GENERATIVE_VIDEO_RESOLUTIONS as readonly string[]).includes(form.generativeVideoResolution)) {
    errors.generativeVideoResolution = 'Выберите разрешение из списка'
  }

  if (Object.keys(errors).length > 0) return { errors, body: null }

  return {
    errors,
    body: {
      name,
      // Пустое поле — это `null`, а не пустая строка: сервер различает их, и
      // «описания нет» не должно превращаться в описание из нуля символов.
      description: form.description.trim() || null,
      isDefault: form.isDefault,
      editPrompt: form.editPrompt.trim() || null,
      brollRatio: brollRatio!,
      shotChangeSec: shotChangeSec!,
      pipEnabled: form.pipEnabled,
      pipPosition: form.pipPosition,
      pipSize: pipSize!,
      imageGenerationEnabled: form.imageGenerationEnabled,
      imageBudgetUsd: imageBudgetUsd!,
      generativeVideoEnabled: form.generativeVideoEnabled,
      generativeVideoBudgetUsd: generativeVideoBudgetUsd!,
      generativeVideoResolution: form.generativeVideoResolution,
      stepwiseApproval: form.stepwiseApproval,
      llmModelId: form.llmModelId.trim() || null,
    },
  }
}

/** `0,025 $` — точная мелкая ставка, которую `formatMoney` округлил бы до копеек. */
export function formatRate(usd: number, digits = 3): string {
  return `${usd.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',')} $`
}

/**
 * Подпись под потолком картинок: во что он превращается в кадрах.
 * Ноль называется нулём — это законное значение, и оно означает запрет.
 */
export function describeImageBudget(raw: string): string {
  const usd = parseDecimalInput(raw)
  if (usd === null || usd < 0) return 'Сумма в долларах на один ролик.'
  if (usd === 0) {
    return 'Ноль — ни одной картинки: каждый такой кадр отдаётся ведущему.'
  }
  // Допуск на шум деления: 1,5 / 0,025 не обязано выйти ровно 60 на другой
  // паре чисел, а подпись «59 кадров» под ровным потолком читается как ошибка.
  const frames = Math.floor(usd / IMAGE_USD_REFERENCE + 1e-9)
  return `Хватит примерно на ${frames} ${plural(frames, 'кадр', 'кадра', 'кадров')} `
    + `по ${formatRate(IMAGE_USD_REFERENCE)} за картинку.`
}

/** То же для потолка генеративного видео, но кванты здесь — клипы по 5 секунд. */
export function describeGenerativeVideoBudget(raw: string): string {
  const usd = parseDecimalInput(raw)
  if (usd === null || usd < 0) return 'Сумма в долларах на один ролик.'
  const clipUsd = GENERATIVE_VIDEO_USD_PER_SEC_REFERENCE * GENERATIVE_VIDEO_MIN_SEC
  if (usd < clipUsd) {
    return `Меньше одного клипа: короткий клип ${GENERATIVE_VIDEO_MIN_SEC} с стоит ${formatRate(clipUsd, 2)}.`
  }
  const clips = Math.floor(usd / clipUsd + 1e-9)
  return `Хватит примерно на ${clips} ${plural(clips, 'клип', 'клипа', 'клипов')} `
    + `по ${GENERATIVE_VIDEO_MIN_SEC} с (${formatRate(clipUsd, 2)} за клип).`
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = Math.abs(n) % 100
  const mod10 = mod100 % 10
  if (mod100 >= 11 && mod100 <= 14) return many
  if (mod10 === 1) return one
  if (mod10 >= 2 && mod10 <= 4) return few
  return many
}

export const PIP_POSITION_OPTIONS = (Object.keys(PIP_POSITION_LABELS) as PipPosition[])
  .map(value => ({ value, label: PIP_POSITION_LABELS[value] }))

export const GENERATIVE_VIDEO_RESOLUTION_OPTIONS = GENERATIVE_VIDEO_RESOLUTIONS
  .map(value => ({ value, label: value.replace('x', '×') }))
