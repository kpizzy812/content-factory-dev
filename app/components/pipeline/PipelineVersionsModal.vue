<script setup lang="ts">
/**
 * Версии конвейера: сохранить текущее состояние и откатиться к прежнему.
 *
 * Откат заменяет граф целиком, поэтому спрашивается через модалку, а не через
 * `confirm()` — она объясняет, что именно будет заменено, а браузерное окно нет.
 */
const props = defineProps<{
  pipelineId: number
  visible: boolean
}>()

const emit = defineEmits<{ close: [] }>()

const store = usePipelineEditorStore()
const toast = useToast()

interface VersionItem {
  id: number
  version: number
  name: string | null
  description: string | null
  isDeployed: boolean
  createdAt: string
}

const versions = ref<VersionItem[]>([])
const isLoading = ref(false)
const isSaving = ref(false)
const isRestoring = ref<number | null>(null)
const errorMessage = ref<string | null>(null)
const versionName = ref('')
const versionDescription = ref('')

const restoreModalRef = ref<{ open: () => void, close: () => void, setBusy: (v: boolean) => void } | null>(null)
const pendingRestore = ref<VersionItem | null>(null)

async function loadVersions() {
  isLoading.value = true
  errorMessage.value = null
  try {
    const response = await $fetch<{ data: VersionItem[] }>(`/api/pipelines/${props.pipelineId}/versions`)
    versions.value = response.data ?? []
  }
  catch (error: unknown) {
    errorMessage.value = (error as { data?: { message?: string } })?.data?.message ?? 'Не удалось загрузить версии'
  }
  finally {
    isLoading.value = false
  }
}

async function saveVersion() {
  isSaving.value = true
  errorMessage.value = null
  try {
    await $fetch(`/api/pipelines/${props.pipelineId}/versions`, {
      method: 'POST',
      body: {
        name: versionName.value.trim() || undefined,
        description: versionDescription.value.trim() || undefined,
      },
    })
    versionName.value = ''
    versionDescription.value = ''
    await loadVersions()
    toast.success('Версия сохранена')
  }
  catch (error: unknown) {
    errorMessage.value = (error as { data?: { message?: string } })?.data?.message ?? 'Не удалось сохранить версию'
  }
  finally {
    isSaving.value = false
  }
}

function askRestore(version: VersionItem) {
  pendingRestore.value = version
  restoreModalRef.value?.open()
}

async function confirmRestore() {
  const version = pendingRestore.value
  if (!version) return

  isRestoring.value = version.id
  restoreModalRef.value?.setBusy(true)
  try {
    const response = await $fetch<{ data: unknown }>(
      `/api/pipelines/${props.pipelineId}/versions/${version.id}/restore`,
      { method: 'POST' },
    )
    if (response.data) store.loadFromApi(response.data)
    toast.success(`Граф откачен к версии v${version.version}`)
    emit('close')
  }
  catch (error: unknown) {
    toast.error((error as { data?: { message?: string } })?.data?.message ?? 'Не удалось восстановить версию')
  }
  finally {
    isRestoring.value = null
    restoreModalRef.value?.setBusy(false)
    restoreModalRef.value?.close()
    pendingRestore.value = null
  }
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('ru-RU')
}

watch(() => props.visible, (visible) => {
  if (visible) loadVersions()
})
</script>

<template>
  <UiModal :open="visible" title="Версии конвейера" size="md" @close="emit('close')">
    <div class="flex flex-col gap-3">
      <p class="text-sm text-muted">
        Версия — снимок графа. Сохраните его перед крупной перестройкой, чтобы
        было куда вернуться.
      </p>

      <div class="flex flex-col gap-2">
        <div class="flex gap-2">
          <UiInput v-model="versionName" class="flex-1" placeholder="Название, например «До рефакторинга»" />
          <UiButton variant="primary" :loading="isSaving" @click="saveVersion">
            Сохранить версию
          </UiButton>
        </div>
        <UiInput v-model="versionDescription" placeholder="Что изменилось — необязательно" />
      </div>

      <p v-if="errorMessage" role="alert" class="flex items-center gap-1.5 text-sm text-danger">
        <Icon name="mingcute:warning-line" />
        {{ errorMessage }}
      </p>

      <UiSkeleton v-if="isLoading" variant="table" :count="3" />

      <UiEmptyState
        v-else-if="!versions.length"
        title="Сохранённых версий нет"
        description="Первая версия появится, как только вы её сохраните."
      />

      <ul v-else class="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
        <li
          v-for="version in versions"
          :key="version.id"
          class="flex items-center gap-3 rounded-md border border-border bg-card px-2.5 py-2"
        >
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5 text-sm">
              <span class="font-mono">v{{ version.version }}</span>
              <span v-if="version.name" class="truncate text-muted">— {{ version.name }}</span>
              <span
                v-if="version.isDeployed"
                class="inline-flex h-[18px] items-center rounded-sm border border-success-border bg-success-bg px-1.5 text-micro text-success"
              >в работе</span>
            </div>
            <div class="tnum font-mono text-[11px] text-subtle">{{ formatDate(version.createdAt) }}</div>
            <div v-if="version.description" class="truncate text-[11px] text-muted">
              {{ version.description }}
            </div>
          </div>

          <UiButton
            class="shrink-0"
            :loading="isRestoring === version.id"
            title="Откатить граф к этой версии"
            @click="askRestore(version)"
          >
            Откатить
          </UiButton>
        </li>
      </ul>
    </div>

    <template #footer>
      <UiButton @click="emit('close')">Закрыть</UiButton>
    </template>
  </UiModal>

  <SharedConfirmModal
    ref="restoreModalRef"
    title="Откатить граф к версии?"
    :message="pendingRestore
      ? `Текущий граф будет заменён версией v${pendingRestore.version}. Несохранённые правки пропадут — сохраните их отдельной версией, если они нужны.`
      : ''"
    confirm-label="Откатить"
    @confirm="confirmRestore"
  />
</template>
