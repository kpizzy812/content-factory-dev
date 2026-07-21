<script setup lang="ts">
const props = defineProps<{
  config: Record<string, any>
}>()

const emit = defineEmits<{
  update: [key: string, value: any]
}>()

const mode = computed(() => props.config.mode || 'message')

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
  return (raw as Array<{ id: number; key: string; title: string; category: string; isActive: boolean }>).filter(t => t.isActive)
})

interface RegistryVar {
  key: string
  label: string
  description: string
  example: string
  availability: 'guaranteed' | 'summary' | 'conditional'
  sourceNode?: string
}

const AVAILABILITY_LABELS: Record<string, string> = {
  guaranteed: 'Всегда доступна',
  summary: 'Из pipeline summary',
  conditional: 'Условно доступна',
}

const guaranteedVars = computed(() =>
  (registryVariables.value as RegistryVar[]).filter(v => v.availability === 'guaranteed'),
)
const summaryVars = computed(() =>
  (registryVariables.value as RegistryVar[]).filter(v => v.availability === 'summary'),
)
const conditionalVars = computed(() =>
  (registryVariables.value as RegistryVar[]).filter(v => v.availability === 'conditional'),
)

const aiLoading = ref(false)
const aiPreview = ref<{ text?: string; reasoning?: string } | null>(null)

async function onAiSuggest(prompt: string) {
  aiLoading.value = true
  aiPreview.value = null
  try {
    const { data } = await $fetch<{ data: { text: string; reasoning?: string } }>('/api/ai/suggest/field', {
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
  <fieldset class="fieldset">
    <legend class="fieldset-legend">Канал</legend>
    <select
      class="select select-sm w-full"
      :value="config.channel || 'telegram'"
      @change="emit('update', 'channel', ($event.target as HTMLSelectElement).value)"
    >
      <option value="telegram">Telegram</option>
    </select>
    <SharedFieldHint text="Куда отправлять уведомление. Сейчас поддерживается Telegram." />
  </fieldset>

  <fieldset class="fieldset">
    <legend class="fieldset-legend">Режим</legend>
    <select
      class="select select-sm w-full"
      :value="config.mode || 'message'"
      @change="emit('update', 'mode', ($event.target as HTMLSelectElement).value)"
    >
      <option value="message">Текст сообщения</option>
      <option value="template">Шаблон из библиотеки</option>
    </select>
    <SharedFieldHint text="«Текст» — свободный ввод, «Шаблон» — использует сохранённый шаблон из Telegram → Шаблоны." />
  </fieldset>

  <!-- Raw message mode -->
  <template v-if="mode === 'message'">
    <fieldset class="fieldset">
      <legend class="fieldset-legend flex items-center gap-1">
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
      </legend>
      <textarea
        :value="config.message || ''"
        class="textarea textarea-sm w-full"
        rows="3"
        placeholder="Текст уведомления"
        @input="emit('update', 'message', ($event.target as HTMLTextAreaElement).value)"
      />
      <SharedFieldHint
        text="Можно использовать переменные {{ }} для вставки данных из предыдущих блоков конвейера."
        example="Конвейер завершён! Обработано {{videosCount}} видео."
      />
      <div v-if="registryVariables.length" class="mt-2 space-y-1.5">
        <div v-if="guaranteedVars.length" class="flex flex-wrap items-center gap-1">
          <span class="badge badge-xs badge-success gap-0.5" :title="AVAILABILITY_LABELS.guaranteed">
            <Icon name="mingcute:check-circle-line" class="size-3" />
            Всегда
          </span>
          <kbd
            v-for="rv in guaranteedVars" :key="rv.key"
            class="kbd kbd-xs cursor-help"
            :title="`${rv.description} (${rv.example})`"
          >{{ rv.key }}</kbd>
        </div>
        <div v-if="summaryVars.length" class="flex flex-wrap items-center gap-1">
          <span class="badge badge-xs badge-info gap-0.5" :title="AVAILABILITY_LABELS.summary">
            <Icon name="mingcute:list-check-line" class="size-3" />
            Summary
          </span>
          <kbd
            v-for="rv in summaryVars" :key="rv.key"
            class="kbd kbd-xs cursor-help"
            :title="`${rv.description} (${rv.example})${rv.sourceNode ? ` [из: ${rv.sourceNode}]` : ''}`"
          >{{ rv.key }}</kbd>
        </div>
        <div v-if="conditionalVars.length" class="flex flex-wrap items-center gap-1">
          <span class="badge badge-xs badge-warning gap-0.5" :title="AVAILABILITY_LABELS.conditional">
            <Icon name="mingcute:alert-line" class="size-3" />
            Условно
          </span>
          <kbd
            v-for="rv in conditionalVars" :key="rv.key"
            class="kbd kbd-xs cursor-help opacity-70"
            :title="`${rv.description} (${rv.example}) — доступна только при ошибках`"
          >{{ rv.key }}</kbd>
        </div>
      </div>
    </fieldset>
  </template>

  <!-- Template mode -->
  <template v-else>
    <fieldset class="fieldset">
      <legend class="fieldset-legend">Шаблон</legend>
      <select
        class="select select-sm w-full"
        :value="config.templateKey || ''"
        @change="emit('update', 'templateKey', ($event.target as HTMLSelectElement).value)"
      >
        <option value="" disabled>Выберите шаблон...</option>
        <option v-for="t in templates" :key="t.key" :value="t.key">
          {{ t.title }} ({{ t.key }})
        </option>
      </select>
      <SharedFieldHint text="Шаблон из раздела Админ → Telegram → Шаблоны. Переменные заполнятся из данных конвейера." />
      <div v-if="!templates.length" class="text-xs text-warning mt-1">
        Нет активных шаблонов. Создайте шаблон в Админ → Telegram → Шаблоны.
      </div>
    </fieldset>
  </template>

  <fieldset class="fieldset">
    <legend class="fieldset-legend">Тип оповещения</legend>
    <select
      class="select select-sm w-full"
      :value="config.alertType || 'custom'"
      @change="emit('update', 'alertType', ($event.target as HTMLSelectElement).value)"
    >
      <option v-for="at in alertTypes" :key="at.value" :value="at.value">{{ at.label }}</option>
    </select>
    <SharedFieldHint text="Определяет маршрутизацию — в какие чаты попадёт уведомление (по routing tags чатов)." />
  </fieldset>

  <!-- No-data handling policy -->
  <div class="divider text-xs text-base-content/40 my-1">Поведение при отсутствии данных</div>

  <fieldset class="fieldset">
    <label class="label cursor-pointer justify-start gap-2 py-0.5">
      <input
        type="checkbox"
        class="checkbox checkbox-sm"
        :checked="config.skipOnNoData !== false"
        @change="emit('update', 'skipOnNoData', ($event.target as HTMLInputElement).checked)"
      />
      <span class="label-text text-sm">Пропускать отправку, если нет данных</span>
    </label>
    <SharedFieldHint
      text="Если включено — уведомление не отправится, когда upstream-ноды вернули _noData (например, нет активного профиля Трендвотчера). Предотвращает ложные «✅ успешно» при пустом результате."
    />
  </fieldset>

  <fieldset class="fieldset">
    <label class="label cursor-pointer justify-start gap-2 py-0.5">
      <input
        type="checkbox"
        class="checkbox checkbox-sm"
        :checked="config.treatNoDataAsWarning !== false"
        :disabled="config.skipOnNoData !== false"
        @change="emit('update', 'treatNoDataAsWarning', ($event.target as HTMLInputElement).checked)"
      />
      <span class="label-text text-sm" :class="{ 'opacity-50': config.skipOnNoData !== false }">
        Помечать уведомление как предупреждение
      </span>
    </label>
    <SharedFieldHint
      text="Если пропуск отключён и есть no-data — уведомление уйдёт с типом «Критическая ошибка» (попадёт в warning-чаты, будет визуально отличаться). Текст будет префиксирован «⚠️ Запуск без данных»."
    />
  </fieldset>

  <!-- Preview -->
  <div v-if="mode === 'message' && config.message" class="mt-2">
    <div class="text-xs text-base-content/50 mb-1">Предпросмотр:</div>
    <div class="p-2 rounded-box bg-base-200 text-xs whitespace-pre-wrap break-words">
      {{ config.message }}
    </div>
  </div>
  <div v-else-if="mode === 'template' && config.templateKey" class="mt-2">
    <div class="alert alert-info alert-sm">
      <Icon name="mingcute:information-line" />
      <span class="text-xs">Будет использован шаблон <kbd class="kbd kbd-xs">{{ config.templateKey }}</kbd>. Переменные заполнятся из данных конвейера.</span>
    </div>
  </div>
</template>
