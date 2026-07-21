<script setup lang="ts">
/**
 * Таб «Статистика» в AccountEditModal.
 *
 * Состояния:
 *   1. loading — первичная загрузка списка снимков
 *   2. error (load) — диагностическая панель сверху
 *   3. platformHandle отсутствует — empty с подсказкой
 *   4. snapshots.length === 0 — empty + кнопка «Собрать впервые»
 *   5. lastSnapshot.status === 'error' — alert-warning сверху + кнопка обновить
 *   6. happy path — StatCards + Sparkline + PostsList + кнопка обновить
 */
import type { NormalizedPost } from "~~/shared/types/account-metrics"

const props = defineProps<{
  accountId: number
}>()

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

const confirmModalRef = ref<HTMLDialogElement>()

// Флаг первичной инициализации — до выполнения первого load() мы не знаем
// есть ли у аккаунта platformHandle, поэтому пока не initialized — показываем
// спиннер (а не «Handle не указан»). Иначе при SSR/CSR-mismatch у аккаунтов
// с handle мерцает empty state.
const initialized = ref(false)

onMounted(async () => {
  await load({ includeRaw: true })
  initialized.value = true
})

watch(accountIdRef, async (newId, oldId) => {
  if (newId !== oldId) {
    initialized.value = false
    await load({ includeRaw: true })
    initialized.value = true
  }
})

// Последний 'ok'-снимок — для stat cards и posts list
const lastOkSnapshot = computed(() => snapshots.value.find((s) => s.status === "ok"))
// Самый свежий снимок (любой статус) — для error-alert
const latestSnapshot = computed(() => snapshots.value[0] ?? null)

// Посты из rawData последнего ok-снимка
const lastPosts = computed<NormalizedPost[]>(() => {
  return lastOkSnapshot.value?.rawData?.posts ?? []
})

// UI-состояния
const noHandle = computed(() => !platformHandle.value)
const noSnapshots = computed(() => !loading.value && snapshots.value.length === 0)
const hasError = computed(() => !!error.value)
const lastIsError = computed(() => latestSnapshot.value?.status === "error")

async function handleFetch() {
  const res = await fetchNow({ force: false })
  if (res?.skipped) {
    // 24h cache hit — спрашиваем оператора надо ли force=1
    confirmModalRef.value?.showModal()
  }
}

async function confirmForceFetch() {
  confirmModalRef.value?.close()
  await fetchNow({ force: true })
}

function cancelForceFetch() {
  confirmModalRef.value?.close()
}
</script>

<template>
  <div class="space-y-3">
    <!-- 2. Ошибка загрузки/fetch — диагностическая панель -->
    <AccountDiagnosticPanel v-if="hasError" :error="error" />

    <!-- 1. Loading (включая фазу до первого load()) -->
    <div
      v-if="!initialized || (loading && snapshots.length === 0)"
      class="flex items-center justify-center py-8"
    >
      <span class="loading loading-spinner loading-lg text-primary" />
    </div>

    <!-- 3. Нет handle -->
    <div v-else-if="noHandle" role="alert" class="alert alert-info alert-soft text-sm">
      <Icon name="mingcute:information-line" />
      <div class="flex-1">
        <div class="font-semibold">Handle не указан</div>
        <div class="text-xs opacity-80">
          Чтобы собрать статистику, откройте вкладку «Доступы» и заполните поле
          handle аккаунта (без символа @).
        </div>
      </div>
    </div>

    <!-- 4. Нет снимков — empty state с CTA -->
    <div v-else-if="noSnapshots" class="text-center py-6 space-y-3">
      <Icon name="mingcute:chart-line-line" class="text-5xl text-base-content/30" />
      <div class="text-sm text-base-content/70">
        Статистика для <span class="font-mono">@{{ platformHandle }}</span> ещё не собрана.
      </div>
      <button
        type="button"
        class="btn btn-primary btn-sm"
        :disabled="fetching"
        @click="handleFetch"
      >
        <span v-if="fetching" class="loading loading-dots loading-sm" />
        <Icon v-else name="mingcute:download-line" class="text-sm" />
        Собрать статистику впервые
      </button>
    </div>

    <!-- 5/6. Есть снимки -->
    <template v-else-if="lastOkSnapshot">
      <!-- Alert если последний — error -->
      <div
        v-if="lastIsError"
        role="alert"
        class="alert alert-warning alert-soft text-sm"
      >
        <Icon name="mingcute:warning-line" />
        <div class="flex-1">
          <div class="font-semibold">Последний сбор завершился ошибкой</div>
          <div class="text-xs opacity-80">{{ latestSnapshot?.errorMessage ?? "Без деталей" }}</div>
        </div>
      </div>

      <AccountMetricsStatCards :snapshot="lastOkSnapshot" />

      <AccountMetricsSparkline :snapshots="snapshots" />

      <AccountMetricsPostsList :posts="lastPosts" :platform="platform" />

      <div class="flex items-center justify-end gap-2 pt-2 border-t border-base-300">
        <span class="text-xs text-base-content/60">
          @{{ platformHandle }} ({{ platform }})
        </span>
        <button
          type="button"
          class="btn btn-sm btn-primary"
          :disabled="fetching"
          @click="handleFetch"
        >
          <span v-if="fetching" class="loading loading-dots loading-sm" />
          <Icon v-else name="mingcute:refresh-1-line" class="text-sm" />
          Обновить статистику
        </button>
      </div>
    </template>

    <!-- Edge: только error-снимки, нет ok вообще -->
    <template v-else-if="snapshots.length > 0">
      <div role="alert" class="alert alert-error alert-soft text-sm">
        <Icon name="mingcute:close-circle-line" />
        <div class="flex-1">
          <div class="font-semibold">Все попытки сбора завершились ошибкой</div>
          <div class="text-xs opacity-80">
            {{ latestSnapshot?.errorMessage ?? "Apify не смог получить данные" }}
          </div>
        </div>
      </div>
      <div class="flex justify-end">
        <button
          type="button"
          class="btn btn-sm btn-primary"
          :disabled="fetching"
          @click="handleFetch"
        >
          <span v-if="fetching" class="loading loading-dots loading-sm" />
          <Icon v-else name="mingcute:refresh-1-line" class="text-sm" />
          Повторить
        </button>
      </div>
    </template>

    <!-- Confirm-modal для force=1 при 24h cache hit -->
    <dialog ref="confirmModalRef" class="modal">
      <div class="modal-box">
        <h3 class="font-bold text-lg">Обновить статистику принудительно?</h3>
        <p class="py-2 text-sm">
          За последние 24 часа уже был успешный сбор. Принудительный refetch
          расходует квоту Apify. Продолжить?
        </p>
        <div class="modal-action">
          <button class="btn btn-sm" @click="cancelForceFetch">Отмена</button>
          <button class="btn btn-sm btn-primary" @click="confirmForceFetch">
            Да, обновить
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button>close</button>
      </form>
    </dialog>
  </div>
</template>
