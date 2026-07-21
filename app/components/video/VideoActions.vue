<script setup lang="ts">
const { can } = usePermissions()

const props = defineProps<{
  videoId: number
  fileUrl: string | null
  status: string
}>()

const emit = defineEmits<{
  deleted: []
}>()

const { deleteVideo, isDeleting, error } = useVideoActions()

const isCompleted = computed(() => props.status === 'completed')
const downloadUrl = computed(() => {
  if (!props.fileUrl) return null
  return `/api/files/${props.fileUrl}`
})

const showDeleteModal = ref(false)

function openDeleteModal() {
  showDeleteModal.value = true
}

function closeDeleteModal() {
  showDeleteModal.value = false
}

async function handleDelete() {
  const result = await deleteVideo(props.videoId)
  if (result) {
    closeDeleteModal()
    emit('deleted')
  }
}
</script>

<template>
  <div class="flex flex-wrap gap-2">
    <!-- Скачать -->
    <a
      v-if="isCompleted && downloadUrl"
      :href="downloadUrl"
      download
      class="btn btn-sm btn-primary gap-1"
    >
      <Icon name="mingcute:download-2-line" />
      Скачать
    </a>

    <!-- Удалить -->
    <button
      v-if="can('canDelete')"
      class="btn btn-sm btn-error btn-outline gap-1"
      :disabled="isDeleting"
      @click="openDeleteModal"
    >
      <span v-if="isDeleting" class="loading loading-spinner loading-xs" />
      <Icon v-else name="mingcute:delete-2-line" />
      Удалить
    </button>

    <!-- Ошибка -->
    <div v-if="error" role="alert" class="alert alert-error alert-soft text-sm w-full">
      <Icon name="mingcute:warning-line" />
      <span>{{ error }}</span>
    </div>

    <!-- Modal подтверждения удаления -->
    <dialog
      class="modal"
      :class="{ 'modal-open': showDeleteModal }"
    >
      <div class="modal-box max-w-lg">
        <h3 class="font-bold text-lg mb-1">Удалить видео?</h3>
        <p class="text-xs text-base-content/60 mb-4">
          Видео и все связанные файлы будут удалены безвозвратно. Это действие нельзя отменить.
        </p>
        <div class="modal-action">
          <button class="btn btn-sm btn-ghost" @click="closeDeleteModal">Отмена</button>
          <button
            class="btn btn-sm btn-error"
            :disabled="isDeleting"
            @click="handleDelete"
          >
            <span v-if="isDeleting" class="loading loading-spinner loading-xs" />
            Удалить
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button @click="closeDeleteModal">close</button>
      </form>
    </dialog>
  </div>
</template>
