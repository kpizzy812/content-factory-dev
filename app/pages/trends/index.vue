<script setup lang="ts">
/**
 * Тренды: список, профили парсинга и запуски.
 *
 * Три вкладки, а не три страницы: оператор заводит профиль, запускает его и
 * тут же смотрит, что приехало — разводить это по разделам значит заставить
 * его ходить кругами.
 *
 * Вкладка выбирается адресом (`?tab=profiles`): ссылку на профили дают в чате,
 * и она должна открывать профили, а не список трендов.
 */
definePageMeta({ middleware: 'module-access', moduleSlug: 'trendwatcher' })
useHead({ title: 'Тренды' })

type Tab = 'trends' | 'profiles' | 'runs'

const route = useRoute()
const router = useRouter()
const toast = useToast()

const activeTab = computed<Tab>(() => {
  const value = route.query.tab
  return value === 'profiles' || value === 'runs' ? value : 'trends'
})

function setTab(tab: Tab) {
  router.replace({ query: { ...route.query, tab: tab === 'trends' ? undefined : tab } })
}

// ── Профили ───────────────────────────────────────────────────────────────
const {
  profiles,
  pending: profilesPending,
  createProfile,
  updateProfile,
  deleteProfile,
  runParsing,
  duplicateProfile,
  validateProfile,
  refresh: refreshProfiles,
} = useTrendwatcherProfiles()

const { data: appsData } = useFetch('/api/admin/apps', { key: 'apps-for-profiles' })
const apps = computed<Array<{ id: number; name: string }>>(() =>
  (appsData.value as { data: Array<{ id: number; name: string }> } | null)?.data ?? [],
)

const { activeRuns, isProfileRunning, refresh: refreshActiveRuns } = useTrendwatcherActiveRuns()

// Список активных запусков приезжает только в браузере, а карточки профилей
// рисуются на сервере: без этой отсечки первый клиентский рендер расходился
// бы с разметкой у любого работающего профиля.
const mounted = ref(false)
onMounted(() => { mounted.value = true })

const showForm = ref(false)
const editingProfile = ref<Record<string, unknown> | null>(null)

const scheduleProfile = ref<Record<string, unknown> | null>(null)

const deleteTarget = ref<{ id: number; name: string } | null>(null)
const runTarget = ref<{ id: number; name: string; maxItems: number } | null>(null)

// ── Панели запусков ───────────────────────────────────────────────────────
const runHistoryProfileId = ref<number | undefined>(undefined)
const runHistoryProfileName = ref<string | undefined>(undefined)
const runDetailId = ref<number | null>(null)

function openCreateForm() {
  editingProfile.value = null
  showForm.value = true
}

function openEditForm(id: number) {
  const profile = profiles.value.find(p => p.id === id)
  if (!profile) return
  editingProfile.value = { ...profile }
  showForm.value = true
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
      toast.success('Профиль обновлён')
    }
    else {
      await createProfile(formData)
      toast.success('Профиль создан')
    }
    closeForm()
  }
  catch (err: unknown) {
    toast.error((err as { data?: { message?: string } })?.data?.message ?? 'Не удалось сохранить профиль')
  }
}

async function handleToggle(id: number, enabled: boolean) {
  await updateProfile(id, { enabled })
}

function requestRun(id: number) {
  const profile = profiles.value.find(p => p.id === id)
  if (!profile) return
  runTarget.value = { id, name: profile.name, maxItems: profile.maxItems }
}

async function handleRun() {
  const target = runTarget.value
  runTarget.value = null
  if (!target) return
  try {
    const result = await runParsing(target.id) as { data: { runId: number } }
    toast.success(`Запуск #${result.data.runId} создан`)
    refreshActiveRuns()
  }
  catch (err: unknown) {
    toast.error((err as { data?: { message?: string } })?.data?.message ?? 'Не удалось запустить парсинг')
  }
}

function requestDelete(id: number) {
  const profile = profiles.value.find(p => p.id === id)
  if (profile) deleteTarget.value = { id, name: profile.name }
}

async function handleDelete() {
  const target = deleteTarget.value
  deleteTarget.value = null
  if (!target) return
  try {
    await deleteProfile(target.id)
    toast.success('Профиль удалён')
  }
  catch {
    toast.error('Не удалось удалить профиль')
  }
}

async function handleDuplicate(id: number) {
  try {
    await duplicateProfile(id)
    toast.success('Профиль продублирован')
  }
  catch {
    toast.error('Не удалось продублировать профиль')
  }
}

async function handleValidate(id: number) {
  try {
    await validateProfile(id)
    toast.success('Конфигурация проверена')
  }
  catch (err: unknown) {
    toast.error((err as { data?: { message?: string } })?.data?.message ?? 'Проверка не прошла')
  }
}

function openSchedule(id: number) {
  const profile = profiles.value.find(p => p.id === id)
  if (profile) scheduleProfile.value = { ...profile }
}

function onScheduleSaved() {
  refreshProfiles()
  toast.success('Расписание сохранено')
}

function openRunHistory(profileId?: number) {
  const profile = profileId != null ? profiles.value.find(p => p.id === profileId) : null
  runHistoryProfileId.value = profileId
  runHistoryProfileName.value = profile?.name
  runDetailId.value = null
  setTab('runs')
}

function openRunDetail(runId: number) {
  runDetailId.value = runId
  setTab('runs')
}

// Пока идут запуски, список профилей и трендов обновляется сам: карточка
// показывает состояние прогона, и без опроса она врёт до перезагрузки.
const hasAnyActive = computed(() => activeRuns.value.length > 0)
let profileRefreshTimer: ReturnType<typeof setInterval> | null = null

watch(hasAnyActive, (active) => {
  if (active && !profileRefreshTimer) {
    profileRefreshTimer = setInterval(() => refreshProfiles(), 5000)
  }
  else if (!active && profileRefreshTimer) {
    clearInterval(profileRefreshTimer)
    profileRefreshTimer = null
    refreshProfiles()
  }
}, { immediate: true })

onUnmounted(() => {
  if (profileRefreshTimer) clearInterval(profileRefreshTimer)
})

const TABS: Array<{ key: Tab; label: string; icon: string }> = [
  { key: 'trends', label: 'Тренды', icon: 'mingcute:fire-line' },
  { key: 'profiles', label: 'Профили парсинга', icon: 'mingcute:settings-3-line' },
  { key: 'runs', label: 'Запуски', icon: 'mingcute:history-line' },
]
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- Активные запуски приезжают только в браузере (`server: false`). -->
    <ClientOnly>
      <div
        v-if="activeRuns.length"
        class="flex flex-wrap items-center gap-2 rounded-md border border-info-border bg-info-bg px-2.5 py-2 text-sm text-fg"
      >
        <Icon name="mingcute:loading-line" class="shrink-0 animate-spin text-info" />
        <span class="font-medium">Парсинг идёт: {{ activeRuns.length }}</span>
        <span class="min-w-0 flex-1 truncate text-muted">
          {{ activeRuns.map(r => r.profile.name).join(', ') }}
        </span>
        <UiButton variant="ghost" @click="openRunHistory()">Подробнее</UiButton>
      </div>
    </ClientOnly>

    <div class="flex gap-0.5 border-b border-divider">
      <button
        v-for="tab in TABS"
        :key="tab.key"
        type="button"
        class="flex h-8 cursor-pointer items-center gap-1.5 border-b-2 px-2.5 text-base"
        :class="activeTab === tab.key
          ? 'border-accent font-medium text-fg'
          : 'border-transparent text-muted hover:text-fg'"
        @click="setTab(tab.key)"
      >
        <Icon :name="tab.icon" />
        {{ tab.label }}
        <ClientOnly>
          <span
            v-if="tab.key === 'runs' && activeRuns.length"
            class="tnum ml-0.5 font-mono text-micro text-info"
          >{{ activeRuns.length }}</span>
        </ClientOnly>
      </button>
    </div>

    <TrendListView v-if="activeTab === 'trends'" />

    <div v-else-if="activeTab === 'profiles'" class="flex flex-col gap-3">
      <div class="flex flex-wrap items-center gap-2">
        <span class="tnum font-mono text-sm text-subtle">{{ profiles.length }} профилей</span>
        <span class="flex-1" />
        <UiButton variant="primary" @click="openCreateForm">
          <Icon name="mingcute:add-line" />
          Создать профиль
        </UiButton>
      </div>

      <UiSkeleton v-if="profilesPending && !profiles.length" variant="cards" :count="6" />

      <UiEmptyState
        v-else-if="!profiles.length"
        variant="first"
        title="Профилей парсинга нет"
        description="Профиль описывает, что и где искать: актор Apify, ключевые слова, площадки и порог просмотров."
      />

      <div v-else class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <TrendProfileCard
          v-for="profile in profiles"
          :key="profile.id"
          :profile="profile"
          :is-running="mounted && isProfileRunning(profile.id)"
          @toggle="handleToggle"
          @run="requestRun"
          @edit="openEditForm"
          @delete="requestDelete"
          @duplicate="handleDuplicate"
          @validate="handleValidate"
          @schedule="openSchedule"
          @show-runs="openRunHistory"
          @show-run-detail="openRunDetail"
        />
      </div>
    </div>

    <!-- История и разбор запуска ходят с `server: false`: на сервере они всегда
         в загрузке, а в браузере — уже нет, и Vue бросал поддерево. -->
    <ClientOnly v-else>
      <TrendRunDetail
        v-if="runDetailId"
        :run-id="runDetailId"
        @close="runDetailId = null"
        @show-detail="openRunDetail"
      />
      <TrendRunHistory
        v-else
        :profile-id="runHistoryProfileId"
        :profile-name="runHistoryProfileName"
        @close="setTab('profiles')"
        @show-detail="openRunDetail"
      />
      <template #fallback>
        <UiSkeleton variant="details" :count="6" />
      </template>
    </ClientOnly>

    <UiModal
      :open="showForm"
      size="lg"
      :title="editingProfile ? 'Профиль парсинга' : 'Новый профиль парсинга'"
      @close="closeForm"
    >
      <TrendProfileForm
        :initial-data="editingProfile ?? undefined"
        :apps="apps"
        @submit="handleSubmit"
        @cancel="closeForm"
      />
    </UiModal>

    <TrendScheduleForm
      v-if="scheduleProfile"
      :profile="scheduleProfile as any"
      @close="scheduleProfile = null"
      @saved="onScheduleSaved"
    />

    <UiModal
      :open="!!runTarget"
      size="sm"
      title="Запустить парсинг?"
      @close="runTarget = null"
    >
      <p class="text-sm text-muted">
        Профиль «{{ runTarget?.name }}» соберёт до {{ runTarget?.maxItems }} результатов.
        Прогон тарифицируется Apify: платится за собранные элементы, а не за запуск,
        поэтому остановка на середине деньги за уже собранное не вернёт.
      </p>
      <template #footer>
        <UiButton variant="ghost" @click="runTarget = null">Отмена</UiButton>
        <UiButton variant="primary" @click="handleRun">Запустить</UiButton>
      </template>
    </UiModal>

    <UiModal
      :open="!!deleteTarget"
      size="sm"
      title="Удалить профиль?"
      @close="deleteTarget = null"
    >
      <p class="text-sm text-muted">
        Профиль «{{ deleteTarget?.name }}» и его расписание удалятся. Уже
        импортированные тренды останутся — они живут отдельно от профиля.
      </p>
      <template #footer>
        <UiButton variant="ghost" @click="deleteTarget = null">Отмена</UiButton>
        <UiButton variant="danger" @click="handleDelete">Удалить</UiButton>
      </template>
    </UiModal>
  </div>
</template>
