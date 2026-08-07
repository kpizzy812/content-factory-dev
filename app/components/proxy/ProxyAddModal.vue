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

// Открывается императивно из карточки списка — своего состояния она не держит.
const isOpen = ref(false)

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
  isOpen.value = true
}

function close() {
  isOpen.value = false
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
      isOpen.value = false
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
    isOpen.value = false
    emit("saved")
    reset()
  } else {
    error.value = "Ошибка создания"
  }
}


const TYPE_OPTIONS = [
  { value: "mobile" as ProxyType, label: "Mobile" },
  { value: "residential" as ProxyType, label: "Residential" },
  { value: "datacenter" as ProxyType, label: "Datacenter" },
]

const PROTOCOL_OPTIONS = [
  { value: "http" as ProxyProtocol, label: "HTTP" },
  { value: "https" as ProxyProtocol, label: "HTTPS" },
  { value: "socks5" as ProxyProtocol, label: "SOCKS5" },
]

const SEGMENT = "h-6 flex-1 cursor-pointer rounded-sm text-sm font-medium transition-colors duration-(--duration-fast) ease-out"
const SEGMENT_ON = "bg-accent text-on-accent"
const SEGMENT_OFF = "text-muted hover:text-fg"

defineExpose({ open, close })
</script>

<template>
  <UiModal :open="isOpen" size="lg" @close="close">
    <template #header>
      {{ isEditMode ? "Редактировать прокси" : "Добавить прокси" }}
    </template>

    <div class="flex flex-col gap-3">
      <p class="text-muted">
        Параметры подключения и метаданные. Поддерживается быстрый ввод строки
        <code class="font-mono text-fg">host:port:user:pass</code>.
      </p>

      <UiField label="Название*">
        <UiInput
          v-model="label"
          maxlength="120"
          :placeholder="suggestedLabel || 'Например: Mobile RU #1'"
        />
        <p
          v-if="suggestedLabel && label.trim() !== suggestedLabel"
          class="mt-1 break-words text-micro text-muted"
        >
          Подсказка:
          <button type="button" class="ml-1 cursor-pointer text-accent-text" @click="applySuggestedLabel">
            {{ suggestedLabel }}
          </button>
        </p>
      </UiField>

      <UiField label="Провайдер">
        <UiSelect v-model="provider" :options="providerOptions" />
      </UiField>

      <UiField label="Тип*">
        <div class="flex rounded-md border border-border bg-card p-0.5">
          <button
            v-for="opt in TYPE_OPTIONS"
            :key="opt.value"
            type="button"
            :class="[SEGMENT, type === opt.value ? SEGMENT_ON : SEGMENT_OFF]"
            @click="type = opt.value"
          >{{ opt.label }}</button>
        </div>
      </UiField>

      <UiField
        label="Протокол*"
        hint="Большинство IPv4/v6 датацентровых и residential — HTTP. Mobile — часто SOCKS5."
      >
        <div class="flex rounded-md border border-border bg-card p-0.5">
          <button
            v-for="opt in PROTOCOL_OPTIONS"
            :key="opt.value"
            type="button"
            :class="[SEGMENT, protocol === opt.value ? SEGMENT_ON : SEGMENT_OFF]"
            @click="protocol = opt.value"
          >{{ opt.label }}</button>
        </div>
      </UiField>

      <UiField hint="Для NodeMaven соответствует флагу ipv4-true в username.">
        <UiCheckbox v-model="ipv4Only" label="IPv4 only (без IPv6)" />
      </UiField>

      <div class="flex items-center gap-2 text-micro text-subtle">
        <span class="h-px flex-1 bg-divider" />
        Доступы
        <span class="h-px flex-1 bg-divider" />
      </div>

      <UiField
        label="Быстрый ввод host:port:user:pass"
        hint="Поля заполнятся автоматически. Распознаются: схема (http/https/socks5), тип (mobile/residential), страна (country-us), регион (region-california), IPv4-only (ipv4-true), session ID и filter из NodeMaven-style username."
      >
        <UiInput
          v-model="shortcut"
          mono
          placeholder="socks5://user:pass@host:port или host:port:user:pass"
        />
      </UiField>

      <div class="grid grid-cols-1 gap-2 md:grid-cols-3">
        <UiField :label="`Host${isEditMode ? '' : '*'}`" class="md:col-span-2">
          <UiInput
            v-model="host"
            mono
            :placeholder="isEditMode ? 'оставьте пустым, чтобы не менять' : 'proxy.example.com'"
          />
        </UiField>
        <UiField :label="`Port${isEditMode ? '' : '*'}`">
          <UiInput v-model.number="port" type="number" min="1" max="65535" placeholder="8080" />
        </UiField>
      </div>

      <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
        <UiField label="Username">
          <UiInput
            v-model="username"
            mono
            autocomplete="off"
            :placeholder="isEditMode ? '••• (не меняется)' : ''"
          />
        </UiField>
        <UiField label="Password">
          <UiInput
            v-model="password"
            type="password"
            autocomplete="new-password"
            :placeholder="isEditMode ? '••• (не меняется)' : ''"
          />
        </UiField>
      </div>

      <UiField label="Rotation URL">
        <UiInput
          v-model="rotationUrl"
          mono
          autocomplete="off"
          :placeholder="isEditMode ? '••• (не меняется)' : 'https://...'"
        />
      </UiField>

      <div class="flex items-center gap-2 text-micro text-subtle">
        <span class="h-px flex-1 bg-divider" />
        Ожидаемая локация
        <span class="h-px flex-1 bg-divider" />
      </div>

      <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
        <UiField label="Страна">
          <UiInput v-model="expectedCountry" placeholder="RU" />
        </UiField>
        <UiField label="Город">
          <UiInput v-model="expectedCity" placeholder="Moscow" />
        </UiField>
      </div>

      <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
        <UiField label="Лимит трафика, GB">
          <UiInput v-model.number="monthlyTrafficGB" type="number" min="0" step="0.1" />
        </UiField>
        <UiField label="Истекает">
          <UiInput v-model="expiresAt" type="date" />
        </UiField>
      </div>

      <UiField label="Заметки">
        <UiTextarea v-model="notes" :rows="2" />
      </UiField>

      <p
        v-if="error"
        class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-danger"
      >
        <Icon name="mingcute:warning-line" class="mt-0.5 shrink-0" />
        <span>{{ error }}</span>
      </p>
    </div>

    <template #footer>
      <UiButton variant="ghost" size="md" @click="close">Отмена</UiButton>
      <UiButton variant="primary" size="md" :loading="isBusy" @click="submit">
        {{ isEditMode ? "Сохранить" : "Создать" }}
      </UiButton>
    </template>
  </UiModal>
</template>
