<script setup lang="ts">
const store = usePipelineEditorStore()

const selectedNode = computed(() => {
  if (!store.selectedNodeId) return null
  return store.nodes.find((n: any) => n.id === store.selectedNodeId) ?? null
})

const hasSelection = computed(() => !!selectedNode.value)
</script>

<template>
  <aside class="w-80 bg-base-100 border-l border-base-300 flex flex-col overflow-hidden shrink-0">
    <!-- Node settings mode -->
    <PipelineNodeSettings v-if="hasSelection" />

    <!-- Help / Guide mode (no node selected) -->
    <div v-else class="flex flex-col h-full">
      <div class="p-3 border-b border-base-300 flex items-center gap-2">
        <Icon name="mingcute:book-3-line" class="text-primary text-lg" />
        <h3 class="text-sm font-bold text-base-content">Руководство</h3>
      </div>

      <div class="flex-1 overflow-y-auto p-3 space-y-2">
        <!-- Quick start -->
        <div class="collapse collapse-arrow bg-base-200/50 rounded-box">
          <input type="checkbox" checked />
          <div class="collapse-title text-sm font-semibold min-h-0 py-2.5 px-3">
            <Icon name="mingcute:rocket-line" class="inline mr-1.5 text-primary" />
            Быстрый старт
          </div>
          <div class="collapse-content text-xs text-base-content/70 leading-relaxed px-3">
            <ol class="list-decimal list-inside space-y-1.5">
              <li>Перетащите блоки из левой панели на холст или кликните по ним</li>
              <li>Соедините блоки, потянув от выходного порта к входному</li>
              <li>Кликните на блок, чтобы настроить его параметры</li>
              <li>Нажмите <kbd class="kbd kbd-xs">Ctrl+S</kbd> для сохранения</li>
              <li>Нажмите <span class="badge badge-success badge-xs">Запустить</span> для запуска</li>
            </ol>
          </div>
        </div>

        <!-- Blocks overview -->
        <div class="collapse collapse-arrow bg-base-200/50 rounded-box">
          <input type="checkbox" />
          <div class="collapse-title text-sm font-semibold min-h-0 py-2.5 px-3">
            <Icon name="mingcute:grid-line" class="inline mr-1.5 text-info" />
            Типы блоков
          </div>
          <div class="collapse-content text-xs text-base-content/70 leading-relaxed px-3 space-y-1.5">
            <p><strong>Контент:</strong> Трендвотчер находит тренды, Сценарии генерирует тексты, Видео создаёт контент, Загрузка публикует.</p>
            <p><strong>Логика:</strong> Условие (if/else), Фильтр, Цикл и Ожидание управляют потоком данных.</p>
            <p><strong>Интеграции:</strong> HTTP-запрос для внешних API, Код для трансформаций, Уведомление для алертов.</p>
          </div>
        </div>

        <!-- Connections -->
        <div class="collapse collapse-arrow bg-base-200/50 rounded-box">
          <input type="checkbox" />
          <div class="collapse-title text-sm font-semibold min-h-0 py-2.5 px-3">
            <Icon name="mingcute:route-line" class="inline mr-1.5 text-accent" />
            Связи между блоками
          </div>
          <div class="collapse-content text-xs text-base-content/70 leading-relaxed px-3 space-y-1.5">
            <p>Потяните от правого порта блока к левому порту другого. Анимированная линия = основной поток.</p>
            <p>Нижний красный порт — выход ошибки. Используйте его для обработки сбоев.</p>
            <p>Данные передаются по связям автоматически: выход предыдущего блока становится входом следующего.</p>
            <p><strong>Удаление связи:</strong> кликните на линию, чтобы выделить, затем <kbd class="kbd kbd-xs">Delete</kbd>. Или правый клик — мгновенное удаление.</p>
          </div>
        </div>

        <!-- Keyboard shortcuts -->
        <div class="collapse collapse-arrow bg-base-200/50 rounded-box">
          <input type="checkbox" />
          <div class="collapse-title text-sm font-semibold min-h-0 py-2.5 px-3">
            <Icon name="mingcute:keyboard-line" class="inline mr-1.5 text-warning" />
            Горячие клавиши
          </div>
          <div class="collapse-content text-xs text-base-content/70 px-3">
            <div class="grid grid-cols-2 gap-y-1.5 gap-x-3">
              <span><kbd class="kbd kbd-xs">Ctrl+S</kbd></span><span>Сохранить</span>
              <span><kbd class="kbd kbd-xs">Ctrl+Z</kbd></span><span>Отменить</span>
              <span><kbd class="kbd kbd-xs">Ctrl+Shift+Z</kbd></span><span>Повторить</span>
              <span><kbd class="kbd kbd-xs">Ctrl+D</kbd></span><span>Дублировать</span>
              <span><kbd class="kbd kbd-xs">Ctrl+C / V</kbd></span><span>Копировать / Вставить</span>
              <span><kbd class="kbd kbd-xs">Ctrl+A</kbd></span><span>Выделить всё</span>
              <span><kbd class="kbd kbd-xs">Delete</kbd></span><span>Удалить блок(и) / связь</span>
              <span><kbd class="kbd kbd-xs">Escape</kbd></span><span>Снять выделение</span>
              <span><kbd class="kbd kbd-xs">Shift+клик</kbd></span><span>Мульти-выделение</span>
            </div>
          </div>
        </div>

        <!-- Testing -->
        <div class="collapse collapse-arrow bg-base-200/50 rounded-box">
          <input type="checkbox" />
          <div class="collapse-title text-sm font-semibold min-h-0 py-2.5 px-3">
            <Icon name="mingcute:bug-line" class="inline mr-1.5 text-error" />
            Тестирование
          </div>
          <div class="collapse-content text-xs text-base-content/70 leading-relaxed px-3 space-y-1.5">
            <p>Кликните на блок и нажмите <strong>Тест</strong> в панели настроек, чтобы проверить его работу изолированно.</p>
            <p>Вы можете закрепить реальные данные последнего запуска через <strong>Pin</strong>, чтобы блок использовал их при повторном тестировании.</p>
            <p>Перед запуском всего конвейера нажмите <strong>Проверить</strong> в тулбаре — это покажет ошибки конфигурации.</p>
          </div>
        </div>

        <!-- Best practices -->
        <div class="collapse collapse-arrow bg-base-200/50 rounded-box">
          <input type="checkbox" />
          <div class="collapse-title text-sm font-semibold min-h-0 py-2.5 px-3">
            <Icon name="mingcute:bulb-line" class="inline mr-1.5 text-success" />
            Лучшие практики
          </div>
          <div class="collapse-content text-xs text-base-content/70 leading-relaxed px-3 space-y-1.5">
            <p>Начинайте с простой цепочки: Тренд -> Сценарий -> Видео -> Загрузка.</p>
            <p>Добавляйте блок Уведомление на ошибочные выходы, чтобы получать алерты о сбоях.</p>
            <p>Используйте блок Условие для ветвления логики по содержимому данных.</p>
            <p>Сохраняйте часто — <kbd class="kbd kbd-xs">Ctrl+S</kbd>.</p>
          </div>
        </div>
      </div>

      <div class="p-3 border-t border-base-300 text-[10px] text-base-content/40 text-center">
        Кликните на блок для настройки
      </div>
    </div>
  </aside>
</template>
