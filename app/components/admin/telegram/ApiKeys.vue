<script setup lang="ts">
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

const showForm = ref(false)
const saving = ref(false)
const error = ref('')
const deleteConfirmId = ref<number | null>(null)
const revealedIds = ref<Set<number>>(new Set())
const copiedId = ref<number | null>(null)
const rotatedKey = ref<{ id: number; key: string } | null>(null)
const form = reactive({ label: '', expiresAt: '' })

function maskKey(key: string): string {
  if (key.length <= 16) return key
  return key.slice(0, 8) + '\u2022\u2022\u2022' + key.slice(-4)
}

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

function toggleReveal(id: number) {
  revealedIds.value.has(id) ? revealedIds.value.delete(id) : revealedIds.value.add(id)
}

async function copyToClipboard(text: string, id: number) {
  await navigator.clipboard.writeText(text)
  copiedId.value = id
  setTimeout(() => { copiedId.value = null }, 2000)
}

function openCreate() {
  Object.assign(form, { label: '', expiresAt: '' })
  error.value = ''
  showForm.value = true
}

async function save() {
  if (!form.label.trim()) { error.value = 'Укажите назначение ключа'; return }
  saving.value = true
  error.value = ''
  try {
    await createKey(form.label.trim(), form.expiresAt || undefined)
    showForm.value = false
    await refresh()
  } catch (e: unknown) {
    error.value = (e as Error).message || 'Ошибка создания ключа'
  } finally { saving.value = false }
}

async function toggleActive(k: ApiKey) {
  try {
    await updateKey(k.id, { isActive: !k.isActive })
    await refresh()
  } catch (e: unknown) { error.value = (e as Error).message || 'Ошибка обновления' }
}

async function confirmRotate(id: number) {
  try {
    const res = await rotateKey(id) as { key?: string }
    rotatedKey.value = { id, key: res.key ?? '' }
    await refresh()
  } catch (e: unknown) { error.value = (e as Error).message || 'Ошибка ротации' }
}

const confirmModalRef = ref<{ open: () => void; close: () => void; setBusy: (v: boolean) => void } | null>(null)

function openDeleteConfirm(id: number) {
  deleteConfirmId.value = id
  confirmModalRef.value?.open()
}

async function onConfirmDelete() {
  const id = deleteConfirmId.value
  if (id === null) return
  confirmModalRef.value?.setBusy(true)
  try {
    await deleteKey(id)
    deleteConfirmId.value = null
    confirmModalRef.value?.close()
    await refresh()
  } catch (e: unknown) {
    error.value = (e as Error).message || 'Ошибка удаления'
  } finally {
    confirmModalRef.value?.setBusy(false)
  }
}
</script>

<template>
  <div class="space-y-4">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h3 class="text-lg font-semibold">API-ключи</h3>
        <p class="text-xs text-base-content/50">Ключи для вызова Telegram-уведомлений из кода, блоков и интеграций</p>
      </div>
      <button class="btn btn-primary btn-sm" @click="openCreate">
        <Icon name="mingcute:add-line" class="size-4" />
        Создать ключ
      </button>
    </div>
    <!-- Error -->
    <div v-if="error && !showForm" role="alert" class="alert alert-error alert-soft">
      <Icon name="mingcute:warning-line" />
      <span>{{ error }}</span>
      <button class="btn btn-ghost btn-xs" @click="error = ''">&#10005;</button>
    </div>
    <!-- Rotated key alert -->
    <div v-if="rotatedKey" role="alert" class="alert alert-warning">
      <Icon name="mingcute:key-2-line" />
      <div class="flex-1">
        <p class="font-semibold text-sm">Запишите новый ключ — он больше не будет показан полностью</p>
        <code class="block mt-1 text-xs font-mono bg-base-100 p-2 rounded break-all select-all">{{ rotatedKey.key }}</code>
      </div>
      <div class="flex gap-1">
        <button class="btn btn-ghost btn-sm" @click="copyToClipboard(rotatedKey.key, rotatedKey.id)">
          <Icon :name="copiedId === rotatedKey.id ? 'mingcute:check-line' : 'mingcute:copy-2-line'" class="size-4" />
        </button>
        <button class="btn btn-ghost btn-xs" @click="rotatedKey = null">&#10005;</button>
      </div>
    </div>
    <!-- Create form -->
    <div v-if="showForm" class="card bg-base-200 shadow">
      <div class="card-body space-y-4">
        <h4 class="card-title text-base">Новый API-ключ</h4>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Назначение</legend>
          <input v-model="form.label" class="input input-sm w-full" placeholder="Назначение ключа, например: CI/CD pipeline" />
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Срок действия (необязательно)</legend>
          <input v-model="form.expiresAt" type="date" class="input input-sm w-full" />
          <p class="text-xs text-base-content/40 mt-0.5">Оставьте пустым для бессрочного ключа</p>
        </fieldset>
        <div v-if="error && showForm" role="alert" class="alert alert-error alert-soft">
          <Icon name="mingcute:warning-line" />
          <span>{{ error }}</span>
        </div>
        <div class="flex gap-2 justify-end">
          <button class="btn btn-ghost btn-sm" @click="showForm = false">Отмена</button>
          <button class="btn btn-primary btn-sm" :disabled="saving" @click="save">
            <span v-if="saving" class="loading loading-spinner loading-sm" />
            Создать
          </button>
        </div>
      </div>
    </div>
    <!-- Keys table -->
    <div v-if="keys.length" class="overflow-x-auto">
      <table class="table table-sm">
        <thead>
          <tr>
            <th>Назначение</th>
            <th>Ключ</th>
            <th>Статус</th>
            <th>Последнее использование</th>
            <th>Срок</th>
            <th>Создан</th>
            <th class="text-right">Действия</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="k in keys" :key="k.id">
            <td class="font-semibold">{{ k.label }}</td>
            <td>
              <div class="flex items-center gap-1">
                <code class="font-mono text-xs">{{ revealedIds.has(k.id) ? k.key : maskKey(k.key) }}</code>
                <div class="tooltip" :data-tip="revealedIds.has(k.id) ? 'Скрыть' : 'Показать'">
                  <button class="btn btn-ghost btn-xs" @click="toggleReveal(k.id)">
                    <Icon :name="revealedIds.has(k.id) ? 'mingcute:eye-close-line' : 'mingcute:eye-line'" class="size-3.5" />
                  </button>
                </div>
                <div class="tooltip" :data-tip="copiedId === k.id ? 'Скопировано!' : 'Копировать'">
                  <button class="btn btn-ghost btn-xs" @click="copyToClipboard(k.key, k.id)">
                    <Icon :name="copiedId === k.id ? 'mingcute:check-line' : 'mingcute:copy-2-line'" class="size-3.5" />
                  </button>
                </div>
              </div>
            </td>
            <td>
              <span :class="['badge badge-sm', k.isActive ? 'badge-success' : 'badge-ghost']">
                {{ k.isActive ? 'Активен' : 'Отключён' }}
              </span>
            </td>
            <td class="text-xs text-base-content/60">{{ k.lastUsedAt ? formatDate(k.lastUsedAt) : 'Не использовался' }}</td>
            <td class="text-xs text-base-content/60">{{ k.expiresAt ? formatDate(k.expiresAt) : 'Бессрочный' }}</td>
            <td class="text-xs text-base-content/60">{{ formatDate(k.createdAt) }}</td>
            <td>
              <div class="flex gap-1 justify-end">
                <div class="tooltip" :data-tip="k.isActive ? 'Отключить' : 'Включить'">
                  <button class="btn btn-ghost btn-xs" @click="toggleActive(k)">
                    <Icon :name="k.isActive ? 'mingcute:toggle-right-line' : 'mingcute:toggle-left-line'" class="size-4" />
                  </button>
                </div>
                <div class="tooltip" data-tip="Ротировать ключ">
                  <button class="btn btn-ghost btn-xs" @click="confirmRotate(k.id)">
                    <Icon name="mingcute:refresh-2-line" class="size-4" />
                  </button>
                </div>
                <div class="tooltip" data-tip="Удалить">
                  <button class="btn btn-ghost btn-xs text-error" @click="openDeleteConfirm(k.id)">
                    <Icon name="mingcute:delete-2-line" class="size-4" />
                  </button>
                </div>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <!-- Empty state -->
    <div v-else-if="!showForm" class="flex flex-col items-center gap-3 py-12 text-base-content/50">
      <Icon name="mingcute:key-2-line" class="text-4xl" />
      <div class="text-center">
        <p class="font-medium">Нет API-ключей</p>
        <p class="text-xs mt-1">Создайте ключ для программного вызова Telegram-уведомлений</p>
      </div>
      <button class="btn btn-primary btn-sm" @click="openCreate">
        <Icon name="mingcute:add-line" class="size-4" />
        Создать первый ключ
      </button>
    </div>
    <!-- Delete confirm modal -->
    <SharedConfirmModal
      ref="confirmModalRef"
      title="Удалить ключ?"
      message="Все интеграции, использующие этот ключ, перестанут работать. Это действие нельзя отменить."
      confirm-label="Удалить"
      variant="danger"
      @confirm="onConfirmDelete"
      @cancel="deleteConfirmId = null"
    />
  </div>
</template>
