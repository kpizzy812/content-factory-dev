<script setup lang="ts">
/**
 * Статистика аккаунта: снимки метрик профиля через Apify.
 *
 * Сбор платный, поэтому повторный запуск в пределах суток спрашивает
 * подтверждение с прямым указанием, что тратится квота.
 */
import type { NormalizedPost } from '~~/shared/types/account-metrics'

const props = defineProps<{ accountId: number }>()

const accountIdRef = computed(() => props.accountId)

const {
  snapshots,
  platform,
  platformHandle,
  loading,
  fetching,
  error,
  load,
  fetchNow,
} = useAccountMetrics(accountIdRef)

const forceRef = ref<{ open: () => void, close: () => void, setBusy: (v: boolean) => void }>()

/**
 * До первого ответа неизвестно, есть ли у аккаунта handle. Показывать
 * «handle не указан» в это время нельзя — состояние мигает.
 */
const initialized = ref(false)

onMounted(async () => {
  await load({ includeRaw: true })
  initialized.value = true
})

watch(accountIdRef, async (newId, oldId) => {
  if (newId === oldId) return
  initialized.value = false
  await load({ includeRaw: true })
  initialized.value = true
})

const lastOkSnapshot = computed(() => snapshots.value.find(s => s.status === 'ok'))
const latestSnapshot = computed(() => snapshots.value[0] ?? null)
const lastPosts = computed<NormalizedPost[]>(() => lastOkSnapshot.value?.rawData?.posts ?? [])

const noHandle = computed(() => !platformHandle.value)
const noSnapshots = computed(() => !loading.value && snapshots.value.length === 0)
const lastIsError = computed(() => latestSnapshot.value?.status === 'error')

async function handleFetch() {
  const res = await fetchNow({ force: false })
  // Свежий снимок в пределах суток — сервер ничего не собирал. Спрашиваем,
  // тратить ли квоту на принудительный сбор.
  if (res?.skipped) forceRef.value?.open()
}

async function confirmForceFetch() {
  forceRef.value?.setBusy(true)
  await fetchNow({ force: true })
  forceRef.value?.setBusy(false)
  forceRef.value?.close()
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <AccountDiagnosticPanel v-if="error" :error="error" />

    <UiSkeleton v-if="!initialized || (loading && !snapshots.length)" variant="details" :count="4" />

    <p v-else-if="noHandle" class="flex gap-2 rounded-md border border-info-border bg-info-bg p-2.5 text-sm">
      <Icon name="mingcute:information-line" class="mt-0.5 shrink-0 text-info" />
      <span>
        <b>Handle не указан.</b>
        Статистику собирают по нему — заполните поле на вкладке «Доступы», без символа @.
      </span>
    </p>

    <UiEmptyState
      v-else-if="noSnapshots"
      variant="first"
      icon="mingcute:chart-line-line"
      title="Статистика ещё не собиралась"
      :description="`Первый сбор для @${platformHandle} расходует квоту Apify.`"
    >
      <UiButton variant="primary" :loading="fetching" @click="handleFetch">
        <Icon v-if="!fetching" name="mingcute:download-line" />
        Собрать впервые
      </UiButton>
    </UiEmptyState>

    <template v-else-if="lastOkSnapshot">
      <p v-if="lastIsError" class="flex gap-2 rounded-md border border-warning-border bg-warning-bg p-2.5 text-sm">
        <Icon name="mingcute:warning-line" class="mt-0.5 shrink-0 text-warning" />
        <span>
          <b>Последний сбор упал.</b>
          {{ latestSnapshot?.errorMessage ?? 'Подробностей платформа не сообщила.' }}
          Показаны данные предыдущего успешного снимка.
        </span>
      </p>

      <AccountMetricsStatCards :snapshot="lastOkSnapshot" />
      <AccountMetricsSparkline :snapshots="snapshots" />
      <AccountMetricsPostsList :posts="lastPosts" :platform="platform" />

      <div class="flex items-center justify-end gap-2 border-t border-divider pt-2.5">
        <span class="font-mono text-micro text-subtle">@{{ platformHandle }} · {{ platform }}</span>
        <UiButton variant="primary" :loading="fetching" @click="handleFetch">
          <Icon v-if="!fetching" name="mingcute:refresh-3-line" />
          Обновить
        </UiButton>
      </div>
    </template>

    <template v-else-if="snapshots.length">
      <p class="flex gap-2 rounded-md border border-danger-border bg-danger-bg p-2.5 text-sm">
        <Icon name="mingcute:close-circle-line" class="mt-0.5 shrink-0 text-danger" />
        <span>
          <b>Все попытки сбора упали.</b>
          {{ latestSnapshot?.errorMessage ?? 'Apify не отдал данные.' }}
        </span>
      </p>
      <div class="flex justify-end">
        <UiButton variant="primary" :loading="fetching" @click="handleFetch">
          <Icon v-if="!fetching" name="mingcute:refresh-3-line" />
          Повторить
        </UiButton>
      </div>
    </template>

    <SharedConfirmModal
      ref="forceRef"
      title="Собрать статистику заново?"
      message="За последние сутки сбор уже проходил успешно. Повторный расходует квоту Apify."
      confirm-label="Собрать и списать квоту"
      variant="warning"
      @confirm="confirmForceFetch"
    />
  </div>
</template>
