<script setup lang="ts">
const store = usePipelineEditorStore()

const categories = [
  {
    name: 'Источники',
    blocks: [
      { type: 'google_drive_scanner', label: 'Drive Scanner', icon: 'mingcute:cloud-line', color: 'badge-info', description: 'Сканирует Google Drive folder' },
    ],
  },
  {
    name: 'Контент',
    blocks: [
      { type: 'trendwatcher', label: 'Трендвотчер', icon: 'mingcute:eye-line', color: 'badge-info', description: 'Поиск трендов' },
      { type: 'character', label: 'Персонаж', icon: 'mingcute:user-3-line', color: 'badge-primary', description: 'Герой из библиотеки в pipeline' },
      { type: 'scene_composer', label: 'Сцена-блок', icon: 'mingcute:layers-line', color: 'badge-secondary', description: 'Готовая сцена из композитора' },
      { type: 'scenario', label: 'Сценарии', icon: 'mingcute:document-line', color: 'badge-warning', description: 'Генерация сценариев' },
      { type: 'video', label: 'Видео', icon: 'mingcute:video-line', color: 'badge-accent', description: 'Генерация видео' },
      { type: 'video_analyzer', label: 'Анализ видео', icon: 'mingcute:scan-2-line', color: 'badge-primary', description: 'Marketing-разбор кадров' },
      { type: 'caption_generator', label: 'Описания', icon: 'mingcute:hashtag-line', color: 'badge-secondary', description: 'AI captions для соцсетей' },
      { type: 'upload', label: 'Загрузка', icon: 'mingcute:upload-3-line', color: 'badge-success', description: 'Загрузка в соцсети' },
      { type: 'idea', label: 'Идея', icon: 'mingcute:bulb-line', color: 'badge-primary', description: 'AI-анализ видео' },
      { type: 'analytics', label: 'Аналитика', icon: 'mingcute:chart-bar-line', color: 'badge-secondary', description: 'Сбор метрик' },
    ],
  },
  {
    name: 'Логика',
    blocks: [
      { type: 'filter', label: 'Фильтр', icon: 'mingcute:filter-line', color: 'badge-neutral', description: 'Условное ветвление' },
      { type: 'if_switch', label: 'Условие', icon: 'mingcute:git-branch-line', color: 'badge-warning', description: 'If / else' },
      { type: 'loop', label: 'Цикл', icon: 'mingcute:refresh-2-line', color: 'badge-accent', description: 'Обработка массива' },
      { type: 'wait', label: 'Ожидание', icon: 'mingcute:time-line', color: 'badge-ghost', description: 'Пауза' },
      { type: 'set', label: 'Установить', icon: 'mingcute:edit-2-line', color: 'badge-neutral', description: 'Присвоить значения' },
    ],
  },
  {
    name: 'Интеграции',
    blocks: [
      { type: 'http_request', label: 'HTTP запрос', icon: 'mingcute:globe-line', color: 'badge-primary', description: 'Внешний API вызов' },
      { type: 'code', label: 'Трансформация', icon: 'mingcute:code-line', color: 'badge-neutral', description: 'Изолированный JS-код' },
      { type: 'notification', label: 'Уведомление', icon: 'mingcute:notification-line', color: 'badge-error', description: 'Telegram алерт' },
      { type: 'sub_pipeline', label: 'Подконвейер', icon: 'mingcute:route-line', color: 'badge-primary', description: 'Вызов другого конвейера' },
      { type: 'google_drive_uploader', label: 'Загрузка в Drive', icon: 'mingcute:cloud-upload-line', color: 'badge-info', description: 'Заливка видео в Drive folder' },
    ],
  },
  {
    name: 'Аннотации',
    blocks: [
      { type: 'note', label: 'Заметка', icon: 'mingcute:notebook-line', color: 'badge-warning', description: 'Текстовая заметка на полотне' },
    ],
  },
]

const searchQuery = ref('')

const filteredCategories = computed(() => {
  const q = searchQuery.value.toLowerCase().trim()
  if (!q) return categories

  return categories
    .map(cat => ({
      ...cat,
      blocks: cat.blocks.filter(
        b => b.label.toLowerCase().includes(q) || b.description.toLowerCase().includes(q) || b.type.includes(q),
      ),
    }))
    .filter(cat => cat.blocks.length > 0)
})

let nodeCounter = 0

function onDragStart(event: DragEvent, block: { type: string; label: string }) {
  if (!event.dataTransfer) return
  event.dataTransfer.setData('block-type', block.type)
  event.dataTransfer.setData('block-label', block.label)
  event.dataTransfer.effectAllowed = 'move'
}

function addNodeToCanvas(block: { type: string; label: string }) {
  nodeCounter++
  const id = `${block.type}-${Date.now()}-${nodeCounter}`
  store.addNode({
    id,
    type: block.type,
    position: { x: 200 + nodeCounter * 20, y: 100 + nodeCounter * 20 },
    data: { label: block.label, type: block.type, config: {} },
  })
}
</script>

<template>
  <aside class="w-56 bg-base-100 border-r border-base-300 flex flex-col overflow-hidden shrink-0">
    <div class="p-3 border-b border-base-300">
      <h3 class="text-sm font-bold text-base-content flex items-center gap-2 mb-2">
        <Icon name="mingcute:grid-line" class="text-primary" />
        Блоки
      </h3>
      <input
        v-model="searchQuery"
        type="text"
        class="input input-xs w-full"
        placeholder="Поиск блока..."
      />
    </div>

    <div class="flex-1 overflow-y-auto p-2 space-y-3">
      <div v-for="cat in filteredCategories" :key="cat.name">
        <div class="text-[10px] font-bold uppercase tracking-wider text-base-content/40 px-1 mb-1">
          {{ cat.name }}
        </div>
        <div class="space-y-0.5">
          <div
            v-for="block in cat.blocks"
            :key="block.type"
            class="flex items-center gap-2 p-1.5 rounded-lg cursor-grab hover:bg-base-200 transition-colors"
            draggable="true"
            @dragstart="onDragStart($event, block)"
            @click="addNodeToCanvas(block)"
          >
            <span class="badge badge-sm size-6 p-0 shrink-0" :class="block.color">
              <Icon :name="block.icon" class="size-3.5" />
            </span>
            <div class="flex-1 min-w-0">
              <div class="text-xs font-medium text-base-content truncate">
                {{ block.label }}
              </div>
              <div class="text-[10px] text-base-content/50 truncate">
                {{ block.description }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="filteredCategories.length === 0" class="text-center py-4 text-xs text-base-content/40">
        Ничего не найдено
      </div>
    </div>

    <div class="p-2 border-t border-base-300 text-[10px] text-base-content/40 leading-tight">
      Перетащите блок на холст или кликните
    </div>
  </aside>
</template>
