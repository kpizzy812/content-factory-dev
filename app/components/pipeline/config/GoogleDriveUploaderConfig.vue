<script setup lang="ts">
const props = defineProps<{
  config: Record<string, any>
}>()

const emit = defineEmits<{
  update: [key: string, value: any]
}>()

const drive = useGoogleDrive()
const loading = ref(false)
const errorMessage = ref<string | null>(null)

async function loadCredentials() {
  loading.value = true
  errorMessage.value = null
  try {
    await drive.fetchCredentials()
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : 'Не удалось загрузить credentials'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadCredentials()
})

const credentials = computed(() => drive.credentials.value)

const folderId = computed(() => String(props.config.folderId ?? ''))
const folderIdValid = computed(() => /^[\w-]{10,}$/.test(folderId.value))

const nameTemplate = computed(() =>
  typeof props.config.nameTemplate === 'string' && props.config.nameTemplate.length > 0
    ? props.config.nameTemplate
    : '{video.title || "video-" + video.id}.mp4',
)

const skipIfAlreadyUploaded = computed(() =>
  props.config.skipIfAlreadyUploaded === undefined
    ? true
    : Boolean(props.config.skipIfAlreadyUploaded),
)

function onCredentialChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  emit('update', 'credentialId', value ? Number(value) : null)
}

function onFolderIdInput(event: Event) {
  emit('update', 'folderId', (event.target as HTMLInputElement).value.trim())
}

function onNameTemplateInput(event: Event) {
  const value = (event.target as HTMLInputElement).value.slice(0, 200)
  emit('update', 'nameTemplate', value)
}

function onSkipChange(event: Event) {
  emit('update', 'skipIfAlreadyUploaded', (event.target as HTMLInputElement).checked)
}
</script>

<template>
  <fieldset class="fieldset">
    <legend class="fieldset-legend">Учётные данные Drive</legend>
    <div v-if="loading" class="text-xs text-base-content/50 flex items-center gap-2">
      <span class="loading loading-spinner loading-xs" />
      Загрузка...
    </div>
    <div v-else-if="credentials.length === 0" class="rounded-box bg-warning/10 p-2 text-xs space-y-1">
      <p class="text-warning-content">Нет подключённых Service Account.</p>
      <NuxtLink to="/google-drive" class="link link-primary text-xs">
        Подключить в /google-drive →
      </NuxtLink>
    </div>
    <select
      v-else
      class="select select-sm w-full"
      :value="config.credentialId ?? ''"
      @change="onCredentialChange"
    >
      <option value="" disabled>Выберите credential...</option>
      <option v-for="c in credentials" :key="c.id" :value="c.id">
        {{ c.name }}
      </option>
    </select>
    <p v-if="errorMessage" class="text-[10px] text-error mt-1">{{ errorMessage }}</p>
    <SharedFieldHint
      text="Service Account для Google Drive с правами Editor на целевую папку. Создаётся в /google-drive."
    />
  </fieldset>

  <fieldset class="fieldset">
    <legend class="fieldset-legend">Целевой Folder ID</legend>
    <input
      type="text"
      class="input input-sm w-full"
      :class="{ 'input-error': folderId.length > 0 && !folderIdValid }"
      :value="folderId"
      placeholder="1abcDEFghi-XYZ_..."
      @input="onFolderIdInput"
    />
    <SharedFieldHint
      text="ID целевой папки Drive (из URL). Папка должна быть расшарена на client_email сервис-аккаунта с ролью Editor."
      example="1aBcD_efGhIJklMnOpQrStuVwxYz"
    />
  </fieldset>

  <fieldset class="fieldset">
    <legend class="fieldset-legend">Шаблон имени файла</legend>
    <input
      type="text"
      class="input input-sm w-full"
      :value="nameTemplate"
      maxlength="200"
      @input="onNameTemplateInput"
    />
    <SharedFieldHint
      text='Поддерживаются плейсхолдеры {video.title}, {video.id} и fallback через ||. Запрещённые символы убираются автоматически.'
      example='{video.title || "video-" + video.id}.mp4'
    />
  </fieldset>

  <fieldset class="fieldset">
    <legend class="fieldset-legend">Идемпотентность</legend>
    <label class="label cursor-pointer justify-start gap-2 p-0">
      <input
        type="checkbox"
        class="checkbox checkbox-sm"
        :checked="skipIfAlreadyUploaded"
        @change="onSkipChange"
      />
      <span class="text-xs">Пропускать видео, у которых уже есть driveFileId</span>
    </label>
    <SharedFieldHint
      text="Если включено — видео, ранее залитое этой нодой, не будет перезагружено. driveFileId сохраняется в Video после успешной заливки."
    />
  </fieldset>
</template>
