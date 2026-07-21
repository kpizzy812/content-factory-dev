<script setup lang="ts">
const props = defineProps<{
  config: Record<string, any>
}>()

const emit = defineEmits<{
  update: [key: string, value: any]
}>()

const methods = ['GET', 'POST', 'PUT', 'DELETE']

const { data: credentialsData } = useFetch<{ data: any[] }>('/api/pipelines/credentials')
const credentials = computed(() => credentialsData.value?.data ?? [])

const selectedCredential = computed(() => {
  if (!props.config.authCredentialId) return null
  return credentials.value.find((c: any) => c.id === props.config.authCredentialId)
})

const credentialHealth = computed(() => {
  const cred = selectedCredential.value
  if (!cred) return null
  return cred.healthStatus as string | undefined
})

const healthBadgeClass = computed(() => {
  switch (credentialHealth.value) {
    case 'revoked': return 'badge-error'
    case 'expired': return 'badge-error'
    case 'expiring_soon': return 'badge-warning'
    case 'failed_test': return 'badge-warning'
    case 'untested': return 'badge-ghost'
    case 'healthy': return 'badge-success'
    default: return ''
  }
})

const healthLabel = computed(() => {
  switch (credentialHealth.value) {
    case 'revoked': return 'Отозваны'
    case 'expired': return 'Истекли'
    case 'expiring_soon': return 'Истекают скоро'
    case 'failed_test': return 'Ошибка теста'
    case 'untested': return 'Не проверены'
    case 'healthy': return 'OK'
    default: return ''
  }
})
</script>

<template>
  <fieldset class="fieldset">
    <legend class="fieldset-legend">Метод</legend>
    <select
      class="select select-sm w-full"
      :value="config.method || 'GET'"
      @change="emit('update', 'method', ($event.target as HTMLSelectElement).value)"
    >
      <option v-for="m in methods" :key="m" :value="m">{{ m }}</option>
    </select>
    <SharedFieldHint text="HTTP метод запроса. GET — получить данные. POST — отправить данные. PUT — обновить. DELETE — удалить." />
  </fieldset>

  <fieldset class="fieldset">
    <legend class="fieldset-legend">URL</legend>
    <input
      :value="config.url || ''"
      type="url"
      class="input input-sm w-full"
      placeholder="https://api.example.com/data"
      @input="emit('update', 'url', ($event.target as HTMLInputElement).value)"
    />
    <SharedFieldHint text="Адрес внешнего API. Поддерживаются шаблоны {{ }} для динамических значений." example="https://api.example.com/data" />
  </fieldset>

  <fieldset class="fieldset">
    <legend class="fieldset-legend">Авторизация</legend>
    <select
      class="select select-sm w-full"
      :value="config.authCredentialId ?? ''"
      @change="emit('update', 'authCredentialId', Number(($event.target as HTMLSelectElement).value) || null)"
    >
      <option value="">Без авторизации</option>
      <option v-for="c in credentials" :key="c.id" :value="c.id">
        {{ c.name }} ({{ c.type }})
      </option>
    </select>

    <!-- Credential health indicator -->
    <div v-if="selectedCredential" class="flex items-center gap-1.5 mt-1">
      <span v-if="healthLabel" class="badge badge-xs" :class="healthBadgeClass">
        {{ healthLabel }}
      </span>
      <span v-if="selectedCredential.lastUsedAt" class="text-[10px] text-base-content/40">
        Исп.: {{ new Date(selectedCredential.lastUsedAt).toLocaleDateString('ru-RU') }}
      </span>
      <span v-if="selectedCredential.expiresAt" class="text-[10px] text-base-content/40">
        Истекает: {{ new Date(selectedCredential.expiresAt).toLocaleDateString('ru-RU') }}
      </span>
    </div>

    <SharedFieldHint text="Учётные данные для запроса. Секреты хранятся зашифрованными и не попадают в граф конвейера." />
  </fieldset>

  <fieldset class="fieldset">
    <legend class="fieldset-legend">Заголовки (JSON)</legend>
    <textarea
      :value="config.headers || ''"
      class="textarea textarea-sm w-full font-mono text-xs"
      rows="3"
      placeholder='{"Content-Type": "application/json"}'
      @input="emit('update', 'headers', ($event.target as HTMLTextAreaElement).value)"
    />
    <SharedFieldHint text="HTTP заголовки в формате JSON. НЕ вставляйте сюда токены и пароли — используйте поле Авторизация." />
  </fieldset>

  <fieldset
    v-if="config.method === 'POST' || config.method === 'PUT'"
    class="fieldset"
  >
    <legend class="fieldset-legend">Тело запроса (JSON)</legend>
    <textarea
      :value="config.body || ''"
      class="textarea textarea-sm w-full font-mono text-xs"
      rows="4"
      placeholder='{"key": "value"}'
      @input="emit('update', 'body', ($event.target as HTMLTextAreaElement).value)"
    />
    <SharedFieldHint text="Данные запроса в формате JSON. Отправляется только для POST и PUT методов." example='{"key": "value"}' />
  </fieldset>
</template>
