<script setup lang="ts">
const store = useAnalyticsFiltersStore()

const accountQuery = computed(() => ({
  ...(store.platform ? { platform: store.platform } : {}),
}))

const { data: accountsData } = useAccounts(accountQuery)
const { data: appsData } = useFetch('/api/apps', { default: () => ({ data: [] }) })

const accounts = computed(() => accountsData.value?.data ?? [])
const apps = computed(() => (appsData.value?.data ?? []) as { id: number; name: string }[])

function onFilterChange() {
  store.resetPage()
}

function onPlatformChange() {
  store.socialAccountId = undefined
  store.resetPage()
}

function onAppChange() {
  store.resetPage()
}
</script>

<template>
  <div class="flex flex-col sm:flex-row gap-3 items-end flex-wrap">
    <fieldset class="fieldset">
      <legend class="fieldset-legend">Приложение</legend>
      <select
        v-model.number="store.appId"
        class="select"
        @change="onAppChange"
      >
        <option :value="undefined">Все приложения</option>
        <option
          v-for="app in apps"
          :key="app.id"
          :value="app.id"
        >
          {{ app.name }}
        </option>
      </select>
    </fieldset>

    <fieldset class="fieldset">
      <legend class="fieldset-legend">Платформа</legend>
      <select
        v-model="store.platform"
        class="select"
        @change="onPlatformChange"
      >
        <option value="">Все платформы</option>
        <option value="youtube">YouTube</option>
        <option value="tiktok">TikTok</option>
        <option value="instagram">Instagram</option>
      </select>
    </fieldset>

    <fieldset class="fieldset">
      <legend class="fieldset-legend">Аккаунт</legend>
      <select
        v-model.number="store.socialAccountId"
        class="select"
        @change="onFilterChange"
      >
        <option :value="undefined">Все аккаунты</option>
        <option
          v-for="acc in accounts"
          :key="acc.id"
          :value="acc.id"
        >
          {{ acc.displayName }}
        </option>
      </select>
    </fieldset>

    <fieldset class="fieldset">
      <legend class="fieldset-legend">Дата от</legend>
      <input
        v-model="store.dateFrom"
        type="date"
        class="input"
        @change="onFilterChange"
      />
    </fieldset>

    <fieldset class="fieldset">
      <legend class="fieldset-legend">Дата до</legend>
      <input
        v-model="store.dateTo"
        type="date"
        class="input"
        @change="onFilterChange"
      />
    </fieldset>
  </div>
</template>
