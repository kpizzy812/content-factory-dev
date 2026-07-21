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
  <div class="card bg-base-100 shadow-sm">
    <div class="card-body p-4 gap-3">
      <h3 class="card-title text-sm">
        <Icon name="mingcute:add-line" class="text-primary" />
        Добавить идею
      </h3>

      <div class="flex flex-col sm:flex-row gap-3">
        <fieldset class="fieldset flex-1">
          <legend class="fieldset-legend">URL видео</legend>
          <input
            v-model="form.sourceUrl"
            type="url"
            class="input w-full"
            placeholder="YouTube, TikTok, Instagram или прямая ссылка на видео/изображение"
            :disabled="isSubmitting"
          >
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Приложение</legend>
          <select
            v-model="form.appId"
            class="select"
            :disabled="isSubmitting"
          >
            <option :value="undefined">Не выбрано</option>
            <option
              v-for="app in apps"
              :key="app.id"
              :value="app.id"
            >
              {{ app.name }}
            </option>
          </select>
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Язык</legend>
          <select
            v-model="form.language"
            class="select"
            :disabled="isSubmitting"
          >
            <option
              v-for="lang in languages"
              :key="lang.value"
              :value="lang.value"
            >
              {{ lang.label }}
            </option>
          </select>
        </fieldset>

        <div class="flex items-end">
          <button
            class="btn btn-primary gap-1"
            :disabled="!form.sourceUrl.trim() || isSubmitting"
            @click="handleSubmit"
          >
            <span v-if="isSubmitting" class="loading loading-spinner loading-xs" />
            <Icon v-else name="mingcute:send-line" />
            Добавить
          </button>
        </div>
      </div>

      <div v-if="errorMessage" role="alert" class="alert alert-error alert-soft text-sm">
        <Icon name="mingcute:warning-line" />
        <span>{{ errorMessage }}</span>
      </div>
    </div>
  </div>
</template>
