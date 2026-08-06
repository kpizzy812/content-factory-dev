<script setup lang="ts">
const { can } = usePermissions()

const props = defineProps<{
  uploadId: number
  status: string
  platformPostUrl?: string | null
  blockedByEnv?: boolean
  attemptCount?: number
}>()

const emit = defineEmits<{ retried: [] }>()

const { retryUpload, isRetrying, error } = useUploadActions()

const canRetry = computed(() => ['failed', 'blocked_by_env'].includes(props.status))
const hasPostUrl = computed(() => props.status === 'published' && props.platformPostUrl)

async function handleRetry() {
  const result = await retryUpload(props.uploadId)
  if (result) emit('retried')
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-1.5">
    <UiButton
      v-if="canRetry && can('canRunAgent')"
      variant="primary"
      :loading="isRetrying"
      @click="handleRetry"
    >
      <Icon v-if="!isRetrying" name="mingcute:refresh-2-line" />
      Повторить
    </UiButton>

    <a v-if="hasPostUrl" :href="platformPostUrl!" target="_blank" rel="noopener">
      <UiButton>
        <Icon name="mingcute:external-link-line" />
        Открыть пост
      </UiButton>
    </a>

    <span v-if="(props.attemptCount || 0) > 1" class="tnum font-mono text-micro text-subtle">
      попытка {{ props.attemptCount }}
    </span>

    <div
      v-if="error"
      role="alert"
      class="flex w-full items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
    >
      <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
      <span>{{ error }}</span>
    </div>
  </div>
</template>
