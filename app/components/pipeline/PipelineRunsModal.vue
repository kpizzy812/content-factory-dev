<script setup lang="ts">
const props = defineProps<{
  pipelineId: number
  visible: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const modalRef = ref<HTMLDialogElement | null>(null)
const page = ref(1)
const statusFilter = ref('')
const triggerFilter = ref('')
const searchQuery = ref('')

const { data, pending, error, refresh } = usePipelineRuns(
  computed(() => props.pipelineId),
  page,
)

const runs = computed(() => {
  let list = data.value?.data ?? []
  if (statusFilter.value) {
    list = list.filter((r: any) => r.status === statusFilter.value)
  }
  if (triggerFilter.value) {
    list = list.filter((r: any) => r.triggerType === triggerFilter.value)
  }
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase()
    list = list.filter((r: any) =>
      String(r.id).includes(q)
      || (r.errorMessage && r.errorMessage.toLowerCase().includes(q))
      || (r.triggerType && r.triggerType.toLowerCase().includes(q)),
    )
  }
  return list
})

const meta = computed(() => data.value?.meta)

const stats = computed(() => {
  const all = data.value?.data ?? []
  return {
    total: all.length,
    success: all.filter((r: any) => r.status === 'success').length,
    failed: all.filter((r: any) => r.status === 'failed').length,
    running: all.filter((r: any) => r.status === 'running').length,
  }
})

const basePath = computed(() => `/pipeline/${props.pipelineId}`)

function handleClose() {
  modalRef.value?.close()
  emit('close')
}

watch(() => props.visible, (val) => {
  if (val) {
    refresh()
    nextTick(() => modalRef.value?.showModal())
  } else {
    modalRef.value?.close()
  }
})
</script>

<template>
  <dialog ref="modalRef" class="modal" @close="emit('close')">
    <div class="modal-box max-w-3xl max-h-[80vh] flex flex-col">
      <!-- Header -->
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-lg font-bold flex items-center gap-2">
          <Icon name="mingcute:time-line" class="text-primary" />
          Запуски
        </h3>
        <button class="btn btn-ghost btn-sm btn-square" @click="handleClose">
          <Icon name="mingcute:close-line" />
        </button>
      </div>

      <!-- Stats -->
      <PipelineRunStats
        v-if="!pending && !error"
        :total="stats.total"
        :success="stats.success"
        :failed="stats.failed"
        :running="stats.running"
        class="mb-3"
      />

      <!-- Filters -->
      <div class="flex items-center gap-2 flex-wrap mb-3">
        <label class="input input-sm flex-1 min-w-36">
          <Icon name="mingcute:search-line" class="text-base-content/40" />
          <input v-model="searchQuery" type="text" placeholder="Поиск..." />
        </label>
        <select v-model="statusFilter" class="select select-sm">
          <option value="">Все статусы</option>
          <option value="success">Успешно</option>
          <option value="failed">Ошибка</option>
          <option value="running">Выполняется</option>
          <option value="pending">Ожидание</option>
          <option value="cancelled">Отменён</option>
        </select>
        <select v-model="triggerFilter" class="select select-sm">
          <option value="">Все триггеры</option>
          <option value="manual">Вручную</option>
          <option value="schedule">По расписанию</option>
          <option value="webhook">Webhook</option>
        </select>
      </div>

      <!-- Scrollable content -->
      <div class="flex-1 overflow-y-auto min-h-0 space-y-1.5">
        <!-- Loading -->
        <div v-if="pending" class="flex justify-center py-8">
          <span class="loading loading-spinner loading-lg" />
        </div>

        <!-- Error -->
        <div v-else-if="error" role="alert" class="alert alert-error">
          <Icon name="mingcute:warning-line" />
          <span>{{ error.message }}</span>
        </div>

        <!-- Empty -->
        <div v-else-if="runs.length === 0 && !searchQuery && !statusFilter && !triggerFilter" class="text-center py-8">
          <Icon name="mingcute:inbox-line" class="text-3xl text-base-content/20 mb-2" />
          <p class="text-sm text-base-content/50">Запусков пока нет</p>
          <p class="text-xs text-base-content/30 mt-1">Запустите конвейер кнопкой «Запустить»</p>
        </div>

        <!-- Filtered empty -->
        <div v-else-if="runs.length === 0" class="text-center py-6 text-base-content/50">
          <p class="text-sm">Ничего не найдено</p>
          <button class="btn btn-xs btn-ghost mt-1" @click="searchQuery = ''; statusFilter = ''; triggerFilter = ''">
            Сбросить фильтры
          </button>
        </div>

        <!-- Runs list -->
        <PipelineRunCard
          v-for="run in runs"
          v-else
          :key="run.id"
          :run="run"
          :base-path="basePath"
          compact
        />
      </div>

      <!-- Pagination -->
      <div v-if="meta && meta.totalPages > 1" class="pt-3 border-t border-base-300 mt-3">
        <div class="join">
          <button
            v-for="p in meta.totalPages"
            :key="p"
            class="join-item btn btn-xs"
            :class="p === meta.page ? 'btn-primary' : 'btn-ghost'"
            @click="page = p"
          >
            {{ p }}
          </button>
        </div>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button @click="emit('close')">close</button>
    </form>
  </dialog>
</template>
