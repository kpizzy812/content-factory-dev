<script setup lang="ts">
/**
 * Форма монтажного профиля приложения.
 *
 * Макет: `design-preview/catalog/09-edit-console.dc.html`, секция `#v5`,
 * блоки `EditProfileForm` и `BudgetFieldset`.
 *
 * Две денежные ручки собраны в отдельный блок с рамкой предупреждения и
 * подписаны как потолки НА ОДИН РОЛИК — иначе `imageBudgetUsd: 1.5` читается
 * как «полтора чего-то» и теряется среди долей и секунд. Под каждой суммой
 * сказано, что произойдёт при исчерпании: это не абстрактный лимит, а команда
 * деградировать кадр.
 *
 * Валидация и сборка тела запроса живут в `edit-profile-form-model.ts` и
 * `edit-profile-client.ts`: невалидное денежное значение обязано отклоняться
 * ДО сети, и это проверяется тестом.
 */
import type { EditProfile } from '~~/shared/types/edit-console'
import {
  EDIT_PROFILE_DEFAULTS,
  EDIT_PROFILE_LIMITS,
  GENERATIVE_VIDEO_RESOLUTION_OPTIONS,
  IMAGE_BUDGET_EXHAUSTED_NOTE,
  IMAGE_GENERATION_OFF_NOTE,
  PIP_POSITION_OPTIONS,
  STEPWISE_NOTE,
  VIDEO_BUDGET_EXHAUSTED_NOTE,
  describeGenerativeVideoBudget,
  describeImageBudget,
  editProfileFormFrom,
} from './edit-profile-form-model'
import type { EditProfileFormErrors } from './edit-profile-form-model'
import { EditProfileValidationError, adminErrorText, saveEditProfile } from './edit-profile-client'
import { formatMoney } from '~~/shared/utils/money'

/** Дефолт называется деньгами и берётся из констант, а не переписывается руками. */
const IMAGE_BUDGET_DEFAULT_LABEL = `по умолчанию ${formatMoney(EDIT_PROFILE_DEFAULTS.imageBudgetUsd)}`
const VIDEO_BUDGET_DEFAULT_LABEL = `по умолчанию ${formatMoney(EDIT_PROFILE_DEFAULTS.generativeVideoBudgetUsd)}`

const props = defineProps<{
  appId: number
  /** `null` — создание нового профиля. */
  profile: EditProfile | null
}>()

const emit = defineEmits<{
  saved: [profile: EditProfile]
  cancel: []
}>()

const form = ref(editProfileFormFrom(props.profile))
const errors = ref<EditProfileFormErrors>({})
const saving = ref(false)
const serverError = ref('')

watch(() => props.profile?.id, () => {
  form.value = editProfileFormFrom(props.profile)
  errors.value = {}
  serverError.value = ''
})

const isEdit = computed(() => props.profile !== null)
const imageBudgetHint = computed(() => describeImageBudget(form.value.imageBudgetUsd))
const videoBudgetHint = computed(() => describeGenerativeVideoBudget(form.value.generativeVideoBudgetUsd))

async function submit() {
  saving.value = true
  serverError.value = ''
  errors.value = {}
  try {
    const result = await saveEditProfile($fetch, {
      appId: props.appId,
      profileId: props.profile?.id ?? null,
      form: form.value,
    })
    emit('saved', result.data)
  }
  catch (error) {
    if (error instanceof EditProfileValidationError) {
      // Запрос не уходил: показываем подписи под полями, а не «ошибка сервера».
      errors.value = error.errors
    }
    else {
      serverError.value = adminErrorText(error, 'Не удалось сохранить профиль')
    }
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="overflow-hidden rounded-lg border border-border bg-panel">
    <div class="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5">
      <span class="text-sm font-semibold">
        {{ isEdit ? 'Монтажный профиль' : 'Новый монтажный профиль' }}
      </span>
      <span
        v-if="props.profile?.isDefault"
        class="rounded-sm border border-accent-border bg-accent-bg px-1.5 py-0.5 text-micro text-accent-text"
      >
        по умолчанию
      </span>
      <span v-if="isEdit" class="tnum font-mono text-micro text-subtle">#{{ props.profile?.id }}</span>
    </div>

    <div class="grid gap-3.5 p-3 sm:grid-cols-2">
      <UiField label="Название" :error="errors.name" class="sm:col-span-2">
        <UiInput v-model="form.name" :invalid="!!errors.name" placeholder="Продуктовый, вертикаль" />
      </UiField>

      <UiField label="Описание" hint="Для операторов — чем этот профиль отличается" class="sm:col-span-2">
        <UiInput v-model="form.description" placeholder="Например: спокойный монтаж под длинные ролики" />
      </UiField>

      <UiField
        label="Промт монтажа"
        hint="Уходит модели, которая раскладывает ролик на кадры"
        class="sm:col-span-2"
      >
        <UiTextarea
          v-model="form.editPrompt"
          :rows="2"
          placeholder="Перебивки — только по смыслу реплики. Никаких стоков с людьми в офисе."
        />
      </UiField>

      <UiField
        label="Доля перебивок"
        :error="errors.brollRatio"
        :hint="`${EDIT_PROFILE_LIMITS.brollRatioMin} … ${EDIT_PROFILE_LIMITS.brollRatioMax}, по умолчанию ${EDIT_PROFILE_DEFAULTS.brollRatio}`"
      >
        <UiInput v-model="form.brollRatio" mono :invalid="!!errors.brollRatio" />
      </UiField>

      <UiField
        label="Смена кадра, с"
        :error="errors.shotChangeSec"
        :hint="`Не меньше ${EDIT_PROFILE_LIMITS.shotChangeSecMin}, по умолчанию ${EDIT_PROFILE_DEFAULTS.shotChangeSec}`"
      >
        <UiInput v-model="form.shotChangeSec" mono :invalid="!!errors.shotChangeSec" />
      </UiField>

      <div class="sm:col-span-2">
        <UiCheckbox v-model="form.pipEnabled" label="Картинка в углу (PiP)" />
      </div>

      <UiField label="Угол картинки в углу" :error="errors.pipPosition">
        <UiSelect
          v-model="form.pipPosition"
          :options="PIP_POSITION_OPTIONS"
          :disabled="!form.pipEnabled"
          :invalid="!!errors.pipPosition"
        />
      </UiField>

      <UiField
        label="Размер картинки в углу"
        :error="errors.pipSize"
        :hint="`${EDIT_PROFILE_LIMITS.pipSizeMin} … ${EDIT_PROFILE_LIMITS.pipSizeMax} ширины кадра`"
      >
        <!--
          Текстовые поля не блокируются выключателями сознательно: значение
          проверяется и уходит на сервер в любом случае, а заблокированное поле
          с невалидным текстом оператор уже не смог бы починить.
        -->
        <UiInput v-model="form.pipSize" mono :invalid="!!errors.pipSize" />
      </UiField>
    </div>

    <!-- Денежные ручки: отдельный блок, а не поле в общем ряду. -->
    <section class="mx-3 mb-3 overflow-hidden rounded-md border border-warning-border bg-warning-bg">
      <div class="flex flex-wrap items-center gap-2 border-b border-warning-border px-3 py-2.5">
        <Icon name="mingcute:currency-dollar-line" class="text-warning" />
        <span class="text-sm font-semibold text-warning">Потолки расхода на один ролик</span>
        <span class="flex-1" />
        <span class="text-micro text-muted">Считаются заново на каждом ролике, а не за сутки</span>
      </div>

      <div class="grid gap-3.5 p-3 sm:grid-cols-2">
        <div class="flex flex-col gap-2">
          <UiCheckbox v-model="form.imageGenerationEnabled" label="Генерировать картинки фона" />
          <p v-if="!form.imageGenerationEnabled" class="text-micro text-warning">
            {{ IMAGE_GENERATION_OFF_NOTE }}
          </p>

          <UiField label="Потолок расхода на картинки, $" :error="errors.imageBudgetUsd">
            <div class="relative">
              <UiInput
                v-model="form.imageBudgetUsd"
                mono
                class="tnum pr-7"
                :invalid="!!errors.imageBudgetUsd"
                placeholder="1.50"
              />
              <span class="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm text-subtle">
                $
              </span>
            </div>
          </UiField>
          <p class="text-micro text-muted">
            Доллары на один ролик, {{ IMAGE_BUDGET_DEFAULT_LABEL }}. {{ imageBudgetHint }}
          </p>
          <p class="text-micro text-warning">{{ IMAGE_BUDGET_EXHAUSTED_NOTE }}</p>
        </div>

        <div class="flex flex-col gap-2">
          <UiCheckbox v-model="form.generativeVideoEnabled" label="Генеративное видео на фонах" />
          <p v-if="!form.generativeVideoEnabled" class="text-micro text-warning">
            Выключено — фоны идут картинкой с движением, потолок ниже пока не расходуется.
          </p>

          <UiField label="Потолок генеративного видео, $" :error="errors.generativeVideoBudgetUsd">
            <div class="relative">
              <UiInput
                v-model="form.generativeVideoBudgetUsd"
                mono
                class="tnum pr-7"
                :invalid="!!errors.generativeVideoBudgetUsd"
                placeholder="0.50"
              />
              <span class="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm text-subtle">
                $
              </span>
            </div>
          </UiField>
          <p class="text-micro text-muted">
            Доллары на один ролик, {{ VIDEO_BUDGET_DEFAULT_LABEL }}. {{ videoBudgetHint }}
          </p>
          <p class="text-micro text-warning">{{ VIDEO_BUDGET_EXHAUSTED_NOTE }}</p>
        </div>

        <UiField
          label="Разрешение генеративного видео"
          :error="errors.generativeVideoResolution"
          hint="Работает только при включённом генеративном видео"
          class="sm:col-span-2"
        >
          <UiSelect
            v-model="form.generativeVideoResolution"
            :options="GENERATIVE_VIDEO_RESOLUTION_OPTIONS"
            :disabled="!form.generativeVideoEnabled"
            :invalid="!!errors.generativeVideoResolution"
          />
        </UiField>
      </div>
    </section>

    <div class="flex flex-col gap-2 px-3 pb-3">
      <UiCheckbox v-model="form.stepwiseApproval" label="Пошаговый режим по умолчанию" />
      <p class="pl-6 text-micro text-subtle">{{ STEPWISE_NOTE }}</p>

      <UiField
        label="Модель для плана монтажа"
        hint="Пусто — модель конвейера по умолчанию"
        class="mt-1"
      >
        <UiInput v-model="form.llmModelId" mono placeholder="claude-sonnet-4-5" />
      </UiField>

      <UiCheckbox v-model="form.isDefault" label="Профиль по умолчанию для приложения" />
      <p class="pl-6 text-micro text-subtle">
        Ролики без явно выбранного профиля собираются по нему. Дефолтный профиль в приложении один:
        включение снимет флаг с прежнего.
      </p>
    </div>

    <div
      v-if="serverError"
      role="alert"
      class="mx-3 mb-3 flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
    >
      <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
      <span>{{ serverError }}</span>
    </div>

    <div class="flex justify-end gap-2 border-t border-border bg-card px-3 py-2.5">
      <UiButton variant="ghost" @click="emit('cancel')">Отмена</UiButton>
      <UiButton variant="primary" :loading="saving" @click="submit">
        {{ isEdit ? 'Сохранить профиль' : 'Создать профиль' }}
      </UiButton>
    </div>
  </div>
</template>
