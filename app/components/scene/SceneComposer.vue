<script setup lang="ts">
/**
 * Сборка сцены: библиотека блоков сверху, перетаскиваемый список блоков снизу.
 *
 * Состояние блоков живёт на странице — она же его сохраняет. Здесь только
 * добавление, порядок, правка и удаление.
 */
import { VueDraggable } from 'vue-draggable-plus'
import type { SceneBlock, SceneBlockKind } from '~~/shared/types/scene'
import type { Character, CharacterReferenceImage } from '~~/shared/types/character'
import type { AppReferenceImage } from '~~/shared/types/app'

const props = defineProps<{
  blocks: SceneBlock[]
  characters: (Character & { referenceImages: CharacterReferenceImage[] })[]
  appScreens: AppReferenceImage[]
  sceneId: string
}>()

const emit = defineEmits<{
  'update:blocks': [blocks: SceneBlock[]]
  'block-regenerated': []
}>()

const list = computed({
  get: () => props.blocks,
  set: value => emit('update:blocks', value),
})

function newBlock(kind: SceneBlockKind): SceneBlock {
  const id = globalThis.crypto?.randomUUID?.() ?? `blk_${Math.random().toString(36).slice(2, 10)}`
  switch (kind) {
    case 'character':
      return { id, kind: 'character', characterId: props.characters[0]?.id ?? '' }
    case 'style':
      return { id, kind: 'style', visualStyle: '' }
    case 'environment':
      return { id, kind: 'environment', location: '' }
    case 'action':
      return { id, kind: 'action', description: '' }
    case 'app_context':
      return { id, kind: 'app_context', focus: '' }
    case 'app_screen':
      return { id, kind: 'app_screen', referenceImageId: props.appScreens[0]?.id ?? '' }
  }
}

function onAdd(kind: SceneBlockKind) {
  emit('update:blocks', [...props.blocks, newBlock(kind)])
}

function onRemove(index: number) {
  emit('update:blocks', props.blocks.filter((_, i) => i !== index))
}

function onUpdate(index: number, updated: SceneBlock) {
  emit('update:blocks', props.blocks.map((b, i) => (i === index ? updated : b)))
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <SceneBlockLibrary @add="onAdd" />

    <section class="flex flex-col gap-2 rounded-lg border border-border bg-panel p-3.5">
      <div class="flex items-center gap-2">
        <h2 class="text-micro tracking-[.06em] text-subtle uppercase">Сборка сцены</h2>
        <span class="tnum font-mono text-micro text-subtle">{{ blocks.length }}</span>
      </div>

      <UiEmptyState
        v-if="!blocks.length"
        title="Сборка пуста"
        description="Добавьте блоки из библиотеки выше — из них соберётся промпт сцены."
      />

      <VueDraggable
        v-else
        v-model="list"
        :animation="150"
        handle=".cursor-move"
        class="flex flex-col gap-2"
      >
        <SceneBlockEditor
          v-for="(blk, idx) in blocks"
          :key="blk.id"
          :block="blk"
          :characters="characters"
          :app-screens="appScreens"
          :scene-id="sceneId"
          @update:block="(b) => onUpdate(idx, b)"
          @remove="onRemove(idx)"
          @compiled-prompt="emit('block-regenerated')"
        />
      </VueDraggable>
    </section>
  </div>
</template>
