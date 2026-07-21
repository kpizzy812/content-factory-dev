<script setup lang="ts">
import {
  parseProxyString,
  type ProxyCreateInput,
  type ProxyDto,
  type ProxyProtocol,
  type ProxyType,
  type ProxyUpdateInput,
} from "~~/shared/types/proxy"

const emit = defineEmits<{
  saved: []
  cancel: []
}>()

const modalRef = ref<HTMLDialogElement>()

const editingId = ref<string | null>(null)

// Поля формы
const label = ref("")
const provider = ref<string>("")
const type = ref<ProxyType>("residential")
const protocol = ref<ProxyProtocol>("http")
const shortcut = ref("")
const host = ref("")
const port = ref<number | null>(null)
const username = ref("")
const password = ref("")
const rotationUrl = ref("")
const expectedCountry = ref("")
const expectedCity = ref("")
const ipv4Only = ref(false)
const monthlyTrafficGB = ref<number | null>(null)
const expiresAt = ref<string>("")
const notes = ref("")
const suggestedLabel = ref("")

const error = ref("")

const { createProxy, updateProxy, isBusy } = useProxyActions()

const isEditMode = computed(() => editingId.value !== null)

const providerOptions = [
  { value: "", label: "Не указан" },
  { value: "NodeMaven", label: "NodeMaven" },
  { value: "iproyal", label: "IPRoyal" },
  { value: "proxyempire", label: "ProxyEmpire" },
  { value: "mobile_proxy_space", label: "Mobile Proxy Space" },
  { value: "other", label: "Другой" },
]

function reset() {
  editingId.value = null
  label.value = ""
  provider.value = ""
  type.value = "residential"
  protocol.value = "http"
  shortcut.value = ""
  host.value = ""
  port.value = null
  username.value = ""
  password.value = ""
  rotationUrl.value = ""
  expectedCountry.value = ""
  expectedCity.value = ""
  ipv4Only.value = false
  monthlyTrafficGB.value = null
  expiresAt.value = ""
  notes.value = ""
  suggestedLabel.value = ""
  error.value = ""
}

function open(proxy?: ProxyDto) {
  reset()
  if (proxy) {
    editingId.value = proxy.id
    label.value = proxy.label
    provider.value = proxy.provider ?? ""
    type.value = proxy.type
    protocol.value = proxy.protocol
    // host/port в edit-режиме: hostMasked не отправляем; пользователь либо
    // оставляет пустым (не трогать), либо указывает новое значение явно
    port.value = proxy.port
    expectedCountry.value = proxy.expectedCountry ?? ""
    expectedCity.value = proxy.expectedCity ?? ""
    ipv4Only.value = proxy.ipv4Only
    monthlyTrafficGB.value = proxy.monthlyTrafficGB
    if (proxy.expiresAt) {
      const d = new Date(proxy.expiresAt)
      if (!Number.isNaN(d.getTime())) {
        expiresAt.value = d.toISOString().slice(0, 10)
      }
    }
    notes.value = proxy.notes ?? ""
  }
  modalRef.value?.showModal()
}

function close() {
  modalRef.value?.close()
  reset()
  emit("cancel")
}

watch(shortcut, (val) => {
  if (!val) return
  const parsed = parseProxyString(val)
  if (!parsed) return

  // Базовые поля доступа
  if (parsed.protocol) protocol.value = parsed.protocol
  host.value = parsed.host
  port.value = parsed.port
  if (parsed.username) username.value = parsed.username
  if (parsed.password) password.value = parsed.password

  // Метаданные из NodeMaven-style username + auto-detection
  if (parsed.type) type.value = parsed.type
  if (parsed.expectedCountry) expectedCountry.value = parsed.expectedCountry
  if (parsed.expectedCity) expectedCity.value = parsed.expectedCity
  if (parsed.ipv4Only !== undefined) ipv4Only.value = parsed.ipv4Only
  if (parsed.provider) provider.value = parsed.provider

  // Подсказка для label — авто-заполняем только пустое поле
  if (parsed.suggestedLabel) {
    suggestedLabel.value = parsed.suggestedLabel
    if (!label.value.trim()) {
      label.value = parsed.suggestedLabel
    }
  }
})

function applySuggestedLabel() {
  if (suggestedLabel.value) label.value = suggestedLabel.value
}

async function submit() {
  error.value = ""

  if (!label.value.trim()) {
    error.value = "Название обязательно"
    return
  }

  if (isEditMode.value) {
    // Edit: отправляем только то, что пользователь явно изменил
    const update: ProxyUpdateInput = {
      label: label.value.trim(),
      type: type.value,
      protocol: protocol.value,
    }
    if (provider.value !== "") update.provider = provider.value || null
    else update.provider = null
    if (host.value.trim()) update.host = host.value.trim()
    if (port.value !== null) update.port = port.value
    // username/password — если оба пустые, не передаём (не трогаем)
    if (username.value || password.value) {
      update.username = username.value || null
      update.password = password.value || null
    }
    if (rotationUrl.value) update.rotationUrl = rotationUrl.value || null
    update.expectedCountry = expectedCountry.value.trim() || null
    update.expectedCity = expectedCity.value.trim() || null
    update.ipv4Only = ipv4Only.value
    update.monthlyTrafficGB = monthlyTrafficGB.value
    update.expiresAt = expiresAt.value || null
    update.notes = notes.value.trim() || null

    const res = await updateProxy(editingId.value as string, update)
    if (res) {
      modalRef.value?.close()
      emit("saved")
      reset()
    } else {
      error.value = "Ошибка сохранения"
    }
    return
  }

  // Create
  if (!host.value.trim()) {
    error.value = "Host обязателен"
    return
  }
  if (port.value === null || port.value < 1 || port.value > 65535) {
    error.value = "Порт должен быть числом 1..65535"
    return
  }

  const input: ProxyCreateInput = {
    label: label.value.trim(),
    provider: provider.value || null,
    type: type.value,
    protocol: protocol.value,
    host: host.value.trim(),
    port: port.value,
    username: username.value || null,
    password: password.value || null,
    rotationUrl: rotationUrl.value || null,
    expectedCountry: expectedCountry.value.trim() || null,
    expectedCity: expectedCity.value.trim() || null,
    ipv4Only: ipv4Only.value,
    monthlyTrafficGB: monthlyTrafficGB.value,
    expiresAt: expiresAt.value || null,
    notes: notes.value.trim() || null,
  }

  const res = await createProxy(input)
  if (res) {
    modalRef.value?.close()
    emit("saved")
    reset()
  } else {
    error.value = "Ошибка создания"
  }
}

defineExpose({ open, close })
</script>

<template>
  <dialog ref="modalRef" class="modal">
    <div class="modal-box max-w-2xl max-h-[90vh] flex flex-col overflow-x-hidden">
      <h3 class="font-bold text-lg mb-1 shrink-0">
        {{ isEditMode ? "Редактировать прокси" : "Добавить прокси" }}
      </h3>
      <p class="text-xs text-base-content/60 mb-4 shrink-0">
        Параметры подключения и метаданные. Поддерживается быстрый ввод строки <code>host:port:user:pass</code>.
      </p>

      <div class="flex-1 overflow-y-auto pr-1 space-y-3">
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Название*</legend>
          <input
            v-model="label"
            type="text"
            class="input input-sm w-full"
            :placeholder="suggestedLabel || 'Например: Mobile RU #1'"
            maxlength="120"
          />
          <p
            v-if="suggestedLabel && label.trim() !== suggestedLabel"
            class="text-xs text-base-content/60 mt-1 break-words"
          >
            Подсказка:
            <button
              type="button"
              class="link link-primary ml-1"
              @click="applySuggestedLabel"
            >
              {{ suggestedLabel }}
            </button>
          </p>
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Провайдер</legend>
          <select v-model="provider" class="select select-sm w-full">
            <option v-for="opt in providerOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Тип*</legend>
          <div class="flex gap-3 flex-wrap">
            <label class="flex items-center gap-1.5 cursor-pointer">
              <input v-model="type" type="radio" value="mobile" class="radio radio-sm radio-primary" />
              <span class="text-sm">Mobile</span>
            </label>
            <label class="flex items-center gap-1.5 cursor-pointer">
              <input v-model="type" type="radio" value="residential" class="radio radio-sm radio-primary" />
              <span class="text-sm">Residential</span>
            </label>
            <label class="flex items-center gap-1.5 cursor-pointer">
              <input v-model="type" type="radio" value="datacenter" class="radio radio-sm radio-primary" />
              <span class="text-sm">Datacenter</span>
            </label>
          </div>
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Протокол*</legend>
          <div class="flex gap-3 flex-wrap">
            <label class="flex items-center gap-1.5 cursor-pointer">
              <input v-model="protocol" type="radio" value="http" class="radio radio-sm radio-primary" />
              <span class="text-sm">HTTP</span>
            </label>
            <label class="flex items-center gap-1.5 cursor-pointer">
              <input v-model="protocol" type="radio" value="https" class="radio radio-sm radio-primary" />
              <span class="text-sm">HTTPS</span>
            </label>
            <label class="flex items-center gap-1.5 cursor-pointer">
              <input v-model="protocol" type="radio" value="socks5" class="radio radio-sm radio-primary" />
              <span class="text-sm">SOCKS5</span>
            </label>
          </div>
          <p class="text-xs text-base-content/60 mt-1 break-words">
            Большинство IPv4/v6 датацентровых и residential — HTTP. Mobile — часто SOCKS5.
          </p>
        </fieldset>

        <fieldset class="fieldset">
          <label class="flex items-center gap-2 cursor-pointer">
            <input
              v-model="ipv4Only"
              type="checkbox"
              class="checkbox checkbox-sm checkbox-primary"
            />
            <span class="text-sm">IPv4 only (без IPv6)</span>
          </label>
          <p class="text-xs text-base-content/60 mt-1 break-words">
            Для NodeMaven — соответствует флагу `ipv4-true` в username
          </p>
        </fieldset>

        <div class="divider text-xs my-1">Доступы</div>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Быстрый ввод host:port:user:pass</legend>
          <input
            v-model="shortcut"
            type="text"
            class="input input-sm w-full"
            placeholder="socks5://user:pass@host:port или host:port:user:pass"
          />
          <p class="text-xs text-base-content/60 mt-1 break-words">
            Поля заполнятся автоматически. Распознаются: схема (http/https/socks5),
            тип (mobile/residential), страна (country-us), регион (region-california),
            IPv4-only (ipv4-true), session ID и filter из NodeMaven-style username.
          </p>
        </fieldset>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-2">
          <fieldset class="fieldset md:col-span-2">
            <legend class="fieldset-legend">
              Host{{ isEditMode ? "" : "*" }}
            </legend>
            <input
              v-model="host"
              type="text"
              class="input input-sm w-full"
              :placeholder="isEditMode ? 'оставьте пустым, чтобы не менять' : 'proxy.example.com'"
            />
          </fieldset>
          <fieldset class="fieldset">
            <legend class="fieldset-legend">
              Port{{ isEditMode ? "" : "*" }}
            </legend>
            <input
              v-model.number="port"
              type="number"
              min="1"
              max="65535"
              class="input input-sm w-full"
              placeholder="8080"
            />
          </fieldset>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Username</legend>
            <input
              v-model="username"
              type="text"
              class="input input-sm w-full"
              :placeholder="isEditMode ? '••• (не меняется)' : ''"
              autocomplete="off"
            />
          </fieldset>
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Password</legend>
            <input
              v-model="password"
              type="password"
              class="input input-sm w-full"
              :placeholder="isEditMode ? '••• (не меняется)' : ''"
              autocomplete="new-password"
            />
          </fieldset>
        </div>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Rotation URL</legend>
          <input
            v-model="rotationUrl"
            type="text"
            class="input input-sm w-full"
            :placeholder="isEditMode ? '••• (не меняется)' : 'https://...'"
            autocomplete="off"
          />
        </fieldset>

        <div class="divider text-xs my-1">Ожидаемая локация</div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Страна</legend>
            <input
              v-model="expectedCountry"
              type="text"
              class="input input-sm w-full"
              placeholder="RU"
            />
          </fieldset>
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Город</legend>
            <input
              v-model="expectedCity"
              type="text"
              class="input input-sm w-full"
              placeholder="Moscow"
            />
          </fieldset>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Лимит трафика, GB</legend>
            <input
              v-model.number="monthlyTrafficGB"
              type="number"
              min="0"
              step="0.1"
              class="input input-sm w-full"
            />
          </fieldset>
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Истекает</legend>
            <input
              v-model="expiresAt"
              type="date"
              class="input input-sm w-full"
            />
          </fieldset>
        </div>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Заметки</legend>
          <textarea
            v-model="notes"
            class="textarea textarea-sm w-full"
            rows="2"
          />
        </fieldset>

        <div v-if="error" role="alert" class="alert alert-error alert-soft">
          <Icon name="mingcute:warning-line" />
          <span>{{ error }}</span>
        </div>
      </div>

      <div class="modal-action mt-4 pt-3 border-t border-base-300 sticky bottom-0 bg-base-100 shrink-0">
        <button class="btn btn-ghost btn-sm" @click="close">Отмена</button>
        <button
          class="btn btn-primary btn-sm"
          :disabled="isBusy"
          @click="submit"
        >
          <span v-if="isBusy" class="loading loading-spinner loading-xs" />
          {{ isEditMode ? "Сохранить" : "Создать" }}
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button @click="close">close</button>
    </form>
  </dialog>
</template>
