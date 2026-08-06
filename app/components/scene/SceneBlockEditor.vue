<script setup lang="ts">
/**
 * Один блок сборки: набор полей зависит от типа блока.
 *
 * Поля правятся по месту, без отдельного режима редактирования — блок и так
 * состоит из двух-четырёх строк, а сохранение общее для всей сцены.
 */
import type { SceneBlock } from '~~/shared/types/scene'
import { SCENE_BLOCK_LABELS, SCENE_BLOCK_ICONS } from '~~/shared/types/scene'
import type { Character } from '~~/shared/types/character'
import type { AppReferenceImage } from '~~/shared/types/app'

const props = defineProps<{
  block: SceneBlock
  characters: Character[]
  appScreens: AppReferenceImage[]
  sceneId?: string
}>()

const emit = defineEmits<{
  'update:block': [block: SceneBlock]
  remove: []
  'compiled-prompt': [prompt: string | null]
}>()

function patch(fields: Partial<SceneBlock>) {
  emit('update:block', { ...props.block, ...fields } as SceneBlock)
}

const canAiRegenerate = computed(() =>
  Boolean(props.sceneId)
  && (props.block.kind === 'action' || props.block.kind === 'style' || props.block.kind === 'environment'))

const characterOptions = computed(() => props.characters.map(c => ({ value: c.id, label: c.name })))
const screenOptions = computed(() => props.appScreens.map(s => ({
  value: s.id,
  label: s.aiCaption ?? s.sha1.slice(0, 12),
})))
const selectedScreen = computed(() =>
  props.block.kind === 'app_screen'
    ? props.appScreens.find(s => s.id === props.block.referenceImageId)
    : undefined)
</script>

<template>
  <div class="flex flex-col gap-2 rounded-md border border-border bg-card p-2.5">
    <div class="flex items-center gap-2">
      <span class="cursor-move text-subtle" title="Перетащите, чтобы поменять порядок">
        <Icon name="mingcute:menu-line" />
      </span>
      <Icon :name="SCENE_BLOCK_ICONS[block.kind]" class="text-accent" />
      <span class="min-w-0 flex-1 truncate text-sm font-medium">{{ SCENE_BLOCK_LABELS[block.kind] }}</span>

      <SceneBlockAiRegenerate
        v-if="canAiRegenerate && sceneId"
        :scene-id="sceneId"
        :block="block"
        @update:block="(b) => emit('update:block', b)"
        @compiled-prompt="(p) => emit('compiled-prompt', p)"
      />
      <UiButton icon-only variant="ghost" title="Убрать блок" aria-label="Убрать блок" @click="emit('remove')">
        <Icon name="mingcute:close-line" />
      </UiButton>
    </div>

    <!-- Персонаж -->
    <template v-if="block.kind === 'character'">
      <UiSelect
        :model-value="block.characterId"
        placeholder="Выберите персонажа"
        :options="characterOptions"
        @update:model-value="(v) => patch({ characterId: String(v) })"
      />
      <NuxtLink v-if="!characters.length" to="/characters" class="text-sm text-accent hover:underline">
        У приложения нет персонажей — заведите в разделе «Персонажи»
      </NuxtLink>
      <div class="grid gap-2 sm:grid-cols-2">
        <UiInput
          :model-value="block.action ?? ''"
          placeholder="Действие в кадре"
          @update:model-value="(v) => patch({ action: v })"
        />
        <UiInput
          :model-value="block.emotion ?? ''"
          placeholder="Эмоция"
          @update:model-value="(v) => patch({ emotion: v })"
        />
      </div>
    </template>

    <!-- Стиль -->
    <template v-else-if="block.kind === 'style'">
      <UiInput
        :model-value="block.visualStyle"
        placeholder="cinematic, warm palette, soft grain"
        @update:model-value="(v) => patch({ visualStyle: v })"
      />
      <div class="grid gap-2 sm:grid-cols-2">
        <UiInput
          :model-value="block.mood ?? ''"
          placeholder="Настроение"
          @update:model-value="(v) => patch({ mood: v })"
        />
        <UiInput
          :model-value="block.camera ?? ''"
          placeholder="Камера: close-up, dolly"
          @update:model-value="(v) => patch({ camera: v })"
        />
      </div>
    </template>

    <!-- Окружение -->
    <template v-else-if="block.kind === 'environment'">
      <UiInput
        :model-value="block.location"
        placeholder="Место: парк у реки, кофейня"
        @update:model-value="(v) => patch({ location: v })"
      />
      <div class="grid gap-2 sm:grid-cols-3">
        <UiInput
          :model-value="block.timeOfDay ?? ''"
          placeholder="Время суток"
          @update:model-value="(v) => patch({ timeOfDay: v })"
        />
        <UiInput
          :model-value="block.lighting ?? ''"
          placeholder="Освещение"
          @update:model-value="(v) => patch({ lighting: v })"
        />
        <UiInput
          :model-value="block.weather ?? ''"
          placeholder="Погода"
          @update:model-value="(v) => patch({ weather: v })"
        />
      </div>
    </template>

    <!-- Действие -->
    <template v-else-if="block.kind === 'action'">
      <UiTextarea
        :model-value="block.description"
        :rows="2"
        placeholder="Что происходит: А зовёт Б, оба смеются, камера едет следом"
        @update:model-value="(v) => patch({ description: v })"
      />
      <UiInput
        :model-value="block.dialog ?? ''"
        placeholder="Реплика в кадре"
        @update:model-value="(v) => patch({ dialog: v })"
      />
    </template>

    <!-- Контекст приложения -->
    <template v-else-if="block.kind === 'app_context'">
      <UiTextarea
        :model-value="block.focus"
        :rows="2"
        placeholder="Что показать про приложение: фичу, пользу, изменение до/после"
        @update:model-value="(v) => patch({ focus: v })"
      />
    </template>

    <!-- Скрин экрана -->
    <template v-else-if="block.kind === 'app_screen'">
      <UiSelect
        :model-value="block.referenceImageId"
        placeholder="Выберите скриншот приложения"
        :options="screenOptions"
        @update:model-value="(v) => patch({ referenceImageId: String(v) })"
      />
      <p v-if="!appScreens.length" class="text-sm text-subtle">
        У приложения нет загруженных скриншотов — добавьте их в «Админ → Приложения».
      </p>
      <UiInput
        :model-value="block.intent ?? ''"
        placeholder="Намерение: реакция на интерфейс, использование фичи"
        @update:model-value="(v) => patch({ intent: v })"
      />
      <img
        v-if="selectedScreen?.fileUrl"
        :src="selectedScreen.fileUrl"
        :alt="selectedScreen.aiCaption ?? 'Скриншот приложения'"
        class="h-32 w-auto self-start rounded-sm border border-divider object-contain"
      >
    </template>
  </div>
</template>
