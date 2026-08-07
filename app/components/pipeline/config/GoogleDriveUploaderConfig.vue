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
const credentialOptions = computed(() => credentials.value.map(c => ({ value: c.id, label: c.name })))

const folderId = computed(() => String(props.config.folderId ?? ''))
const folderIdValid = computed(() => /^[\w-]{10,}$/.test(folderId.value))

const DEFAULT_NAME_TEMPLATE = '{video.title || "video-" + video.id}.mp4'

const nameTemplate = computed(() =>
  typeof props.config.nameTemplate === 'string' && props.config.nameTemplate.length > 0
    ? props.config.nameTemplate
    : DEFAULT_NAME_TEMPLATE,
)

const skipIfAlreadyUploaded = computed(() =>
  props.config.skipIfAlreadyUploaded === undefined
    ? true
    : Boolean(props.config.skipIfAlreadyUploaded),
)

function onNameTemplateInput(raw: string | number) {
  emit('update', 'nameTemplate', String(raw).slice(0, 200))
}
</script>

<template>
  <UiField label="Учётные данные Drive">
    <div v-if="loading" class="flex items-center gap-2 text-sm text-subtle">
      <Icon name="mingcute:loading-line" class="animate-spin" />
      Загрузка…
    </div>

    <div
      v-else-if="credentials.length === 0"
      class="flex flex-col gap-1 rounded-md border border-warning-border bg-warning-bg px-2.5 py-2 text-sm"
    >
      <p class="text-warning">Нет подключённых Service Account.</p>
      <NuxtLink to="/google-drive" class="text-accent-text">Подключить в /google-drive →</NuxtLink>
    </div>

    <UiSelect
      v-else
      :model-value="config.credentialId ?? ''"
      :options="credentialOptions"
      placeholder="Выберите credential…"
      @update:model-value="(v) => emit('update', 'credentialId', v ? Number(v) : null)"
    />

    <p v-if="errorMessage" class="mt-1 text-micro text-danger">{{ errorMessage }}</p>
    <SharedFieldHint
      text="Service Account для Google Drive с правами Editor на целевую папку. Создаётся в /google-drive."
    />
  </UiField>

  <UiField label="Целевой Folder ID">
    <UiInput
      :model-value="folderId"
      :invalid="folderId.length > 0 && !folderIdValid"
      placeholder="1abcDEFghi-XYZ_..."
      mono
      @update:model-value="(v) => emit('update', 'folderId', v.trim())"
    />
    <SharedFieldHint
      text="ID целевой папки Drive (из URL). Папка должна быть расшарена на client_email сервис-аккаунта с ролью Editor."
      example="1aBcD_efGhIJklMnOpQrStuVwxYz"
    />
  </UiField>

  <UiField label="Шаблон имени файла">
    <UiInput
      :model-value="nameTemplate"
      maxlength="200"
      mono
      @update:model-value="onNameTemplateInput"
    />
    <SharedFieldHint
      text="Поддерживаются плейсхолдеры {video.title}, {video.id} и fallback через ||. Запрещённые символы убираются автоматически."
      :example="DEFAULT_NAME_TEMPLATE"
    />
  </UiField>

  <UiField label="Идемпотентность">
    <UiCheckbox
      :model-value="skipIfAlreadyUploaded"
      label="Пропускать видео, у которых уже есть driveFileId"
      @update:model-value="(v) => emit('update', 'skipIfAlreadyUploaded', v)"
    />
    <SharedFieldHint
      text="Если включено — видео, ранее залитое этой нодой, не будет перезагружено. driveFileId сохраняется в Video после успешной заливки."
    />
  </UiField>
</template>
