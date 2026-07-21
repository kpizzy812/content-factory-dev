<script setup lang="ts">
definePageMeta({ middleware: ["admin-access"] })
useHead({ title: "Здоровье storage" })

interface MissingEntry {
  id: number
  scenarioId: number | null
  title: string | null
  status: string
  fileUrl: string | null
  completedAt: string | null
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
    driver: {
      provider: string
      bucketName?: string
      localRoot?: string
      credentialsSource?: string
    }
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
  "/api/admin/storage-health",
  { server: false, default: () => null },
)
const stats = computed(() => data.value?.data ?? null)
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between flex-wrap gap-3">
      <h1 class="text-2xl font-bold text-base-content">Здоровье storage</h1>
      <button
        class="btn btn-sm btn-soft"
        :disabled="pending"
        @click="refresh()"
      >
        <Icon name="mingcute:refresh-2-line" :class="{ 'animate-spin': pending }" />
        Обновить
      </button>
    </div>

    <div v-if="pending" class="flex justify-center py-12">
      <span class="loading loading-spinner loading-lg" />
    </div>

    <div v-else-if="error" role="alert" class="alert alert-error">
      <Icon name="mingcute:warning-line" />
      <span>Не удалось загрузить данные: {{ error.message }}</span>
    </div>

    <template v-else-if="stats">
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div class="card card-border bg-base-100">
          <div class="card-body p-4">
            <div class="text-xs opacity-60">Storage Driver</div>
            <div class="text-2xl font-bold uppercase">{{ stats.driver.provider }}</div>
            <div class="text-xs opacity-60 truncate">
              {{ stats.driver.bucketName ?? stats.driver.localRoot ?? "—" }}
            </div>
          </div>
        </div>
        <div class="card card-border bg-base-100">
          <div class="card-body p-4">
            <div class="text-xs opacity-60">Проверено видео</div>
            <div class="text-2xl font-bold">{{ stats.checkedVideos }}</div>
            <div class="text-xs">
              На диске: {{ stats.videoFilesOnDisk }} / отсутствует: {{ stats.videoFilesMissing }}
            </div>
          </div>
        </div>
        <div class="card card-border bg-base-100">
          <div class="card-body p-4">
            <div class="text-xs opacity-60">Картинки сцен</div>
            <div class="text-2xl font-bold">
              {{ stats.imageAssetsOnDisk }} / {{ stats.imageAssetsExpected }}
            </div>
            <div class="text-xs opacity-60">на диске / ожидается</div>
          </div>
        </div>
        <div class="card card-border bg-base-100">
          <div class="card-body p-4">
            <div class="text-xs opacity-60">Клипы сцен</div>
            <div class="text-2xl font-bold">
              {{ stats.clipAssetsOnDisk }} / {{ stats.clipAssetsExpected }}
            </div>
            <div class="text-xs opacity-60">на диске / ожидается</div>
          </div>
        </div>
      </div>

      <div
        v-if="stats.videoFilesMissing > 0"
        role="alert"
        class="alert alert-warning"
      >
        <Icon name="mingcute:warning-line" />
        <div>
          <div class="font-semibold">{{ stats.videoFilesMissing }} видео без файла</div>
          <div class="text-xs">
            Storage driver не нашёл финальные mp4 — пересоберите ассембли (бесплатно) или
            перегенерируйте полностью (платно).
          </div>
        </div>
      </div>

      <div v-if="stats.missing.length" class="card card-border bg-base-100">
        <div class="card-body p-0">
          <div class="overflow-x-auto">
            <table class="table table-sm">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Название</th>
                  <th>Статус</th>
                  <th>Файл</th>
                  <th>Картинки</th>
                  <th>Клипы</th>
                  <th class="text-right">Действие</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="v in stats.missing" :key="v.id">
                  <td class="font-mono text-xs">#{{ v.id }}</td>
                  <td class="truncate max-w-[24ch]">{{ v.title ?? "—" }}</td>
                  <td>
                    <span class="badge badge-sm badge-soft">{{ v.status }}</span>
                  </td>
                  <td>
                    <span
                      class="badge badge-sm"
                      :class="v.missingVideoFile ? 'badge-error' : 'badge-success'"
                    >
                      {{ v.missingVideoFile ? "нет" : "OK" }}
                    </span>
                  </td>
                  <td>
                    {{ v.totalImageAssets - v.missingImageAssets }}/{{ v.totalImageAssets }}
                  </td>
                  <td>
                    {{ v.totalClipAssets - v.missingClipAssets }}/{{ v.totalClipAssets }}
                  </td>
                  <td class="text-right">
                    <NuxtLink
                      :to="`/videos/${v.id}`"
                      class="btn btn-xs btn-soft"
                    >
                      Открыть
                    </NuxtLink>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div v-else role="alert" class="alert alert-success">
        <Icon name="mingcute:check-circle-line" />
        <span>Все проверенные видео в порядке — файлы и ассеты на месте.</span>
      </div>

      <div class="text-xs opacity-60">
        Storage base: <code>{{ stats.storageBase }}</code>
        <template v-if="stats.freeSpaceGB !== null">
          · свободно {{ stats.freeSpaceGB }} GB
        </template>
      </div>
    </template>
  </div>
</template>
