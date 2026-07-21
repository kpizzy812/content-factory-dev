<script setup lang="ts">
import type { DriveFolder } from '~/composables/useGoogleDrive'

const props = defineProps<{
  credentialId: number
  initialParentId?: string
  isSyncing?: boolean
}>()
const emit = defineEmits<{
  select: [folder: DriveFolder]
  sync: [payload: { credentialId: number, folderId: string, onlyVideos: boolean }]
}>()

const { listFolders } = useGoogleDrive()

interface Crumb {
  id: string
  name: string
}

const stack = ref<Crumb[]>([{ id: props.initialParentId ?? 'root', name: 'Расшаренные папки' }])
const folders = ref<DriveFolder[]>([])
const isLoading = ref(false)
const errorMessage = ref<string | null>(null)
const onlyVideos = ref(true)

const currentParentId = computed(() => stack.value[stack.value.length - 1]?.id ?? 'root')

async function loadFolders() {
  isLoading.value = true
  errorMessage.value = null
  try {
    folders.value = await listFolders(props.credentialId, currentParentId.value)
  } catch (err: unknown) {
    const data = err as { data?: { message?: string }, message?: string }
    errorMessage.value = data?.data?.message || data?.message || 'Ошибка загрузки папок'
    folders.value = []
  } finally {
    isLoading.value = false
  }
}

function openFolder(folder: DriveFolder) {
  stack.value.push({ id: folder.id, name: folder.name })
  emit('select', folder)
  loadFolders()
}

function goTo(index: number) {
  stack.value = stack.value.slice(0, index + 1)
  loadFolders()
}

function syncCurrent() {
  const folderId = currentParentId.value
  if (folderId === 'root') {
    errorMessage.value = 'Нельзя синхронизировать корневую папку. Откройте подпапку.'
    return
  }
  // isSyncing управляется родителем через prop — он знает реальное завершение операции.
  emit('sync', {
    credentialId: props.credentialId,
    folderId,
    onlyVideos: onlyVideos.value,
  })
}

watch(
  () => props.credentialId,
  () => {
    stack.value = [{ id: props.initialParentId ?? 'root', name: 'Расшаренные папки' }]
    loadFolders()
  },
  { immediate: true },
)
</script>

<template>
  <div class="space-y-3">
    <!-- Breadcrumbs -->
    <div class="breadcrumbs text-sm">
      <ul>
        <li v-for="(crumb, i) in stack" :key="`${crumb.id}-${i}`">
          <button
            class="link link-hover"
            :class="{ 'font-bold': i === stack.length - 1 }"
            @click="goTo(i)"
          >
            <Icon name="mingcute:folder-line" class="h-4 w-4" />
            {{ crumb.name }}
          </button>
        </li>
      </ul>
    </div>

    <!-- Toolbar -->
    <div class="flex flex-wrap items-center gap-2 justify-between">
      <label class="label cursor-pointer gap-2">
        <input v-model="onlyVideos" type="checkbox" class="checkbox checkbox-sm">
        <span class="label-text text-sm">Только видео</span>
      </label>
      <button
        class="btn btn-sm btn-primary"
        :disabled="isSyncing || isLoading || currentParentId === 'root'"
        @click="syncCurrent"
      >
        <span v-if="isSyncing" class="loading loading-spinner loading-sm" />
        <Icon v-else name="mingcute:refresh-3-line" class="h-4 w-4" />
        Запустить sync этой папки
      </button>
    </div>

    <!-- Error -->
    <div v-if="errorMessage" class="alert alert-error text-sm">
      <Icon name="mingcute:warning-line" class="h-5 w-5" />
      <span>{{ errorMessage }}</span>
    </div>

    <!-- Loading -->
    <div v-if="isLoading" class="flex items-center justify-center py-12">
      <span class="loading loading-spinner loading-lg" />
    </div>

    <!-- Empty -->
    <div
      v-else-if="folders.length === 0"
      class="text-center py-12 text-base-content/60"
    >
      <Icon name="mingcute:folder-open-line" class="h-12 w-12 mx-auto mb-2" />
      <template v-if="currentParentId === 'root'">
        <p>Ни одна папка не расшарена на сервис-аккаунт</p>
        <p class="text-xs mt-2 max-w-md mx-auto">
          В Google Drive откройте нужную папку, нажмите <b>Поделиться</b> и добавьте email сервис-аккаунта (вы указывали его при подключении). После этого обновите страницу.
        </p>
      </template>
      <template v-else>
        <p>В этой папке нет вложенных папок</p>
        <p class="text-xs mt-1">
          Можно запустить sync файлов прямо здесь.
        </p>
      </template>
    </div>

    <!-- Grid -->
    <div v-else class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      <div
        v-for="folder in folders"
        :key="folder.id"
        class="card card-sm card-border bg-base-100 shadow-sm hover:border-primary transition-colors"
      >
        <div class="card-body p-3 flex-row items-center gap-2">
          <Icon name="mingcute:folder-line" class="h-6 w-6 text-primary shrink-0" />
          <div class="grow min-w-0">
            <div class="font-medium truncate" :title="folder.name">{{ folder.name }}</div>
            <div v-if="folder.modifiedTime" class="text-xs text-base-content/60">
              {{ new Date(folder.modifiedTime).toLocaleDateString('ru-RU') }}
            </div>
          </div>
          <button class="btn btn-xs btn-ghost shrink-0" @click="openFolder(folder)">
            Открыть
            <Icon name="mingcute:right-line" class="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
