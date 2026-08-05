<script setup lang="ts">
definePageMeta({ middleware: 'module-access', moduleSlug: 'trendwatcher' })
useHead({ title: 'Тренды' })

const activeTab = ref<'trends' | 'profiles' | 'runs'>('trends')

// --- Trends tab ---
const filtersStore = useTrendFiltersStore()

// URL ↔ state sync для runId/pipelineId (из кнопки «К юниту» монитора исполнений)
useRunPipelineFilter(filtersStore)

const { data, pending, error, refresh: refreshTrends } = useTrends(computed(() => filtersStore.query))
const trends = computed(() => data.value?.data ?? [])
const meta = computed(() => data.value?.meta ?? { total: 0, page: 1, perPage: 20, totalPages: 1 })

function onPageUpdate(p: number) {
  filtersStore.page = p
}

function clearRunFilter() {
  filtersStore.runId = undefined
  filtersStore.resetPage()
}

function clearPipelineFilter() {
  filtersStore.pipelineId = undefined
  filtersStore.resetPage()
}

// --- Profiles tab ---
const {
  profiles,
  pending: profilesPending,
  createProfile,
  updateProfile,
  deleteProfile,
  runParsing,
  duplicateProfile,
  refresh: refreshProfiles,
} = useTrendwatcherProfiles()

const { data: appsData } = useFetch('/api/admin/apps', { key: 'apps-for-profiles' })
const apps = computed<Array<{ id: number; name: string }>>(() =>
  (appsData.value as { data: Array<{ id: number; name: string }> } | null)?.data ?? [],
)

// Active runs polling
const { activeRuns, isProfileRunning, refresh: refreshActiveRuns } = useTrendwatcherActiveRuns()

const showForm = ref(false)
const editingProfile = ref<Record<string, unknown> | null>(null)

// --- Panels ---
const showRunHistory = ref(false)
const runHistoryProfileId = ref<number | undefined>(undefined)
const runHistoryProfileName = ref<string | undefined>(undefined)

const showRunDetail = ref(false)
const runDetailId = ref<number>(0)

const showScheduleForm = ref(false)
const scheduleProfile = ref<Record<string, unknown> | null>(null)

// Toast notifications
const toast = ref<{ message: string; type: 'success' | 'error' | 'info' } | null>(null)

function showToast(message: string, type: 'success' | 'error' | 'info' = 'success') {
  toast.value = { message, type }
  setTimeout(() => { toast.value = null }, 4000)
}

// --- Profile actions ---
function openCreateForm() {
  editingProfile.value = null
  showForm.value = true
}

function openEditForm(id: number) {
  const profile = profiles.value.find((p) => p.id === id)
  if (profile) {
    editingProfile.value = { ...profile }
    showForm.value = true
  }
}

function closeForm() {
  showForm.value = false
  editingProfile.value = null
}

async function handleSubmit(formData: {
  appId: number
  name: string
  actorId: string
  keywords: string[]
  platforms: string[]
  language?: string
  geo?: string
  viewCountMin?: number | null
  viewCountMax?: number | null
  maxItems?: number
}) {
  try {
    if (editingProfile.value?.id) {
      await updateProfile(editingProfile.value.id as number, formData)
      showToast('Профиль обновлён')
    } else {
      await createProfile(formData)
      showToast('Профиль создан')
    }
    closeForm()
  } catch {
    showToast('Ошибка сохранения профиля', 'error')
  }
}

async function handleToggle(id: number, enabled: boolean) {
  await updateProfile(id, { enabled })
}

async function handleRun(id: number) {
  try {
    const result = await runParsing(id) as { data: { runId: number } }
    showToast(`Запуск #${result.data.runId} создан`, 'info')
    // Start polling active runs
    refreshActiveRuns()
  } catch (err: unknown) {
    const e = err as { data?: { message?: string } }
    showToast(e?.data?.message ?? 'Ошибка запуска', 'error')
  }
}

async function handleDelete(id: number) {
  if (!confirm('Удалить профиль парсинга?')) return
  await deleteProfile(id)
  showToast('Профиль удалён')
}

async function handleDuplicate(id: number) {
  try {
    await duplicateProfile(id)
    showToast('Профиль дублирован')
  } catch {
    showToast('Ошибка дублирования', 'error')
  }
}

function openSchedule(id: number) {
  const profile = profiles.value.find((p) => p.id === id)
  if (profile) {
    scheduleProfile.value = { ...profile }
    showScheduleForm.value = true
  }
}

function closeSchedule() {
  showScheduleForm.value = false
  scheduleProfile.value = null
}

function onScheduleSaved() {
  refreshProfiles()
  showToast('Расписание сохранено')
}

function openRunHistory(profileId: number) {
  const profile = profiles.value.find((p) => p.id === profileId)
  runHistoryProfileId.value = profileId
  runHistoryProfileName.value = profile?.name
  showRunDetail.value = false
  showRunHistory.value = true
  activeTab.value = 'runs'
}

function openRunHistoryAll() {
  runHistoryProfileId.value = undefined
  runHistoryProfileName.value = undefined
  showRunDetail.value = false
  showRunHistory.value = true
}

function openRunDetail(runId: number) {
  runDetailId.value = runId
  showRunHistory.value = false
  showRunDetail.value = true
  activeTab.value = 'runs'
}

function closeRunPanel() {
  showRunHistory.value = false
  showRunDetail.value = false
}

// Polling-driven refresh of profiles every 5s when there are active runs
const hasAnyActive = computed(() => activeRuns.value.length > 0)
let profileRefreshTimer: ReturnType<typeof setInterval> | null = null

watch(hasAnyActive, (active) => {
  if (active && !profileRefreshTimer) {
    profileRefreshTimer = setInterval(() => refreshProfiles(), 5000)
  } else if (!active && profileRefreshTimer) {
    clearInterval(profileRefreshTimer)
    profileRefreshTimer = null
    refreshProfiles() // Final refresh
    refreshTrends()   // Refresh trends to show newly imported
  }
}, { immediate: true })

onUnmounted(() => {
  if (profileRefreshTimer) clearInterval(profileRefreshTimer)
})
</script>

<template>
  <div class="space-y-4">
    <!-- Active runs banner -->
    <div v-if="activeRuns.length > 0" role="alert" class="alert alert-info">
      <span class="loading loading-ring loading-sm" />
      <div>
        <span class="font-semibold">{{ activeRuns.length }} {{ activeRuns.length === 1 ? 'запуск' : 'запусков' }} в работе</span>
        <span class="text-sm ml-2">
          {{ activeRuns.map((r) => r.profile.name).join(', ') }}
        </span>
      </div>
      <button class="btn btn-sm btn-ghost" @click="openRunHistoryAll">
        Подробнее
      </button>
    </div>

    <!-- DaisyUI Tabs -->
    <div role="tablist" class="tabs tabs-box">
      <button
        role="tab"
        class="tab"
        :class="{ 'tab-active': activeTab === 'trends' }"
        @click="activeTab = 'trends'"
      >
        <Icon name="mingcute:fire-line" class="mr-1" />
        Тренды
      </button>
      <button
        role="tab"
        class="tab"
        :class="{ 'tab-active': activeTab === 'profiles' }"
        @click="activeTab = 'profiles'"
      >
        <Icon name="mingcute:settings-3-line" class="mr-1" />
        Профили парсинга
      </button>
      <button
        role="tab"
        class="tab"
        :class="{ 'tab-active': activeTab === 'runs' }"
        @click="activeTab = 'runs'; openRunHistoryAll()"
      >
        <Icon name="mingcute:history-line" class="mr-1" />
        Запуски
        <span v-if="activeRuns.length > 0" class="badge badge-primary badge-xs ml-1">
          {{ activeRuns.length }}
        </span>
      </button>
    </div>

    <!-- Tab 1: Тренды — эталонный список -->
    <TrendListView v-if="activeTab === 'trends'" />

    <!-- Tab 2: Профили парсинга -->
    <div v-if="activeTab === 'profiles'">
      <!-- Schedule form modal -->
      <TrendScheduleForm
        v-if="showScheduleForm && scheduleProfile"
        :profile="scheduleProfile as any"
        @close="closeSchedule"
        @saved="onScheduleSaved"
      />

      <!-- Форма создания/редактирования -->
      <div v-if="showForm" class="card bg-base-100 shadow-sm mb-4">
        <div class="card-body">
          <h3 class="card-title text-lg mb-2">
            {{ editingProfile ? 'Редактировать профиль' : 'Новый профиль парсинга' }}
          </h3>
          <TrendProfileForm
            :initial-data="editingProfile ?? undefined"
            :apps="apps"
            @submit="handleSubmit"
            @cancel="closeForm"
          />
        </div>
      </div>

      <!-- Кнопка создания -->
      <div v-if="!showForm && !showScheduleForm" class="flex justify-end mb-4">
        <button class="btn btn-primary btn-sm" @click="openCreateForm">
          <Icon name="mingcute:add-line" class="text-lg" />
          Создать профиль
        </button>
      </div>

      <!-- Загрузка -->
      <div v-if="profilesPending" class="flex justify-center py-12">
        <span class="loading loading-spinner loading-lg" />
      </div>

      <!-- Пусто -->
      <SharedEmptyState
        v-else-if="profiles.length === 0"
        icon="mingcute:settings-3-line"
        title="Нет профилей парсинга"
        description="Создайте профиль для автоматического поиска трендов через Apify."
      />

      <!-- Список профилей -->
      <div v-else class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <TrendProfileCard
          v-for="profile in profiles"
          :key="profile.id"
          :profile="profile"
          :is-running="isProfileRunning(profile.id)"
          @toggle="handleToggle"
          @run="handleRun"
          @edit="openEditForm"
          @delete="handleDelete"
          @duplicate="handleDuplicate"
          @schedule="openSchedule"
          @show-runs="openRunHistory"
          @show-run-detail="openRunDetail"
        />
      </div>
    </div>

    <!-- Tab 3: Запуски -->
    <div v-if="activeTab === 'runs'">
      <TrendRunDetail
        v-if="showRunDetail && runDetailId"
        :run-id="runDetailId"
        @close="closeRunPanel(); showRunHistory = true"
      />
      <TrendRunHistory
        v-else
        :profile-id="runHistoryProfileId"
        :profile-name="runHistoryProfileName"
        @close="closeRunPanel(); activeTab = 'profiles'"
        @show-detail="openRunDetail"
      />
    </div>

    <!-- Toast -->
    <div v-if="toast" class="toast toast-end toast-bottom z-50">
      <div
        class="alert"
        :class="{
          'alert-success': toast.type === 'success',
          'alert-error': toast.type === 'error',
          'alert-info': toast.type === 'info',
        }"
      >
        <span>{{ toast.message }}</span>
      </div>
    </div>
  </div>
</template>
