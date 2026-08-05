<script setup lang="ts">
const emit = defineEmits<{
  created: []
}>()

const { createIdea } = useIdeaActions()

const form = reactive({
  sourceUrl: '',
  appId: undefined as number | undefined,
  language: '',
})

const isSubmitting = ref(false)
const errorMessage = ref('')

// Загрузка списка приложений
const { data: appsData } = useFetch('/api/admin/apps')
const apps = computed(() => appsData.value?.data ?? [])

const languages = [
  { value: '', label: 'Авто (русский)' },
  { value: 'русский', label: 'Русский' },
  { value: 'английский', label: 'Английский' },
  { value: 'испанский', label: 'Испанский' },
]

async function handleSubmit() {
  if (!form.sourceUrl.trim()) return

  isSubmitting.value = true
  errorMessage.value = ''

  try {
    await createIdea({
      sourceUrl: form.sourceUrl.trim(),
      ...(form.appId ? { appId: form.appId } : {}),
      ...(form.language ? { language: form.language } : {}),
    })
    form.sourceUrl = ''
    form.appId = undefined
    form.language = ''
    emit('created')
  } catch {
    errorMessage.value = 'Не удалось создать идею. Проверьте URL и попробуйте снова.'
    setTimeout(() => { errorMessage.value = '' }, 5000)
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <form class="flex flex-col gap-2 rounded-lg border border-border bg-panel p-3" @submit.prevent="handleSubmit">
    <div class="flex flex-col gap-2 sm:flex-row sm:items-end">
      <UiField label="Ссылка на ролик" class="flex-1">
        <UiInput
          v-model="form.sourceUrl"
          type="url"
          placeholder="YouTube, TikTok, Instagram или прямая ссылка"
          :disabled="isSubmitting"
        />
      </UiField>

      <UiField label="Приложение" class="w-52">
        <UiSelect
          :model-value="form.appId ?? ''"
          :disabled="isSubmitting"
          :options="[
            { value: '', label: 'Не выбрано' },
            ...apps.map((a: { id: number, name: string }) => ({ value: a.id, label: a.name })),
          ]"
          @update:model-value="form.appId = $event ? Number($event) : undefined"
        />
      </UiField>

      <UiField label="Язык" class="w-44">
        <UiSelect v-model="form.language" :options="languages" :disabled="isSubmitting" />
      </UiField>

      <UiButton
        type="submit"
        variant="primary"
        :loading="isSubmitting"
        :disabled="!form.sourceUrl.trim()"
      >
        Добавить
      </UiButton>
    </div>

    <p v-if="errorMessage" class="text-sm text-danger">{{ errorMessage }}</p>
  </form>
</template>
