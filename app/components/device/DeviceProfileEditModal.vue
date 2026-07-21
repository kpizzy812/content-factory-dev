<script setup lang="ts">
/**
 * DeviceProfileEditModal — основная форма создания/редактирования device-профиля.
 *
 * R6/R7 (миграция DuoPlus): fingerprint-секция и device-preset selector удалены
 * из UI (браузерная антидетект-функциональность). Параметры устройства (hardware) —
 * Этап 3. Остаются идентичность/платформа/OS/разрешение/locale/прокси/теги/заметки.
 * Fingerprint хранится скрыто (smart-watcher платформы накатывает дефолты), но
 * больше не редактируется оператором.
 *
 * Реструктурирована (см. memory `indigo_form_reshape_done`):
 * - Все поля стали dropdowns с фиксированными values из shared/data/device-presets.
 * - Smart watchers: platformType → defaults, proxyId → language/timezone suggestion.
 * - TagPicker (новый shared) вместо CSV-input.
 * - Sanity-panel — live preview предупреждений.
 */
import type {
  DevicePlatformType,
  DeviceProfileCreateInput,
  DeviceProfileDto,
} from "~~/shared/types/device-profile"
import { DEVICE_PLATFORM_TYPES } from "~~/shared/types/device-profile"
import type { ProxyDto } from "~~/shared/types/proxy"
import {
  DEVICE_OS_BY_PLATFORM,
  DEVICE_RESOLUTIONS_BY_PLATFORM,
  DEVICE_LANGUAGES,
  DEVICE_TIMEZONES,
} from "~~/shared/data/device-presets"
import {
  applyPlatformDefaults,
  applyProxyDefaults,
  type PlatformAffectedFields,
} from "~~/shared/utils/device-form-watchers"
import { DEVICE_FINGERPRINT_DEFAULTS } from "~~/shared/schemas/device-fingerprint"

// Скрытый fingerprint больше не редактируется в UI, но нужен smart-watcher'у
// platformType (накатывает дефолты) и серверу как часть payload (валидируется
// дефолтами на бэкенде). Тип берём из watcher-утилиты (device-form-watchers),
// он реэкспортит DeviceFingerprintDto из device-profile.
type FingerprintState = PlatformAffectedFields["fingerprint"]

const emit = defineEmits<{ saved: [] }>()

// Используем native <dialog>.showModal() (а не fake :class="modal-open"):
// модалка открывается ИЗНУТРИ AccountEditModal который сам native dialog.showModal().
// Native top-layer перебивает любой z-index - fake-modal с position:fixed
// рендерится ПОЗАДИ родительского native dialog (наблюдалось 2026-05-25).
// showModal() пушит в top-layer стек, последняя открытая всегда сверху.
const dialogRef = ref<HTMLDialogElement | null>(null)
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
  // fingerprint больше не редактируется в UI — хранится скрыто, чтобы
  // smart-watcher platformType мог накатывать дефолты, а payload оставался валидным.
  fingerprint: FingerprintState
}

function freshForm(): FormState {
  return {
    name: "",
    platformType: "desktop",
    os: "",
    userAgent: "",
    screenResolution: "",
    language: "",
    timezone: "",
    proxyId: "",
    notes: "",
    tags: [],
    fingerprint: { ...DEVICE_FINGERPRINT_DEFAULTS },
  }
}

const form = ref<FormState>(freshForm())

// Track user-modified fields — чтобы watcher не перезатирал то что юзер уже выбрал
const userTouched = reactive({
  os: false,
  screenResolution: false,
  userAgent: false,
  language: false,
  timezone: false,
  fingerprint: false,
})

const { data: proxiesData, pending: proxiesPending } = useFetch<{ data: ProxyDto[] }>(
  "/api/proxies",
)
const proxies = computed<ProxyDto[]>(() => proxiesData.value?.data ?? [])

const selectedProxy = computed<ProxyDto | null>(
  () => proxies.value.find((p) => p.id === form.value.proxyId) ?? null,
)

const osOptions = computed(() => DEVICE_OS_BY_PLATFORM[form.value.platformType] ?? [])
const resolutionOptions = computed(
  () => DEVICE_RESOLUTIONS_BY_PLATFORM[form.value.platformType] ?? [],
)

// Группировка timezones по континентам
const timezonesGrouped = computed(() => {
  const groups: Record<string, typeof DEVICE_TIMEZONES> = {}
  for (const tz of DEVICE_TIMEZONES) {
    if (!groups[tz.group]) groups[tz.group] = [] as unknown as typeof DEVICE_TIMEZONES
    ;(groups[tz.group] as unknown as Array<(typeof DEVICE_TIMEZONES)[number]>).push(tz)
  }
  return groups
})

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
    form.value.os = profile.os ?? ""
    form.value.userAgent = profile.userAgent ?? ""
    form.value.screenResolution = profile.screenResolution ?? ""
    form.value.language = profile.language ?? ""
    form.value.timezone = profile.timezone ?? ""
    form.value.proxyId = profile.proxyId ?? ""
    form.value.notes = profile.notes ?? ""
    form.value.tags = [...profile.tags]
    // fingerprint держим на дефолтах — оператор его не редактирует, сервер
    // нормализует дефолтами при сохранении (DeviceProfileDto его не несёт).
    form.value.fingerprint = { ...DEVICE_FINGERPRINT_DEFAULTS }
    // В edit-mode помечаем все поля как "touched" — чтобы watcher не перезатёр значения
    userTouched.os = !!profile.os
    userTouched.screenResolution = !!profile.screenResolution
    userTouched.userAgent = !!profile.userAgent
    userTouched.language = !!profile.language
    userTouched.timezone = !!profile.timezone
    userTouched.fingerprint = true
  }
  dialogRef.value?.showModal()
}

function close() {
  dialogRef.value?.close()
}

defineExpose({ open, close })

const platformLabels: Record<DevicePlatformType, string> = {
  desktop: "Desktop",
  mobile_android: "Mobile (Android)",
  mobile_ios: "Mobile (iOS)",
}

// === Smart watchers ===
// Логика вынесена в shared/utils/device-form-watchers.ts ради testability.
// Тесты: tests/unit/device-form-watchers.spec.ts.

// При смене platformType — подтянуть defaults в пустые/нетронутые поля.
watch(
  () => form.value.platformType,
  (newPlatform, oldPlatform) => {
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
  },
)

// При смене прокси — suggest language/timezone из country/city (если поля пустые).
watch(
  () => form.value.proxyId,
  (newProxyId) => {
    if (!newProxyId) return
    const proxy = proxies.value.find((p) => p.id === newProxyId)
    if (!proxy) return
    const changes = applyProxyDefaults(
      { language: form.value.language, timezone: form.value.timezone },
      { expectedCountry: proxy.expectedCountry, expectedCity: proxy.expectedCity },
      { language: userTouched.language, timezone: userTouched.timezone },
    )
    if (changes.language !== undefined) form.value.language = changes.language
    if (changes.timezone !== undefined) form.value.timezone = changes.timezone
  },
)

// === Submit ===

async function submit() {
  if (!form.value.name.trim()) return

  // Базовый device-payload + скрытый fingerprint (сервер нормализует дефолтами).
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

  let result: DeviceProfileDto | null
  if (editing.value) {
    result = await updateProfile(editing.value.id, payload)
  } else {
    result = await createProfile(payload)
  }

  if (result) {
    emit("saved")
    close()
  }
}
</script>

<template>
  <!--
    Native dialog.showModal() (см. script): пушит в top-layer стек браузера.
    При nested-открытии изнутри AccountEditModal (тоже native showModal) наша
    модалка оказывается выше в стеке и поверх AccountEditModal визуально.
    Teleport убран - не нужен, top-layer независим от DOM-иерархии.
  -->
  <dialog ref="dialogRef" class="modal">
    <div class="modal-box max-w-3xl max-h-[90vh] flex flex-col">
      <h3 class="font-bold text-lg mb-1">
        {{ editing ? "Редактирование профиля устройства" : "Новый профиль устройства" }}
      </h3>
      <p class="text-xs text-base-content/60 mb-4">
        Идентичность профиля для постинга. Параметры устройства подтянет провайдер.
      </p>

      <div class="flex-1 overflow-y-auto space-y-4 pr-1">
        <!-- Storage info: профиль хранится локально, push в облако провайдера — Этап 3. -->
        <div role="alert" class="alert alert-info alert-soft text-sm">
          <Icon name="mingcute:cloud-line" />
          <span>
            Профиль создаётся <b>локально</b>. Публикация в облако провайдера
            (cookies, сессии) появится в <b>Этапе 3</b> миграции.
          </span>
        </div>

        <!-- Identity -->
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Имя профиля *</legend>
          <input
            v-model="form.name"
            type="text"
            class="input md:input-sm w-full"
            placeholder="например, IG-account-1"
            maxlength="120"
          />
        </fieldset>

        <!-- Platform & OS -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Тип платформы</legend>
            <select v-model="form.platformType" class="select md:select-sm w-full">
              <option v-for="p in DEVICE_PLATFORM_TYPES" :key="p" :value="p">
                {{ platformLabels[p] }}
              </option>
            </select>
          </fieldset>

          <fieldset class="fieldset">
            <legend class="fieldset-legend">OS</legend>
            <select
              v-model="form.os"
              class="select md:select-sm w-full"
              @change="userTouched.os = true"
            >
              <option value="">— не указана —</option>
              <option v-for="o in osOptions" :key="o.value" :value="o.value">
                {{ o.label }}
              </option>
            </select>
          </fieldset>
        </div>

        <!-- Screen & locale -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Разрешение</legend>
            <select
              v-model="form.screenResolution"
              class="select md:select-sm w-full"
              @change="userTouched.screenResolution = true"
            >
              <option value="">— не указано —</option>
              <option v-for="r in resolutionOptions" :key="r.value" :value="r.value">
                {{ r.label }}
              </option>
            </select>
          </fieldset>

          <fieldset class="fieldset">
            <legend class="fieldset-legend">Язык</legend>
            <select
              v-model="form.language"
              class="select md:select-sm w-full"
              @change="userTouched.language = true"
            >
              <option value="">— не указан —</option>
              <option v-for="l in DEVICE_LANGUAGES" :key="l.value" :value="l.value">
                {{ l.label }}
              </option>
            </select>
          </fieldset>

          <fieldset class="fieldset md:col-span-2">
            <legend class="fieldset-legend">Часовой пояс</legend>
            <select
              v-model="form.timezone"
              class="select md:select-sm w-full"
              @change="userTouched.timezone = true"
            >
              <option value="">— не указан —</option>
              <optgroup
                v-for="(tzList, groupLabel) in timezonesGrouped"
                :key="groupLabel"
                :label="groupLabel"
              >
                <option v-for="tz in tzList" :key="tz.value" :value="tz.value">
                  {{ tz.label }}
                </option>
              </optgroup>
            </select>
          </fieldset>
        </div>

        <!-- Параметры устройства (hardware/fingerprint) настраиваются в Этапе 3 -->
        <div role="alert" class="alert alert-info alert-soft text-sm">
          <Icon name="mingcute:cellphone-2-line" />
          <span>
            Параметры устройства и fingerprint настраиваются автоматически провайдером.
            Ручная настройка появится в <b>Этапе 3</b> миграции.
          </span>
        </div>

        <!-- Network -->
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Прокси</legend>
          <div v-if="proxiesPending" class="flex items-center gap-2 py-2">
            <span class="loading loading-spinner loading-sm" />
            <span class="text-sm">Загрузка прокси...</span>
          </div>
          <select v-else v-model="form.proxyId" class="select md:select-sm w-full">
            <option value="">Без прокси</option>
            <option v-for="p in proxies" :key="p.id" :value="p.id">
              {{ p.label }} · {{ p.type }} · {{ p.status }}
              <template v-if="p.expectedCountry">· {{ p.expectedCountry }}</template>
            </option>
          </select>
        </fieldset>

        <!-- Meta -->
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Теги</legend>
          <!--
            allow-create=false — пул тегов формируется distinct unnest'ом из
            DeviceProfile.tags. Реального POST endpoint нет (он бы был no-op), поэтому
            не вызываем сеть. Юзер всё равно может ввести новый тег → Enter → он попадёт
            в form.tags и сохранится в БД при save профиля. На следующее открытие любого
            профиля этот тег появится в dropdown.
          -->
          <SharedTagPicker
            v-model="form.tags"
            endpoint="/api/device-profiles/tags"
            :allow-create="false"
            placeholder="Добавить тег (us, instagram, primary)..."
          />
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Заметки</legend>
          <textarea
            v-model="form.notes"
            class="textarea md:textarea-sm w-full"
            rows="2"
            placeholder="План прогрева, особенности..."
          />
        </fieldset>

        <!-- Sanity-panel -->
        <DeviceSanityPanel
          :platform-type="form.platformType"
          :screen-resolution="form.screenResolution"
          :language="form.language"
          :timezone="form.timezone"
          :user-agent="form.userAgent"
          :proxy="selectedProxy"
        />

        <div v-if="error" role="alert" class="alert alert-error alert-soft text-sm">
          <Icon name="mingcute:warning-line" />
          <span>{{ error }}</span>
        </div>
      </div>

      <div class="modal-action mt-4 pt-3 border-t border-base-300 sticky bottom-0 bg-base-100">
        <button class="btn btn-sm btn-ghost" :disabled="isBusy" @click="close">Отмена</button>
        <button
          class="btn btn-sm btn-primary"
          :disabled="isBusy || !form.name.trim()"
          @click="submit"
        >
          <span v-if="isBusy" class="loading loading-spinner loading-xs" />
          {{ editing ? "Сохранить" : "Создать" }}
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button @click="close">close</button>
    </form>
  </dialog>
</template>
