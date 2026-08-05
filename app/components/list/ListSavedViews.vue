<script setup lang="ts">
import type { SavedViewDto } from '~~/shared/types/saved-view'

/**
 * Вкладки представлений. Источник: design-preview/_system/blocks/SavedViews.html
 *
 * Порядок: системные → общие → личные → «＋ Сохранить текущий вид».
 * Владелец в подписи вкладки не показывается — плотность важнее; он живёт
 * в меню вида вместе с датой изменения и действиями.
 */
const props = defineProps<{
  views: SavedViewDto[]
  activeId: string | number
  dirty: boolean
  canManageShared: boolean
  counts?: Record<string, number>
}>()

const emit = defineEmits<{
  select: [id: string | number]
  save: [scope: 'shared' | 'personal']
  saveAsOwn: []
  revert: []
  pin: [id: string | number]
  remove: [id: number]
}>()

const saving = ref(false)
const newName = ref('')
const newScope = ref<'shared' | 'personal'>('personal')

const active = computed(() => props.views.find(v => String(v.id) === String(props.activeId)) ?? null)
const isSharedActive = computed(() => active.value?.scope === 'shared')

function menuFor(view: SavedViewDto) {
  const items = [{ key: 'pin', label: 'Открывать по умолчанию', icon: 'mingcute:pin-line' }]
  if (view.scope === 'system') return items
  if (view.scope === 'shared' && !props.canManageShared) return items
  return [
    ...items,
    { key: 'remove', label: 'Удалить', icon: 'mingcute:delete-2-line', danger: true },
  ]
}

function onMenu(view: SavedViewDto, key: string) {
  if (key === 'pin') emit('pin', view.id)
  else if (key === 'remove') emit('remove', view.id as number)
}

function submit() {
  if (!newName.value.trim()) return
  emit('save', newScope.value)
  saving.value = false
  newName.value = ''
}

defineExpose({ pendingName: newName })
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex flex-wrap items-center gap-1">
      <div
        v-for="view in views"
        :key="view.id"
        class="group/tab flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-sm"
        :class="String(view.id) === String(activeId)
          ? 'border-accent-border bg-accent-bg text-fg'
          : 'cursor-pointer border-transparent text-muted hover:bg-card hover:text-fg'"
        @click="emit('select', view.id)"
      >
        <Icon
          v-if="view.scope === 'shared'"
          name="mingcute:group-line"
          class="shrink-0 text-subtle"
          title="Общее представление"
        />
        <span>{{ view.name }}</span>
        <span
          v-if="counts?.[String(view.id)] != null"
          class="tnum font-mono text-micro text-subtle"
        >{{ counts[String(view.id)] }}</span>

        <UiActionMenu
          v-if="String(view.id) === String(activeId)"
          :items="menuFor(view)"
          align="left"
          @select="onMenu(view, $event)"
        />
      </div>

      <button
        v-if="!saving"
        type="button"
        class="flex h-7 cursor-pointer items-center gap-1 rounded-md border border-dashed border-border px-2.5 text-sm text-subtle hover:border-subtle hover:text-muted"
        @click="saving = true"
      >
        <Icon name="mingcute:add-line" />
        Сохранить текущий вид
      </button>
    </div>

    <!-- Форма сохранения -->
    <div v-if="saving" class="flex flex-wrap items-center gap-2 rounded-md border border-border bg-panel p-2">
      <UiInput v-model="newName" placeholder="Название представления" class="max-w-64" @keyup.enter="submit" />
      <UiSelect
        v-if="canManageShared"
        v-model="newScope"
        class="max-w-44"
        :options="[
          { value: 'personal', label: 'Личное' },
          { value: 'shared', label: 'Общее для команды' },
        ]"
      />
      <span v-else class="text-sm text-subtle">Личное представление</span>
      <UiButton variant="primary" :disabled="!newName.trim()" @click="submit">Сохранить</UiButton>
      <UiButton variant="ghost" @click="saving = false; newName = ''">Отмена</UiButton>
    </div>

    <!-- Общее представление изменено на лету: оригинал не трогаем -->
    <div
      v-if="dirty && isSharedActive"
      class="flex flex-wrap items-center gap-2 rounded-md border border-warning-border bg-warning-bg px-2.5 py-1.5 text-sm"
    >
      <Icon name="mingcute:information-line" class="shrink-0 text-warning" />
      <span class="text-muted">Вид изменён. Общее представление не тронуто.</span>
      <button type="button" class="cursor-pointer underline underline-offset-2" @click="emit('revert')">
        Вернуть исходный
      </button>
      <button type="button" class="cursor-pointer underline underline-offset-2" @click="emit('saveAsOwn')">
        Сохранить как свой
      </button>
    </div>
  </div>
</template>
