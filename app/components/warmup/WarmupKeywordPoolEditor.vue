<script setup lang="ts">
import type { KeywordPoolUpsertBody } from "~~/app/composables/useWarmupKeywords"
import type { WarmupKeywordPoolDto, WarmupPlatform } from "~~/shared/types/warmup"

const emit = defineEmits<{
  saved: []
  close: []
}>()

const isOpen = ref(false)
const editingId = ref<string | null>(null)
const isProcessingLocal = ref(false)
const errorMessage = ref<string | null>(null)

const form = reactive({
  name: "",
  appId: "" as string,
  language: "" as "" | "ru" | "en" | "null",
  category: "general",
  platform: "" as "" | WarmupPlatform,
  keywords: [] as string[],
  hashtags: [] as string[],
  isActive: true,
})

const CATEGORIES = ["general", "tech", "lifestyle", "fitness", "education", "music", "comments"]

const CATEGORY_OPTIONS = CATEGORIES.map(c => ({ value: c, label: c }))

const LANGUAGE_OPTIONS = [
  { value: "", label: "Любой язык" },
  { value: "en", label: "English" },
  { value: "ru", label: "Русский" },
]

const PLATFORM_OPTIONS = [
  { value: "", label: "Все платформы" },
  { value: "tiktok", label: "TikTok" },
  { value: "instagram", label: "Instagram" },
  { value: "youtube", label: "YouTube" },
]

const { createPool, updatePool } = useWarmupKeywords()

function reset() {
  editingId.value = null
  errorMessage.value = null
  form.name = ""
  form.appId = ""
  form.language = ""
  form.category = "general"
  form.platform = ""
  form.keywords = []
  form.hashtags = []
  form.isActive = true
}

function open(pool?: WarmupKeywordPoolDto) {
  reset()
  if (pool) {
    editingId.value = pool.id
    form.name = pool.name
    form.appId = pool.appId ? String(pool.appId) : ""
    form.language = (pool.language as "ru" | "en" | null) ?? ""
    form.category = pool.category
    form.platform = (pool.platform as WarmupPlatform) ?? ""
    form.keywords = [...pool.keywords]
    form.hashtags = [...pool.hashtags]
    form.isActive = pool.isActive
  }
  isOpen.value = true
}

function close() {
  if (isProcessingLocal.value) return
  isOpen.value = false
  reset()
  emit("close")
}

function buildBody(): KeywordPoolUpsertBody | null {
  if (!form.name.trim()) {
    errorMessage.value = "Введите название"
    return null
  }
  if (form.keywords.length === 0) {
    errorMessage.value = "Добавьте хотя бы одно ключевое слово"
    return null
  }
  return {
    name: form.name.trim(),
    appId: form.appId ? Number(form.appId) : null,
    language: form.language === "" ? null : form.language === "null" ? null : form.language,
    category: form.category,
    platform: form.platform === "" ? null : form.platform,
    keywords: form.keywords,
    hashtags: form.hashtags,
    isActive: form.isActive,
  }
}

async function save() {
  errorMessage.value = null
  const body = buildBody()
  if (!body) return
  isProcessingLocal.value = true
  try {
    const result = editingId.value
      ? await updatePool(editingId.value, body)
      : await createPool(body)
    if (result) {
      emit("saved")
      close()
    } else {
      errorMessage.value = "Не удалось сохранить пул"
    }
  } finally {
    isProcessingLocal.value = false
  }
}

defineExpose({ open, close })
</script>

<template>
  <UiModal
    :open="isOpen"
    size="lg"
    :title="editingId ? 'Пул ключевых слов' : 'Новый пул ключевых слов'"
    @close="close"
  >
    <div class="flex flex-col gap-3">
      <UiField label="Название">
        <UiInput v-model="form.name" placeholder="Например, general_en" />
      </UiField>

      <div class="grid gap-3 md:grid-cols-3">
        <UiField label="Категория">
          <UiSelect v-model="form.category" :options="CATEGORY_OPTIONS" />
        </UiField>
        <UiField label="Язык">
          <UiSelect v-model="form.language" :options="LANGUAGE_OPTIONS" />
        </UiField>
        <UiField label="Платформа">
          <UiSelect v-model="form.platform" :options="PLATFORM_OPTIONS" />
        </UiField>
      </div>

      <UiField label="Приложение" hint="Пусто — пул общий для всех приложений">
        <UiInput v-model="form.appId" type="number" mono placeholder="номер приложения" class="max-w-44" />
      </UiField>

      <UiField label="Ключевые слова" hint="Enter или запятая добавляют слово">
        <SharedTagInput v-model="form.keywords" placeholder="кухня на заказ" />
      </UiField>

      <UiField label="Хэштеги">
        <SharedTagInput v-model="form.hashtags" placeholder="#fyp" />
      </UiField>

      <UiCheckbox v-model="form.isActive" label="Планировщик берёт слова из этого пула" />

      <p
        v-if="errorMessage"
        role="alert"
        class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
      >
        <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
        <span class="min-w-0 flex-1">{{ errorMessage }}</span>
      </p>
    </div>

    <template #footer>
      <UiButton variant="ghost" :disabled="isProcessingLocal" @click="close">Отмена</UiButton>
      <UiButton variant="primary" :loading="isProcessingLocal" @click="save">Сохранить</UiButton>
    </template>
  </UiModal>
</template>
