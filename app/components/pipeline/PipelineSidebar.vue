<script setup lang="ts">
/**
 * Палитра блоков. Источник: 04-pipeline-editor.dc.html.
 *
 * Группы — те же категории, что красят полоску блока на канвасе
 * (`PipelineNodeMeta`): палитра и граф обязаны называть одно и то же одинаково,
 * иначе «Производство» в палитре и фиолетовая полоска на канвасе перестают
 * читаться как одно и то же.
 *
 * Описание блока показывается по наведению, а не второй строкой: двадцать
 * четыре типа с подписями в два ряда не помещаются на экран, и палитру
 * приходится листать вместо того, чтобы читать.
 */
import { PIPELINE_NODE_META, type NodeCategory } from './PipelineNodeMeta'

const store = usePipelineEditorStore()

const CATEGORY_TITLES: Array<{ key: NodeCategory, title: string }> = [
  { key: 'src', title: 'Источники' },
  { key: 'prod', title: 'Производство' },
  { key: 'ctrl', title: 'Контроль' },
  { key: 'out', title: 'Выход' },
  { key: 'util', title: 'Служебные' },
]

const CATEGORY_COLOR: Record<NodeCategory, string> = {
  src: 'var(--color-cat-src)',
  prod: 'var(--color-cat-prod)',
  ctrl: 'var(--color-cat-ctrl)',
  out: 'var(--color-cat-out)',
  util: 'var(--color-cat-util)',
}

/** Что делает блок — короткой фразой, для подсказки при наведении. */
const DESCRIPTIONS: Record<string, string> = {
  google_drive_scanner: 'Забирает файлы из папки Google Drive и отдаёт их дальше.',
  trendwatcher: 'Собирает тренды с площадок по профилю парсинга.',
  content_strategy: 'Гипотеза, лид-магнит и CTA под собранные тренды.',
  character: 'Подставляет героя из библиотеки персонажей.',
  scene_composer: 'Готовая сцена из композитора вместо генерации с нуля.',
  scenario: 'Пишет сценарии и варианты по брифу.',
  video: 'Собирает ролик: кадры, клипы, озвучка, сборка.',
  video_analyzer: 'Маркетинговый разбор готового ролика по кадрам.',
  caption_generator: 'Заголовок, описание и теги под площадку.',
  idea: 'Разбирает идею или референс в бриф.',
  quality_gate: 'Пропускает дальше только то, что прошло проверку.',
  filter: 'Отсеивает элементы по условию.',
  if_switch: 'Разводит поток по двум именованным выходам.',
  loop: 'Прогоняет ветку по каждому элементу списка.',
  wait: 'Пауза перед следующим блоком.',
  set: 'Кладёт в поток вычисленные значения.',
  upload: 'Публикует ролик в социальную сеть.',
  analytics: 'Собирает метрики опубликованного.',
  notification: 'Пишет в Telegram о результате.',
  google_drive_uploader: 'Кладёт готовый файл в папку Google Drive.',
  http_request: 'Запрос во внешний API: метод, заголовки, тело.',
  code: 'Изолированный JS над данными потока.',
  sub_pipeline: 'Вызывает другой конвейер как один блок.',
  note: 'Заметка на полотне: без портов и без категории.',
}

const searchQuery = ref('')
const collapsed = ref(false)

const groups = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()

  return CATEGORY_TITLES.map(category => ({
    ...category,
    blocks: Object.entries(PIPELINE_NODE_META)
      .filter(([, meta]) => meta.category === category.key)
      .map(([type, meta]) => ({ type, ...meta, description: DESCRIPTIONS[type] ?? '' }))
      .filter(block => !query
        || block.label.toLowerCase().includes(query)
        || block.type.includes(query)
        || block.description.toLowerCase().includes(query)),
  })).filter(category => category.blocks.length > 0)
})

const totalTypes = Object.keys(PIPELINE_NODE_META).length

let nodeCounter = 0

function onDragStart(event: DragEvent, block: { type: string, label: string }) {
  if (!event.dataTransfer) return
  event.dataTransfer.setData('block-type', block.type)
  event.dataTransfer.setData('block-label', block.label)
  event.dataTransfer.effectAllowed = 'move'
}

function addNodeToCanvas(block: { type: string, label: string }) {
  nodeCounter += 1
  store.addNode({
    id: `${block.type}-${Date.now()}-${nodeCounter}`,
    type: block.type,
    position: { x: 200 + nodeCounter * 20, y: 100 + nodeCounter * 20 },
    data: { label: block.label, type: block.type, config: {} },
  })
}
</script>

<template>
  <aside
    class="flex shrink-0 flex-col overflow-hidden border-r border-border bg-panel transition-[width]"
    :class="collapsed ? 'w-11' : 'w-60'"
  >
    <div class="flex flex-none items-center gap-2 border-b border-divider p-2.5">
      <UiInput
        v-if="!collapsed"
        v-model="searchQuery"
        placeholder="Поиск ноды"
        class="flex-1"
      />
      <button
        type="button"
        class="flex h-7 w-6.5 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border bg-card text-muted hover:text-fg"
        :title="collapsed ? 'Развернуть палитру' : 'Свернуть палитру'"
        @click="collapsed = !collapsed"
      >
        <Icon :name="collapsed ? 'mingcute:right-line' : 'mingcute:left-line'" />
      </button>
    </div>

    <div v-if="!collapsed" class="min-h-0 flex-1 overflow-y-auto p-2">
      <template v-for="group in groups" :key="group.key">
        <div
          class="flex h-5.5 items-center gap-1.5 px-1.5 text-[10.5px] tracking-[.07em] text-subtle uppercase first:mt-0 [&:not(:first-child)]:mt-1.5"
        >
          <span class="size-2 rounded-[2px]" :style="{ background: CATEGORY_COLOR[group.key] }" />
          {{ group.title }}
        </div>

        <UiTooltip
          v-for="block in group.blocks"
          :key="block.type"
          :text="block.description"
          placement="right"
          class="w-full"
        >
          <div
            class="flex h-[30px] cursor-grab items-center gap-2.5 rounded-sm px-1.5 hover:bg-card"
            draggable="true"
            @dragstart="onDragStart($event, block)"
            @click="addNodeToCanvas(block)"
          >
            <Icon
              :name="block.icon"
              class="shrink-0"
              :style="{ color: block.type === 'note' ? 'var(--color-text-subtle)' : CATEGORY_COLOR[group.key] }"
            />
            <span class="min-w-0 flex-1 truncate text-[12.5px]">{{ block.label }}</span>
            <span v-if="block.type === 'note'" class="text-[10.5px] text-subtle">без цвета</span>
          </div>
        </UiTooltip>
      </template>

      <UiEmptyState
        v-if="!groups.length"
        title="Ничего не найдено"
        description="Попробуйте другое слово — поиск идёт по названию и описанию блока."
      />

      <p v-else class="px-1.5 pt-2 pb-1 text-[11px] leading-relaxed text-subtle">
        Всего {{ totalTypes }} типа нод. Тон иконки — категория, наведение
        показывает описание. Блок ставится перетаскиванием или кликом.
      </p>
    </div>
  </aside>
</template>
