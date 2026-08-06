<script setup lang="ts">
/**
 * Шаблоны сообщений.
 *
 * Список читают, редактор открывают — поэтому редактор вынесен в отдельный
 * компонент и живёт модалкой: в прошлой версии он занимал две трети файла и
 * раскрывался прямо над таблицей, отодвигая её вниз.
 *
 * Тестовая отправка бесплатна и стоит в меню строки вместе с остальным редким:
 * шаблон правят раз в месяц, и держать четыре иконки в каждой строке незачем.
 */
import type { TemplateVariable } from './TemplateForm.vue'

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

const { data: templatesData, refresh } = useAdminTelegramTemplates()
const { data: variablesData } = useAdminTelegramVariables()
const { createTemplate, updateTemplate, deleteTemplate, testTemplate } = useAdminTelegramActions()

const toast = useToast()

const templates = computed<Template[]>(() => (templatesData.value as any)?.data ?? templatesData.value ?? [])
const registryVariables = computed(() => (variablesData.value as any)?.data ?? variablesData.value ?? [])

const CATEGORY_LABELS: Record<string, string> = {
  alert: 'Оповещение',
  notification: 'Уведомление',
  report: 'Отчёт',
  custom: 'Своё',
}

const showForm = ref(false)
const editingId = ref<number | null>(null)
const saving = ref(false)
const formError = ref('')
const deleteTarget = ref<Template | null>(null)
const testingId = ref<number | null>(null)

const form = reactive({ key: '', title: '', category: 'notification', body: '' })
const formVariables = ref<TemplateVariable[]>([])

function variablesToSchema(vars: TemplateVariable[]): Record<string, string> | null {
  if (!vars.length) return null
  return Object.fromEntries(vars.map(v => [v.name, v.description || v.example || v.name]))
}

function schemaToVariables(schema: Record<string, string> | null): TemplateVariable[] {
  if (!schema) return []
  return Object.entries(schema).map(([name, description]) => ({
    name,
    description: String(description),
    example: '',
    required: true,
  }))
}

function openCreate() {
  editingId.value = null
  Object.assign(form, { key: '', title: '', category: 'notification', body: '' })
  formVariables.value = []
  formError.value = ''
  showForm.value = true
}

function openEdit(template: Template) {
  editingId.value = template.id
  Object.assign(form, {
    key: template.key,
    title: template.title,
    category: template.category,
    body: template.messageBody,
  })
  formVariables.value = schemaToVariables(template.variablesSchema)
  formError.value = ''
  showForm.value = true
}

async function save() {
  if (!form.title.trim() || !form.body.trim()) {
    formError.value = 'Название и текст обязательны'
    return
  }
  if (editingId.value === null && !form.key.trim()) {
    formError.value = 'Без ключа шаблон нечем вызвать из кода'
    return
  }
  if (formVariables.value.some(v => !v.name.trim())) {
    formError.value = 'У переменной без имени нет смысла — заполните или уберите'
    return
  }

  saving.value = true
  formError.value = ''
  try {
    const schema = variablesToSchema(formVariables.value)
    if (editingId.value !== null) {
      await updateTemplate(editingId.value, {
        title: form.title,
        category: form.category,
        messageBody: form.body,
        variablesSchema: schema,
      })
    }
    else {
      await createTemplate({
        key: form.key,
        title: form.title,
        category: form.category,
        messageBody: form.body,
        variablesSchema: schema ?? undefined,
      })
    }
    showForm.value = false
    editingId.value = null
    await refresh()
    toast.success('Шаблон сохранён')
  }
  catch (e: any) {
    formError.value = e?.data?.message || e?.message || 'Не удалось сохранить шаблон'
  }
  finally {
    saving.value = false
  }
}

async function toggleActive(template: Template) {
  try {
    await updateTemplate(template.id, { isActive: !template.isActive })
    await refresh()
  }
  catch (e: any) {
    toast.error(e?.data?.message || e?.message || 'Не удалось изменить шаблон')
  }
}

async function sendTest(template: Template) {
  testingId.value = template.id
  try {
    const vars = template.variablesSchema
      ? Object.fromEntries(Object.entries(template.variablesSchema).map(([k, v]) => [k, v || k]))
      : undefined
    const res = await testTemplate(template.id, vars) as { sent: boolean; error?: string }
    if (res.sent) toast.success('Тестовое сообщение отправлено')
    else toast.error(res.error || 'Тестовое сообщение не ушло')
  }
  catch (e: any) {
    toast.error(e?.data?.message || e?.message || 'Не удалось отправить тест')
  }
  finally {
    testingId.value = null
  }
}

async function handleDelete() {
  const target = deleteTarget.value
  deleteTarget.value = null
  if (!target) return
  try {
    await deleteTemplate(target.id)
    await refresh()
    toast.success('Шаблон удалён')
  }
  catch (e: any) {
    toast.error(e?.data?.message || e?.message || 'Не удалось удалить шаблон')
  }
}

function menuItems(template: Template) {
  return [
    { key: 'edit', label: 'Изменить', icon: 'mingcute:edit-line' },
    {
      key: 'toggle',
      label: template.isActive ? 'Выключить' : 'Включить',
      icon: template.isActive ? 'mingcute:eye-close-line' : 'mingcute:eye-line',
    },
    { key: 'test', label: 'Отправить тест', icon: 'mingcute:send-line' },
    { key: 'delete', label: 'Удалить шаблон', icon: 'mingcute:delete-2-line', danger: true },
  ]
}

function onMenuSelect(action: string, template: Template) {
  if (action === 'edit') openEdit(template)
  else if (action === 'toggle') toggleActive(template)
  else if (action === 'test') sendTest(template)
  else if (action === 'delete') deleteTarget.value = template
}

const COLUMNS = '180px minmax(0,1fr) 132px 108px 92px 28px'
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <div class="min-w-0 flex-1">
        <h3 class="text-base font-semibold">Шаблоны сообщений</h3>
        <p class="text-sm text-subtle">Готовый текст с подстановкой переменных запуска.</p>
      </div>
      <UiButton variant="primary" @click="openCreate">
        <Icon name="mingcute:add-line" />
        Создать шаблон
      </UiButton>
    </div>

    <UiEmptyState
      v-if="!templates.length"
      variant="first"
      title="Шаблонов нет"
      description="Шаблон превращает событие завода в понятное сообщение: текст пишется один раз, значения подставляются при отправке."
    />

    <UiTable v-else :columns="COLUMNS" min-width="820px">
      <UiTableHead>
        <span>Ключ</span>
        <span>Название</span>
        <span>Категория</span>
        <span>Состояние</span>
        <span>Отправок</span>
        <span />
      </UiTableHead>

      <UiTableRow
        v-for="template in templates"
        :key="template.id"
        role="button"
        tabindex="0"
        @click="openEdit(template)"
        @keydown.enter="openEdit(template)"
      >
        <span class="truncate font-mono text-sm text-muted">{{ template.key }}</span>
        <span class="truncate">{{ template.title }}</span>
        <span class="truncate text-sm text-muted">
          {{ CATEGORY_LABELS[template.category] ?? template.category }}
        </span>
        <span class="flex items-center gap-1.5">
          <UiStatusBadge :status="template.isActive ? 'done' : 'cancelled'" size="xs" icon-only />
          <span class="text-sm text-muted">{{ template.isActive ? 'работает' : 'выключен' }}</span>
        </span>
        <span class="tnum font-mono text-sm text-muted">
          {{ template._count?.deliveries ?? 0 }}
          <Icon v-if="testingId === template.id" name="mingcute:loading-line" class="animate-spin text-info" />
        </span>
        <span @click.stop>
          <UiActionMenu :items="menuItems(template)" align="right" @select="onMenuSelect($event, template)" />
        </span>
      </UiTableRow>
    </UiTable>

    <AdminTelegramTemplateForm
      :open="showForm"
      :editing-id="editingId"
      :registry-variables="registryVariables"
      :saving="saving"
      :error="formError"
      :model-key="form.key"
      :model-title="form.title"
      :model-category="form.category"
      :model-body="form.body"
      :variables="formVariables"
      @close="showForm = false"
      @save="save"
      @update:model-key="form.key = $event"
      @update:model-title="form.title = $event"
      @update:model-category="form.category = $event"
      @update:model-body="form.body = $event"
      @update:variables="formVariables = $event"
    />

    <UiModal :open="!!deleteTarget" size="sm" title="Удалить шаблон?" @close="deleteTarget = null">
      <p class="text-sm text-muted">
        Всё, что отправляет «{{ deleteTarget?.title }}», перестанет уходить. История
        доставок останется. Если нужно только приостановить — выключите шаблон.
      </p>
      <template #footer>
        <UiButton variant="ghost" @click="deleteTarget = null">Отмена</UiButton>
        <UiButton variant="danger" @click="handleDelete">Удалить</UiButton>
      </template>
    </UiModal>
  </div>
</template>
