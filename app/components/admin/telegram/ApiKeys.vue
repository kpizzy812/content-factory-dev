<script setup lang="ts">
/**
 * Ключи для вызова наших уведомлений извне.
 *
 * Это не ключи чужих сервисов: те живут в окружении и в интерфейс не выводятся.
 * Эти выпускаются здесь, хранятся у нас и без показа бесполезны — их некуда
 * скопировать. Поэтому значение прячется по умолчанию и открывается по кнопке:
 * ключ на экране виден тому, кто его открыл, а не всем, кто идёт мимо.
 *
 * После ротации старое значение уже не показать, поэтому новое стоит отдельной
 * плашкой, пока человек его не закроет.
 */
interface ApiKey {
  id: number
  key: string
  label: string
  isActive: boolean
  createdAt: string
  lastUsedAt: string | null
  expiresAt: string | null
}

const { data: keysData, refresh } = useAdminTelegramKeys()
const { createKey, updateKey, deleteKey, rotateKey } = useAdminTelegramActions()
const keys = computed<ApiKey[]>(() => (keysData.value as any)?.data ?? keysData.value ?? [])

const toast = useToast()

const showForm = ref(false)
const saving = ref(false)
const formError = ref('')
const deleteTarget = ref<ApiKey | null>(null)
const revealedIds = ref<Set<number>>(new Set())
const copiedId = ref<number | null>(null)
const rotatedKey = ref<{ id: number; key: string } | null>(null)
const form = reactive({ label: '', expiresAt: '' })

function maskKey(key: string): string {
  if (key.length <= 16) return key
  return `${key.slice(0, 8)}•••${key.slice(-4)}`
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

function toggleReveal(id: number) {
  const next = new Set(revealedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  revealedIds.value = next
}

async function copyToClipboard(text: string, id: number) {
  try {
    await navigator.clipboard.writeText(text)
    copiedId.value = id
    setTimeout(() => { copiedId.value = null }, 2000)
  }
  catch {
    toast.error('Буфер обмена недоступен')
  }
}

function openCreate() {
  Object.assign(form, { label: '', expiresAt: '' })
  formError.value = ''
  showForm.value = true
}

async function save() {
  if (!form.label.trim()) {
    formError.value = 'Без назначения ключ через полгода никто не опознает'
    return
  }
  saving.value = true
  formError.value = ''
  try {
    await createKey(form.label.trim(), form.expiresAt || undefined)
    showForm.value = false
    await refresh()
    toast.success('Ключ создан')
  }
  catch (e: unknown) {
    formError.value = (e as Error).message || 'Не удалось создать ключ'
  }
  finally {
    saving.value = false
  }
}

async function toggleActive(key: ApiKey) {
  try {
    await updateKey(key.id, { isActive: !key.isActive })
    await refresh()
  }
  catch (e: unknown) {
    toast.error((e as Error).message || 'Не удалось изменить ключ')
  }
}

async function handleRotate(key: ApiKey) {
  try {
    const res = await rotateKey(key.id) as { key?: string }
    rotatedKey.value = { id: key.id, key: res.key ?? '' }
    await refresh()
  }
  catch (e: unknown) {
    toast.error((e as Error).message || 'Не удалось ротировать ключ')
  }
}

async function handleDelete() {
  const target = deleteTarget.value
  deleteTarget.value = null
  if (!target) return
  try {
    await deleteKey(target.id)
    await refresh()
    toast.success('Ключ удалён')
  }
  catch (e: unknown) {
    toast.error((e as Error).message || 'Не удалось удалить ключ')
  }
}

function menuItems(key: ApiKey) {
  return [
    {
      key: 'toggle',
      label: key.isActive ? 'Отключить' : 'Включить',
      icon: key.isActive ? 'mingcute:pause-line' : 'mingcute:play-line',
    },
    { key: 'rotate', label: 'Ротировать', icon: 'mingcute:refresh-2-line' },
    { key: 'delete', label: 'Удалить ключ', icon: 'mingcute:delete-2-line', danger: true },
  ]
}

function onMenuSelect(action: string, key: ApiKey) {
  if (action === 'toggle') toggleActive(key)
  else if (action === 'rotate') handleRotate(key)
  else if (action === 'delete') deleteTarget.value = key
}

const COLUMNS = 'minmax(160px,1fr) 220px 104px 132px 120px 28px'
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <div class="min-w-0 flex-1">
        <h3 class="text-base font-semibold">API-ключи</h3>
        <p class="text-sm text-subtle">
          Ими внешний код вызывает наши уведомления. Ключи чужих сервисов задаются
          окружением и здесь не показываются.
        </p>
      </div>
      <UiButton variant="primary" @click="openCreate">
        <Icon name="mingcute:add-line" />
        Создать ключ
      </UiButton>
    </div>

    <div
      v-if="rotatedKey"
      class="flex flex-col gap-2 rounded-md border border-warning-border bg-warning-bg px-2.5 py-2"
    >
      <span class="flex items-center gap-2 text-sm text-fg">
        <Icon name="mingcute:key-2-line" class="shrink-0 text-warning" />
        Запишите новый ключ — целиком он больше не покажется
      </span>
      <div class="flex items-center gap-2">
        <code class="min-w-0 flex-1 truncate rounded-sm bg-panel px-2 py-1.5 font-mono text-sm select-all">
          {{ rotatedKey.key }}
        </code>
        <UiButton variant="ghost" @click="copyToClipboard(rotatedKey.key, rotatedKey.id)">
          <Icon :name="copiedId === rotatedKey.id ? 'mingcute:check-line' : 'mingcute:copy-2-line'" />
        </UiButton>
        <UiButton variant="ghost" aria-label="Закрыть" @click="rotatedKey = null">
          <Icon name="mingcute:close-line" />
        </UiButton>
      </div>
    </div>

    <UiEmptyState
      v-if="!keys.length"
      variant="first"
      title="Ключей нет"
      description="Ключ нужен, чтобы внешний код мог отправлять уведомления в Telegram от имени завода."
    />

    <UiTable v-else :columns="COLUMNS" min-width="880px">
      <UiTableHead>
        <span>Назначение</span>
        <span>Ключ</span>
        <span>Состояние</span>
        <span>Использован</span>
        <span>Срок</span>
        <span />
      </UiTableHead>

      <UiTableRow v-for="key in keys" :key="key.id" :clickable="false">
        <span class="min-w-0">
          <span class="block truncate">{{ key.label }}</span>
          <ClientOnly>
            <span class="tnum block font-mono text-micro text-subtle">создан {{ formatDate(key.createdAt) }}</span>
          </ClientOnly>
        </span>

        <span class="flex min-w-0 items-center gap-1">
          <code class="min-w-0 flex-1 truncate font-mono text-sm text-muted">
            {{ revealedIds.has(key.id) ? key.key : maskKey(key.key) }}
          </code>
          <UiButton
            variant="ghost"
            :title="revealedIds.has(key.id) ? 'Скрыть' : 'Показать'"
            @click="toggleReveal(key.id)"
          >
            <Icon :name="revealedIds.has(key.id) ? 'mingcute:eye-close-line' : 'mingcute:eye-line'" />
          </UiButton>
          <UiButton
            variant="ghost"
            :title="copiedId === key.id ? 'Скопировано' : 'Копировать'"
            @click="copyToClipboard(key.key, key.id)"
          >
            <Icon :name="copiedId === key.id ? 'mingcute:check-line' : 'mingcute:copy-2-line'" />
          </UiButton>
        </span>

        <span class="flex items-center gap-1.5">
          <UiStatusBadge :status="key.isActive ? 'done' : 'cancelled'" size="xs" icon-only />
          <span class="text-sm text-muted">{{ key.isActive ? 'работает' : 'отключён' }}</span>
        </span>

        <ClientOnly>
          <span class="tnum truncate font-mono text-sm text-muted">
            {{ key.lastUsedAt ? formatDate(key.lastUsedAt) : 'ни разу' }}
          </span>
          <template #fallback><span /></template>
        </ClientOnly>

        <ClientOnly>
          <span class="tnum truncate font-mono text-sm text-muted">
            {{ key.expiresAt ? formatDate(key.expiresAt) : 'бессрочный' }}
          </span>
          <template #fallback><span /></template>
        </ClientOnly>

        <UiActionMenu :items="menuItems(key)" align="right" @select="onMenuSelect($event, key)" />
      </UiTableRow>
    </UiTable>

    <UiModal :open="showForm" size="sm" title="Новый API-ключ" @close="showForm = false">
      <div class="flex flex-col gap-3">
        <UiField
          label="Назначение"
          hint="Что этим ключом ходит — по нему потом решают, можно ли его отозвать"
          :error="formError || undefined"
        >
          <UiInput v-model="form.label" placeholder="Сборка CI, бот поддержки, внешний планировщик" />
        </UiField>
        <UiField label="Срок действия" hint="Пусто — бессрочный">
          <UiInput v-model="form.expiresAt" type="date" class="max-w-52" />
        </UiField>
      </div>
      <template #footer>
        <UiButton variant="ghost" @click="showForm = false">Отмена</UiButton>
        <UiButton variant="primary" :loading="saving" @click="save">Создать</UiButton>
      </template>
    </UiModal>

    <UiModal :open="!!deleteTarget" size="sm" title="Удалить ключ?" @close="deleteTarget = null">
      <p class="text-sm text-muted">
        Всё, что ходит с ключом «{{ deleteTarget?.label }}», перестанет работать сразу.
        Отменить удаление нельзя — если нужно только приостановить, отключите ключ.
      </p>
      <template #footer>
        <UiButton variant="ghost" @click="deleteTarget = null">Отмена</UiButton>
        <UiButton variant="danger" @click="handleDelete">Удалить</UiButton>
      </template>
    </UiModal>
  </div>
</template>
