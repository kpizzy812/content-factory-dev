<script setup lang="ts">
interface Template {
  id: number
  key: string
  title: string
  category: string
  messageBody: string
  variablesSchema: Record<string, string> | null
  isActive: boolean
  _count: { deliveries: number }
}
interface VariableEntry {
  name: string
  description: string
  example: string
  required: boolean
}
interface RegistryVar {
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

const { data: templatesData, refresh } = useAdminTelegramTemplates()
const { data: variablesData } = useAdminTelegramVariables()
const { createTemplate, updateTemplate, deleteTemplate, testTemplate, generateTemplate } = useAdminTelegramActions()

const registryVariables = computed<RegistryVar[]>(() => (variablesData.value as any)?.data ?? variablesData.value ?? [])
const registryKeys = computed(() => new Set(registryVariables.value.map(v => v.key)))
const templates = computed<Template[]>(() => (templatesData.value as any)?.data ?? templatesData.value ?? [])

const categories = [
  { value: 'alert', label: 'Системное оповещение' },
  { value: 'notification', label: 'Уведомление' },
  { value: 'report', label: 'Отчёт' },
  { value: 'custom', label: 'Пользовательское' },
]
const categoryLabel = (val: string) => categories.find(c => c.value === val)?.label ?? val

const showForm = ref(false)
const editingId = ref<number | null>(null)
const saving = ref(false)
const error = ref('')
const deleteConfirmId = ref<number | null>(null)
const testingId = ref<number | null>(null)
const testFeedback = ref<{ id: number; success: boolean; message: string } | null>(null)
const form = reactive({ key: '', title: '', category: 'notification', messageBody: '' })
const formVariables = ref<VariableEntry[]>([])
const messageRef = ref<HTMLTextAreaElement>()
const isEditing = computed(() => editingId.value !== null)

function variablesToSchema(vars: VariableEntry[]): Record<string, string> | null {
  if (!vars.length) return null
  return Object.fromEntries(vars.map(v => [v.name, v.description || v.example || v.name]))
}
function schemaToVariables(schema: Record<string, string> | null): VariableEntry[] {
  if (!schema) return []
  return Object.entries(schema).map(([name, desc]) => ({ name, description: String(desc), example: '', required: true }))
}

const usedVariables = computed(() => {
  const matches = form.messageBody.match(/\{\{(\w+)\}\}/g)
  return matches ? [...new Set(matches.map(m => m.replace(/[{}]/g, '')))] : []
})
const missingVars = computed(() => {
  const defined = new Set(formVariables.value.map(v => v.name))
  return usedVariables.value.filter(v => !defined.has(v))
})
function addMissingVariables() {
  for (const v of missingVars.value) formVariables.value.push({ name: v, description: '', example: '', required: true })
}
function addVariable() { formVariables.value.push({ name: '', description: '', example: '', required: true }) }
function removeVariable(i: number) { formVariables.value.splice(i, 1) }

function insertVariable(varName: string) {
  const el = messageRef.value
  if (!el) { form.messageBody += `{{${varName}}}`; return }
  const start = el.selectionStart
  const end = el.selectionEnd
  form.messageBody = form.messageBody.slice(0, start) + `{{${varName}}}` + form.messageBody.slice(end)
  nextTick(() => { const p = start + varName.length + 4; el.setSelectionRange(p, p); el.focus() })
}

const invalidVars = computed(() => {
  return usedVariables.value.filter(v => !registryKeys.value.has(v))
})

const unsupportedExpressions = computed(() => {
  return form.messageBody
    .split('\n')
    .filter(line => {
      const t = line.trim()
      if (/^.+\?\s*["'«"].+["'»"]\s*:\s*["'«"].+["'»"]\s*$/.test(t)) return true
      if (/\{\{.*\}\}\s*[><=!]+\s*\d+/.test(t)) return true
      return false
    })
})

const preview = computed(() => {
  let text = form.messageBody
  // Strip expression lines from preview
  text = text
    .split('\n')
    .filter(line => {
      const t = line.trim()
      if (/^.+\?\s*["'«"].+["'»"]\s*:\s*["'«"].+["'»"]\s*$/.test(t)) return false
      if (/\{\{.*\}\}\s*[><=!]+\s*\d+/.test(t)) return false
      return true
    })
    .join('\n')
  for (const v of usedVariables.value) {
    const entry = formVariables.value.find(fv => fv.name === v)
    text = text.replaceAll(`{{${v}}}`, `[${entry?.example || entry?.description || v}]`)
  }
  return text
})

const aiPrompt = ref('')
const aiLoading = ref(false)
const aiResult = ref<{
  title: string; key: string; category: string
  messageBody: string; variables: Array<{ name: string; description: string; example?: string }>
  explanation: string
  rejectedVariables?: string[]
} | null>(null)

async function handleAiGenerate(prompt: string) {
  if (!prompt.trim()) return
  aiLoading.value = true; aiResult.value = null
  try { aiResult.value = await generateTemplate(prompt) as any }
  catch (e: any) { error.value = e.data?.message || e.message || 'Ошибка AI-генерации' }
  finally { aiLoading.value = false }
}
function applyAiResult() {
  if (!aiResult.value) return
  form.key = aiResult.value.key
  form.title = aiResult.value.title
  form.category = aiResult.value.category
  form.messageBody = aiResult.value.messageBody
  formVariables.value = (aiResult.value.variables || []).map(v => ({
    name: v.name, description: v.description, example: v.example || '', required: true,
  }))
  aiResult.value = null
}

function openCreate() {
  editingId.value = null
  Object.assign(form, { key: '', title: '', category: 'notification', messageBody: '' })
  formVariables.value = []; aiResult.value = null; aiPrompt.value = ''; error.value = ''
  showForm.value = true
}
function openEdit(t: Template) {
  editingId.value = t.id
  Object.assign(form, { key: t.key, title: t.title, category: t.category, messageBody: t.messageBody })
  formVariables.value = schemaToVariables(t.variablesSchema); error.value = ''
  showForm.value = true
}
function closeForm() { showForm.value = false; editingId.value = null }

async function save() {
  if (!form.title.trim() || !form.messageBody.trim()) { error.value = 'Заполните название и текст сообщения'; return }
  if (!isEditing.value && !form.key.trim()) { error.value = 'Укажите ключ шаблона'; return }
  if (formVariables.value.some(v => !v.name.trim())) { error.value = 'У всех переменных должно быть имя'; return }
  saving.value = true; error.value = ''
  try {
    const schema = variablesToSchema(formVariables.value)
    if (isEditing.value) {
      await updateTemplate(editingId.value!, { title: form.title, category: form.category, messageBody: form.messageBody, variablesSchema: schema })
    } else {
      await createTemplate({ key: form.key, title: form.title, category: form.category, messageBody: form.messageBody, variablesSchema: schema ?? undefined })
    }
    closeForm(); await refresh()
  } catch (e: any) { error.value = e.data?.message || e.message || 'Ошибка сохранения' }
  finally { saving.value = false }
}

const confirmModalRef = ref<{ open: () => void; close: () => void; setBusy: (v: boolean) => void } | null>(null)

function openDeleteConfirm(id: number) {
  deleteConfirmId.value = id
  confirmModalRef.value?.open()
}

async function onConfirmDelete() {
  const id = deleteConfirmId.value
  if (id === null) return
  confirmModalRef.value?.setBusy(true)
  try {
    await deleteTemplate(id)
    deleteConfirmId.value = null
    confirmModalRef.value?.close()
    await refresh()
  } catch (e: any) {
    error.value = e.data?.message || e.message || 'Ошибка удаления'
  } finally {
    confirmModalRef.value?.setBusy(false)
  }
}
async function toggleActive(t: Template) {
  try { await updateTemplate(t.id, { isActive: !t.isActive }); await refresh() }
  catch (e: any) { error.value = e.data?.message || e.message || 'Ошибка обновления' }
}

async function sendTest(t: Template) {
  testingId.value = t.id; testFeedback.value = null
  try {
    const vars = t.variablesSchema ? Object.fromEntries(Object.entries(t.variablesSchema).map(([k, v]) => [k, v || k])) : undefined
    const res = await testTemplate(t.id, vars) as { sent: boolean; error?: string }
    testFeedback.value = { id: t.id, success: res.sent, message: res.sent ? 'Тестовое сообщение отправлено' : (res.error || 'Не удалось отправить') }
  } catch (e: any) {
    testFeedback.value = { id: t.id, success: false, message: e.data?.message || e.message || 'Ошибка тестовой отправки' }
  } finally { testingId.value = null; setTimeout(() => { testFeedback.value = null }, 5000) }
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <div>
        <h3 class="text-lg font-semibold">Шаблоны сообщений</h3>
        <p class="text-xs text-base-content/50">Структурированные уведомления с подстановкой переменных</p>
      </div>
      <button class="btn btn-primary btn-sm" @click="openCreate">
        <Icon name="mingcute:add-line" class="size-4" /> Создать шаблон
      </button>
    </div>

    <div v-if="error && !showForm" role="alert" class="alert alert-error alert-soft">
      <Icon name="mingcute:warning-line" /><span>{{ error }}</span>
      <button class="btn btn-ghost btn-xs" @click="error = ''">X</button>
    </div>
    <div v-if="testFeedback" role="alert" :class="['alert alert-sm', testFeedback.success ? 'alert-success' : 'alert-error']">
      <Icon :name="testFeedback.success ? 'mingcute:check-circle-line' : 'mingcute:close-circle-line'" />
      <span>{{ testFeedback.message }}</span>
      <button class="btn btn-ghost btn-xs" @click="testFeedback = null">X</button>
    </div>

    <!-- Form -->
    <div v-if="showForm" class="card bg-base-200 shadow">
      <div class="card-body space-y-4">
        <h4 class="card-title text-base">{{ isEditing ? 'Редактирование шаблона' : 'Новый шаблон' }}</h4>

        <!-- AI Generator -->
        <div v-if="!isEditing" class="card bg-primary/5 border border-primary/20">
          <div class="card-body p-3 gap-2">
            <div class="flex items-center gap-2">
              <Icon name="mingcute:sparkles-2-line" class="text-primary" />
              <span class="text-sm font-medium">AI-генератор шаблона</span>
            </div>
            <div class="flex gap-2">
              <input v-model="aiPrompt" class="input input-sm flex-1" placeholder="Опишите, какой шаблон нужен..." :disabled="aiLoading" @keydown.enter.prevent="handleAiGenerate(aiPrompt)" />
              <button class="btn btn-sm btn-primary" :disabled="!aiPrompt.trim() || aiLoading" @click="handleAiGenerate(aiPrompt)">
                <span v-if="aiLoading" class="loading loading-spinner loading-xs" />
                <Icon v-else name="mingcute:sparkles-2-line" class="size-4" /> Сгенерировать
              </button>
            </div>
            <div v-if="aiResult" class="mt-2 space-y-2">
              <div class="bg-base-100 rounded-lg p-3 text-sm space-y-1">
                <div><span class="opacity-50">Название:</span> <span class="font-semibold">{{ aiResult.title }}</span></div>
                <div><span class="opacity-50">Ключ:</span> <code class="font-mono text-xs">{{ aiResult.key }}</code></div>
                <div><span class="opacity-50">Категория:</span> {{ categoryLabel(aiResult.category) }}</div>
                <div class="whitespace-pre-wrap bg-base-200 rounded p-2 text-xs mt-1">{{ aiResult.messageBody }}</div>
                <div v-if="aiResult.variables?.length" class="flex flex-wrap gap-1">
                  <span class="text-xs opacity-50">Переменные:</span>
                  <kbd v-for="v in aiResult.variables" :key="v.name" class="kbd kbd-xs">{{ v.name }}</kbd>
                </div>
                <div v-if="aiResult.rejectedVariables?.length" class="alert alert-warning alert-sm py-1 mt-1">
                  <Icon name="mingcute:warning-line" class="text-xs" />
                  <span class="text-[10px]">Отклонены переменные не из реестра: <kbd v-for="v in aiResult.rejectedVariables" :key="v" class="kbd kbd-xs mx-0.5">{{ v }}</kbd></span>
                </div>
                <div v-if="aiResult.explanation" class="text-xs text-base-content/50 italic">{{ aiResult.explanation }}</div>
              </div>
              <div class="flex gap-2">
                <button class="btn btn-primary btn-sm flex-1" @click="applyAiResult">
                  <Icon name="mingcute:check-line" class="size-4" /> Применить
                </button>
                <button class="btn btn-ghost btn-sm" @click="aiResult = null">Отмена</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Key + Title + Category -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <fieldset v-if="!isEditing" class="fieldset">
            <legend class="fieldset-legend">Ключ</legend>
            <input v-model="form.key" class="input input-sm w-full" placeholder="cycle_complete" />
            <p class="text-xs text-base-content/40 mt-0.5">Уникальный идентификатор для вызова из кода</p>
          </fieldset>
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Название</legend>
            <input v-model="form.title" class="input input-sm w-full" placeholder="Завершение цикла" />
          </fieldset>
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Категория</legend>
            <select v-model="form.category" class="select select-sm w-full">
              <option v-for="c in categories" :key="c.value" :value="c.value">{{ c.label }}</option>
            </select>
          </fieldset>
        </div>

        <!-- Message body -->
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Текст сообщения</legend>
          <textarea ref="messageRef" v-model="form.messageBody" class="textarea textarea-sm w-full min-h-24" placeholder="Цикл {{cycleName}} завершён за {{duration}} мин." />
          <div v-if="formVariables.length" class="flex flex-wrap gap-1 mt-1 items-center">
            <span class="text-xs text-base-content/50">Вставить:</span>
            <button v-for="v in formVariables" :key="v.name" type="button" class="badge badge-outline badge-sm cursor-pointer hover:badge-primary" :disabled="!v.name.trim()" @click="v.name.trim() && insertVariable(v.name)" v-text="'{{' + v.name + '}}'" />
          </div>
        </fieldset>

        <!-- Variable picker from registry — grouped by availability -->
        <fieldset v-if="registryVariables.length" class="fieldset">
          <legend class="fieldset-legend">Доступные переменные (из реестра)</legend>
          <div class="space-y-2">
            <!-- Guaranteed -->
            <div v-if="registryVariables.filter(v => v.availability === 'guaranteed').length">
              <div class="flex items-center gap-1 mb-1">
                <span class="badge badge-xs badge-success gap-0.5">Всегда</span>
              </div>
              <div class="flex flex-wrap gap-1">
                <button
                  v-for="rv in registryVariables.filter(v => v.availability === 'guaranteed')" :key="rv.key"
                  type="button"
                  class="badge badge-sm cursor-pointer"
                  :class="usedVariables.includes(rv.key) ? 'badge-primary' : 'badge-outline hover:badge-primary'"
                  :title="`${rv.description} (${rv.example})`"
                  @click="insertVariable(rv.key)"
                >{{ rv.key }}</button>
              </div>
            </div>
            <!-- Summary -->
            <div v-if="registryVariables.filter(v => v.availability === 'summary').length">
              <div class="flex items-center gap-1 mb-1">
                <span class="badge badge-xs badge-info gap-0.5">Pipeline summary</span>
                <span class="text-[10px] text-base-content/40">— доступны если соответствующий блок есть в конвейере</span>
              </div>
              <div class="flex flex-wrap gap-1">
                <button
                  v-for="rv in registryVariables.filter(v => v.availability === 'summary')" :key="rv.key"
                  type="button"
                  class="badge badge-sm cursor-pointer"
                  :class="usedVariables.includes(rv.key) ? 'badge-primary' : 'badge-outline hover:badge-primary'"
                  :title="`${rv.description} (${rv.example})${rv.sourceNode ? ` [из: ${rv.sourceNode}]` : ''}`"
                  @click="insertVariable(rv.key)"
                >{{ rv.key }}</button>
              </div>
            </div>
            <!-- Conditional -->
            <div v-if="registryVariables.filter(v => v.availability === 'conditional').length">
              <div class="flex items-center gap-1 mb-1">
                <span class="badge badge-xs badge-warning gap-0.5">Условно</span>
                <span class="text-[10px] text-base-content/40">— доступны только при ошибках</span>
              </div>
              <div class="flex flex-wrap gap-1">
                <button
                  v-for="rv in registryVariables.filter(v => v.availability === 'conditional')" :key="rv.key"
                  type="button"
                  class="badge badge-sm cursor-pointer opacity-70"
                  :class="usedVariables.includes(rv.key) ? 'badge-warning' : 'badge-outline hover:badge-warning'"
                  :title="`${rv.description} (${rv.example}) — доступна только при ошибках`"
                  @click="insertVariable(rv.key)"
                >{{ rv.key }}</button>
              </div>
            </div>
          </div>
          <p class="text-[10px] text-base-content/40 mt-1">Кликните для вставки переменной в текст шаблона</p>
        </fieldset>

        <!-- Variable editor -->
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Переменные</legend>
          <div v-if="formVariables.length" class="space-y-2">
            <div v-for="(v, i) in formVariables" :key="i" class="flex items-start gap-2 bg-base-100 rounded-lg p-2">
              <input v-model="v.name" class="input input-xs w-28 font-mono" placeholder="varName" :class="{ 'input-error': v.name && !registryKeys.has(v.name) }" />
              <input v-model="v.description" class="input input-xs flex-1" placeholder="Описание" />
              <input v-model="v.example" class="input input-xs w-28" placeholder="Пример" />
              <label class="flex items-center gap-1 text-xs cursor-pointer whitespace-nowrap">
                <input v-model="v.required" type="checkbox" class="checkbox checkbox-xs" /> Обяз.
              </label>
              <button class="btn btn-ghost btn-xs text-error" @click="removeVariable(i)">
                <Icon name="mingcute:close-line" class="size-3.5" />
              </button>
            </div>
          </div>
          <button class="btn btn-ghost btn-xs mt-1" @click="addVariable">
            <Icon name="mingcute:add-line" class="size-3.5" /> Добавить переменную
          </button>
        </fieldset>

        <!-- Invalid variables warning (not in registry) -->
        <div v-if="invalidVars.length" role="alert" class="alert alert-warning alert-sm">
          <Icon name="mingcute:warning-line" />
          <div class="text-xs">
            <p class="font-semibold">Переменные не найдены в реестре</p>
            <p>Переменные <kbd v-for="v in invalidVars" :key="v" class="kbd kbd-xs mx-0.5">{{ v }}</kbd> не входят в реестр поддерживаемых переменных и не будут подставлены при отправке.</p>
          </div>
        </div>

        <!-- Unsupported expressions warning -->
        <div v-if="unsupportedExpressions.length" role="alert" class="alert alert-error alert-sm">
          <Icon name="mingcute:warning-line" />
          <div class="text-xs">
            <p class="font-semibold">Обнаружены неподдерживаемые выражения</p>
            <p>Шаблоны поддерживают только подстановку переменных <kbd class="kbd kbd-xs">{<!-- -->{var}<!-- -->}</kbd>. Условные выражения и сравнения будут удалены при отправке.</p>
          </div>
        </div>

        <!-- Missing variables warning -->
        <div v-if="missingVars.length" role="alert" class="alert alert-warning alert-sm">
          <Icon name="mingcute:warning-line" />
          <span class="text-xs">Переменные <kbd v-for="v in missingVars" :key="v" class="kbd kbd-xs mx-0.5">{{ v }}</kbd> используются в тексте, но не описаны</span>
          <button class="btn btn-ghost btn-xs" @click="addMissingVariables">+ Добавить</button>
        </div>

        <!-- Preview -->
        <div v-if="form.messageBody.trim()" class="card bg-base-300">
          <div class="card-body p-3">
            <p class="text-xs font-semibold opacity-60 mb-1">Предпросмотр</p>
            <pre class="text-sm whitespace-pre-wrap">{{ preview }}</pre>
          </div>
        </div>

        <div v-if="error && showForm" role="alert" class="alert alert-error alert-soft">
          <Icon name="mingcute:warning-line" /><span>{{ error }}</span>
        </div>

        <div class="flex gap-2 justify-end">
          <button class="btn btn-ghost btn-sm" @click="closeForm">Отмена</button>
          <button class="btn btn-primary btn-sm" :disabled="saving" @click="save">
            <span v-if="saving" class="loading loading-spinner loading-sm" />
            {{ isEditing ? 'Сохранить' : 'Создать' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Table -->
    <div v-if="templates.length" class="overflow-x-auto">
      <table class="table table-sm">
        <thead>
          <tr><th>Ключ</th><th>Название</th><th>Категория</th><th>Статус</th><th>Отправок</th><th class="text-right">Действия</th></tr>
        </thead>
        <tbody>
          <tr v-for="t in templates" :key="t.id">
            <td class="font-mono text-xs">{{ t.key }}</td>
            <td>{{ t.title }}</td>
            <td><span class="badge badge-sm badge-outline">{{ categoryLabel(t.category) }}</span></td>
            <td><span :class="['badge badge-sm', t.isActive ? 'badge-success' : 'badge-ghost']">{{ t.isActive ? 'Активен' : 'Выключен' }}</span></td>
            <td>{{ t._count?.deliveries ?? 0 }}</td>
            <td>
              <div class="flex gap-1 justify-end">
                <div class="tooltip" data-tip="Редактировать">
                  <button class="btn btn-ghost btn-xs" @click="openEdit(t)"><Icon name="mingcute:edit-line" class="size-4" /></button>
                </div>
                <div class="tooltip" :data-tip="t.isActive ? 'Выключить' : 'Включить'">
                  <button class="btn btn-ghost btn-xs" @click="toggleActive(t)"><Icon :name="t.isActive ? 'mingcute:eye-close-line' : 'mingcute:eye-line'" class="size-4" /></button>
                </div>
                <div class="tooltip" data-tip="Тестовая отправка">
                  <button class="btn btn-ghost btn-xs" :disabled="testingId === t.id" @click="sendTest(t)">
                    <span v-if="testingId === t.id" class="loading loading-spinner loading-xs" />
                    <Icon v-else name="mingcute:send-line" class="size-4" />
                  </button>
                </div>
                <div class="tooltip" data-tip="Удалить">
                  <button class="btn btn-ghost btn-xs text-error" @click="openDeleteConfirm(t.id)"><Icon name="mingcute:delete-2-line" class="size-4" /></button>
                </div>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Empty state -->
    <div v-else-if="!showForm" class="flex flex-col items-center gap-3 py-12 text-base-content/50">
      <Icon name="mingcute:file-line" class="text-4xl" />
      <div class="text-center">
        <p class="font-medium">Нет шаблонов</p>
        <p class="text-xs mt-1">Создайте шаблон для структурированных уведомлений с переменными</p>
      </div>
      <button class="btn btn-primary btn-sm" @click="openCreate">
        <Icon name="mingcute:add-line" class="size-4" /> Создать первый шаблон
      </button>
    </div>

    <!-- Delete confirm modal -->
    <SharedConfirmModal
      ref="confirmModalRef"
      title="Удалить шаблон?"
      message="Это действие нельзя отменить. Все связанные данные будут потеряны."
      confirm-label="Удалить"
      variant="danger"
      @confirm="onConfirmDelete"
      @cancel="deleteConfirmId = null"
    />
  </div>
</template>
