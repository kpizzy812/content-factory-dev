<script setup lang="ts">
import type { KeywordPoolUpsertBody } from "~~/app/composables/useWarmupKeywords"
import type { WarmupKeywordPoolDto, WarmupPlatform } from "~~/shared/types/warmup"

const emit = defineEmits<{
  saved: []
  close: []
}>()

const dialogRef = ref<HTMLDialogElement>()
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
  dialogRef.value?.showModal()
}

function close() {
  dialogRef.value?.close()
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
  <dialog ref="dialogRef" class="modal">
    <div class="modal-box max-w-2xl">
      <h3 class="font-bold text-lg">
        {{ editingId ? "Редактирование пула" : "Новый пул ключевых слов" }}
      </h3>

      <div class="space-y-3 mt-4">
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Название</legend>
          <input
            v-model="form.name"
            type="text"
            class="input w-full"
            placeholder="Например, general_en"
          />
        </fieldset>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Категория</legend>
            <select v-model="form.category" class="select w-full">
              <option v-for="c in CATEGORIES" :key="c" :value="c">{{ c }}</option>
            </select>
          </fieldset>

          <fieldset class="fieldset">
            <legend class="fieldset-legend">Язык</legend>
            <select v-model="form.language" class="select w-full">
              <option value="">Универсальный</option>
              <option value="en">English</option>
              <option value="ru">Русский</option>
            </select>
          </fieldset>

          <fieldset class="fieldset">
            <legend class="fieldset-legend">Платформа</legend>
            <select v-model="form.platform" class="select w-full">
              <option value="">Все</option>
              <option value="tiktok">TikTok</option>
              <option value="instagram">Instagram</option>
              <option value="youtube">YouTube</option>
            </select>
          </fieldset>
        </div>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">App ID (опционально)</legend>
          <input
            v-model="form.appId"
            type="number"
            class="input w-full"
            placeholder="Оставьте пустым для глобального пула"
          />
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Ключевые слова</legend>
          <SharedTagInput
            v-model="form.keywords"
            placeholder="Введите слово и Enter / запятая"
          />
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Хэштеги (опционально)</legend>
          <SharedTagInput
            v-model="form.hashtags"
            placeholder="#fyp, #viral"
          />
        </fieldset>

        <label class="label cursor-pointer justify-start gap-2">
          <input v-model="form.isActive" type="checkbox" class="toggle toggle-primary" />
          <span class="label-text">Активен (используется в planner)</span>
        </label>

        <div v-if="errorMessage" class="alert alert-error text-sm">
          <Icon name="mingcute:alert-line" />
          {{ errorMessage }}
        </div>
      </div>

      <div class="modal-action">
        <button class="btn btn-sm" :disabled="isProcessingLocal" @click="close">
          Отмена
        </button>
        <button
          class="btn btn-sm btn-primary"
          :disabled="isProcessingLocal"
          @click="save"
        >
          <span v-if="isProcessingLocal" class="loading loading-spinner loading-xs" />
          <Icon v-else name="mingcute:save-line" />
          Сохранить
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button @click="close">close</button>
    </form>
  </dialog>
</template>
