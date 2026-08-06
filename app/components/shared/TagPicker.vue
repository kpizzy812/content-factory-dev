<script setup lang="ts">
/**
 * Generic TagPicker — переиспользуемый picker для тегов с подгрузкой пула через
 * настраиваемый endpoint. Поддерживает inline rename, create-on-the-fly,
 * delete from pool, keyboard навигацию.
 *
 * Используется через тонкие обёртки: `PipelineTagPicker.vue`,
 * `IndigoProfileTagPicker.vue` — чтобы захардкодить endpoint.
 *
 * Server contract (для любого endpoint):
 * - GET    {endpoint}                       → { data: Array<{ id, name }> }
 * - POST   {endpoint} body {name}           → 201 / 409 если уже есть
 * - PUT    {endpoint} body {oldName,newName}→ rename
 * - DELETE {endpoint} body {name}           → remove from pool
 *
 * История появления: extracted из PipelineTagPicker.vue, см. memory
 * indigo_ui_research для motivation.
 */

const props = withDefaults(
  defineProps<{
    modelValue: string[]
    endpoint: string
    placeholder?: string
    maxTags?: number
    allowRename?: boolean
    allowDeletePool?: boolean
    /**
     * Когда false — POST {endpoint} не вызывается. Это для случаев, когда у backend-а нет
     * настоящего хранилища тегов (тег "виртуальный" — distinct unnest из существующих
     * записей, см. /api/device-profiles/tags.get). При этом юзер всё равно может
     * добавить совершенно новый тег: вводит строку → Enter → попадает в local state
     * формы → сохранится в массиве модели при save. На следующий показ dropdown'а
     * этот тег появится через distinct.
     *
     * Что меняется в UI при allowCreate=false:
     *   - "Создать <X>" highlighted-кнопка в dropdown не показывается;
     *   - Enter с непустым search всё равно работает и добавляет тег в selection;
     *   - сетевого POST нет — никаких no-op 201 ответов.
     */
    allowCreate?: boolean
    disabled?: boolean
  }>(),
  {
    placeholder: 'Добавить тег...',
    maxTags: 30,
    allowRename: true,
    allowDeletePool: true,
    allowCreate: true,
    disabled: false,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string[]]
}>()

const search = ref('')
const showDropdown = ref(false)
const allTags = ref<string[]>([])
const isLoading = ref(false)
const inputRef = ref<HTMLInputElement | null>(null)
const dropdownStyle = ref<Record<string, string>>({})
const teleportTarget = ref<HTMLElement | null>(null)
const isMounted = ref(false)

// Inline rename
const editingTag = ref<string | null>(null)
const editingName = ref('')

const suggestions = computed(() => {
  const selected = new Set(props.modelValue.map(t => t.toLowerCase()))
  const available = allTags.value.filter(t => !selected.has(t.toLowerCase()))
  const q = search.value.trim().toLowerCase()
  if (!q) return available
  return available.filter(t => t.toLowerCase().includes(q))
})

// "Create новый тег" highlight в dropdown — только если allowCreate. При allowCreate=false
// этой кнопки нет, но Enter всё равно положит строку в selection (см. addTag ниже).
const canCreate = computed(() => {
  if (!props.allowCreate) return false
  const q = search.value.trim()
  if (!q) return false
  if (props.modelValue.length >= props.maxTags) return false
  const lower = q.toLowerCase()
  return !props.modelValue.some(t => t.toLowerCase() === lower)
    && !allTags.value.some(t => t.toLowerCase() === lower)
})

async function loadTags() {
  isLoading.value = true
  try {
    const res = await $fetch<{ data: Array<{ id: number | string; name: string }> }>(props.endpoint)
    allTags.value = res.data.map(t => t.name)
  }
  catch { /* empty */ }
  finally {
    isLoading.value = false
  }
}

async function createTag(name: string) {
  const trimmed = name.trim()
  if (!trimmed) return

  try {
    await $fetch(props.endpoint, {
      method: 'POST',
      body: { name: trimmed },
    })
  }
  catch {
    // 409 = уже существует, это ок
  }

  if (!allTags.value.some(t => t.toLowerCase() === trimmed.toLowerCase())) {
    allTags.value.push(trimmed)
    allTags.value.sort((a, b) => a.localeCompare(b, 'ru'))
  }
}

async function addTag(tag: string) {
  const trimmed = tag.trim()
  if (!trimmed) return
  if (props.modelValue.some(t => t.toLowerCase() === trimmed.toLowerCase())) return
  if (props.modelValue.length >= props.maxTags) return

  // Если тега нет в пуле — создать на сервере (только если backend поддерживает POST).
  // При allowCreate=false (например, DuoPlus) пул собирается distinct'ом, реального
  // POST нет — тег сохранится в БД при save профиля.
  if (
    props.allowCreate
    && !allTags.value.some(t => t.toLowerCase() === trimmed.toLowerCase())
  ) {
    await createTag(trimmed)
  }

  emit('update:modelValue', [...props.modelValue, trimmed])
  search.value = ''
}

function removeTagFromSelection(tag: string) {
  emit('update:modelValue', props.modelValue.filter(t => t !== tag))
}

async function deleteTagFromPool(tag: string) {
  if (!props.allowDeletePool) return
  try {
    await $fetch(props.endpoint, {
      method: 'DELETE',
      body: { name: tag },
    })
  }
  catch { /* empty */ }

  allTags.value = allTags.value.filter(t => t !== tag)
  if (props.modelValue.includes(tag)) {
    emit('update:modelValue', props.modelValue.filter(t => t !== tag))
  }
}

function startEditing(tag: string) {
  if (!props.allowRename) return
  editingTag.value = tag
  editingName.value = tag
}

async function finishEditing() {
  if (!editingTag.value) return
  const oldName = editingTag.value
  const newName = editingName.value.trim()

  editingTag.value = null

  if (!newName || newName === oldName) return

  try {
    await $fetch(props.endpoint, {
      method: 'PUT',
      body: { oldName, newName },
    })
  }
  catch { return }

  const idx = allTags.value.indexOf(oldName)
  if (idx >= 0) allTags.value[idx] = newName

  if (props.modelValue.includes(oldName)) {
    emit('update:modelValue', props.modelValue.map(t => t === oldName ? newName : t))
  }
}

function cancelEditing() {
  editingTag.value = null
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && showDropdown.value) {
    // Закрываем только dropdown, не даём Escape'у закрыть родительский <dialog>
    e.preventDefault()
    e.stopPropagation()
    showDropdown.value = false
    detachReposition()
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    addTag(search.value)
  }
  if (e.key === 'Backspace' && !search.value && props.modelValue.length > 0) {
    emit('update:modelValue', props.modelValue.slice(0, -1))
  }
}

function hideDropdown() {
  setTimeout(() => {
    showDropdown.value = false
    detachReposition()
  }, 200)
}

function updateDropdownPosition() {
  if (!inputRef.value) return
  const rect = inputRef.value.getBoundingClientRect()
  dropdownStyle.value = {
    position: 'fixed',
    top: `${rect.bottom + 4}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    zIndex: '100',
  }
}

function attachReposition() {
  // capture:true — ловим скролл любого ancestor-а (modal-box scrollable содержимое)
  window.addEventListener('scroll', updateDropdownPosition, true)
  window.addEventListener('resize', updateDropdownPosition)
}

function detachReposition() {
  window.removeEventListener('scroll', updateDropdownPosition, true)
  window.removeEventListener('resize', updateDropdownPosition)
}

function resolveTeleportTarget(): HTMLElement {
  // <dialog>.showModal() рендерится в top layer браузера. Teleport в body кладёт
  // dropdown в обычный DOM, из-за чего он уходит ПОД модалку. Ищем ближайший
  // <dialog>-ancestor и телепортим туда — dropdown оказывается в том же top layer.
  let el: HTMLElement | null = inputRef.value
  while (el) {
    if (el.tagName === 'DIALOG') return el
    el = el.parentElement
  }
  return document.body
}

function onFocus() {
  if (props.disabled) return
  showDropdown.value = true
  updateDropdownPosition()
  attachReposition()
  loadTags()
}

onMounted(() => {
  teleportTarget.value = resolveTeleportTarget()
  isMounted.value = true
})

onBeforeUnmount(() => {
  detachReposition()
})
</script>

<template>
  <div class="flex flex-col gap-2">
    <div v-if="modelValue.length > 0" class="flex flex-wrap gap-1.5">
      <span
        v-for="tag in modelValue"
        :key="tag"
        class="inline-flex items-center gap-1 rounded-sm border border-divider bg-card px-1.5 py-0.5 text-micro text-muted"
      >
        {{ tag }}
        <button
          type="button"
          class="cursor-pointer text-subtle hover:text-danger"
          :disabled="disabled"
          :aria-label="`Убрать тег ${tag}`"
          @click="removeTagFromSelection(tag)"
        >
          <Icon name="mingcute:close-line" />
        </button>
      </span>
    </div>

    <div>
      <input
        ref="inputRef"
        v-model="search"
        type="text"
        class="h-8 w-full rounded-md border border-border bg-card px-2.5 text-base text-fg outline-offset-1 focus:border-accent"
        :placeholder="placeholder"
        :disabled="disabled"
        @focus="onFocus"
        @blur="hideDropdown"
        @keydown="handleKeydown"
        @input="updateDropdownPosition"
      >

      <Teleport v-if="isMounted && teleportTarget" :to="teleportTarget">
        <div
          v-if="showDropdown && (suggestions.length > 0 || canCreate || isLoading)"
          :style="dropdownStyle"
          class="max-h-48 overflow-y-auto rounded-md border border-border bg-raised shadow-md"
        >
          <div v-if="isLoading" class="flex items-center justify-center gap-2 p-3 text-sm text-muted">
            <Icon name="mingcute:loading-line" class="animate-spin" />
            Загружаем
          </div>
          <template v-else>
            <button
              v-if="canCreate"
              type="button"
              class="flex w-full cursor-pointer items-center gap-2 border-b border-divider px-3 py-2 text-left text-sm hover:bg-card"
              @mousedown.prevent="addTag(search)"
            >
              <Icon name="mingcute:add-line" class="text-accent" />
              <span>Создать «{{ search.trim() }}»</span>
            </button>

            <div
              v-for="tag in suggestions"
              :key="tag"
              class="group flex items-center hover:bg-card"
            >
              <input
                v-if="editingTag === tag"
                v-model="editingName"
                class="mx-1 my-1 h-7 flex-1 rounded-md border border-border bg-card px-2 text-sm text-fg"
                @keydown.enter.prevent="finishEditing"
                @keydown.escape.prevent="cancelEditing"
                @blur="finishEditing"
                @mousedown.stop
              >

              <template v-else>
                <button
                  type="button"
                  class="flex-1 cursor-pointer px-3 py-2 text-left text-sm"
                  @mousedown.prevent="addTag(tag)"
                >
                  {{ tag }}
                </button>
                <button
                  v-if="allowRename"
                  type="button"
                  class="cursor-pointer px-1 py-1 text-subtle opacity-0 transition-opacity group-hover:opacity-100 hover:text-fg"
                  title="Переименовать"
                  @mousedown.prevent="startEditing(tag)"
                >
                  <Icon name="mingcute:edit-line" />
                </button>
                <button
                  v-if="allowDeletePool"
                  type="button"
                  class="mr-1 cursor-pointer px-1 py-1 text-subtle opacity-0 transition-opacity group-hover:opacity-100 hover:text-danger"
                  title="Убрать из общего списка"
                  @mousedown.prevent="deleteTagFromPool(tag)"
                >
                  <Icon name="mingcute:delete-2-line" />
                </button>
              </template>
            </div>
          </template>
        </div>
      </Teleport>
    </div>
  </div>
</template>
