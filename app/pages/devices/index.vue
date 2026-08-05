<script setup lang="ts">
import type { DeviceProfileDto, DeviceSyncStatus } from "~~/shared/types/device-profile"

definePageMeta({
  layout: "default",
  middleware: "module-access",
  moduleSlug: "social-upload",
})
useHead({ title: "Устройства DuoPlus" })

const filters = useDeviceFiltersStore()
const { data: profilesData, pending, error, refresh } = useDeviceProfiles()

// Автоматизация устройств — унаследованный контур: при выключенной зоне её API
// отдаёт 404, и это конфигурация, а не поломка.
const { legacyModules, loadLegacyModules } = useLegacyModules()
loadLegacyModules()
const zoneOff = computed(() => !legacyModules.value.deviceAutomation)
const profiles = computed<DeviceProfileDto[]>(() => profilesData.value?.data ?? [])

const { syncFromRemote, isBusy: isSyncing } = useDeviceActions()

const editModalRef = ref<{ open: (p?: DeviceProfileDto) => void }>()
const linkModalRef = ref<{ open: (p: DeviceProfileDto) => void }>()

const searchInput = ref(filters.search)
let searchTimeout: ReturnType<typeof setTimeout> | null = null
watch(searchInput, (val) => {
  if (searchTimeout) clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => {
    filters.search = val
  }, 300)
})

const syncStatusOptions: { value: DeviceSyncStatus | ""; label: string }[] = [
  { value: "", label: "Все" },
  { value: "synced", label: "Синхронизированы" },
  { value: "local_only", label: "Только локально" },
  { value: "remote_only", label: "Только в облаке" },
  { value: "conflict", label: "Конфликты" },
  { value: "deleted_remote", label: "Удалены в облаке" },
  { value: "error", label: "Ошибка" },
]

const syncSummary = ref<{
  imported: number
  updated: number
  conflicted: number
  skipped: number
  errors: number
  total: number
} | null>(null)
const syncSummaryTimer = ref<ReturnType<typeof setTimeout> | null>(null)

async function runSync() {
  syncSummary.value = null
  if (syncSummaryTimer.value) {
    clearTimeout(syncSummaryTimer.value)
    syncSummaryTimer.value = null
  }
  const result = await syncFromRemote()
  if (result) {
    syncSummary.value = result
    syncSummaryTimer.value = setTimeout(() => {
      syncSummary.value = null
    }, 10_000)
  }
  await refresh()
}

function onCreate() {
  editModalRef.value?.open()
}

function onEdit(profile: DeviceProfileDto) {
  editModalRef.value?.open(profile)
}

function onLink(profile: DeviceProfileDto) {
  linkModalRef.value?.open(profile)
}

async function onSaved() {
  await refresh()
}

const totalCount = computed(() => profiles.value.length)
const syncedCount = computed(
  () => profiles.value.filter((p) => p.syncStatus === "synced").length,
)
const conflictCount = computed(
  () =>
    profiles.value.filter(
      (p) =>
        p.syncStatus === "conflict"
        || p.syncStatus === "deleted_remote"
        || p.syncStatus === "error",
    ).length,
)

onBeforeUnmount(() => {
  if (syncSummaryTimer.value) clearTimeout(syncSummaryTimer.value)
})
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-xl font-semibold">Устройства</h1>
      <span class="tnum text-sm text-subtle">{{ totalCount }}</span>
      <span class="flex-1" />
      <UiButton v-if="!zoneOff" :loading="isSyncing" @click="runSync">
        <Icon v-if="!isSyncing" name="mingcute:refresh-3-line" />
        Синхронизировать
      </UiButton>
      <UiButton v-if="!zoneOff" variant="primary" @click="onCreate">
        <Icon name="mingcute:add-line" />
        Создать профиль
      </UiButton>
    </div>

    <div v-if="!zoneOff" class="flex flex-wrap gap-4 text-sm text-muted">
      <span>Синхронизировано <span class="tnum font-mono text-success">{{ syncedCount }}</span></span>
      <span>Конфликтов <span class="tnum font-mono" :class="conflictCount ? 'text-warning' : 'text-fg'">{{ conflictCount }}</span></span>
    </div>

    <p
      v-if="syncSummary"
      class="flex flex-wrap items-center gap-2 rounded-md border p-2.5 text-sm"
      :class="syncSummary.errors === 0
        ? 'border-success-border bg-success-bg text-success'
        : 'border-warning-border bg-warning-bg text-warning'"
    >
      <span>
        Импортировано {{ syncSummary.imported }}, обновлено {{ syncSummary.updated }},
        конфликтов {{ syncSummary.conflicted }}<template v-if="syncSummary.skipped > 0">, пропущено дубликатов {{ syncSummary.skipped }}</template><template v-if="syncSummary.errors > 0">, ошибок {{ syncSummary.errors }}</template>.
        Всего в облаке {{ syncSummary.total }}.
      </span>
      <UiButton icon-only variant="ghost" aria-label="Скрыть" class="ml-auto" @click="syncSummary = null">
        <Icon name="mingcute:close-line" />
      </UiButton>
    </p>

    <div v-if="!zoneOff" class="flex flex-wrap items-end gap-2">
      <UiField label="Поиск" class="max-w-72 flex-1">
        <!--
          Chrome игнорирует autocomplete=off на одиночном input и подставляет в
          него сохранённый логин с формы входа. Рабочий приём — приманка: два
          скрытых поля выше нашего, autofill заполняет первое подходящее и до
          поиска не доходит. Скрыты не через display:none — такие поля Chrome
          для autofill не рассматривает, и приманка перестала бы работать.
        -->
        <input
          type="text"
          name="username"
          autocomplete="username"
          tabindex="-1"
          aria-hidden="true"
          style="position:absolute;opacity:0;height:0;width:0;pointer-events:none"
        >
        <input
          type="password"
          name="password"
          autocomplete="current-password"
          tabindex="-1"
          aria-hidden="true"
          style="position:absolute;opacity:0;height:0;width:0;pointer-events:none"
        >
        <input
          v-model="searchInput"
          type="search"
          role="search"
          name="indigo-profiles-filter-query"
          autocomplete="off"
          data-form-type="other"
          data-1p-ignore="true"
          data-lpignore="true"
          aria-label="Фильтр профилей по имени, тегу или заметке"
          class="h-8 w-full rounded-md border border-border bg-card px-2.5 text-base text-fg outline-offset-1 focus:border-accent"
          placeholder="Имя, тег, заметка"
        >
      </UiField>

      <UiField label="Синхронизация" class="w-56">
        <UiSelect v-model="filters.syncStatus" :options="syncStatusOptions" />
      </UiField>

      <UiButton variant="ghost" @click="filters.reset(); searchInput = ''">Сбросить</UiButton>
    </div>

    <UiEmptyState
      v-if="zoneOff"
      variant="denied"
      title="Автоматизация устройств выключена"
      description="Зона относится к унаследованному контуру и включается флагом LEGACY_DEVICE_AUTOMATION_ENABLED в окружении."
    />

    <UiSkeleton v-else-if="pending && !profiles.length" variant="cards" :count="6" />

    <UiErrorState
      v-else-if="error"
      message="Не удалось загрузить профили устройств."
      :details="error.message"
      @retry="refresh()"
    />

    <UiEmptyState
      v-else-if="!profiles.length"
      variant="first"
      title="Профилей устройств нет"
      description="Создайте профиль или подтяните уже существующие синхронизацией с облаком."
    />

    <div v-else class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <DeviceProfileCard
        v-for="profile in profiles"
        :key="profile.id"
        :profile="profile"
        @updated="onSaved"
        @deleted="onSaved"
        @edit="onEdit"
        @link="onLink"
      />
    </div>

    <DeviceProfileEditModal ref="editModalRef" @saved="onSaved" />
    <DeviceProfileLinkModal ref="linkModalRef" @saved="onSaved" />
  </div>
</template>
