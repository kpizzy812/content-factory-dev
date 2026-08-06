<script setup lang="ts">
/**
 * Telegram. Макет: design-preview/catalog/08-settings-admin.dc.html
 *
 * Вкладки — второй уровень внутри страницы: у каждой свой запрос, и грузить их
 * все разом ради одной незачем. Хлебных крошек нет — путь рисует топбар.
 */
definePageMeta({ middleware: ['admin-access'] })
useHead({ title: 'Telegram' })

const TABS = [
  { key: 'overview', label: 'Обзор' },
  { key: 'diagnostics', label: 'Диагностика' },
  { key: 'templates', label: 'Шаблоны' },
  { key: 'keys', label: 'API-ключи' },
  { key: 'chats', label: 'Чаты' },
  { key: 'deliveries', label: 'Доставки' },
  { key: 'audit', label: 'Аудит' },
] as const

type TabKey = typeof TABS[number]['key']

const activeTab = ref<TabKey>('overview')

const { data: statusData, pending, refresh } = useAdminTelegramStatus()
const status = computed(() => statusData.value?.data ?? null)
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-xl font-semibold">Telegram</h1>
      <span v-if="status" class="tnum font-mono text-sm text-subtle">
        {{ status.chats.total }} чатов · {{ status.chats.alertsEnabled }} с алертами
      </span>
      <span class="flex-1" />
      <UiButton :loading="pending" @click="refresh()">
        <Icon v-if="!pending" name="mingcute:refresh-2-line" />
        Обновить
      </UiButton>
    </div>

    <div class="flex flex-wrap gap-0.5 border-b border-border">
      <button
        v-for="tab in TABS"
        :key="tab.key"
        type="button"
        class="h-7 cursor-pointer border-b-2 px-2.5 text-sm"
        :class="activeTab === tab.key
          ? 'border-accent font-medium text-fg'
          : 'border-transparent text-muted hover:text-fg'"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </div>

    <UiSkeleton v-if="pending && !status" variant="details" :count="6" />

    <template v-else>
      <AdminTelegramOverview
        v-if="activeTab === 'overview'"
        :status="status"
        @test-api="activeTab = 'diagnostics'"
        @navigate="(tab) => { activeTab = tab as TabKey }"
      />
      <AdminTelegramDiagnostics v-else-if="activeTab === 'diagnostics'" />
      <AdminTelegramTemplates v-else-if="activeTab === 'templates'" />
      <AdminTelegramApiKeys v-else-if="activeTab === 'keys'" />
      <AdminTelegramChats v-else-if="activeTab === 'chats'" />
      <AdminTelegramDeliveries v-else-if="activeTab === 'deliveries'" />
      <AdminTelegramAudit v-else-if="activeTab === 'audit'" />
    </template>
  </div>
</template>
