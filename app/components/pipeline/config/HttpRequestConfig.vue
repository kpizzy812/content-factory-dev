<script setup lang="ts">
const props = defineProps<{
  config: Record<string, any>
}>()

const emit = defineEmits<{
  update: [key: string, value: any]
}>()

const methodOptions = ['GET', 'POST', 'PUT', 'DELETE'].map(m => ({ value: m, label: m }))

const { data: credentialsData } = useFetch<{ data: any[] }>('/api/pipelines/credentials')
const credentials = computed(() => credentialsData.value?.data ?? [])

const credentialOptions = computed(() => [
  { value: '', label: 'Без авторизации' },
  ...credentials.value.map((c: any) => ({ value: c.id, label: `${c.name} (${c.type})` })),
])

const selectedCredential = computed(() => {
  if (!props.config.authCredentialId) return null
  return credentials.value.find((c: any) => c.id === props.config.authCredentialId)
})

// Здоровье учётных данных — доменная подпись при системном тоне: «Отозваны» и
// «Истекают скоро» точнее, чем «Ошибка» и «Предупреждение» из общего словаря.
const HEALTH_META: Record<string, { label: string, tone: string }> = {
  revoked: { label: 'Отозваны', tone: 'bg-danger-bg border-danger-border text-danger' },
  expired: { label: 'Истекли', tone: 'bg-danger-bg border-danger-border text-danger' },
  expiring_soon: { label: 'Истекают скоро', tone: 'bg-warning-bg border-warning-border text-warning' },
  failed_test: { label: 'Ошибка теста', tone: 'bg-warning-bg border-warning-border text-warning' },
  untested: { label: 'Не проверены', tone: 'bg-neutral-bg border-neutral-border text-neutral' },
  healthy: { label: 'OK', tone: 'bg-success-bg border-success-border text-success' },
}

const health = computed(() => {
  const status = selectedCredential.value?.healthStatus as string | undefined
  return status ? HEALTH_META[status] ?? null : null
})

// Шаблонные фигурные скобки держим константой: в текстовом узле Vue читает их
// как интерполяцию.
const urlHint = 'Адрес внешнего API. Поддерживаются шаблоны {{ }} для динамических значений.'

function ruDate(value: string) {
  return new Date(value).toLocaleDateString('ru-RU')
}
</script>

<template>
  <UiField label="Метод">
    <UiSelect
      :model-value="config.method || 'GET'"
      :options="methodOptions"
      @update:model-value="(v) => emit('update', 'method', v)"
    />
    <SharedFieldHint text="HTTP метод запроса. GET — получить данные. POST — отправить данные. PUT — обновить. DELETE — удалить." />
  </UiField>

  <UiField label="URL">
    <UiInput
      :model-value="config.url || ''"
      type="url"
      placeholder="https://api.example.com/data"
      @update:model-value="(v) => emit('update', 'url', v)"
    />
    <SharedFieldHint :text="urlHint" example="https://api.example.com/data" />
  </UiField>

  <UiField label="Авторизация">
    <UiSelect
      :model-value="config.authCredentialId ?? ''"
      :options="credentialOptions"
      @update:model-value="(v) => emit('update', 'authCredentialId', Number(v) || null)"
    />

    <div v-if="selectedCredential" class="mt-1 flex flex-wrap items-center gap-1.5">
      <span
        v-if="health"
        class="inline-flex h-[18px] items-center rounded-sm border px-1.5 text-micro"
        :class="health.tone"
      >{{ health.label }}</span>
      <span v-if="selectedCredential.lastUsedAt" class="text-micro text-subtle">
        Исп.: {{ ruDate(selectedCredential.lastUsedAt) }}
      </span>
      <span v-if="selectedCredential.expiresAt" class="text-micro text-subtle">
        Истекает: {{ ruDate(selectedCredential.expiresAt) }}
      </span>
    </div>

    <SharedFieldHint text="Учётные данные для запроса. Секреты хранятся зашифрованными и не попадают в граф конвейера." />
  </UiField>

  <UiField label="Заголовки (JSON)">
    <UiTextarea
      :model-value="config.headers || ''"
      :rows="3"
      placeholder='{"Content-Type": "application/json"}'
      class="font-mono text-sm"
      @update:model-value="(v) => emit('update', 'headers', v)"
    />
    <SharedFieldHint text="HTTP заголовки в формате JSON. Не вставляйте сюда токены и пароли — для них есть поле «Авторизация»." />
  </UiField>

  <UiField v-if="config.method === 'POST' || config.method === 'PUT'" label="Тело запроса (JSON)">
    <UiTextarea
      :model-value="config.body || ''"
      :rows="4"
      placeholder='{"key": "value"}'
      class="font-mono text-sm"
      @update:model-value="(v) => emit('update', 'body', v)"
    />
    <SharedFieldHint text="Данные запроса в формате JSON. Отправляется только для POST и PUT методов." example='{"key": "value"}' />
  </UiField>
</template>
