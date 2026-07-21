<script setup lang="ts">
const { can } = usePermissions()

const props = defineProps<{
  uploadId: number
  status: string
  platformPostUrl?: string | null
  blockedByEnv?: boolean
  attemptCount?: number
}>()

const emit = defineEmits<{
  retried: []
}>()

const { retryUpload, isRetrying, error } = useUploadActions()

const canRetry = computed(() => ['failed', 'blocked_by_env'].includes(props.status))
const hasPostUrl = computed(() => props.status === 'published' && props.platformPostUrl)

async function handleRetry() {
  const result = await retryUpload(props.uploadId)
  if (result) {
    emit('retried')
  }
}
</script>

<template>
  <div class="flex flex-wrap gap-2 items-center">
    <!-- Blocked by env warning -->
    <div v-if="props.blockedByEnv" class="alert alert-warning text-xs w-full">
      <Icon name="mingcute:lock-line" />
      <span>Публикация отключена через ENABLE_SOCIAL_POSTING=false. Загрузка будет выполнена после включения.</span>
    </div>

    <!-- Повторить -->
    <button
      v-if="canRetry && can('canRunAgent')"
      class="btn btn-sm btn-warning gap-1"
      :disabled="isRetrying"
      @click="handleRetry"
    >
      <span v-if="isRetrying" class="loading loading-spinner loading-xs" />
      <Icon v-else name="mingcute:refresh-2-line" />
      {{ props.blockedByEnv ? 'Повторить (требуется ENV)' : 'Повторить' }}
    </button>

    <!-- Ссылка на пост -->
    <a
      v-if="hasPostUrl"
      :href="platformPostUrl!"
      target="_blank"
      rel="noopener"
      class="btn btn-sm btn-primary btn-outline gap-1"
    >
      <Icon name="mingcute:external-link-line" />
      Открыть пост
    </a>

    <!-- Attempt count -->
    <span v-if="(props.attemptCount || 0) > 1" class="text-xs text-base-content/50">
      Попытка {{ props.attemptCount }}
    </span>

    <!-- Ошибка -->
    <div v-if="error" role="alert" class="alert alert-error alert-soft text-sm w-full">
      <Icon name="mingcute:warning-line" />
      <span>{{ error }}</span>
    </div>
  </div>
</template>
