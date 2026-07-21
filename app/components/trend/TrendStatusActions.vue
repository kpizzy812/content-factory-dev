<script setup lang="ts">
const { can } = usePermissions()

const props = defineProps<{
  trendId: number
  currentStatus: string
}>()

const emit = defineEmits<{
  updated: [status: string]
}>()

const isUpdating = ref(false)
const errorMessage = ref('')
const isOpen = ref(false)
const dropdownRef = ref<HTMLElement | null>(null)

const statuses = [
  { value: 'new', label: 'Новый' },
  { value: 'reviewed', label: 'Просмотрен' },
  { value: 'in_work', label: 'В работе' },
  { value: 'completed', label: 'Завершён' },
  { value: 'dismissed', label: 'Отклонён' },
] as const

const availableStatuses = computed(() =>
  statuses.filter(s => s.value !== props.currentStatus),
)

async function changeStatus(newStatus: string) {
  isOpen.value = false
  isUpdating.value = true
  errorMessage.value = ''
  try {
    await $fetch(`/api/trends/${props.trendId}/status`, {
      method: 'PUT',
      body: { status: newStatus },
    })
    emit('updated', newStatus)
  } catch {
    errorMessage.value = 'Не удалось сменить статус. Попробуйте ещё раз.'
    setTimeout(() => { errorMessage.value = '' }, 5000)
  } finally {
    isUpdating.value = false
  }
}

function onClickOutside(e: MouseEvent) {
  if (dropdownRef.value && !dropdownRef.value.contains(e.target as Node)) {
    isOpen.value = false
  }
}

onMounted(() => document.addEventListener('click', onClickOutside))
onUnmounted(() => document.removeEventListener('click', onClickOutside))
</script>

<template>
  <div v-if="can('canWrite')">
    <div ref="dropdownRef" class="relative inline-block">
      <button
        class="btn btn-sm btn-outline gap-1"
        :class="{ 'btn-disabled': isUpdating }"
        @click.stop="isOpen = !isOpen"
      >
        <span v-if="isUpdating" class="loading loading-spinner loading-xs" />
        <Icon v-else name="mingcute:transfer-line" />
        Сменить статус
      </button>
      <ul
        v-show="isOpen"
        class="absolute right-0 mt-1 menu bg-base-100 rounded-box z-10 w-52 p-2 shadow-lg border border-base-300"
      >
        <li v-for="s in availableStatuses" :key="s.value">
          <button @click="changeStatus(s.value)">{{ s.label }}</button>
        </li>
      </ul>
    </div>

    <div v-if="errorMessage" role="alert" class="alert alert-error alert-soft mt-2 text-sm">
      <Icon name="mingcute:warning-line" />
      <span>{{ errorMessage }}</span>
    </div>
  </div>
</template>
