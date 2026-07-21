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

const onlyUnlabeled = computed(() =>
  props.config.onlyUnlabeled === undefined ? true : Boolean(props.config.onlyUnlabeled),
)

const batchSize = computed(() => Number(props.config.batchSize ?? 10))

function onCredentialChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  emit('update', 'credentialId', value ? Number(value) : null)
}

function onFolderIdInput(event: Event) {
  emit('update', 'folderId', (event.target as HTMLInputElement).value.trim())
}

function onUnlabeledChange(event: Event) {
  emit('update', 'onlyUnlabeled', (event.target as HTMLInputElement).checked)
}

function onBatchSizeChange(event: Event) {
  const v = Number((event.target as HTMLInputElement).value)
  if (Number.isFinite(v) && v >= 1 && v <= 100) {
    emit('update', 'batchSize', v)
  }
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
      text="Service Account для Google Drive. Создаётся в /google-drive."
    />
  </fieldset>

  <fieldset class="fieldset">
    <legend class="fieldset-legend">Folder ID</legend>
    <input
      type="text"
      class="input input-sm w-full"
      :class="{ 'input-error': folderId.length > 0 && !folderIdValid }"
      :value="folderId"
      placeholder="1abcDEFghi-XYZ_..."
      @input="onFolderIdInput"
    />
    <SharedFieldHint
      text="ID из URL Drive: drive.google.com/drive/folders/<ID>. Минимум 10 символов, только буквы/цифры/дефисы/подчёркивания."
      example="1aBcD_efGhIJklMnOpQrStuVwxYz"
    />
  </fieldset>

  <fieldset class="fieldset">
    <legend class="fieldset-legend">Только неразмеченные</legend>
    <label class="label cursor-pointer justify-start gap-2 p-0">
      <input
        type="checkbox"
        class="checkbox checkbox-sm"
        :checked="onlyUnlabeled"
        @change="onUnlabeledChange"
      />
      <span class="text-xs">Пропускать файлы с уже сгенерированной подписью</span>
    </label>
    <SharedFieldHint
      text="Если включено — берём только DriveFile с hasGeneratedCaption=false. Помогает не зацикливаться на уже обработанных видео."
    />
  </fieldset>

  <fieldset class="fieldset">
    <legend class="fieldset-legend">Размер пачки</legend>
    <input
      type="number"
      class="input input-sm w-full"
      min="1"
      max="100"
      :value="batchSize"
      @change="onBatchSizeChange"
    />
    <SharedFieldHint
      text="Сколько видео обрабатывать за один запуск. Больше — дольше pipeline. По умолчанию 10."
    />
  </fieldset>
</template>
