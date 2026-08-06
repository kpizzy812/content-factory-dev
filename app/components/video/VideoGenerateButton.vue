<script setup lang="ts">
const { can } = usePermissions()

const props = defineProps<{
  scenarioId: number
  scenarioStatus: string
  hasActiveVideo: boolean
}>()

const { generateVideo, isGenerating, error } = useVideoActions()

const showConfig = ref(false)
const config = ref({
  format: 'portrait',
  subtitlesEnabled: true,
  musicEnabled: true,
  musicMood: 'energetic upbeat',
  musicDuration: 15,
  clipDuration: 5,
  imageCount: 3,
  renderQuality: 'medium',
  targetPlatform: '',
})

const disabledReason = computed(() => {
  if (props.hasActiveVideo) return 'Для этого сценария уже генерируется ролик'
  if (props.scenarioStatus !== 'selected') return 'Сначала нужно выбрать вариант сценария'
  return ''
})

async function handleGenerate() {
  const result = await generateVideo(props.scenarioId, {
    format: config.value.format,
    subtitlesEnabled: config.value.subtitlesEnabled,
    musicEnabled: config.value.musicEnabled,
    musicMood: config.value.musicMood,
    musicDuration: config.value.musicDuration,
    clipDuration: config.value.clipDuration,
    imageCount: config.value.imageCount,
    renderQuality: config.value.renderQuality,
    targetPlatform: config.value.targetPlatform || undefined,
  })
  if (result) {
    showConfig.value = false
    await navigateTo(`/videos/${(result as { data: { id: number } }).data.id}`)
  }
}
</script>

<template>
  <div v-if="can('canRunAgent')" class="flex flex-col gap-2">
    <UiTooltip v-if="disabledReason" :text="disabledReason" placement="bottom">
      <UiButton variant="primary" disabled>
        <Icon name="mingcute:video-line" />
        Создать ролик
      </UiButton>
    </UiTooltip>
    <UiButton v-else variant="primary" :loading="isGenerating" @click="showConfig = true">
      <Icon v-if="!isGenerating" name="mingcute:video-line" />
      {{ isGenerating ? 'Запускаем' : 'Создать ролик' }}
    </UiButton>

    <div
      v-if="error"
      role="alert"
      class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
    >
      <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
      <span>{{ error }}</span>
    </div>

    <UiModal :open="showConfig" title="Настройки генерации ролика" @close="showConfig = false">
      <VideoOutputConfig v-model="config" />
      <template #footer>
        <UiButton variant="ghost" @click="showConfig = false">Отмена</UiButton>
        <UiButton variant="primary" :loading="isGenerating" @click="handleGenerate">
          <Icon v-if="!isGenerating" name="mingcute:play-fill" />
          Запустить · платно
        </UiButton>
      </template>
    </UiModal>
  </div>
</template>
