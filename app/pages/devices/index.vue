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
  <div class="space-y-6">
    <!-- Заголовок -->
    <div class="flex items-center justify-between flex-wrap gap-3">
      <div>
        <h1 class="text-2xl font-bold text-base-content">Устройства DuoPlus</h1>
        <p class="text-sm text-base-content/60 mt-1">
          Всего: {{ totalCount }} · Синхронизировано: {{ syncedCount }} · Проблемы: {{ conflictCount }}
        </p>
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        <button
          class="btn btn-sm btn-ghost gap-1"
          :disabled="isSyncing"
          @click="runSync"
        >
          <span v-if="isSyncing" class="loading loading-spinner loading-xs" />
          <Icon v-else name="mingcute:refresh-3-line" />
          {{ isSyncing ? "Синхронизирую..." : "Синхронизация" }}
        </button>
        <button class="btn btn-primary btn-sm gap-1" @click="onCreate">
          <Icon name="mingcute:add-line" />
          Создать профиль
        </button>
      </div>
    </div>

    <div
      v-if="syncSummary"
      role="alert"
      class="alert text-sm"
      :class="syncSummary.errors === 0 ? 'alert-success alert-soft' : 'alert-warning alert-soft'"
    >
      <Icon
        :name="syncSummary.errors === 0 ? 'mingcute:check-circle-line' : 'mingcute:warning-line'"
      />
      <span>
        Синхронизация завершена: импортировано {{ syncSummary.imported }},
        обновлено {{ syncSummary.updated }},
        конфликтов {{ syncSummary.conflicted }}<template v-if="syncSummary.skipped > 0">,
        пропущено дубликатов {{ syncSummary.skipped }}</template><template v-if="syncSummary.errors > 0">,
        ошибок {{ syncSummary.errors }}</template>
        (всего в облаке: {{ syncSummary.total }})
      </span>
      <button class="btn btn-xs btn-ghost ml-auto" @click="syncSummary = null">
        <Icon name="mingcute:close-line" />
      </button>
    </div>

    <!-- Фильтры -->
    <div class="card bg-base-100 shadow-sm">
      <div class="card-body p-4 gap-3">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-2">
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Поиск</legend>
            <!--
              Chrome MacBook агрессивно игнорирует autocomplete=off на одиночных
              input - autofill подкидывает сохранённый email/password из других
              форм проекта (login и т.п.). Все стандартные
              атрибуты (autocomplete=off, data-form-type, data-1p-ignore) не
              помогают на Mac Chrome.
              Рабочий приём 2026: HONEYPOT - скрытые fake username+password
              inputs ВЫШЕ нашего search. Chrome autofill заполнит первое
              совпадающее поле формы, наш search остаётся чистым. Поля скрыты
              через style (не display:none - Chrome игнорирует display:none
              fields для autofill), tabindex=-1 убирает их из tab-навигации,
              aria-hidden=true убирает из screen-reader.
            -->
            <input
              type="text"
              name="username"
              autocomplete="username"
              tabindex="-1"
              aria-hidden="true"
              style="position:absolute;opacity:0;height:0;width:0;pointer-events:none"
            />
            <input
              type="password"
              name="password"
              autocomplete="current-password"
              tabindex="-1"
              aria-hidden="true"
              style="position:absolute;opacity:0;height:0;width:0;pointer-events:none"
            />
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
              class="input input-sm w-full"
              placeholder="имя, тег, заметка"
            />
          </fieldset>
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Статус sync</legend>
            <select v-model="filters.syncStatus" class="select select-sm w-full">
              <option v-for="opt in syncStatusOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
          </fieldset>
          <fieldset class="fieldset">
            <legend class="fieldset-legend">&nbsp;</legend>
            <button
              class="btn btn-sm btn-ghost"
              @click="
                filters.reset();
                searchInput = '';
              "
            >
              <Icon name="mingcute:close-line" />
              Сбросить
            </button>
          </fieldset>
        </div>
      </div>
    </div>

    <div v-if="pending" class="flex justify-center py-12">
      <span class="loading loading-spinner loading-lg" />
    </div>

    <div v-else-if="error" role="alert" class="alert alert-error">
      <Icon name="mingcute:warning-line" />
      <span>Ошибка загрузки: {{ error.message }}</span>
    </div>

    <SharedEmptyState
      v-else-if="profiles.length === 0"
      icon="mingcute:safari-line"
      title="Нет профилей устройств"
      description="Создайте первый профиль или синхронизируйтесь с уже существующим облаком DuoPlus."
    />

    <div v-else class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
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
