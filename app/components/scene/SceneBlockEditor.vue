<script setup lang="ts">
/**
 * Inline-редактор одного блока сцены. Отображает inline-поля в зависимости от kind,
 * выпадает в подходящий picker для character и app_screen (через select из переданного списка).
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

function patch(patch: Partial<SceneBlock>) {
  emit('update:block', { ...props.block, ...patch } as SceneBlock)
}

function onAiRegenerated(updated: SceneBlock) {
  emit('update:block', updated)
}

function onAiCompiled(prompt: string | null) {
  emit('compiled-prompt', prompt)
}

const canAiRegenerate = computed(() =>
  Boolean(props.sceneId)
  && (props.block.kind === 'action' || props.block.kind === 'style' || props.block.kind === 'environment'),
)
</script>

<template>
  <div class="card bg-base-100 border border-base-300 shadow-sm">
    <div class="card-body p-3 space-y-2">
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2 text-sm font-semibold">
          <span class="cursor-move text-base-content/40" title="Перетащите для сортировки">
            <Icon name="mingcute:menu-line" class="size-4" />
          </span>
          <Icon :name="SCENE_BLOCK_ICONS[block.kind]" class="size-4 text-primary" />
          {{ SCENE_BLOCK_LABELS[block.kind] }}
        </div>
        <div class="flex items-center gap-1">
          <SceneBlockAiRegenerate
            v-if="canAiRegenerate && sceneId"
            :scene-id="sceneId"
            :block="block"
            @update:block="onAiRegenerated"
            @compiled-prompt="onAiCompiled"
          />
          <button
            type="button"
            class="btn btn-ghost btn-xs text-error"
            title="Удалить блок"
            @click="emit('remove')"
          >
            <Icon name="mingcute:close-line" class="size-4" />
          </button>
        </div>
      </div>

      <!-- Character -->
      <template v-if="block.kind === 'character'">
        <select
          :value="block.characterId"
          class="select select-sm w-full"
          @change="(e) => patch({ characterId: (e.target as HTMLSelectElement).value })"
        >
          <option value="" disabled>Выберите персонажа…</option>
          <option v-for="c in characters" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
        <NuxtLink
          v-if="characters.length === 0"
          to="/characters"
          class="text-xs text-info link"
        >
          У этого приложения нет персонажей — создайте в разделе «Персонажи»
        </NuxtLink>
        <div class="grid grid-cols-2 gap-2">
          <input
            :value="block.action ?? ''"
            type="text"
            class="input input-sm"
            placeholder="Действие в кадре (опц.)"
            @input="(e) => patch({ action: (e.target as HTMLInputElement).value })"
          />
          <input
            :value="block.emotion ?? ''"
            type="text"
            class="input input-sm"
            placeholder="Эмоция (опц.)"
            @input="(e) => patch({ emotion: (e.target as HTMLInputElement).value })"
          />
        </div>
      </template>

      <!-- Style -->
      <template v-else-if="block.kind === 'style'">
        <input
          :value="block.visualStyle"
          type="text"
          class="input input-sm"
          placeholder="cinematic, warm palette, soft grain"
          @input="(e) => patch({ visualStyle: (e.target as HTMLInputElement).value })"
        />
        <div class="grid grid-cols-2 gap-2">
          <input
            :value="block.mood ?? ''"
            type="text"
            class="input input-sm"
            placeholder="Настроение (опц.)"
            @input="(e) => patch({ mood: (e.target as HTMLInputElement).value })"
          />
          <input
            :value="block.camera ?? ''"
            type="text"
            class="input input-sm"
            placeholder="Камера: close-up, dolly… (опц.)"
            @input="(e) => patch({ camera: (e.target as HTMLInputElement).value })"
          />
        </div>
      </template>

      <!-- Environment -->
      <template v-else-if="block.kind === 'environment'">
        <input
          :value="block.location"
          type="text"
          class="input input-sm"
          placeholder="Место: парк у реки, кофейня…"
          @input="(e) => patch({ location: (e.target as HTMLInputElement).value })"
        />
        <div class="grid grid-cols-3 gap-2">
          <input
            :value="block.timeOfDay ?? ''"
            type="text"
            class="input input-sm"
            placeholder="Время суток"
            @input="(e) => patch({ timeOfDay: (e.target as HTMLInputElement).value })"
          />
          <input
            :value="block.lighting ?? ''"
            type="text"
            class="input input-sm"
            placeholder="Освещение"
            @input="(e) => patch({ lighting: (e.target as HTMLInputElement).value })"
          />
          <input
            :value="block.weather ?? ''"
            type="text"
            class="input input-sm"
            placeholder="Погода"
            @input="(e) => patch({ weather: (e.target as HTMLInputElement).value })"
          />
        </div>
      </template>

      <!-- Action -->
      <template v-else-if="block.kind === 'action'">
        <textarea
          :value="block.description"
          class="textarea textarea-sm"
          rows="2"
          placeholder="Что происходит: A общается с B, C трясёт руками…"
          @input="(e) => patch({ description: (e.target as HTMLTextAreaElement).value })"
        />
        <input
          :value="block.dialog ?? ''"
          type="text"
          class="input input-sm"
          placeholder="Диалог в кадре (опц.)"
          @input="(e) => patch({ dialog: (e.target as HTMLInputElement).value })"
        />
      </template>

      <!-- App context -->
      <template v-else-if="block.kind === 'app_context'">
        <textarea
          :value="block.focus"
          class="textarea textarea-sm"
          rows="2"
          placeholder="Что показать про приложение: фичу, value-prop, transformation"
          @input="(e) => patch({ focus: (e.target as HTMLTextAreaElement).value })"
        />
      </template>

      <!-- App screen -->
      <template v-else-if="block.kind === 'app_screen'">
        <select
          :value="block.referenceImageId"
          class="select select-sm w-full"
          @change="(e) => patch({ referenceImageId: (e.target as HTMLSelectElement).value })"
        >
          <option value="" disabled>Выберите скриншот приложения…</option>
          <option v-for="s in appScreens" :key="s.id" :value="s.id">
            {{ s.aiCaption ?? s.sha1 }}
          </option>
        </select>
        <p v-if="appScreens.length === 0" class="text-xs text-base-content/50">
          У этого приложения нет загруженных скриншотов — добавьте их через «Админ → Приложения».
        </p>
        <input
          :value="block.intent ?? ''"
          type="text"
          class="input input-sm"
          placeholder="Намерение: reaction_to_interface, use_feature… (опц.)"
          @input="(e) => patch({ intent: (e.target as HTMLInputElement).value })"
        />
        <img
          v-if="appScreens.find(s => s.id === block.referenceImageId)?.fileUrl"
          :src="appScreens.find(s => s.id === block.referenceImageId)?.fileUrl"
          class="rounded mt-1 max-h-32 object-contain"
        />
      </template>
    </div>
  </div>
</template>
