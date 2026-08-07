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

const onlyUnlabeled = computed(() =>
  props.config.onlyUnlabeled === undefined ? true : Boolean(props.config.onlyUnlabeled),
)

const batchSize = computed(() => Number(props.config.batchSize ?? 10))

function onBatchSizeChange(raw: string | number) {
  const v = Number(raw)
  if (Number.isFinite(v) && v >= 1 && v <= 100) {
    emit('update', 'batchSize', v)
  }
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
    <SharedFieldHint text="Service Account для Google Drive. Создаётся в /google-drive." />
  </UiField>

  <UiField label="Folder ID">
    <UiInput
      :model-value="folderId"
      :invalid="folderId.length > 0 && !folderIdValid"
      placeholder="1abcDEFghi-XYZ_..."
      mono
      @update:model-value="(v) => emit('update', 'folderId', v.trim())"
    />
    <SharedFieldHint
      text="ID из URL Drive: drive.google.com/drive/folders/<ID>. Минимум 10 символов, только буквы, цифры, дефисы и подчёркивания."
      example="1aBcD_efGhIJklMnOpQrStuVwxYz"
    />
  </UiField>

  <UiField label="Только неразмеченные">
    <UiCheckbox
      :model-value="onlyUnlabeled"
      label="Пропускать файлы с уже сгенерированной подписью"
      @update:model-value="(v) => emit('update', 'onlyUnlabeled', v)"
    />
    <SharedFieldHint
      text="Если включено — берём только DriveFile с hasGeneratedCaption=false. Помогает не зацикливаться на уже обработанных видео."
    />
  </UiField>

  <UiField label="Размер пачки">
    <UiInput
      type="number"
      min="1"
      max="100"
      :model-value="batchSize"
      @update:model-value="onBatchSizeChange"
    />
    <SharedFieldHint
      text="Сколько видео обрабатывать за один запуск. Больше — дольше pipeline. По умолчанию 10."
    />
  </UiField>
</template>
