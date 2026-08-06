<script setup lang="ts">
/**
 * Редактор шаблона сообщения.
 *
 * Вынесен из `Templates.vue`: там он занимал две трети файла, а список и
 * редактор живут отдельными жизнями — список читают, редактор открывают.
 *
 * Три предупреждения под текстом отвечают на три разных вопроса и поэтому не
 * схлопнуты в одно: переменная не из реестра — не подставится; переменная не
 * описана — подставится, но пример показать нечем; условное выражение —
 * будет вырезано целиком.
 *
 * AI-подсказка платная (дёргает модель), поэтому подписана ценой.
 */
export interface TemplateVariable {
  name: string
  description: string
  example: string
  required: boolean
}

export interface RegistryVariable {
  key: string
  label: string
  description: string
  type: string
  category: string
  example: string
  scopes: string[]
  availability?: 'guaranteed' | 'summary' | 'conditional'
  sourceNode?: string
}

const props = defineProps<{
  open: boolean
  /** null — создание нового шаблона. */
  editingId: number | null
  registryVariables: RegistryVariable[]
  saving: boolean
  error: string
  modelKey: string
  modelTitle: string
  modelCategory: string
  modelBody: string
  variables: TemplateVariable[]
}>()

const emit = defineEmits<{
  close: []
  save: []
  'update:modelKey': [value: string]
  'update:modelTitle': [value: string]
  'update:modelCategory': [value: string]
  'update:modelBody': [value: string]
  'update:variables': [value: TemplateVariable[]]
}>()

const { generateTemplate } = useAdminTelegramActions()
const toast = useToast()

const CATEGORIES = [
  { value: 'alert', label: 'Системное оповещение' },
  { value: 'notification', label: 'Уведомление' },
  { value: 'report', label: 'Отчёт' },
  { value: 'custom', label: 'Своё' },
]

const AVAILABILITY_GROUPS = [
  {
    key: 'guaranteed' as const,
    label: 'Есть всегда',
    hint: '',
    tone: 'border-success-border bg-success-bg text-success',
  },
  {
    key: 'summary' as const,
    label: 'Из блоков конвейера',
    hint: 'появятся, если такой блок есть в графе',
    tone: 'border-info-border bg-info-bg text-info',
  },
  {
    key: 'conditional' as const,
    label: 'Только при ошибке',
    hint: 'в обычном запуске подставить нечего',
    tone: 'border-warning-border bg-warning-bg text-warning',
  },
]

/** Двойные фигурные скобки в разметке шаблон Vue съедает — держим строкой. */
const placeholderSample = '{{переменная}}'

const isEditing = computed(() => props.editingId !== null)
const registryKeys = computed(() => new Set(props.registryVariables.map(v => v.key)))
const bodyRef = ref<HTMLTextAreaElement | null>(null)

const usedVariables = computed(() => {
  const matches = props.modelBody.match(/\{\{(\w+)\}\}/g)
  return matches ? [...new Set(matches.map(m => m.replace(/[{}]/g, '')))] : []
})

const missingVars = computed(() => {
  const defined = new Set(props.variables.map(v => v.name))
  return usedVariables.value.filter(v => !defined.has(v))
})

const invalidVars = computed(() => usedVariables.value.filter(v => !registryKeys.value.has(v)))

/** Строки, которые движок шаблонов не понимает и молча вырежет при отправке. */
const unsupportedExpressions = computed(() =>
  props.modelBody.split('\n').filter((line) => {
    const t = line.trim()
    if (/^.+\?\s*["'«"].+["'»"]\s*:\s*["'«"].+["'»"]\s*$/.test(t)) return true
    if (/\{\{.*\}\}\s*[><=!]+\s*\d+/.test(t)) return true
    return false
  }),
)

const preview = computed(() => {
  let text = props.modelBody
    .split('\n')
    .filter((line) => {
      const t = line.trim()
      if (/^.+\?\s*["'«"].+["'»"]\s*:\s*["'«"].+["'»"]\s*$/.test(t)) return false
      if (/\{\{.*\}\}\s*[><=!]+\s*\d+/.test(t)) return false
      return true
    })
    .join('\n')
  for (const name of usedVariables.value) {
    const entry = props.variables.find(v => v.name === name)
    text = text.replaceAll(`{{${name}}}`, `[${entry?.example || entry?.description || name}]`)
  }
  return text
})

function updateVariables(next: TemplateVariable[]) {
  emit('update:variables', next)
}

function addVariable() {
  updateVariables([...props.variables, { name: '', description: '', example: '', required: true }])
}

function removeVariable(index: number) {
  updateVariables(props.variables.filter((_, i) => i !== index))
}

function patchVariable(index: number, patch: Partial<TemplateVariable>) {
  updateVariables(props.variables.map((v, i) => (i === index ? { ...v, ...patch } : v)))
}

function addMissingVariables() {
  updateVariables([
    ...props.variables,
    ...missingVars.value.map(name => ({ name, description: '', example: '', required: true })),
  ])
}

function insertVariable(name: string) {
  const el = bodyRef.value
  if (!el) {
    emit('update:modelBody', `${props.modelBody}{{${name}}}`)
    return
  }
  const start = el.selectionStart
  const end = el.selectionEnd
  emit('update:modelBody', `${props.modelBody.slice(0, start)}{{${name}}}${props.modelBody.slice(end)}`)
  nextTick(() => {
    const position = start + name.length + 4
    el.setSelectionRange(position, position)
    el.focus()
  })
}

// ── AI-подсказка ──────────────────────────────────────────────────────────
const aiPrompt = ref('')
const aiLoading = ref(false)
const aiResult = ref<{
  title: string
  key: string
  category: string
  messageBody: string
  variables: Array<{ name: string; description: string; example?: string }>
  explanation: string
  rejectedVariables?: string[]
} | null>(null)

async function handleAiGenerate() {
  if (!aiPrompt.value.trim()) return
  aiLoading.value = true
  aiResult.value = null
  try {
    aiResult.value = await generateTemplate(aiPrompt.value) as any
  }
  catch (e: any) {
    toast.error(e?.data?.message || e?.message || 'Не удалось собрать шаблон')
  }
  finally {
    aiLoading.value = false
  }
}

function applyAiResult() {
  const result = aiResult.value
  if (!result) return
  emit('update:modelKey', result.key)
  emit('update:modelTitle', result.title)
  emit('update:modelCategory', result.category)
  emit('update:modelBody', result.messageBody)
  updateVariables((result.variables ?? []).map(v => ({
    name: v.name,
    description: v.description,
    example: v.example ?? '',
    required: true,
  })))
  aiResult.value = null
}

function categoryLabel(value: string): string {
  return CATEGORIES.find(c => c.value === value)?.label ?? value
}

function groupVariables(availability: 'guaranteed' | 'summary' | 'conditional') {
  return props.registryVariables.filter(v => v.availability === availability)
}
</script>

<template>
  <UiModal
    :open="open"
    size="lg"
    :title="isEditing ? 'Шаблон сообщения' : 'Новый шаблон'"
    @close="emit('close')"
  >
    <div class="flex flex-col gap-3">
      <section v-if="!isEditing" class="flex flex-col gap-2 rounded-md border border-border bg-card p-2.5">
        <span class="flex items-center gap-1.5 text-sm font-medium">
          <Icon name="mingcute:sparkles-2-line" class="text-accent" />
          Собрать черновик моделью
          <span class="font-normal text-subtle">· платно</span>
        </span>
        <div class="flex gap-2">
          <UiInput
            v-model="aiPrompt"
            placeholder="Опишите, о чём должно быть сообщение"
            :disabled="aiLoading"
            @keydown.enter.prevent="handleAiGenerate"
          />
          <UiButton
            variant="primary"
            class="shrink-0"
            :loading="aiLoading"
            :disabled="!aiPrompt.trim()"
            @click="handleAiGenerate"
          >
            Собрать
          </UiButton>
        </div>

        <div v-if="aiResult" class="flex flex-col gap-2 rounded-md border border-divider bg-panel p-2.5">
          <ClientOnly>
            <UiKeyValue
              :items="[
                { label: 'Название', value: aiResult.title },
                { label: 'Ключ', value: aiResult.key },
                { label: 'Категория', value: categoryLabel(aiResult.category) },
              ]"
            />
          </ClientOnly>
          <pre class="rounded-md bg-surface p-2 text-sm break-words whitespace-pre-wrap text-muted">{{ aiResult.messageBody }}</pre>
          <div v-if="aiResult.variables?.length" class="flex flex-wrap items-center gap-1">
            <span class="text-micro text-subtle">переменные:</span>
            <code v-for="v in aiResult.variables" :key="v.name" class="rounded-sm bg-surface px-1.5 font-mono text-micro">
              {{ v.name }}
            </code>
          </div>
          <p v-if="aiResult.rejectedVariables?.length" class="text-micro text-warning">
            Отброшены переменные не из реестра: {{ aiResult.rejectedVariables.join(', ') }}
          </p>
          <p v-if="aiResult.explanation" class="text-micro text-subtle">{{ aiResult.explanation }}</p>
          <div class="flex gap-1.5">
            <UiButton variant="primary" @click="applyAiResult">
              <Icon name="mingcute:check-line" />
              Подставить в форму
            </UiButton>
            <UiButton variant="ghost" @click="aiResult = null">Отбросить</UiButton>
          </div>
        </div>
      </section>

      <div class="grid gap-3 sm:grid-cols-2">
        <UiField v-if="!isEditing" label="Ключ" hint="По нему шаблон вызывают из кода">
          <UiInput
            mono
            :model-value="modelKey"
            placeholder="cycle_complete"
            @update:model-value="emit('update:modelKey', $event)"
          />
        </UiField>
        <UiField label="Название">
          <UiInput
            :model-value="modelTitle"
            placeholder="Завершение цикла"
            @update:model-value="emit('update:modelTitle', $event)"
          />
        </UiField>
        <UiField label="Категория">
          <UiSelect
            :model-value="modelCategory"
            :options="CATEGORIES"
            @update:model-value="emit('update:modelCategory', String($event))"
          />
        </UiField>
      </div>

      <UiField label="Текст сообщения">
        <textarea
          ref="bodyRef"
          :value="modelBody"
          rows="5"
          class="w-full rounded-md border border-border bg-card px-2.5 py-2 text-base text-fg outline-offset-1 focus:border-accent"
          placeholder="Цикл {{cycleName}} завершён за {{duration}} мин"
          @input="emit('update:modelBody', ($event.target as HTMLTextAreaElement).value)"
        />
      </UiField>

      <UiField
        v-if="registryVariables.length"
        label="Переменные из реестра"
        hint="Клик вставляет переменную в текст"
      >
        <div class="flex flex-col gap-2">
          <div v-for="group in AVAILABILITY_GROUPS" :key="group.key">
            <template v-if="groupVariables(group.key).length">
              <span class="mb-1 flex flex-wrap items-center gap-1.5">
                <span class="inline-flex h-[18px] items-center rounded-sm border px-1.5 text-micro" :class="group.tone">
                  {{ group.label }}
                </span>
                <span v-if="group.hint" class="text-micro text-subtle">{{ group.hint }}</span>
              </span>
              <div class="flex flex-wrap gap-1">
                <button
                  v-for="rv in groupVariables(group.key)"
                  :key="rv.key"
                  type="button"
                  class="h-6 cursor-pointer rounded-sm border px-1.5 font-mono text-micro transition-colors duration-(--duration-fast)"
                  :class="usedVariables.includes(rv.key)
                    ? 'border-accent-border bg-accent-bg text-fg'
                    : 'border-divider bg-card text-muted hover:text-fg'"
                  :title="`${rv.description} · пример: ${rv.example}`"
                  @click="insertVariable(rv.key)"
                >{{ rv.key }}</button>
              </div>
            </template>
          </div>
        </div>
      </UiField>

      <UiField label="Описание переменных" hint="Описание попадает в предпросмотр вместо значения">
        <div class="flex flex-col gap-1.5">
          <div
            v-for="(variable, index) in variables"
            :key="index"
            class="flex flex-wrap items-center gap-1.5 rounded-md border border-divider bg-card p-1.5"
          >
            <UiInput
              class="max-w-36"
              mono
              :model-value="variable.name"
              :invalid="!!variable.name && !registryKeys.has(variable.name)"
              placeholder="имя"
              @update:model-value="patchVariable(index, { name: $event })"
            />
            <UiInput
              class="min-w-0 flex-1"
              :model-value="variable.description"
              placeholder="что это"
              @update:model-value="patchVariable(index, { description: $event })"
            />
            <UiInput
              class="max-w-36"
              :model-value="variable.example"
              placeholder="пример"
              @update:model-value="patchVariable(index, { example: $event })"
            />
            <UiCheckbox
              :model-value="variable.required"
              label="обязательна"
              @update:model-value="patchVariable(index, { required: $event })"
            />
            <UiButton variant="ghost" aria-label="Убрать переменную" @click="removeVariable(index)">
              <Icon name="mingcute:close-line" class="text-danger" />
            </UiButton>
          </div>
          <UiButton variant="ghost" class="w-fit" @click="addVariable">
            <Icon name="mingcute:add-line" />
            Добавить переменную
          </UiButton>
        </div>
      </UiField>

      <p
        v-if="invalidVars.length"
        class="flex items-start gap-2 rounded-md border border-warning-border bg-warning-bg px-2.5 py-2 text-sm text-fg"
      >
        <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0 text-warning" />
        <span>
          {{ invalidVars.join(', ') }} — таких переменных в реестре нет. При отправке они
          останутся в тексте как есть.
        </span>
      </p>

      <p
        v-if="unsupportedExpressions.length"
        class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-fg"
      >
        <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0 text-danger" />
        <span>
          Шаблон умеет только подстановку <code class="font-mono">{{ placeholderSample }}</code>.
          Условия и сравнения ({{ unsupportedExpressions.length }} строк) будут вырезаны при отправке.
        </span>
      </p>

      <p
        v-if="missingVars.length"
        class="flex flex-wrap items-center gap-2 rounded-md border border-warning-border bg-warning-bg px-2.5 py-2 text-sm text-fg"
      >
        <Icon name="mingcute:alert-line" class="shrink-0 text-warning" />
        <span class="min-w-0 flex-1">
          {{ missingVars.join(', ') }} стоят в тексте, но не описаны — в предпросмотре
          вместо них будет имя.
        </span>
        <UiButton variant="ghost" @click="addMissingVariables">Описать</UiButton>
      </p>

      <UiField v-if="modelBody.trim()" label="Предпросмотр">
        <pre class="rounded-md border border-divider bg-surface p-2.5 text-sm break-words whitespace-pre-wrap">{{ preview }}</pre>
      </UiField>

      <p v-if="error" class="flex items-start gap-2 text-sm text-danger">
        <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
        <span>{{ error }}</span>
      </p>
    </div>

    <template #footer>
      <UiButton variant="ghost" @click="emit('close')">Отмена</UiButton>
      <UiButton variant="primary" :loading="saving" @click="emit('save')">
        {{ isEditing ? 'Сохранить' : 'Создать' }}
      </UiButton>
    </template>
  </UiModal>
</template>
