<script setup lang="ts">
const props = defineProps<{
  config: Record<string, any>
}>()

const emit = defineEmits<{
  update: [key: string, value: any]
}>()

const mode = computed(() => props.config.mode || 'message')

const channelOptions = [{ value: 'telegram', label: 'Telegram' }]

const modeOptions = [
  { value: 'message', label: 'Текст сообщения' },
  { value: 'template', label: 'Шаблон из библиотеки' },
]

const alertTypes = [
  { value: 'custom', label: 'Пользовательское' },
  { value: 'cycle_started', label: 'Цикл запущен' },
  { value: 'upload_success', label: 'Загрузка завершена' },
  { value: 'critical_error', label: 'Критическая ошибка' },
  { value: 'idea_created', label: 'Идея создана' },
]

const { data: templatesData } = useAdminTelegramTemplates()
const { data: variablesData } = useAdminTelegramVariables('pipeline')
const registryVariables = computed(() => (variablesData.value as any)?.data ?? variablesData.value ?? [])
const templates = computed(() => {
  const raw = (templatesData.value as any)?.data ?? templatesData.value ?? []
  return (raw as Array<{ id: number, key: string, title: string, category: string, isActive: boolean }>).filter(t => t.isActive)
})

const templateOptions = computed(() => templates.value.map(t => ({
  value: t.key,
  label: `${t.title} (${t.key})`,
})))

interface RegistryVar {
  key: string
  label: string
  description: string
  example: string
  availability: 'guaranteed' | 'summary' | 'conditional'
  sourceNode?: string
}

// Группы доступности переменных: подпись, тон бейджа и иконка.
const AVAILABILITY_GROUPS = [
  {
    key: 'guaranteed' as const,
    label: 'Всегда',
    title: 'Всегда доступна',
    icon: 'mingcute:check-circle-line',
    tone: 'bg-success-bg border-success-border text-success',
  },
  {
    key: 'summary' as const,
    label: 'Summary',
    title: 'Из pipeline summary',
    icon: 'mingcute:list-check-line',
    tone: 'bg-info-bg border-info-border text-info',
  },
  {
    key: 'conditional' as const,
    label: 'Условно',
    title: 'Условно доступна',
    icon: 'mingcute:alert-line',
    tone: 'bg-warning-bg border-warning-border text-warning',
  },
]

function varsOf(availability: RegistryVar['availability']) {
  return (registryVariables.value as RegistryVar[]).filter(v => v.availability === availability)
}

function varTitle(rv: RegistryVar) {
  const source = rv.sourceNode ? ` [из: ${rv.sourceNode}]` : ''
  const conditional = rv.availability === 'conditional' ? ' — доступна только при ошибках' : ''
  return `${rv.description} (${rv.example})${source}${conditional}`
}

// Фигурные скобки шаблона — константами: в тексте разметки Vue читает их как
// интерполяцию.
const messageHint = 'Можно использовать переменные {{ }} для вставки данных из предыдущих блоков конвейера.'
const messageExample = 'Конвейер завершён! Обработано {{videosCount}} видео.'

const aiLoading = ref(false)
const aiPreview = ref<{ text?: string, reasoning?: string } | null>(null)

async function onAiSuggest(prompt: string) {
  aiLoading.value = true
  aiPreview.value = null
  try {
    const { data } = await $fetch<{ data: { text: string, reasoning?: string } }>('/api/ai/suggest/field', {
      method: 'POST',
      body: {
        prompt,
        fieldType: 'message',
        context: {
          channel: props.config.channel || 'telegram',
        },
      },
    })
    if (data?.text) {
      aiPreview.value = data
    }
  } finally {
    aiLoading.value = false
  }
}

function applyAiMessage() {
  if (aiPreview.value?.text) {
    emit('update', 'message', aiPreview.value.text)
  }
  aiPreview.value = null
}

function dismissAiMessage() {
  aiPreview.value = null
}
</script>

<template>
  <UiField label="Канал">
    <UiSelect
      :model-value="config.channel || 'telegram'"
      :options="channelOptions"
      @update:model-value="(v) => emit('update', 'channel', v)"
    />
    <SharedFieldHint text="Куда отправлять уведомление. Сейчас поддерживается Telegram." />
  </UiField>

  <UiField label="Режим">
    <UiSelect
      :model-value="config.mode || 'message'"
      :options="modeOptions"
      @update:model-value="(v) => emit('update', 'mode', v)"
    />
    <SharedFieldHint text="«Текст» — свободный ввод, «Шаблон» — использует сохранённый шаблон из Telegram → Шаблоны." />
  </UiField>

  <!-- Свободный текст -->
  <div v-if="mode === 'message'">
    <div class="mb-[5px] flex items-center gap-1 text-micro text-muted">
      Сообщение
      <SharedAiSuggestButton
        :loading="aiLoading"
        with-prompt
        with-preview
        :preview-data="aiPreview"
        placeholder="Какое уведомление нужно..."
        @suggest="onAiSuggest"
        @apply="applyAiMessage"
        @dismiss="dismissAiMessage"
      />
    </div>

    <UiTextarea
      :model-value="config.message || ''"
      :rows="3"
      placeholder="Текст уведомления"
      @update:model-value="(v) => emit('update', 'message', v)"
    />
    <SharedFieldHint :text="messageHint" :example="messageExample" />

    <div v-if="registryVariables.length" class="mt-2 flex flex-col gap-1.5">
      <div
        v-for="group in AVAILABILITY_GROUPS"
        :key="group.key"
        class="flex flex-wrap items-center gap-1"
      >
        <template v-if="varsOf(group.key).length">
          <span
            class="inline-flex h-[18px] items-center gap-0.5 rounded-sm border px-1.5 text-micro"
            :class="group.tone"
            :title="group.title"
          >
            <Icon :name="group.icon" class="shrink-0" />
            {{ group.label }}
          </span>
          <span
            v-for="rv in varsOf(group.key)"
            :key="rv.key"
            class="cursor-help rounded-sm border border-border bg-card px-1 py-px font-mono text-micro text-muted"
            :class="group.key === 'conditional' && 'opacity-70'"
            :title="varTitle(rv)"
          >{{ rv.key }}</span>
        </template>
      </div>
    </div>
  </div>

  <!-- Шаблон из библиотеки -->
  <UiField v-else label="Шаблон">
    <UiSelect
      :model-value="config.templateKey || ''"
      :options="templateOptions"
      placeholder="Выберите шаблон…"
      @update:model-value="(v) => emit('update', 'templateKey', v)"
    />
    <SharedFieldHint text="Шаблон из раздела Админ → Telegram → Шаблоны. Переменные заполнятся из данных конвейера." />
    <p v-if="!templates.length" class="mt-1 text-micro text-warning">
      Нет активных шаблонов. Создайте шаблон в Админ → Telegram → Шаблоны.
    </p>
  </UiField>

  <UiField label="Тип оповещения">
    <UiSelect
      :model-value="config.alertType || 'custom'"
      :options="alertTypes"
      @update:model-value="(v) => emit('update', 'alertType', v)"
    />
    <SharedFieldHint text="Определяет маршрутизацию — в какие чаты попадёт уведомление (по routing tags чатов)." />
  </UiField>

  <div class="flex items-center gap-2 text-micro text-subtle">
    <span class="h-px flex-1 bg-divider" />
    Поведение при отсутствии данных
    <span class="h-px flex-1 bg-divider" />
  </div>

  <UiField>
    <UiCheckbox
      :model-value="config.skipOnNoData !== false"
      label="Пропускать отправку, если нет данных"
      @update:model-value="(v) => emit('update', 'skipOnNoData', v)"
    />
    <SharedFieldHint
      text="Если включено — уведомление не отправится, когда upstream-ноды вернули _noData (например, нет активного профиля Трендвотчера). Предотвращает ложные «успешно» при пустом результате."
    />
  </UiField>

  <UiField>
    <UiCheckbox
      :model-value="config.treatNoDataAsWarning !== false"
      :disabled="config.skipOnNoData !== false"
      label="Помечать уведомление как предупреждение"
      @update:model-value="(v) => emit('update', 'treatNoDataAsWarning', v)"
    />
    <SharedFieldHint
      text="Если пропуск отключён и есть no-data — уведомление уйдёт с типом «Критическая ошибка» (попадёт в warning-чаты, будет визуально отличаться). Текст будет префиксирован «Запуск без данных»."
    />
  </UiField>

  <!-- Предпросмотр -->
  <div v-if="mode === 'message' && config.message">
    <div class="mb-1 text-micro text-subtle">Предпросмотр:</div>
    <div class="rounded-md border border-border bg-card px-2.5 py-2 text-sm break-words whitespace-pre-wrap">
      {{ config.message }}
    </div>
  </div>
  <p
    v-else-if="mode === 'template' && config.templateKey"
    class="flex items-start gap-2 rounded-md border border-info-border bg-info-bg px-2.5 py-2 text-micro text-muted"
  >
    <Icon name="mingcute:information-line" class="mt-0.5 shrink-0 text-info" />
    <span>
      Будет использован шаблон
      <code class="font-mono text-fg">{{ config.templateKey }}</code>.
      Переменные заполнятся из данных конвейера.
    </span>
  </p>
</template>
