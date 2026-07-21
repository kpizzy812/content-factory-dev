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
        testResult.value = { success: false, error: 'Некорректный JSON в mock input' }
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
      color: 'error',
      borderBg: 'border-error/30 bg-error/5',
      text: 'text-error',
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
    detail = `Результат: ${keys.length} полей (${keys.slice(0, 3).join(', ')}${keys.length > 3 ? '...' : ''})`
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
    color: 'success',
    borderBg: 'border-success/30 bg-success/5',
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
</script>

<template>
  <div class="space-y-2">
    <!-- What is testing — collapsible help -->
    <button
      type="button"
      class="inline-flex items-center gap-0.5 text-[10px] text-base-content/40 hover:text-base-content/60 transition-colors"
      @click="showHelp = !showHelp"
    >
      <Icon name="mingcute:question-line" class="text-[10px]" />
      <span>{{ showHelp ? 'Скрыть справку' : 'Что это?' }}</span>
    </button>

    <Transition name="fade">
      <div v-if="showHelp" class="rounded-box bg-base-200/60 p-2 text-[10px] text-base-content/60 leading-relaxed space-y-1">
        <p><strong>Тестирование блока</strong> — проверка работы с пробными данными, без запуска всего конвейера.</p>
        <p>Вы задаёте входные данные (то, что блок получит от предыдущего блока), и система показывает результат.</p>
        <p><strong>Простой режим:</strong> добавьте пары «ключ = значение». Например: <kbd class="kbd kbd-xs">title</kbd> = <kbd class="kbd kbd-xs">Мой тренд</kbd></p>
        <p><strong>JSON режим:</strong> вставьте готовый JSON-объект для опытных пользователей.</p>
        <p class="text-base-content/40">Тест безопасен — он не изменяет данные и не запускает внешние API.</p>
      </div>
    </Transition>

    <!-- Config issues warning -->
    <div v-if="configIssues.length" class="rounded-box bg-warning/5 border border-warning/20 p-2 text-[10px]">
      <div class="flex items-center gap-1 text-warning font-medium mb-1">
        <Icon name="mingcute:alert-line" class="text-xs" />
        Не заполнены обязательные поля
      </div>
      <ul class="text-base-content/50 space-y-0.5">
        <li v-for="issue in configIssues" :key="issue">{{ issue }}</li>
      </ul>
    </div>

    <!-- Mode toggle -->
    <div class="flex items-center gap-1">
      <span class="text-[10px] text-base-content/50">Входные данные:</span>
      <div class="join">
        <button
          class="join-item btn btn-xs"
          :class="mode === 'simple' ? 'btn-primary' : 'btn-ghost'"
          @click="mode = 'simple'"
        >
          Простой
        </button>
        <button
          class="join-item btn btn-xs"
          :class="mode === 'advanced' ? 'btn-primary' : 'btn-ghost'"
          @click="mode = 'advanced'"
        >
          JSON
        </button>
      </div>
    </div>

    <!-- Simple mode -->
    <div v-if="mode === 'simple'" class="space-y-1">
      <div
        v-for="(field, idx) in simpleFields"
        :key="idx"
        class="flex items-center gap-1"
      >
        <input
          v-model="field.key"
          type="text"
          class="input input-xs w-24 font-mono"
          placeholder="ключ"
        />
        <span class="text-base-content/30 text-xs">=</span>
        <input
          v-model="field.value"
          type="text"
          class="input input-xs flex-1 font-mono"
          placeholder="значение"
        />
        <div v-if="simpleFields.length > 1" class="tooltip tooltip-left" data-tip="Убрать поле">
          <button class="btn btn-ghost btn-xs btn-square" @click="removeSimpleField(idx)">
            <Icon name="mingcute:close-line" class="text-error text-[10px]" />
          </button>
        </div>
      </div>
      <button class="btn btn-ghost btn-xs gap-0.5" @click="addSimpleField">
        <Icon name="mingcute:add-line" class="text-[10px]" />
        <span class="text-[10px]">Добавить поле</span>
      </button>
    </div>

    <!-- Advanced mode -->
    <div v-else>
      <textarea
        v-model="testMockInput"
        class="textarea textarea-xs w-full font-mono text-[10px] h-16"
        placeholder='{"trends": [...], "key": "value"}'
      />
    </div>

    <!-- Run button -->
    <button
      class="btn btn-outline btn-sm btn-block"
      :disabled="isTesting"
      @click="runTest"
    >
      <span v-if="isTesting" class="loading loading-spinner loading-sm" />
      <Icon v-else name="mingcute:play-fill" />
      Запустить тест
    </button>

    <!-- Result: human-friendly -->
    <Transition name="fade">
      <div
        v-if="showResult && resultSummary"
        class="rounded-box border p-2.5 text-xs"
        :class="resultSummary.borderBg"
      >
        <div class="flex items-center gap-1.5 mb-1">
          <Icon
            :name="resultSummary.icon"
            :class="resultSummary.text"
            class="text-base"
          />
          <span class="font-semibold" :class="resultSummary.text">
            {{ resultSummary.title }}
          </span>
          <span class="flex-1" />
          <span v-if="testResult?.duration" class="text-[10px] text-base-content/40">
            {{ testResult.duration }}мс
          </span>
          <div class="tooltip tooltip-left" data-tip="Скрыть результат">
            <button class="btn btn-ghost btn-xs btn-square" @click="dismissResult">
              <Icon name="mingcute:close-line" class="text-[10px]" />
            </button>
          </div>
        </div>

        <p class="text-base-content/70 text-[11px]">{{ resultSummary.detail }}</p>

        <!-- Human-friendly hint -->
        <p v-if="resultSummary.hint" class="text-[10px] text-base-content/40 mt-1">
          {{ resultSummary.hint }}
        </p>

        <!-- Expandable raw output -->
        <details v-if="testResult?.success && testResult?.output" class="mt-2">
          <summary class="text-[10px] text-base-content/40 cursor-pointer hover:text-base-content/60">
            Подробный результат (JSON)
          </summary>
          <pre class="mt-1 whitespace-pre-wrap break-all text-[10px] max-h-32 overflow-auto bg-base-200/50 rounded p-1.5">{{ JSON.stringify(testResult.output, null, 2) }}</pre>
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
