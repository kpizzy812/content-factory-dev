<script setup lang="ts">
/**
 * TaxonomyManager — модальное окно для CRUD управления taxonomy items.
 * Открывается из TaxonomyPicker или отдельно.
 */
import type { TaxonomyCreateInput, TaxonomyItem } from '~/composables/useTaxonomy'

const props = defineProps<{
  type: string
}>()

const emit = defineEmits<{
  close: []
}>()

const { filtered, categories, loading, error: taxonomyError, searchQuery, selectedCategory, create, update, remove } = useTaxonomy(() => props.type)

const typeLabels: Record<string, string> = {
  strategy: 'Стратегии',
  hook_style: 'Стили хуков',
  prompt_pattern: 'Шаблоны промтов',
}

const categoryOptions = computed(() => [
  { value: '', label: 'Все категории' },
  ...categories.value.map(cat => ({ value: cat, label: cat })),
])

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

// Удаление подтверждается вторым кликом по той же кнопке: строк много,
// и модалка поверх модалки здесь стоила бы больше, чем защищает.
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

const BADGE = 'inline-flex h-[18px] shrink-0 items-center rounded-sm border px-1.5 text-micro'
const NEUTRAL_TONE = 'border-neutral-border bg-neutral-bg text-neutral'
</script>

<template>
  <UiModal :open="true" size="lg" @close="emit('close')">
    <template #header>
      <span class="flex items-center gap-2">
        {{ typeLabels[type] || 'Справочник' }}
        <UiButton variant="primary" @click="openCreate">
          <Icon name="mingcute:add-line" />
          Создать
        </UiButton>
      </span>
    </template>

    <div class="flex flex-col gap-3">
      <div
        v-if="saveError"
        class="flex items-center gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-danger"
      >
        <Icon name="mingcute:warning-line" class="shrink-0" />
        <span class="min-w-0 flex-1">{{ saveError }}</span>
        <UiButton variant="ghost" icon-only aria-label="Скрыть ошибку" @click="saveError = null">
          <Icon name="mingcute:close-line" />
        </UiButton>
      </div>

      <!-- Черновик от AI -->
      <div v-if="!isCreating" class="flex gap-1.5">
        <UiInput
          v-model="aiPrompt"
          class="flex-1"
          placeholder="Опишите что нужно — AI создаст черновик…"
          :disabled="aiGenerating"
          @keyup.enter="generateWithAi"
        />
        <UiButton size="md" :disabled="!aiPrompt.trim()" :loading="aiGenerating" @click="generateWithAi">
          <Icon v-if="!aiGenerating" name="mingcute:sparkles-2-line" />
          AI
        </UiButton>
      </div>

      <!-- Форма создания и правки -->
      <div v-if="isCreating" class="flex flex-col gap-2 rounded-md border border-border bg-card p-3">
        <div class="font-semibold">{{ editingItem ? 'Редактирование' : 'Новый элемент' }}</div>

        <UiField label="Название *">
          <UiInput v-model="form.name" placeholder="Название стратегии или стиля" />
        </UiField>

        <UiField label="Краткое описание *">
          <UiInput v-model="form.shortDescription" placeholder="Одно предложение" />
        </UiField>

        <UiField label="Полное объяснение">
          <UiTextarea v-model="form.fullExplanation" :rows="3" placeholder="Подробное описание…" />
        </UiField>

        <div class="grid grid-cols-2 gap-2">
          <UiField label="Категория">
            <UiInput v-model="form.category" placeholder="Например: Рост" />
          </UiField>

          <UiField label="Теги (через запятую)">
            <UiInput v-model="form.tags" placeholder="быстрый, массовый" />
          </UiField>
        </div>

        <UiField label="Примеры (каждый с новой строки)">
          <UiTextarea v-model="form.examples" :rows="2" placeholder="Пример использования…" />
        </UiField>

        <UiField label="Подходит для (через запятую)">
          <UiInput v-model="form.useCases" placeholder="Новые аккаунты, Тестирование" />
        </UiField>

        <div class="flex justify-end gap-1.5">
          <UiButton variant="ghost" @click="isCreating = false">Отмена</UiButton>
          <UiButton
            variant="primary"
            :disabled="!form.name.trim() || !form.shortDescription.trim()"
            :loading="saving"
            @click="save"
          >
            {{ editingItem ? 'Сохранить' : 'Создать' }}
          </UiButton>
        </div>
      </div>

      <!-- Поиск -->
      <div class="flex gap-1.5">
        <UiInput v-model="searchQuery" class="flex-1" placeholder="Поиск…" />
        <UiSelect
          v-if="categories.length"
          :model-value="selectedCategory ?? ''"
          :options="categoryOptions"
          class="w-40 shrink-0"
          @update:model-value="(v) => selectedCategory = (v as string) || null"
        />
      </div>

      <!-- Список -->
      <div class="flex flex-col gap-1">
        <div v-if="loading" class="flex justify-center py-6 text-muted">
          <Icon name="mingcute:loading-line" class="animate-spin text-lg" />
        </div>

        <div
          v-for="item in filtered"
          :key="item.id"
          class="flex items-start gap-2 rounded-md border border-border p-2 transition-colors duration-(--duration-fast) ease-out hover:border-subtle"
          :class="item.isArchived && 'opacity-50'"
        >
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-1.5">
              <span class="font-medium">{{ item.name }}</span>
              <span v-if="item.isSystem" :class="[BADGE, NEUTRAL_TONE]">системный</span>
              <span v-if="item.category" :class="[BADGE, 'border-border text-subtle']">{{ item.category }}</span>
              <span v-if="item.isArchived" :class="[BADGE, 'border-warning-border bg-warning-bg text-warning']">архив</span>
            </div>
            <div class="mt-0.5 text-sm text-muted">{{ item.shortDescription }}</div>
            <div v-if="item.tags.length" class="mt-1 flex flex-wrap gap-1">
              <span v-for="tag in item.tags" :key="tag" class="text-micro text-subtle">#{{ tag }}</span>
            </div>
          </div>

          <div class="flex shrink-0 gap-0.5">
            <UiButton variant="ghost" icon-only title="Редактировать" @click="openEdit(item)">
              <Icon name="mingcute:edit-2-line" />
            </UiButton>
            <UiButton
              variant="ghost"
              icon-only
              :title="item.isArchived ? 'Восстановить' : 'Архивировать'"
              @click="toggleArchive(item)"
            >
              <Icon :name="item.isArchived ? 'mingcute:refresh-2-line' : 'mingcute:archive-line'" />
            </UiButton>
            <UiButton
              v-if="!item.isSystem"
              :variant="confirmDelete === item.id ? 'danger' : 'ghost'"
              icon-only
              :title="confirmDelete === item.id ? 'Нажмите ещё раз, чтобы удалить' : 'Удалить'"
              @click="onDelete(item.id)"
            >
              <Icon name="mingcute:delete-2-line" />
            </UiButton>
          </div>
        </div>

        <p v-if="!loading && !filtered.length" class="py-6 text-center text-muted">
          {{ searchQuery || selectedCategory ? 'Ничего не найдено' : 'Нет элементов' }}
        </p>
      </div>
    </div>
  </UiModal>
</template>
