<script setup lang="ts">
/**
 * TaxonomyManager — модальное окно для CRUD управления taxonomy items.
 * Открывается из TaxonomyPicker или отдельно.
 */
import type { TaxonomyItem, TaxonomyCreateInput } from '~/composables/useTaxonomy'

const props = defineProps<{
  type: string
}>()

const emit = defineEmits<{
  close: []
}>()

const { items, filtered, categories, loading, error: taxonomyError, searchQuery, selectedCategory, create, update, remove, load } = useTaxonomy(() => props.type)

const typeLabels: Record<string, string> = {
  strategy: 'Стратегии',
  hook_style: 'Стили хуков',
  prompt_pattern: 'Шаблоны промтов',
}

// Edit/Create state
const editingItem = ref<TaxonomyItem | null>(null)
const isCreating = ref(false)

const form = reactive({
  name: '',
  shortDescription: '',
  fullExplanation: '',
  category: '',
  tags: '' as string,
  examples: '' as string,
  useCases: '' as string,
})

const saving = ref(false)

function openCreate() {
  editingItem.value = null
  isCreating.value = true
  Object.assign(form, {
    name: '',
    shortDescription: '',
    fullExplanation: '',
    category: '',
    tags: '',
    examples: '',
    useCases: '',
  })
}

function openEdit(item: TaxonomyItem) {
  editingItem.value = item
  isCreating.value = true
  Object.assign(form, {
    name: item.name,
    shortDescription: item.shortDescription,
    fullExplanation: item.fullExplanation || '',
    category: item.category || '',
    tags: item.tags.join(', '),
    examples: item.examples.join('\n'),
    useCases: item.useCases.join(', '),
  })
}

const saveError = ref<string | null>(null)

async function save() {
  saving.value = true
  saveError.value = null
  const input: TaxonomyCreateInput = {
    type: props.type,
    name: form.name,
    shortDescription: form.shortDescription,
    fullExplanation: form.fullExplanation || undefined,
    category: form.category || undefined,
    tags: form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
    examples: form.examples ? form.examples.split('\n').map(e => e.trim()).filter(Boolean) : [],
    useCases: form.useCases ? form.useCases.split(',').map(u => u.trim()).filter(Boolean) : [],
  }

  let result
  if (editingItem.value) {
    result = await update(editingItem.value.id, input)
  } else {
    result = await create(input)
  }
  saving.value = false

  if (result) {
    isCreating.value = false
    editingItem.value = null
  } else {
    saveError.value = taxonomyError.value || 'Ошибка сохранения'
  }
}

// AI draft generation
const aiPrompt = ref('')
const aiGenerating = ref(false)

async function generateWithAi() {
  if (!aiPrompt.value.trim()) return
  aiGenerating.value = true
  try {
    const res = await $fetch<{ data: { draft: any } }>('/api/ai/suggest/taxonomy', {
      method: 'POST',
      body: {
        type: props.type,
        prompt: aiPrompt.value.trim(),
      },
    })
    if (res.data?.draft) {
      // Заполняем форму данными от AI
      editingItem.value = null
      isCreating.value = true
      const d = res.data.draft
      Object.assign(form, {
        name: d.name || '',
        shortDescription: d.shortDescription || '',
        fullExplanation: d.fullExplanation || '',
        category: d.category || '',
        tags: Array.isArray(d.tags) ? d.tags.join(', ') : '',
        examples: Array.isArray(d.examples) ? d.examples.join('\n') : '',
        useCases: Array.isArray(d.useCases) ? d.useCases.join(', ') : '',
      })
      aiPrompt.value = ''
    }
  } catch (e: any) {
    saveError.value = e?.data?.message || e?.message || 'Ошибка генерации AI'
  } finally {
    aiGenerating.value = false
  }
}

const confirmDelete = ref<number | null>(null)

async function onDelete(id: number) {
  if (confirmDelete.value !== id) {
    confirmDelete.value = id
    return
  }
  await remove(id)
  confirmDelete.value = null
}

async function toggleArchive(item: TaxonomyItem) {
  await update(item.id, { isArchived: !item.isArchived })
}
</script>

<template>
  <dialog class="modal modal-open" @click.self="emit('close')">
    <div class="modal-box max-w-2xl max-h-[80vh] flex flex-col">
      <!-- Header -->
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-bold text-base">
          {{ typeLabels[type] || 'Taxonomy' }}
        </h3>
        <div class="flex gap-1">
          <button class="btn btn-primary btn-xs" @click="openCreate">
            <Icon name="mingcute:add-line" class="text-xs" />
            Создать
          </button>
          <button class="btn btn-ghost btn-xs btn-square" @click="emit('close')">
            <Icon name="mingcute:close-line" />
          </button>
        </div>
      </div>

      <!-- Error display -->
      <div v-if="saveError" class="alert alert-error alert-sm mb-3">
        <Icon name="mingcute:warning-line" class="text-sm" />
        <span class="text-xs">{{ saveError }}</span>
        <button class="btn btn-ghost btn-xs btn-square ml-auto" @click="saveError = null">
          <Icon name="mingcute:close-line" />
        </button>
      </div>

      <!-- AI generation -->
      <div v-if="!isCreating" class="flex gap-1.5 mb-3">
        <input
          v-model="aiPrompt"
          type="text"
          class="input input-sm flex-1"
          placeholder="Опиши что нужно — AI создаст черновик..."
          :disabled="aiGenerating"
          @keyup.enter="generateWithAi"
        />
        <button
          class="btn btn-sm btn-ghost"
          :disabled="!aiPrompt.trim() || aiGenerating"
          @click="generateWithAi"
        >
          <span v-if="aiGenerating" class="loading loading-spinner loading-xs" />
          <Icon v-else name="mingcute:sparkles-2-line" class="text-sm" />
          AI
        </button>
      </div>

      <!-- Create/Edit form -->
      <div v-if="isCreating" class="bg-base-200 rounded-box p-3 mb-3 space-y-2">
        <div class="text-xs font-bold">{{ editingItem ? 'Редактирование' : 'Новый элемент' }}</div>

        <fieldset class="fieldset">
          <legend class="fieldset-legend text-[10px]">Название *</legend>
          <input v-model="form.name" class="input input-sm w-full" placeholder="Название стратегии / стиля" />
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend text-[10px]">Краткое описание *</legend>
          <input v-model="form.shortDescription" class="input input-sm w-full" placeholder="Одно предложение" />
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend text-[10px]">Полное объяснение</legend>
          <textarea v-model="form.fullExplanation" class="textarea textarea-sm w-full" rows="3" placeholder="Подробное описание..." />
        </fieldset>

        <div class="grid grid-cols-2 gap-2">
          <fieldset class="fieldset">
            <legend class="fieldset-legend text-[10px]">Категория</legend>
            <input v-model="form.category" class="input input-sm w-full" placeholder="Например: Рост" />
          </fieldset>

          <fieldset class="fieldset">
            <legend class="fieldset-legend text-[10px]">Теги (через запятую)</legend>
            <input v-model="form.tags" class="input input-sm w-full" placeholder="быстрый, массовый" />
          </fieldset>
        </div>

        <fieldset class="fieldset">
          <legend class="fieldset-legend text-[10px]">Примеры (каждый с новой строки)</legend>
          <textarea v-model="form.examples" class="textarea textarea-sm w-full" rows="2" placeholder="Пример использования..." />
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend text-[10px]">Подходит для (через запятую)</legend>
          <input v-model="form.useCases" class="input input-sm w-full" placeholder="Новые аккаунты, Тестирование" />
        </fieldset>

        <div class="flex gap-1 justify-end">
          <button class="btn btn-ghost btn-xs" @click="isCreating = false">Отмена</button>
          <button
            class="btn btn-primary btn-xs"
            :disabled="!form.name.trim() || !form.shortDescription.trim() || saving"
            @click="save"
          >
            <span v-if="saving" class="loading loading-spinner loading-xs" />
            {{ editingItem ? 'Сохранить' : 'Создать' }}
          </button>
        </div>
      </div>

      <!-- Search bar -->
      <div class="flex gap-1.5 mb-2">
        <input
          v-model="searchQuery"
          type="text"
          class="input input-sm flex-1"
          placeholder="Поиск..."
        />
        <select
          v-if="categories.length"
          class="select select-sm"
          :value="selectedCategory ?? ''"
          @change="selectedCategory = ($event.target as HTMLSelectElement).value || null"
        >
          <option value="">Все категории</option>
          <option v-for="cat in categories" :key="cat" :value="cat">{{ cat }}</option>
        </select>
      </div>

      <!-- Items list -->
      <div class="flex-1 overflow-y-auto space-y-1">
        <div v-if="loading" class="flex justify-center py-6">
          <span class="loading loading-spinner loading-sm" />
        </div>

        <div
          v-for="item in filtered"
          :key="item.id"
          class="flex items-start gap-2 p-2 rounded-box border border-base-300 hover:border-base-content/20 transition-colors"
          :class="{ 'opacity-50': item.isArchived }"
        >
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="text-sm font-medium">{{ item.name }}</span>
              <span v-if="item.isSystem" class="badge badge-ghost badge-xs">системный</span>
              <span v-if="item.category" class="badge badge-outline badge-xs">{{ item.category }}</span>
              <span v-if="item.isArchived" class="badge badge-warning badge-xs">архив</span>
            </div>
            <div class="text-xs text-base-content/60 mt-0.5">{{ item.shortDescription }}</div>
            <div v-if="item.tags.length" class="flex flex-wrap gap-1 mt-1">
              <span v-for="tag in item.tags" :key="tag" class="text-[10px] text-base-content/40">#{{ tag }}</span>
            </div>
          </div>

          <div class="flex gap-0.5 shrink-0">
            <button class="btn btn-ghost btn-xs btn-square" title="Редактировать" @click="openEdit(item)">
              <Icon name="mingcute:edit-2-line" class="text-xs" />
            </button>
            <button class="btn btn-ghost btn-xs btn-square" :title="item.isArchived ? 'Восстановить' : 'Архивировать'" @click="toggleArchive(item)">
              <Icon :name="item.isArchived ? 'mingcute:refresh-2-line' : 'mingcute:archive-line'" class="text-xs" />
            </button>
            <button
              v-if="!item.isSystem"
              class="btn btn-ghost btn-xs btn-square"
              :class="{ 'btn-error': confirmDelete === item.id }"
              :title="confirmDelete === item.id ? 'Подтвердить удаление' : 'Удалить'"
              @click="onDelete(item.id)"
            >
              <Icon name="mingcute:delete-2-line" class="text-xs" />
            </button>
          </div>
        </div>

        <div v-if="!loading && !filtered.length" class="text-center py-6 text-sm text-base-content/40">
          {{ searchQuery || selectedCategory ? 'Ничего не найдено' : 'Нет элементов' }}
        </div>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button @click="emit('close')">close</button>
    </form>
  </dialog>
</template>
