<script setup lang="ts">
import type { AccountRow } from './account-row'

/**
 * Пачка аккаунтов: создание и правка.
 *
 * Раньше модалка умела только править существующую (`PUT`), а кнопки создания
 * на странице не было вовсе, хотя `POST /api/account-groups` есть. Теперь оба
 * пути в одном окне — разница только в наличии `id`.
 */
const props = defineProps<{ appId: number }>()

const emit = defineEmits<{ saved: [] }>()

const DISPATCH_MODES = [
  { value: 'round_robin', label: 'По кругу — следующий аккаунт на каждый ролик' },
  { value: 'all', label: 'Во все сразу — один ролик уходит в каждый аккаунт' },
  { value: 'first_active', label: 'В первый активный' },
]

interface GroupPayload {
  id: number
  name: string
  dispatchMode?: string
  members: { socialAccount: { id: number } }[]
}

const isOpen = ref(false)
const saving = ref(false)
const error = ref('')

const groupId = ref<number | null>(null)
const groupName = ref('')
const dispatchMode = ref('round_robin')
const selectedAccountIds = ref<number[]>([])

const { data: accountsData } = useFetch('/api/accounts')
const allAccounts = computed<AccountRow[]>(() => (accountsData.value?.data ?? []) as AccountRow[])

function open(group?: GroupPayload) {
  groupId.value = group?.id ?? null
  groupName.value = group?.name ?? ''
  dispatchMode.value = group?.dispatchMode ?? 'round_robin'
  selectedAccountIds.value = group?.members.map(m => m.socialAccount.id) ?? []
  error.value = ''
  isOpen.value = true
}

function close() {
  isOpen.value = false
}

function toggleAccount(id: number) {
  selectedAccountIds.value = selectedAccountIds.value.includes(id)
    ? selectedAccountIds.value.filter(x => x !== id)
    : [...selectedAccountIds.value, id]
}

async function save() {
  if (!groupName.value.trim()) {
    error.value = 'Название обязательно'
    return
  }

  saving.value = true
  error.value = ''

  try {
    if (groupId.value) {
      await $fetch(`/api/account-groups/${groupId.value}`, {
        method: 'PUT',
        body: {
          name: groupName.value.trim(),
          accountIds: selectedAccountIds.value,
          dispatchMode: dispatchMode.value,
        },
      })
    }
    else {
      await $fetch('/api/account-groups', {
        method: 'POST',
        body: {
          appId: props.appId,
          name: groupName.value.trim(),
          accountIds: selectedAccountIds.value,
          dispatchMode: dispatchMode.value,
        },
      })
    }
    isOpen.value = false
    emit('saved')
  }
  catch (e: unknown) {
    error.value = (e as { data?: { message?: string } })?.data?.message
      ?? (e as Error).message
      ?? 'Не удалось сохранить пачку'
  }
  finally {
    saving.value = false
  }
}

defineExpose({ open, close })
</script>

<template>
  <UiModal
    :open="isOpen"
    :title="groupId ? 'Правка пачки' : 'Новая пачка аккаунтов'"
    size="md"
    @close="close"
  >
    <div class="flex flex-col gap-4">
      <UiField label="Название">
        <UiInput v-model="groupName" placeholder="Например, «Мебель RU»" />
      </UiField>

      <UiField
        label="Раздача роликов"
        hint="Определяет, как пачка распределяет ролики между своими аккаунтами."
      >
        <UiSelect v-model="dispatchMode" :options="DISPATCH_MODES" />
      </UiField>

      <UiField :label="`Аккаунты · выбрано ${selectedAccountIds.length}`">
        <div v-if="allAccounts.length" class="max-h-56 overflow-y-auto rounded-md border border-border">
          <label
            v-for="account in allAccounts"
            :key="account.id"
            class="flex cursor-pointer items-center gap-2.5 border-b border-divider px-2.5 py-2 last:border-b-0 hover:bg-card"
          >
            <input
              type="checkbox"
              class="size-3.5 cursor-pointer accent-(--color-accent)"
              :checked="selectedAccountIds.includes(account.id)"
              @change="toggleAccount(account.id)"
            >
            <span class="min-w-0 flex-1 truncate font-mono text-sm">{{ account.displayName }}</span>
            <UiPlatformBadge :platform="account.platform" />
          </label>
        </div>
        <p v-else class="text-sm text-subtle">Аккаунтов пока нет — пачку будет некем наполнить.</p>
      </UiField>

      <p v-if="error" class="flex items-center gap-2 rounded-md border border-danger-border bg-danger-bg p-2.5 text-sm text-danger">
        <Icon name="mingcute:warning-line" class="shrink-0" />
        {{ error }}
      </p>
    </div>

    <template #footer>
      <UiButton variant="ghost" :disabled="saving" @click="close">Отмена</UiButton>
      <UiButton variant="primary" :loading="saving" @click="save">Сохранить</UiButton>
    </template>
  </UiModal>
</template>
