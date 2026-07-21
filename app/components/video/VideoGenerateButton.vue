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

const isDisabled = computed(() => {
  if (isGenerating.value) return true
  if (props.scenarioStatus !== 'selected') return true
  if (props.hasActiveVideo) return true
  return false
})

const disabledReason = computed(() => {
  if (props.hasActiveVideo) return 'Для этого сценария уже генерируется видео'
  if (props.scenarioStatus !== 'selected') return 'Сценарий должен быть в статусе "Выбран"'
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
  <div v-if="can('canRunAgent')">
    <div
      :class="{ 'tooltip tooltip-bottom': isDisabled && !isGenerating }"
      :data-tip="disabledReason"
    >
      <button
        class="btn btn-sm btn-primary gap-1"
        :class="{ 'btn-disabled opacity-50': isDisabled }"
        :disabled="isDisabled"
        @click="showConfig = true"
      >
        <template v-if="isGenerating">
          <span class="loading loading-spinner loading-xs" />
          Запуск генерации...
        </template>
        <template v-else>
          <Icon name="mingcute:video-line" />
          Создать видео
        </template>
      </button>
    </div>

    <div v-if="error" role="alert" class="alert alert-error alert-soft text-sm mt-2">
      <Icon name="mingcute:warning-line" />
      <span>{{ error }}</span>
    </div>

    <!-- Config modal -->
    <dialog :class="{ 'modal modal-open': showConfig, 'modal': !showConfig }">
      <div class="modal-box max-w-lg">
        <h3 class="text-lg font-bold mb-4">Настройки генерации видео</h3>

        <VideoOutputConfig v-model="config" />

        <div class="modal-action">
          <button class="btn btn-ghost" @click="showConfig = false">Отмена</button>
          <button
            class="btn btn-primary"
            :disabled="isGenerating"
            @click="handleGenerate"
          >
            <span v-if="isGenerating" class="loading loading-spinner loading-xs" />
            <Icon v-else name="mingcute:play-fill" />
            Запустить генерацию
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button @click="showConfig = false">close</button>
      </form>
    </dialog>
  </div>
</template>
