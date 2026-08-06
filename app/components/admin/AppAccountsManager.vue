<script setup lang="ts">
/**
 * Аккаунты и пачки приложения на его карточке.
 *
 * Своя модалка создания пачки здесь дублировала `AccountGroupEditModal` целиком —
 * теперь и создание, и правка идут через неё, а удаление спрашивает
 * подтверждение общей модалкой вместо нативного `<dialog>`.
 */
import { platformMeta } from '~/components/ui/platform-meta'
import type { AccountRow } from '~/components/account/account-row'

const props = defineProps<{ appId: number }>()

const toast = useToast()
const filters = computed(() => ({ appId: props.appId }))

const { data: accountsData, pending: accountsPending, refresh: refreshAccounts } = useAccounts(filters)
const { data: groupsData, pending: groupsPending, refresh: refreshGroups } = useAccountGroups(filters)

const accounts = computed<AccountRow[]>(() => (accountsData.value?.data ?? []) as AccountRow[])
const groups = computed(() => groupsData.value?.data ?? [])

const connectModalRef = ref<{ open: () => void }>()
const groupModalRef = ref<{ open: (group?: unknown) => void }>()
const deleteRef = ref<{ open: () => void, close: () => void, setBusy: (v: boolean) => void }>()

const groupToDelete = ref<{ id: number, name: string } | null>(null)

function askDeleteGroup(group: { id: number, name: string }) {
  groupToDelete.value = { id: group.id, name: group.name }
  deleteRef.value?.open()
}

async function confirmDeleteGroup() {
  if (!groupToDelete.value) return
  deleteRef.value?.setBusy(true)
  try {
    await $fetch(`/api/account-groups/${groupToDelete.value.id}`, { method: 'DELETE' })
    toast.success(`Пачка «${groupToDelete.value.name}» удалена`)
    await refreshGroups()
  }
  catch (e: unknown) {
    toast.error((e as Error).message || 'Не удалось удалить пачку')
  }
  finally {
    deleteRef.value?.setBusy(false)
    deleteRef.value?.close()
    groupToDelete.value = null
  }
}

async function onGroupSaved() {
  await refreshGroups()
  await refreshAccounts()
}

const DISPATCH_LABELS: Record<string, string> = {
  round_robin: 'по кругу',
  all: 'во все сразу',
  first_active: 'в первый активный',
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <section class="flex flex-col gap-3">
      <div class="flex flex-wrap items-center gap-2">
        <h3 class="flex items-center gap-2 font-medium">
          <Icon name="mingcute:share-2-line" />
          Подключённые аккаунты
        </h3>
        <span class="tnum font-mono text-sm text-subtle">{{ accounts.length }}</span>
        <span class="flex-1" />
        <UiButton variant="primary" @click="connectModalRef?.open()">
          <Icon name="mingcute:link-line" />
          Подключить
        </UiButton>
      </div>

      <UiSkeleton v-if="accountsPending && !accounts.length" variant="table" :count="3" />

      <UiEmptyState
        v-else-if="!accounts.length"
        variant="first"
        title="Аккаунтов у приложения нет"
        description="Подключите аккаунт, чтобы публиковать ролики этого приложения в соцсети."
      />

      <UiTable v-else columns="minmax(200px,1fr) 136px 120px 96px 132px" min-width="720px">
        <UiTableHead>
          <span>Аккаунт</span>
          <span>Готовность</span>
          <span>Метод</span>
          <span class="text-right">Публикаций</span>
          <span>Статус</span>
        </UiTableHead>
        <UiTableRow
          v-for="account in accounts"
          :key="account.id"
          density="media"
          @click="navigateTo('/accounts')"
        >
          <span class="flex min-w-0 items-center gap-2">
            <span class="h-4 w-1 shrink-0 rounded-[2px]" :style="{ background: platformMeta(account.platform).color }" />
            <span class="min-w-0">
              <span class="block truncate font-mono text-sm">{{ account.displayName }}</span>
              <span class="block text-micro text-subtle">{{ platformMeta(account.platform).label }}</span>
            </span>
          </span>
          <span><AccountReadinessMarks :account="account" /></span>
          <span class="truncate text-sm text-muted">
            {{ account.postingMethod === 'browser_automation' ? 'устройство' : 'официальный API' }}
          </span>
          <span class="tnum text-right font-mono text-sm">{{ account._count?.uploads ?? 0 }}</span>
          <span><AccountStatusBadge :status="account.status" size="xs" /></span>
        </UiTableRow>
      </UiTable>
    </section>

    <section class="flex flex-col gap-3">
      <div class="flex flex-wrap items-center gap-2">
        <h3 class="flex items-center gap-2 font-medium">
          <Icon name="mingcute:group-line" />
          Пачки аккаунтов
        </h3>
        <span class="tnum font-mono text-sm text-subtle">{{ groups.length }}</span>
        <span class="flex-1" />
        <UiButton :disabled="!accounts.length" @click="groupModalRef?.open()">
          <Icon name="mingcute:add-line" />
          Новая пачка
        </UiButton>
      </div>

      <UiSkeleton v-if="groupsPending && !groups.length" variant="cards" :count="3" />

      <UiEmptyState
        v-else-if="!groups.length"
        variant="first"
        title="Пачек нет"
        description="Пачка задаёт, как один ролик расходится по нескольким аккаунтам."
      />

      <div v-else class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <div
          v-for="group in groups"
          :key="group.id"
          class="flex flex-col gap-2 rounded-lg border border-border bg-panel p-3.5"
        >
          <div class="flex items-start gap-2">
            <div class="min-w-0 flex-1">
              <h4 class="truncate font-medium">{{ group.name }}</h4>
              <p class="text-micro text-subtle">
                Раздача {{ DISPATCH_LABELS[group.dispatchMode] ?? group.dispatchMode }}
              </p>
            </div>
            <span class="tnum shrink-0 rounded-sm border border-neutral-border bg-neutral-bg px-2 py-0.5 font-mono text-micro text-neutral">
              {{ group.activeMembersCount }} из {{ group.members.length }}
            </span>
          </div>

          <div class="flex flex-wrap gap-1">
            <span
              v-for="m in group.members.slice(0, 4)"
              :key="m.id"
              class="max-w-32 truncate rounded-sm border border-border bg-card px-1.5 py-0.5 font-mono text-micro text-muted"
            >
              {{ m.socialAccount.displayName }}
            </span>
            <span v-if="group.members.length > 4" class="rounded-sm border border-divider px-1.5 py-0.5 text-micro text-subtle">
              +{{ group.members.length - 4 }}
            </span>
          </div>

          <div class="flex justify-end gap-2">
            <UiButton @click="groupModalRef?.open(group)">
              <Icon name="mingcute:edit-line" />
              Изменить
            </UiButton>
            <UiButton variant="danger" @click="askDeleteGroup(group)">
              <Icon name="mingcute:delete-2-line" />
              Удалить
            </UiButton>
          </div>
        </div>
      </div>
    </section>

    <AccountConnectModal ref="connectModalRef" :app-id="appId" />
    <AccountGroupEditModal ref="groupModalRef" :app-id="appId" @saved="onGroupSaved" />

    <SharedConfirmModal
      ref="deleteRef"
      title="Удалить пачку?"
      :message="groupToDelete
        ? `Пачка «${groupToDelete.name}» будет удалена. Сами аккаунты останутся подключёнными.`
        : ''"
      confirm-label="Удалить"
      @confirm="confirmDeleteGroup"
    />
  </div>
</template>
