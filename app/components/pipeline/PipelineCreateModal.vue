<script setup lang="ts">
/**
 * Создание конвейера.
 *
 * Иконка, цвет и теги спрятаны в «Дополнительно»: конвейер заводят ради графа,
 * а оформление правят потом в редакторе.
 */
import { pipelineIcons } from '~~/shared/utils/pipeline-meta'
import { PIPELINE_COLOR_OPTIONS, pipelineColor } from './PipelineColorMap'

const emit = defineEmits<{ created: [] }>()

const isOpen = ref(false)
const name = ref('')
const description = ref('')
const icon = ref('')
const color = ref('')
const tags = ref<string[]>([])
const isCreating = ref(false)
const showAdvanced = ref(false)
const error = ref<string | null>(null)

const preview = computed(() => pipelineColor(color.value))

function open() {
  name.value = ''
  description.value = ''
  icon.value = ''
  color.value = ''
  tags.value = []
  showAdvanced.value = false
  error.value = null
  isOpen.value = true
}

function close() {
  if (!isCreating.value) isOpen.value = false
}

async function handleCreate() {
  if (!name.value.trim() || isCreating.value) return
  isCreating.value = true
  error.value = null
  try {
    const result = await $fetch<{ data: { id: number } }>('/api/pipelines', {
      method: 'POST',
      body: {
        name: name.value.trim(),
        description: description.value.trim() || undefined,
        icon: icon.value || undefined,
        color: color.value || undefined,
        tags: tags.value.length ? tags.value : undefined,
      },
    })
    isOpen.value = false
    emit('created')
    await navigateTo(`/pipeline/${result.data.id}`)
  }
  catch (e: any) {
    error.value = e?.data?.message || 'Не удалось создать конвейер'
  }
  finally {
    isCreating.value = false
  }
}

defineExpose({ open })
</script>

<template>
  <UiModal :open="isOpen" title="Создать конвейер" @close="close">
    <div class="flex flex-col gap-3">
      <p class="text-sm text-muted">
        Имя и описание достаточно, чтобы начать. Оформление и теги правятся здесь
        же в «Дополнительно» или потом в редакторе.
      </p>

      <UiField label="Название">
        <UiInput v-model="name" placeholder="Мой конвейер" @keydown.enter.prevent="handleCreate" />
      </UiField>

      <UiField label="Описание">
        <UiTextarea v-model="description" :rows="3" placeholder="Что делает этот конвейер" />
      </UiField>

      <UiButton variant="ghost" class="self-start" @click="showAdvanced = !showAdvanced">
        <Icon
          name="mingcute:right-line"
          class="transition-transform duration-(--duration-fast)"
          :class="showAdvanced && 'rotate-90'"
        />
        Дополнительно
      </UiButton>

      <template v-if="showAdvanced">
        <UiField label="Иконка">
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="item in pipelineIcons"
              :key="item.value"
              type="button"
              class="flex size-8 cursor-pointer items-center justify-center rounded-md border"
              :class="icon === item.value
                ? 'border-accent-border bg-accent-bg text-accent'
                : 'border-border bg-card text-muted hover:text-fg'"
              :title="item.label"
              @click="icon = item.value"
            >
              <Icon :name="item.icon" class="text-lg" />
            </button>
          </div>
        </UiField>

        <UiField label="Цвет">
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="item in PIPELINE_COLOR_OPTIONS"
              :key="item.value"
              type="button"
              class="flex size-8 cursor-pointer items-center justify-center rounded-md border"
              :class="[item.swatch, color === item.value ? 'border-fg' : 'border-border']"
              :title="item.label"
              @click="color = item.value"
            >
              <Icon v-if="color === item.value" name="mingcute:check-line" class="text-inverse" />
            </button>
          </div>
        </UiField>

        <UiField label="Теги">
          <PipelineTagPicker v-model="tags" />
        </UiField>

        <div v-if="name.trim()" class="flex items-center gap-3 rounded-md border border-border bg-card p-3">
          <span class="flex size-10 items-center justify-center rounded-md" :class="preview.bg">
            <Icon :name="icon || 'mingcute:git-merge-line'" class="text-xl" :class="preview.text" />
          </span>
          <span class="min-w-0">
            <span class="block truncate font-medium">{{ name }}</span>
            <span v-if="tags.length" class="block truncate text-sm text-subtle">{{ tags.join(' · ') }}</span>
          </span>
        </div>
      </template>

      <p
        v-if="error"
        role="alert"
        class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
      >
        <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
        <span class="min-w-0 flex-1">{{ error }}</span>
      </p>
    </div>

    <template #footer>
      <UiButton variant="ghost" :disabled="isCreating" @click="close">Отмена</UiButton>
      <UiButton variant="primary" :disabled="!name.trim()" :loading="isCreating" @click="handleCreate">
        Создать
      </UiButton>
    </template>
  </UiModal>
</template>
