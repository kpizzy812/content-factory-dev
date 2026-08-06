<script setup lang="ts">
/**
 * Здоровье хранилища. Макет: design-preview/catalog/08-settings-admin.dc.html
 *
 * В макете это полоски заполненности с порогами 80 и 90 процентов. Endpoint
 * отдаёт другое: сколько роликов проверено и у скольких пропали файлы. Полоски
 * рисуются по этим числам — доля найденного, — а не по свободному месту:
 * `freeSpaceGB` приходит без общего объёма, и процент из него не получится.
 *
 * Ответ приходит только на клиенте (`server: false`), поэтому содержимое
 * обёрнуто в ClientOnly: иначе на сервере страница вечно в загрузке.
 */
definePageMeta({ middleware: ['admin-access'] })
useHead({ title: 'Здоровье хранилища' })

interface MissingEntry {
  id: number
  title: string | null
  status: string
  missingVideoFile: boolean
  missingImageAssets: number
  totalImageAssets: number
  missingClipAssets: number
  totalClipAssets: number
  canReassemble: boolean
}

interface StorageHealthResponse {
  data: {
    storageBase: string
    baseExists: boolean
    freeSpaceGB: number | null
    driver: { provider: string; bucketName?: string; localRoot?: string; credentialsSource?: string }
    checkedVideos: number
    videoFilesOnDisk: number
    videoFilesMissing: number
    imageAssetsExpected: number
    imageAssetsOnDisk: number
    clipAssetsExpected: number
    clipAssetsOnDisk: number
    missing: MissingEntry[]
  }
}

const { data, refresh, pending, error } = await useFetch<StorageHealthResponse>(
  '/api/admin/storage-health',
  { server: false, default: () => null },
)

const stats = computed(() => data.value?.data ?? null)

// `pending` на сервере false, а в браузере сразу true — привязка к кнопке
// ломала гидратацию. Кнопка знает только про свой собственный повтор.
const refreshing = ref(false)

async function recheck() {
  refreshing.value = true
  try {
    await refresh()
  }
  finally {
    refreshing.value = false
  }
}

interface Bar {
  label: string
  found: number
  expected: number
  hint: string
}

const bars = computed<Bar[]>(() => {
  const s = stats.value
  if (!s) return []
  return [
    { label: 'Готовые ролики', found: s.videoFilesOnDisk, expected: s.checkedVideos, hint: 'финальные mp4' },
    { label: 'Кадры сцен', found: s.imageAssetsOnDisk, expected: s.imageAssetsExpected, hint: 'картинки под клипы' },
    { label: 'Клипы сцен', found: s.clipAssetsOnDisk, expected: s.clipAssetsExpected, hint: 'сгенерированные куски' },
  ]
})

function share(bar: Bar): number {
  if (!bar.expected) return 100
  return Math.round((bar.found / bar.expected) * 100)
}

function barTone(bar: Bar): string {
  const value = share(bar)
  if (value >= 100) return 'bg-success'
  if (value >= 90) return 'bg-warning'
  return 'bg-danger'
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-xl font-semibold">Здоровье хранилища</h1>
      <span class="flex-1" />
      <UiButton :loading="refreshing" @click="recheck">
        <Icon v-if="!refreshing" name="mingcute:refresh-2-line" />
        Проверить заново
      </UiButton>
    </div>

    <ClientOnly>
      <UiSkeleton v-if="pending && !stats" variant="details" :count="6" />

      <UiErrorState
        v-else-if="error"
        message="Не удалось проверить хранилище."
        :details="error.message"
        @retry="recheck"
      />

      <template v-else-if="stats">
        <section class="overflow-hidden rounded-lg border border-border bg-panel">
          <div class="flex flex-wrap items-center gap-2 border-b border-divider bg-card px-3.5 py-2.5">
            <h2 class="text-base font-medium">Файлы на месте</h2>
            <span class="tnum font-mono text-sm text-subtle">
              проверено {{ stats.checkedVideos }} роликов
            </span>
          </div>

          <div class="flex flex-col gap-2 px-3.5 py-3">
            <div
              v-for="bar in bars"
              :key="bar.label"
              class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,1fr)_130px_120px]"
            >
              <span class="min-w-0">
                <span class="block truncate text-sm">{{ bar.label }}</span>
                <span class="block truncate text-micro text-subtle">{{ bar.hint }}</span>
              </span>
              <span class="col-span-2 h-1.5 overflow-hidden rounded-[2px] bg-card sm:col-span-1">
                <span class="block h-full" :class="barTone(bar)" :style="{ width: `${share(bar)}%` }" />
              </span>
              <span class="tnum font-mono text-sm sm:text-right" :class="share(bar) >= 100 ? 'text-muted' : 'text-warning'">
                {{ bar.found }} из {{ bar.expected }}
              </span>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-divider bg-card px-3.5 py-2 text-micro text-subtle">
            <span class="font-mono">{{ stats.driver.provider }}</span>
            <span class="truncate font-mono">
              {{ stats.driver.bucketName ?? stats.driver.localRoot ?? stats.storageBase }}
            </span>
            <span v-if="stats.freeSpaceGB !== null" class="tnum font-mono">
              свободно {{ stats.freeSpaceGB }} ГБ
            </span>
            <span v-if="!stats.baseExists" class="text-danger">каталог хранилища не найден</span>
          </div>
        </section>

        <p
          v-if="stats.videoFilesMissing > 0"
          class="flex items-start gap-2 rounded-md border border-warning-border bg-warning-bg px-2.5 py-2 text-sm text-fg"
        >
          <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0 text-warning" />
          <span>
            У {{ stats.videoFilesMissing }} роликов нет финального файла. Пересборка
            бесплатна и делается на странице ролика; полная перегенерация — платная.
          </span>
        </p>

        <UiEmptyState
          v-if="!stats.missing.length"
          icon="mingcute:check-circle-line"
          title="Всё на месте"
          description="У проверенных роликов файлы и ассеты найдены в хранилище."
        />

        <section v-else class="overflow-hidden rounded-lg border border-border bg-panel">
          <div class="flex items-center gap-2 border-b border-divider bg-card px-3.5 py-2.5">
            <h2 class="text-base font-medium">Ролики с пропажами</h2>
            <span class="tnum font-mono text-sm text-subtle">{{ stats.missing.length }}</span>
          </div>

          <NuxtLink
            v-for="row in stats.missing"
            :key="row.id"
            :to="`/videos/${row.id}`"
            class="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 border-b border-divider px-3.5 py-2 no-underline last:border-b-0 hover:bg-card sm:grid-cols-[64px_minmax(0,1fr)_100px_96px_96px]"
          >
            <span class="font-mono text-sm text-subtle">#{{ row.id }}</span>
            <span class="truncate text-sm">{{ row.title ?? 'Без названия' }}</span>
            <span
              class="inline-flex h-[18px] w-fit items-center rounded-sm border px-1.5 text-micro"
              :class="row.missingVideoFile
                ? 'border-danger-border bg-danger-bg text-danger'
                : 'border-success-border bg-success-bg text-success'"
            >{{ row.missingVideoFile ? 'нет файла' : 'файл на месте' }}</span>
            <span class="tnum font-mono text-micro text-subtle sm:text-right">
              кадры {{ row.totalImageAssets - row.missingImageAssets }}/{{ row.totalImageAssets }}
            </span>
            <span class="tnum font-mono text-micro text-subtle sm:text-right">
              клипы {{ row.totalClipAssets - row.missingClipAssets }}/{{ row.totalClipAssets }}
            </span>
          </NuxtLink>
        </section>
      </template>

      <template #fallback>
        <UiSkeleton variant="details" :count="6" />
      </template>
    </ClientOnly>
  </div>
</template>
