<script setup lang="ts">
definePageMeta({
  middleware: ['admin-access'],
})

useHead({ title: 'Telegram' })

const activeTab = ref('overview')

const tabs = [
  { key: 'overview', label: 'Обзор', icon: 'mingcute:dashboard-line' },
  { key: 'diagnostics', label: 'Диагностика', icon: 'mingcute:radar-line' },
  { key: 'templates', label: 'Шаблоны', icon: 'mingcute:file-line' },
  { key: 'keys', label: 'API-ключи', icon: 'mingcute:key-2-line' },
  { key: 'chats', label: 'Чаты', icon: 'mingcute:group-line' },
  { key: 'deliveries', label: 'Доставки', icon: 'mingcute:send-plane-line' },
  { key: 'audit', label: 'Аудит', icon: 'mingcute:history-line' },
]

const { data: statusData, pending: statusPending, refresh: refreshStatus } = useAdminTelegramStatus()
const status = computed(() => statusData.value?.data ?? null)

function handleTestApi() {
  activeTab.value = 'diagnostics'
}

function navigateTab(tab: string) {
  activeTab.value = tab
}
</script>

<template>
  <div class="space-y-4">
    <!-- Breadcrumbs -->
    <div class="breadcrumbs text-sm">
      <ul>
        <li><NuxtLink to="/admin">Админ</NuxtLink></li>
        <li>Telegram</li>
      </ul>
    </div>

    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold text-base-content">Telegram-интеграция</h1>
      <button class="btn btn-sm btn-ghost" @click="refreshStatus()">
        <Icon name="mingcute:refresh-2-line" />
        Обновить
      </button>
    </div>

    <!-- Loading -->
    <div v-if="statusPending" class="flex justify-center py-12">
      <span class="loading loading-spinner loading-lg" />
    </div>

    <template v-else>
      <!-- Tabs -->
      <div role="tablist" class="tabs tabs-bordered">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          role="tab"
          class="tab gap-1"
          :class="{ 'tab-active': activeTab === tab.key }"
          @click="activeTab = tab.key"
        >
          <Icon :name="tab.icon" class="text-sm" />
          {{ tab.label }}
        </button>
      </div>

      <!-- Tab content -->
      <div class="mt-4">
        <AdminTelegramOverview
          v-if="activeTab === 'overview'"
          :status="status"
          @test-api="handleTestApi"
          @navigate="navigateTab"
        />
        <AdminTelegramDiagnostics
          v-if="activeTab === 'diagnostics'"
        />
        <AdminTelegramTemplates
          v-if="activeTab === 'templates'"
        />
        <AdminTelegramApiKeys
          v-if="activeTab === 'keys'"
        />
        <AdminTelegramChats
          v-if="activeTab === 'chats'"
        />
        <AdminTelegramDeliveries
          v-if="activeTab === 'deliveries'"
        />
        <AdminTelegramAudit
          v-if="activeTab === 'audit'"
        />
      </div>
    </template>
  </div>
</template>
