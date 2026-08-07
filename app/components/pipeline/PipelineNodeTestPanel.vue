<script setup lang="ts">
/**
 * Human-friendly тест-панель для pipeline нод.
 * Два режима: Простой (визуальная форма) и JSON (продвинутый).
 * Результаты показываются в понятном виде с пояснениями.
 */

const props = defineProps<{
  nodeType: string
  config: Record<string, any>
}>()

const mode = ref<'simple' | 'advanced'>('simple')
const isTesting = ref(false)
const testMockInput = ref('')
const showHelp = ref(false)

interface TestResult {
  success: boolean
  output?: any
  error?: string
  duration?: number
}

const testResult = ref<TestResult | null>(null)
const showResult = ref(false)

// Simple mode: ключ-значение пары
interface SimpleField {
  key: string
  value: string
}

const simpleFields = ref<SimpleField[]>([{ key: '', value: '' }])

function addSimpleField() {
  simpleFields.value.push({ key: '', value: '' })
}

function removeSimpleField(index: number) {
  simpleFields.value.splice(index, 1)
  if (simpleFields.value.length === 0) {
    simpleFields.value.push({ key: '', value: '' })
  }
}

/**
 * Конвертирует simple fields в JSON object.
 * Пытается парсить числа и boolean.
 */
function simpleToJson(): Record<string, unknown> {
  const obj: Record<string, unknown> = {}
  for (const field of simpleFields.value) {
    const key = field.key.trim()
    if (!key) continue
    const val = field.value.trim()

    if (val === 'true') obj[key] = true
    else if (val === 'false') obj[key] = false
    else if (val !== '' && !isNaN(Number(val))) obj[key] = Number(val)
    else if (val.startsWith('[') || val.startsWith('{')) {
      try { obj[key] = JSON.parse(val) } catch { obj[key] = val }
    }
    else obj[key] = val
  }
  return obj
}

async function runTest() {
  isTesting.value = true
  testResult.value = null
  showResult.value = false

  let mockInput: Record<string, unknown> = {}

  if (mode.value === 'simple') {
    mockInput = simpleToJson()
  } else {
    if (testMockInput.value.trim()) {
      try {
        mockInput = JSON.parse(testMockInput.value)
      } catch {
        testResult.value = { success: false, error: 'Некорректный JSON во входных данных' }
        showResult.value = true
        isTesting.value = false
        return
      }
    }
  }

  try {
    const res = await $fetch<{ data: TestResult }>('/api/pipelines/nodes/test', {
      method: 'POST',
      body: {
        nodeType: props.nodeType,
        nodeConfig: props.config,
        mockInput,
      },
    })
    testResult.value = res.data
    showResult.value = true
  } catch (e: any) {
    testResult.value = {
      success: false,
      error: e?.data?.message || 'Ошибка выполнения теста',
    }
    showResult.value = true
  } finally {
    isTesting.value = false
  }
}

function dismissResult() {
  showResult.value = false
  testResult.value = null
}

// Human-readable result summary
const resultSummary = computed(() => {
  if (!testResult.value) return null
  if (!testResult.value.success) {
    return {
      icon: 'mingcute:close-circle-line',
      box: 'border-danger-border bg-danger-bg',
      text: 'text-danger',
      title: 'Ошибка при выполнении',
      detail: testResult.value.error || 'Неизвестная ошибка',
      hint: 'Проверьте настройки блока и входные данные. Если ошибка повторяется — проблема в конфигурации.',
    }
  }

  const output = testResult.value.output
  const outputType = Array.isArray(output) ? 'array' : typeof output

  let detail = ''
  let hint = ''
  if (outputType === 'array') {
    detail = `Получено ${output.length} элементов`
    hint = output.length === 0
      ? 'Блок вернул пустой массив — проверьте входные данные или фильтры.'
      : 'Блок вернул данные. Они будут переданы следующему блоку конвейера.'
  } else if (outputType === 'object' && output !== null) {
    const keys = Object.keys(output)
    detail = `Результат: ${keys.length} полей (${keys.slice(0, 3).join(', ')}${keys.length > 3 ? '…' : ''})`
    hint = 'Блок вернул объект с данными — они будут доступны следующему блоку.'
  } else if (outputType === 'string') {
    detail = output.length > 100 ? `Текст (${output.length} символов)` : output
    hint = 'Блок вернул текстовый результат.'
  } else {
    detail = String(output)
    hint = 'Блок вернул результат.'
  }

  return {
    icon: 'mingcute:check-circle-line',
    box: 'border-success-border bg-success-bg',
    text: 'text-success',
    title: 'Блок работает корректно',
    detail,
    hint,
  }
})

// Config status check
const configIssues = computed(() => {
  const issues: string[] = []
  const schema = nodeFieldSchemas[props.nodeType]
  if (!schema) return issues

  for (const [key, field] of Object.entries(schema)) {
    if (field.type === 'ref' && !props.config[key]) {
      issues.push(`${field.label} — не выбрано`)
    }
  }
  return issues
})

// Reset on node change
watch(() => props.nodeType, () => {
  testResult.value = null
  showResult.value = false
  testMockInput.value = ''
  simpleFields.value = [{ key: '', value: '' }]
})

const KBD = 'rounded-sm border border-border bg-card px-1 font-mono text-micro text-fg'
</script>

<template>
  <div class="flex flex-col gap-2">
    <!-- Справка -->
    <button
      type="button"
      class="inline-flex cursor-pointer items-center gap-0.5 self-start text-micro text-subtle transition-colors duration-(--duration-fast) ease-out hover:text-muted"
      @click="showHelp = !showHelp"
    >
      <Icon name="mingcute:question-line" />
      <span>{{ showHelp ? 'Скрыть справку' : 'Что это?' }}</span>
    </button>

    <Transition name="fade">
      <div
        v-if="showHelp"
        class="flex flex-col gap-1 rounded-md border border-border bg-card p-2 text-micro leading-relaxed text-muted"
      >
        <p><strong class="text-fg">Тестирование блока</strong> — проверка работы с пробными данными, без запуска всего конвейера.</p>
        <p>Вы задаёте входные данные (то, что блок получит от предыдущего блока), и система показывает результат.</p>
        <p><strong class="text-fg">Простой режим:</strong> добавьте пары «ключ = значение». Например: <span :class="KBD">title</span> = <span :class="KBD">Мой тренд</span></p>
        <p><strong class="text-fg">JSON режим:</strong> вставьте готовый JSON-объект для опытных пользователей.</p>
        <p class="text-subtle">Тест безопасен — он не изменяет данные и не запускает внешние API.</p>
      </div>
    </Transition>

    <!-- Незаполненные обязательные поля -->
    <div
      v-if="configIssues.length"
      class="rounded-md border border-warning-border bg-warning-bg p-2 text-micro"
    >
      <div class="mb-1 flex items-center gap-1 font-medium text-warning">
        <Icon name="mingcute:alert-line" />
        Не заполнены обязательные поля
      </div>
      <ul class="flex flex-col gap-0.5 text-muted">
        <li v-for="issue in configIssues" :key="issue">{{ issue }}</li>
      </ul>
    </div>

    <!-- Режим ввода -->
    <div class="flex items-center gap-2">
      <span class="text-micro text-subtle">Входные данные:</span>
      <div class="flex rounded-md border border-border bg-card p-0.5">
        <button
          type="button"
          class="h-5 cursor-pointer rounded-sm px-2 text-micro font-medium transition-colors duration-(--duration-fast) ease-out"
          :class="mode === 'simple' ? 'bg-accent text-on-accent' : 'text-muted hover:text-fg'"
          @click="mode = 'simple'"
        >Простой</button>
        <button
          type="button"
          class="h-5 cursor-pointer rounded-sm px-2 text-micro font-medium transition-colors duration-(--duration-fast) ease-out"
          :class="mode === 'advanced' ? 'bg-accent text-on-accent' : 'text-muted hover:text-fg'"
          @click="mode = 'advanced'"
        >JSON</button>
      </div>
    </div>

    <!-- Простой режим -->
    <div v-if="mode === 'simple'" class="flex flex-col gap-1">
      <div
        v-for="(field, idx) in simpleFields"
        :key="idx"
        class="flex items-center gap-1"
      >
        <UiInput v-model="field.key" mono class="w-24 shrink-0" placeholder="ключ" />
        <span class="text-subtle">=</span>
        <UiInput v-model="field.value" mono class="min-w-0 flex-1" placeholder="значение" />
        <UiTooltip v-if="simpleFields.length > 1" text="Убрать поле" placement="left">
          <UiButton variant="ghost" icon-only @click="removeSimpleField(idx)">
            <Icon name="mingcute:close-line" class="text-danger" />
          </UiButton>
        </UiTooltip>
      </div>
      <UiButton variant="ghost" class="self-start" @click="addSimpleField">
        <Icon name="mingcute:add-line" />
        Добавить поле
      </UiButton>
    </div>

    <!-- JSON-режим -->
    <UiTextarea
      v-else
      v-model="testMockInput"
      :rows="3"
      class="font-mono text-micro"
      placeholder='{"trends": [...], "key": "value"}'
    />

    <UiButton class="w-full justify-center" :loading="isTesting" @click="runTest">
      <Icon v-if="!isTesting" name="mingcute:play-fill" />
      Запустить тест
    </UiButton>

    <!-- Результат -->
    <Transition name="fade">
      <div
        v-if="showResult && resultSummary"
        class="rounded-md border p-2.5"
        :class="resultSummary.box"
      >
        <div class="mb-1 flex items-center gap-1.5">
          <Icon :name="resultSummary.icon" :class="resultSummary.text" />
          <span class="font-semibold" :class="resultSummary.text">{{ resultSummary.title }}</span>
          <span class="flex-1" />
          <span v-if="testResult?.duration" class="tnum text-micro text-subtle">
            {{ testResult.duration }} мс
          </span>
          <UiTooltip text="Скрыть результат" placement="left">
            <UiButton variant="ghost" icon-only @click="dismissResult">
              <Icon name="mingcute:close-line" />
            </UiButton>
          </UiTooltip>
        </div>

        <p class="text-sm text-muted">{{ resultSummary.detail }}</p>

        <p v-if="resultSummary.hint" class="mt-1 text-micro text-subtle">
          {{ resultSummary.hint }}
        </p>

        <details v-if="testResult?.success && testResult?.output" class="mt-2">
          <summary class="cursor-pointer text-micro text-subtle hover:text-muted">
            Подробный результат (JSON)
          </summary>
          <pre class="mt-1 max-h-32 overflow-auto rounded-sm border border-divider bg-card p-1.5 font-mono text-micro break-all whitespace-pre-wrap">{{ JSON.stringify(testResult.output, null, 2) }}</pre>
        </details>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
