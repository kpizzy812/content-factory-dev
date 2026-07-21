<script setup lang="ts">
const props = defineProps<{
  pipelineId: number
  visible: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const store = usePipelineEditorStore()

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
const versionName = ref('')
const versionDescription = ref('')
const errorMsg = ref<string | null>(null)
// using DaisyUI modal pattern
const expandedVersion = ref<number | null>(null)
const versionGraphData = ref<any>(null)

async function loadVersions() {
  isLoading.value = true
  errorMsg.value = null
  try {
    const res = await $fetch<{ data: VersionItem[] }>(
      `/api/pipelines/${props.pipelineId}/versions`,
    )
    versions.value = res.data ?? []
  } catch {
    errorMsg.value = 'Ошибка загрузки версий'
  } finally {
    isLoading.value = false
  }
}

async function saveVersion() {
  isSaving.value = true
  errorMsg.value = null
  try {
    // Save current graph first
    await $fetch(`/api/pipelines/${props.pipelineId}`, {
      method: 'PUT',
      body: { graphData: store.toGraphData() },
    })

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
  } catch (e: any) {
    errorMsg.value = e?.data?.message || 'Ошибка сохранения версии'
  } finally {
    isSaving.value = false
  }
}

async function restoreVersion(versionId: number) {
  if (!confirm('Восстановить эту версию? Текущий граф будет заменён.')) return

  isRestoring.value = versionId
  errorMsg.value = null
  try {
    const res = await $fetch<{ data: any }>(
      `/api/pipelines/${props.pipelineId}/versions/${versionId}/restore`,
      { method: 'POST' },
    )
    if (res.data) {
      store.loadFromApi(res.data)
    }
    emit('close')
  } catch (e: any) {
    errorMsg.value = e?.data?.message || 'Ошибка восстановления версии'
  } finally {
    isRestoring.value = null
  }
}

function toggleVersionDetails(versionId: number) {
  if (expandedVersion.value === versionId) {
    expandedVersion.value = null
    versionGraphData.value = null
  } else {
    expandedVersion.value = versionId
    // Load graph data for diff comparison could be done here
  }
}

// overlay click handled by modal-backdrop

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleString('ru-RU')
}

// Count nodes in a version's graph
function countNodes(ver: VersionItem): string {
  // We don't have graphData here, so show version number
  return `v${ver.version}`
}

watch(() => props.visible, (v) => {
  if (v) loadVersions()
})
</script>

<template>
  <dialog class="modal" :class="{ 'modal-open': visible }">
    <div class="modal-box max-w-lg space-y-4">
      <div class="flex items-center justify-between">
        <div>
          <h3 class="text-lg font-bold">Версии конвейера</h3>
          <p class="text-xs text-base-content/50">Сохраняйте версии чтобы откатиться к прежнему состоянию</p>
        </div>
        <button class="btn btn-ghost btn-sm btn-square" @click="emit('close')">
          <Icon name="mingcute:close-line" />
        </button>
      </div>

      <!-- Save new version -->
      <div class="space-y-2">
        <div class="flex gap-2">
          <input
            v-model="versionName"
            type="text"
            class="input input-sm flex-1"
            placeholder="Название, например «До рефакторинга»"
          />
          <button
            class="btn btn-sm btn-primary"
            :disabled="isSaving"
            @click="saveVersion"
          >
            <span v-if="isSaving" class="loading loading-spinner loading-sm" />
            <Icon v-else name="mingcute:save-line" />
            Сохранить
          </button>
        </div>
        <input
          v-model="versionDescription"
          type="text"
          class="input input-sm w-full"
          placeholder="Что изменилось? (необязательно)"
        />
      </div>

      <div v-if="errorMsg" class="alert alert-error alert-soft text-sm">
        {{ errorMsg }}
      </div>

      <!-- Versions list -->
      <div v-if="isLoading" class="flex justify-center py-6">
        <span class="loading loading-spinner loading-md" />
      </div>

      <div v-else-if="versions.length === 0" class="text-center text-base-content/50 py-6 text-sm">
        Нет сохранённых версий
      </div>

      <ul v-else class="space-y-1.5 max-h-72 overflow-y-auto">
        <li
          v-for="ver in versions"
          :key="ver.id"
          class="rounded-box bg-base-200/50 hover:bg-base-200 transition-colors"
        >
          <div
            class="flex items-center gap-3 p-2 cursor-pointer"
            @click="toggleVersionDetails(ver.id)"
          >
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium truncate flex items-center gap-1">
                v{{ ver.version }}
                <span v-if="ver.name" class="text-base-content/60"> — {{ ver.name }}</span>
                <span v-if="ver.isDeployed" class="badge badge-xs badge-success">deployed</span>
              </div>
              <div class="text-xs text-base-content/50">
                {{ formatDate(ver.createdAt) }}
              </div>
              <div v-if="ver.description" class="text-xs text-base-content/40 mt-0.5">
                {{ ver.description }}
              </div>
            </div>
            <div class="tooltip tooltip-left" data-tip="Откатить граф к этой версии">
              <button
                class="btn btn-xs btn-ghost shrink-0"
                :disabled="isRestoring === ver.id"
                @click.stop="restoreVersion(ver.id)"
              >
                <span v-if="isRestoring === ver.id" class="loading loading-spinner loading-xs" />
                <Icon v-else name="mingcute:refresh-2-line" />
                Откатить
              </button>
            </div>
          </div>
        </li>
      </ul>
    </div>
    <form method="dialog" class="modal-backdrop" @click="emit('close')">
      <button>close</button>
    </form>
  </dialog>
</template>
