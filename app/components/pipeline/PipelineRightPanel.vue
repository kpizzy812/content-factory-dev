<script setup lang="ts">
/**
 * Правая панель редактора: настройки выбранного блока либо руководство.
 *
 * Руководство осталось на месте, но переехало на общий `UiDisclosure` —
 * раскрывающиеся секции в приложении должны выглядеть одинаково, а нативный
 * `collapse` DaisyUI держался на скрытом чекбоксе и не читался с клавиатуры.
 */
const store = usePipelineEditorStore()

const selectedNode = computed(() =>
  store.selectedNodeId
    ? store.nodes.find((node: { id: string }) => node.id === store.selectedNodeId) ?? null
    : null,
)

const hasSelection = computed(() => Boolean(selectedNode.value))

const SHORTCUTS: Array<[string, string]> = [
  ['Ctrl+S', 'Сохранить'],
  ['Ctrl+Z', 'Отменить'],
  ['Ctrl+Shift+Z', 'Повторить'],
  ['Ctrl+D', 'Дублировать'],
  ['Ctrl+C / V', 'Копировать и вставить'],
  ['Ctrl+A', 'Выделить всё'],
  ['Delete', 'Удалить блок или связь'],
  ['Escape', 'Снять выделение'],
  ['Shift+клик', 'Выделить несколько'],
]
</script>

<template>
  <aside class="flex w-80 shrink-0 flex-col overflow-hidden border-l border-border bg-panel">
    <PipelineNodeSettings v-if="hasSelection" />

    <div v-else class="flex h-full flex-col">
      <header class="flex flex-none items-center gap-2 border-b border-divider px-3 py-2.5">
        <Icon name="mingcute:book-3-line" class="text-muted" />
        <h3 class="text-sm font-semibold">Руководство</h3>
      </header>

      <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        <UiDisclosure title="Быстрый старт" :default-open="true">
          <ol class="flex list-inside list-decimal flex-col gap-1.5 text-sm text-muted">
            <li>Перетащите блок из палитры слева на полотно или кликните по нему.</li>
            <li>Соедините блоки: потяните от правого порта к левому у соседнего.</li>
            <li>Кликните по блоку — справа откроются его настройки.</li>
            <li>Сохраните Ctrl+S и нажмите «Запустить».</li>
          </ol>
        </UiDisclosure>

        <UiDisclosure title="Типы блоков">
          <div class="flex flex-col gap-1.5 text-sm text-muted">
            <p><span class="text-fg">Источники</span> дают данные: трендвотчер, идея, сканер Drive, HTTP-запрос.</p>
            <p><span class="text-fg">Производство</span> делает контент: стратегия, сценарий, персонаж, видео, описания.</p>
            <p><span class="text-fg">Контроль</span> управляет потоком: гейт качества, фильтр, условие, цикл, ожидание.</p>
            <p><span class="text-fg">Выход</span> отдаёт наружу: публикация, загрузка в Drive, уведомление, аналитика.</p>
          </div>
        </UiDisclosure>

        <UiDisclosure title="Связи между блоками">
          <div class="flex flex-col gap-1.5 text-sm text-muted">
            <p>Выход предыдущего блока становится входом следующего — данные идут по связям сами.</p>
            <p>Нижний красный порт — ветка ошибки: на неё вешают уведомление или запасной путь.</p>
            <p>Удалить связь: клик по линии и Delete, либо правый клик по ней.</p>
          </div>
        </UiDisclosure>

        <UiDisclosure title="Горячие клавиши">
          <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
            <template v-for="[keys, action] in SHORTCUTS" :key="keys">
              <dt>
                <span class="rounded-sm border border-border bg-card px-1.5 py-0.5 font-mono text-[11px] text-muted">
                  {{ keys }}
                </span>
              </dt>
              <dd class="text-muted">{{ action }}</dd>
            </template>
          </dl>
        </UiDisclosure>

        <UiDisclosure title="Проверка перед запуском">
          <div class="flex flex-col gap-1.5 text-sm text-muted">
            <p>«Тест» в панели блока прогоняет его отдельно — без запуска всего конвейера и без лишних трат.</p>
            <p>Закреплённые данные последнего запуска позволяют повторять тест на тех же входах.</p>
            <p>«Проверить готовность» в меню шапки показывает ошибки конфигурации до запуска.</p>
          </div>
        </UiDisclosure>
      </div>

      <footer class="flex-none border-t border-divider px-3 py-2 text-center text-[11px] text-subtle">
        Кликните по блоку, чтобы настроить его
      </footer>
    </div>
  </aside>
</template>
