<script setup lang="ts">
/**
 * Превью промпта сцены.
 *
 * Считается прямо в браузере, чтобы правка блока была видна сразу: финальную
 * сборку всё равно делает сервер при сохранении, и она может отличаться
 * порядком слов — но состав и референсы совпадают.
 */
import type { SceneBlock } from '~~/shared/types/scene'
import type { Character, CharacterReferenceImage } from '~~/shared/types/character'
import type { AppReferenceImage } from '~~/shared/types/app'

const props = defineProps<{
  blocks: SceneBlock[]
  characters: (Character & { referenceImages: CharacterReferenceImage[] })[]
  appScreens: AppReferenceImage[]
}>()

const preview = computed(() => {
  const sections: string[] = []
  const refs: { source: string, url: string }[] = []

  const characterBlocks = props.blocks.filter(b => b.kind === 'character')
  const styleBlocks = props.blocks.filter(b => b.kind === 'style')
  const envBlocks = props.blocks.filter(b => b.kind === 'environment')
  const actionBlocks = props.blocks.filter(b => b.kind === 'action')
  const ctxBlocks = props.blocks.filter(b => b.kind === 'app_context')
  const screenBlocks = props.blocks.filter(b => b.kind === 'app_screen')

  if (characterBlocks.length) {
    const lines = characterBlocks.map((b) => {
      const c = props.characters.find(x => x.id === b.characterId)
      const role = b.roleOverride ?? c?.role ?? 'protagonist'
      const visual = c?.visualPrompt ?? c?.description ?? `character:${b.characterId}`
      const name = c?.name ?? '[unknown]'
      const a = b.action ? `, ${b.action}` : ''
      const e = b.emotion ? `, ${b.emotion}` : ''
      if (c) for (const r of c.referenceImages) refs.push({ source: 'Персонаж', url: r.fileUrl })
      return `${name} (${role}): ${visual}${a}${e}`
    })
    sections.push(`Characters: ${lines.join('; ')}.`)
  }

  if (actionBlocks.length) {
    sections.push(`Action: ${actionBlocks
      .map(b => b.description + (b.dialog ? ` Dialog: "${b.dialog}".` : ''))
      .join(' ')}`)
  }

  if (envBlocks.length) {
    const lines = envBlocks.map(b => [b.location, b.timeOfDay, b.lighting, b.weather].filter(Boolean).join(', '))
    sections.push(`Environment: ${lines.join('; ')}.`)
  }

  if (styleBlocks.length) {
    const lines = styleBlocks.map((b) => {
      const parts = [b.visualStyle]
      if (b.mood) parts.push(`mood: ${b.mood}`)
      if (b.camera) parts.push(`camera: ${b.camera}`)
      return parts.join(', ')
    })
    sections.push(`Style: ${lines.join('; ')}.`)
  }

  if (ctxBlocks.length) sections.push(`App context: ${ctxBlocks.map(b => b.focus).join('; ')}.`)

  if (screenBlocks.length) {
    for (const b of screenBlocks) {
      const s = props.appScreens.find(x => x.id === b.referenceImageId)
      if (s?.fileUrl) refs.push({ source: 'Скрин приложения', url: s.fileUrl })
    }
    sections.push(`App screen reactions: ${screenBlocks.map(b => b.intent || 'reaction').join('; ')}.`)
  }

  return { prompt: sections.join(' '), refs }
})
</script>

<template>
  <section class="flex flex-col gap-2.5 rounded-lg border border-border bg-panel p-3.5">
    <h2 class="text-micro tracking-[.06em] text-subtle uppercase">Промпт сцены</h2>

    <p
      v-if="!preview.prompt"
      class="rounded-md border border-dashed border-divider px-2.5 py-3 text-center text-sm text-subtle"
    >
      Пока пусто — промпт соберётся из блоков.
    </p>
    <p
      v-else
      class="max-h-56 overflow-y-auto rounded-md border border-divider bg-surface px-2.5 py-2 font-mono text-micro leading-relaxed break-words text-muted"
    >
      {{ preview.prompt }}
    </p>

    <div v-if="preview.refs.length" class="flex flex-col gap-1.5">
      <div class="flex items-center gap-2">
        <h3 class="text-micro tracking-[.06em] text-subtle uppercase">Референсы блоков</h3>
        <span class="tnum font-mono text-micro text-subtle">{{ preview.refs.length }}</span>
      </div>
      <div class="grid grid-cols-4 gap-1">
        <img
          v-for="(r, i) in preview.refs.slice(0, 8)"
          :key="i"
          :src="r.url"
          :alt="r.source"
          :title="r.source"
          class="aspect-square w-full rounded-sm border border-divider object-cover"
        >
      </div>
    </div>
  </section>
</template>
