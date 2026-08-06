<script setup lang="ts">
/**
 * Форма профиля устройства: создание и правка.
 *
 * Поля — списки с фиксированными значениями, а не свободный ввод: расхождение
 * между разрешением, языком и часовым поясом ловит проверка ниже формы, и
 * произвольные строки ей нечем проверять.
 *
 * Отпечаток браузера оператором не редактируется — он хранится скрыто, чтобы
 * смена платформы могла накатить свои значения, а сервер получил валидный набор.
 */
import type {
  DevicePlatformType,
  DeviceProfileCreateInput,
  DeviceProfileDto,
} from '~~/shared/types/device-profile'
import { DEVICE_PLATFORM_TYPES } from '~~/shared/types/device-profile'
import type { ProxyDto } from '~~/shared/types/proxy'
import {
  DEVICE_OS_BY_PLATFORM,
  DEVICE_RESOLUTIONS_BY_PLATFORM,
  DEVICE_LANGUAGES,
  DEVICE_TIMEZONES,
} from '~~/shared/data/device-presets'
import {
  applyPlatformDefaults,
  applyProxyDefaults,
  type PlatformAffectedFields,
} from '~~/shared/utils/device-form-watchers'
import { DEVICE_FINGERPRINT_DEFAULTS } from '~~/shared/schemas/device-fingerprint'

type FingerprintState = PlatformAffectedFields['fingerprint']

const emit = defineEmits<{ saved: [] }>()

const isOpen = ref(false)
const editing = ref<DeviceProfileDto | null>(null)
const { createProfile, updateProfile, isBusy, error } = useDeviceActions()

interface FormState {
  name: string
  platformType: DevicePlatformType
  os: string
  userAgent: string
  screenResolution: string
  language: string
  timezone: string
  proxyId: string
  notes: string
  tags: string[]
  fingerprint: FingerprintState
}

function freshForm(): FormState {
  return {
    name: '',
    platformType: 'desktop',
    os: '',
    userAgent: '',
    screenResolution: '',
    language: '',
    timezone: '',
    proxyId: '',
    notes: '',
    tags: [],
    fingerprint: { ...DEVICE_FINGERPRINT_DEFAULTS },
  }
}

const form = ref<FormState>(freshForm())

// Что оператор уже выбрал руками — такие поля автоподстановка не трогает.
const userTouched = reactive({
  os: false,
  screenResolution: false,
  userAgent: false,
  language: false,
  timezone: false,
  fingerprint: false,
})

const { data: proxiesData, pending: proxiesPending } = useFetch<{ data: ProxyDto[] }>('/api/proxies')
const proxies = computed<ProxyDto[]>(() => proxiesData.value?.data ?? [])

const selectedProxy = computed<ProxyDto | null>(
  () => proxies.value.find(p => p.id === form.value.proxyId) ?? null,
)

const osOptions = computed(() => DEVICE_OS_BY_PLATFORM[form.value.platformType] ?? [])
const resolutionOptions = computed(() => DEVICE_RESOLUTIONS_BY_PLATFORM[form.value.platformType] ?? [])

// Часовые пояса списком с подписью континента: их несколько десятков, и без
// группы выбирать невозможно. UiSelect групп не умеет, поэтому группа уходит в
// подпись пункта.
const timezoneOptions = computed(() =>
  DEVICE_TIMEZONES.map(tz => ({ value: tz.value, label: `${tz.group} · ${tz.label}` })))

function reset() {
  form.value = freshForm()
  userTouched.os = false
  userTouched.screenResolution = false
  userTouched.userAgent = false
  userTouched.language = false
  userTouched.timezone = false
  userTouched.fingerprint = false
  editing.value = null
}

function open(profile?: DeviceProfileDto) {
  reset()
  if (profile) {
    editing.value = profile
    form.value.name = profile.name
    form.value.platformType = profile.platformType
    form.value.os = profile.os ?? ''
    form.value.userAgent = profile.userAgent ?? ''
    form.value.screenResolution = profile.screenResolution ?? ''
    form.value.language = profile.language ?? ''
    form.value.timezone = profile.timezone ?? ''
    form.value.proxyId = profile.proxyId ?? ''
    form.value.notes = profile.notes ?? ''
    form.value.tags = [...profile.tags]
    form.value.fingerprint = { ...DEVICE_FINGERPRINT_DEFAULTS }
    // В правке все заполненные поля считаются выбранными руками.
    userTouched.os = !!profile.os
    userTouched.screenResolution = !!profile.screenResolution
    userTouched.userAgent = !!profile.userAgent
    userTouched.language = !!profile.language
    userTouched.timezone = !!profile.timezone
    userTouched.fingerprint = true
  }
  isOpen.value = true
}

function close() {
  isOpen.value = false
}

defineExpose({ open, close })

const platformLabels: Record<DevicePlatformType, string> = {
  desktop: 'Компьютер',
  mobile_android: 'Телефон · Android',
  mobile_ios: 'Телефон · iOS',
}

// Логика подстановки живёт в shared/utils/device-form-watchers — она покрыта
// тестами и одинакова для формы и для импорта.
watch(() => form.value.platformType, (newPlatform, oldPlatform) => {
  if (!newPlatform) return
  const changes = applyPlatformDefaults(
    {
      os: form.value.os,
      screenResolution: form.value.screenResolution,
      userAgent: form.value.userAgent,
      fingerprint: form.value.fingerprint,
    },
    newPlatform,
    oldPlatform ?? null,
    {
      os: userTouched.os,
      screenResolution: userTouched.screenResolution,
      userAgent: userTouched.userAgent,
      fingerprint: userTouched.fingerprint,
    },
  )
  if (changes.os !== undefined) form.value.os = changes.os
  if (changes.screenResolution !== undefined) form.value.screenResolution = changes.screenResolution
  if (changes.userAgent !== undefined) form.value.userAgent = changes.userAgent
  if (changes.fingerprint !== undefined) form.value.fingerprint = changes.fingerprint
})

watch(() => form.value.proxyId, (newProxyId) => {
  if (!newProxyId) return
  const proxy = proxies.value.find(p => p.id === newProxyId)
  if (!proxy) return
  const changes = applyProxyDefaults(
    { language: form.value.language, timezone: form.value.timezone },
    { expectedCountry: proxy.expectedCountry, expectedCity: proxy.expectedCity },
    { language: userTouched.language, timezone: userTouched.timezone },
  )
  if (changes.language !== undefined) form.value.language = changes.language
  if (changes.timezone !== undefined) form.value.timezone = changes.timezone
})

async function submit() {
  if (!form.value.name.trim()) return

  const payload: DeviceProfileCreateInput & { fingerprint: FingerprintState } = {
    name: form.value.name.trim(),
    platformType: form.value.platformType,
    os: form.value.os.trim() || null,
    userAgent: form.value.userAgent.trim() || null,
    screenResolution: form.value.screenResolution.trim() || null,
    language: form.value.language.trim() || null,
    timezone: form.value.timezone.trim() || null,
    proxyId: form.value.proxyId || null,
    notes: form.value.notes.trim() || null,
    tags: form.value.tags,
    fingerprint: form.value.fingerprint,
  }

  const result = editing.value
    ? await updateProfile(editing.value.id, payload)
    : await createProfile(payload)

  if (result) {
    emit('saved')
    close()
  }
}
</script>

<template>
  <UiModal
    :open="isOpen"
    :title="editing ? 'Профиль устройства' : 'Новый профиль устройства'"
    size="lg"
    @close="close"
  >
    <div class="flex flex-col gap-3">
      <p class="text-sm text-muted">
        Здесь задаётся идентичность профиля для постинга. Параметры самого устройства
        подтягивает провайдер при синхронизации.
      </p>

      <UiField label="Имя профиля">
        <UiInput v-model="form.name" placeholder="Например, ig-account-1" />
      </UiField>

      <div class="grid gap-3 sm:grid-cols-2">
        <UiField label="Платформа">
          <UiSelect
            v-model="form.platformType"
            :options="DEVICE_PLATFORM_TYPES.map(p => ({ value: p, label: platformLabels[p] }))"
          />
        </UiField>

        <UiField label="Система">
          <UiSelect
            v-model="form.os"
            placeholder="Не указана"
            :options="osOptions.map(o => ({ value: o.value, label: o.label }))"
            @update:model-value="userTouched.os = true"
          />
        </UiField>

        <UiField label="Разрешение">
          <UiSelect
            v-model="form.screenResolution"
            placeholder="Не указано"
            :options="resolutionOptions.map(r => ({ value: r.value, label: r.label }))"
            @update:model-value="userTouched.screenResolution = true"
          />
        </UiField>

        <UiField label="Язык">
          <UiSelect
            v-model="form.language"
            placeholder="Не указан"
            :options="DEVICE_LANGUAGES.map(l => ({ value: l.value, label: l.label }))"
            @update:model-value="userTouched.language = true"
          />
        </UiField>
      </div>

      <UiField label="Часовой пояс">
        <UiSelect
          v-model="form.timezone"
          placeholder="Не указан"
          :options="timezoneOptions"
          @update:model-value="userTouched.timezone = true"
        />
      </UiField>

      <UiField label="Прокси" hint="Страна прокси решает, можно ли привязывать аккаунты">
        <div v-if="proxiesPending" class="flex items-center gap-2 text-sm text-muted">
          <Icon name="mingcute:loading-line" class="animate-spin" />
          Загружаем прокси
        </div>
        <UiSelect
          v-else
          v-model="form.proxyId"
          placeholder="Без прокси"
          :options="proxies.map(p => ({
            value: p.id,
            label: [p.label, p.type, p.status, p.expectedCountry].filter(Boolean).join(' · '),
          }))"
        />
      </UiField>

      <UiField label="Теги" hint="Новый тег добавляется вводом и Enter">
        <SharedTagPicker
          v-model="form.tags"
          endpoint="/api/device-profiles/tags"
          :allow-create="false"
          placeholder="us, instagram, основной"
        />
      </UiField>

      <UiField label="Заметки">
        <UiTextarea v-model="form.notes" :rows="2" placeholder="План прогрева, особенности" />
      </UiField>

      <DeviceSanityPanel
        :platform-type="form.platformType"
        :screen-resolution="form.screenResolution"
        :language="form.language"
        :timezone="form.timezone"
        :user-agent="form.userAgent"
        :proxy="selectedProxy"
      />

      <p
        v-if="error"
        role="alert"
        class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
      >
        <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
        <span>{{ error }}</span>
      </p>
    </div>

    <template #footer>
      <UiButton variant="ghost" :disabled="isBusy" @click="close">Отмена</UiButton>
      <UiButton
        variant="primary"
        :disabled="!form.name.trim()"
        :loading="isBusy"
        @click="submit"
      >
        {{ editing ? 'Сохранить' : 'Создать' }}
      </UiButton>
    </template>
  </UiModal>
</template>
