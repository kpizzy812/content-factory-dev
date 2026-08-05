<script setup lang="ts">
/**
 * Командная палитра ⌘K. Источник: design-preview/_system/blocks/CommandPalette*.html
 *
 * Основной способ перемещаться по ~20 разделам и ~50 страницам: перебирать их
 * мышью в меню на такой глубине бессмысленно.
 *
 * Поиск по сущностям (vid_10842, @zavod.mebel.ru) в макете есть, но требует
 * общего серверного endpoint, которого пока нет, — секция подключается в
 * этапе 5 без изменения этого компонента.
 */
const { allItems } = useAppNavigation()
const router = useRouter()

const open = ref(false)
const query = ref('')
const cursor = ref(0)
const inputEl = ref<HTMLInputElement | null>(null)
const recent = useState<string[]>('cmdk-recent', () => [])

interface Row {
  /** Уникален в пределах списка: два пункта могут вести на один маршрут. */
  key: string
  /** Маршрут, если строка — переход. Нужен для «недавнего». */
  to?: string
  label: string
  hint?: string
  icon: string
  section: string
  run: () => void
}

const commands = computed<Row[]>(() => [
  {
    key: 'cmd:stuck',
    label: 'Показать застрявшее',
    hint: 'Команда',
    icon: 'mingcute:alert-line',
    section: 'Команды',
    run: () => router.push('/?filter=stuck'),
  },
  {
    key: 'cmd:theme',
    label: 'Переключить тему',
    hint: 'Команда',
    icon: 'mingcute:sun-line',
    section: 'Команды',
    run: () => {
      const cm = useColorMode()
      cm.preference = cm.preference === 'dark' ? 'light' : 'dark'
    },
  },
])

const sections = computed(() => {
  const q = query.value.trim().toLowerCase()

  const navRows: Row[] = allItems.value.map((i, idx) => ({
    key: `nav:${idx}:${i.to}`,
    to: i.to,
    label: i.label,
    hint: i.group ?? 'Раздел',
    icon: i.icon,
    section: 'Разделы',
    run: () => router.push(i.to),
  }))

  const all = [...navRows, ...commands.value]

  let rows: Row[]
  if (q) {
    rows = all.filter(r => r.label.toLowerCase().includes(q) || r.hint?.toLowerCase().includes(q))
  }
  else {
    // Пустой запрос: сверху недавнее, ниже всё остальное без повторов.
    const recentRows = recent.value
      .map(to => navRows.find(r => r.to === to))
      .filter((r): r is Row => !!r)
      .map(r => ({ ...r, section: 'Недавнее', key: `recent:${r.key}` }))
    const recentSet = new Set(recent.value)
    rows = [...recentRows, ...all.filter(r => !r.to || !recentSet.has(r.to))]
  }

  const grouped = new Map<string, Row[]>()
  for (const r of rows) {
    if (!grouped.has(r.section)) grouped.set(r.section, [])
    grouped.get(r.section)!.push(r)
  }
  return grouped
})

const flat = computed(() => [...sections.value.values()].flat())

function openPalette() {
  open.value = true
  query.value = ''
  cursor.value = 0
  nextTick(() => inputEl.value?.focus())
}

function pick(row?: Row) {
  const target = row ?? flat.value[cursor.value]
  if (!target) return
  open.value = false
  if (target.to) {
    const to = target.to
    recent.value = [to, ...recent.value.filter(r => r !== to)].slice(0, 4)
  }
  target.run()
}

function onKeydown(e: KeyboardEvent) {
  const mod = e.ctrlKey || e.metaKey
  if (mod && e.code === 'KeyK') {
    e.preventDefault()
    open.value ? (open.value = false) : openPalette()
    return
  }
  if (!open.value) return

  if (e.key === 'Escape') {
    e.stopPropagation()
    open.value = false
  }
  else if (e.key === 'ArrowDown') {
    e.preventDefault()
    cursor.value = Math.min(cursor.value + 1, flat.value.length - 1)
  }
  else if (e.key === 'ArrowUp') {
    e.preventDefault()
    cursor.value = Math.max(cursor.value - 1, 0)
  }
  else if (e.key === 'Enter') {
    e.preventDefault()
    pick()
  }
}

watch(query, () => { cursor.value = 0 })

onMounted(() => document.addEventListener('keydown', onKeydown, true))
onUnmounted(() => document.removeEventListener('keydown', onKeydown, true))

defineExpose({ openPalette })
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-start justify-center bg-overlay px-4 pt-[12vh]"
      @click.self="open = false"
    >
      <div class="w-full max-w-xl overflow-hidden rounded-lg border border-border bg-raised shadow-lg">
        <div class="flex h-11 items-center gap-2.5 border-b border-divider px-3">
          <Icon name="mingcute:search-line" class="shrink-0 text-subtle" />
          <input
            ref="inputEl"
            v-model="query"
            placeholder="Поиск и команды"
            class="flex-1 bg-transparent text-md outline-none placeholder:text-subtle"
          >
          <span class="shrink-0 rounded-sm border border-border bg-surface px-1.5 py-0.5 font-mono text-micro text-subtle">esc</span>
        </div>

        <div class="max-h-[52vh] overflow-y-auto p-1.5">
          <template v-for="[section, rows] in sections" :key="section">
            <div class="px-[9px] pt-1.5 pb-1 text-[10.5px] tracking-[.07em] text-subtle uppercase">
              {{ section }}
            </div>
            <button
              v-for="row in rows"
              :key="`${section}:${row.key}`"
              type="button"
              class="flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-sm px-[9px] text-base"
              :class="flat[cursor]?.key === row.key ? 'bg-accent-bg text-fg' : 'text-muted hover:bg-card'"
              @click="pick(row)"
              @mouseenter="cursor = flat.findIndex(r => r.key === row.key)"
            >
              <Icon :name="row.icon" class="shrink-0" />
              <span class="truncate">{{ row.label }}</span>
              <span v-if="row.hint" class="shrink-0 text-subtle">· {{ row.hint }}</span>
              <span class="flex-1" />
              <span v-if="flat[cursor]?.key === row.key" class="shrink-0 font-mono text-micro text-subtle">↵</span>
            </button>
          </template>

          <div v-if="!flat.length" class="px-[9px] py-6 text-center text-sm text-subtle">
            Ничего не найдено
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
