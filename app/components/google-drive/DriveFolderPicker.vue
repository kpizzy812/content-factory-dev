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
  <div class="flex flex-col gap-3">
    <!-- Путь -->
    <nav class="flex flex-wrap items-center gap-1 text-sm">
      <template v-for="(crumb, i) in stack" :key="`${crumb.id}-${i}`">
        <Icon v-if="i > 0" name="mingcute:right-line" class="shrink-0 text-subtle" />
        <button
          type="button"
          class="flex cursor-pointer items-center gap-1 rounded-sm px-1 hover:text-fg"
          :class="i === stack.length - 1 ? 'font-medium text-fg' : 'text-muted'"
          @click="goTo(i)"
        >
          <Icon name="mingcute:folder-line" class="shrink-0" />
          {{ crumb.name }}
        </button>
      </template>
    </nav>

    <div class="flex flex-wrap items-center justify-between gap-2">
      <UiCheckbox v-model="onlyVideos" label="Только видео" />
      <UiButton
        variant="primary"
        size="md"
        :disabled="isLoading || currentParentId === 'root'"
        :loading="isSyncing"
        @click="syncCurrent"
      >
        <Icon v-if="!isSyncing" name="mingcute:refresh-3-line" />
        Синхронизировать эту папку
      </UiButton>
    </div>

    <p
      v-if="errorMessage"
      class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-danger"
    >
      <Icon name="mingcute:warning-line" class="mt-0.5 shrink-0" />
      <span>{{ errorMessage }}</span>
    </p>

    <div v-if="isLoading" class="flex items-center justify-center py-12 text-muted">
      <Icon name="mingcute:loading-line" class="animate-spin text-2xl" />
    </div>

    <div
      v-else-if="folders.length === 0"
      class="flex flex-col items-center gap-2 py-12 text-center text-muted"
    >
      <Icon name="mingcute:folder-open-line" class="text-3xl text-subtle" />
      <template v-if="currentParentId === 'root'">
        <p>Ни одна папка не расшарена на сервис-аккаунт</p>
        <p class="mx-auto max-w-md text-sm text-subtle">
          В Google Drive откройте нужную папку, нажмите <b class="text-muted">Поделиться</b> и добавьте
          email сервис-аккаунта (вы указывали его при подключении). После этого обновите страницу.
        </p>
      </template>
      <template v-else>
        <p>В этой папке нет вложенных папок</p>
        <p class="text-sm text-subtle">Синхронизацию файлов можно запустить прямо здесь.</p>
      </template>
    </div>

    <div v-else class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      <div
        v-for="folder in folders"
        :key="folder.id"
        class="flex items-center gap-2 rounded-lg border border-border bg-panel p-3 shadow-sm transition-colors duration-(--duration-fast) ease-out hover:border-accent-border"
      >
        <Icon name="mingcute:folder-line" class="shrink-0 text-lg text-accent-text" />
        <div class="min-w-0 grow">
          <div class="truncate font-medium" :title="folder.name">{{ folder.name }}</div>
          <ClientOnly>
            <div v-if="folder.modifiedTime" class="text-sm text-muted">
              {{ new Date(folder.modifiedTime).toLocaleDateString('ru-RU') }}
            </div>
          </ClientOnly>
        </div>
        <UiButton variant="ghost" class="shrink-0" @click="openFolder(folder)">
          Открыть
          <Icon name="mingcute:right-line" />
        </UiButton>
      </div>
    </div>
  </div>
</template>
