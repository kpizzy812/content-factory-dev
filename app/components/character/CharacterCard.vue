<script setup lang="ts">
import type { Character, CharacterReferenceImage } from '~~/shared/types/character'
import { CHARACTER_ROLE_LABELS } from '~~/shared/types/character'

/**
 * Карточка персонажа.
 *
 * Превью 4:3, а не 9:16 общей `UiEntityCard`: это референсные фото лица и
 * одежды, у них своя пропорция, и в вертикальной рамке от них остаётся полоса.
 *
 * Дополнительные референсы показываются миниатюрами поверх основного: сколько
 * их есть — главный признак готовности персонажа к сцене.
 */
const props = defineProps<{
  character: Character & { referenceImages?: CharacterReferenceImage[] }
}>()

const refs = computed<CharacterReferenceImage[]>(() => props.character.referenceImages ?? [])
const primary = computed(() => refs.value[0]?.fileUrl ?? null)
const extra = computed(() => refs.value.slice(1, 4))
const refCount = computed(() => refs.value.length)
const roleLabel = computed(() => CHARACTER_ROLE_LABELS[props.character.role] ?? props.character.role)
</script>

<template>
  <NuxtLink
    :to="`/characters/${character.id}`"
    class="overflow-hidden rounded-lg border border-border bg-card transition-colors duration-(--duration-fast) ease-out hover:border-subtle"
  >
    <div class="relative aspect-[4/3] bg-surface">
      <img
        v-if="primary"
        :src="primary"
        :alt="character.name"
        class="size-full object-cover"
      >
      <div v-else class="flex size-full items-center justify-center text-subtle">
        <Icon name="mingcute:user-3-line" class="text-2xl" />
      </div>

      <div v-if="extra.length" class="absolute inset-x-1.5 bottom-1.5 flex gap-1">
        <img
          v-for="r in extra"
          :key="r.id"
          :src="r.fileUrl"
          :alt="r.kind"
          class="size-8 rounded-sm border border-border object-cover"
        >
        <span
          v-if="refCount > 4"
          class="tnum flex size-8 items-center justify-center rounded-sm border border-border bg-panel font-mono text-micro"
        >
          +{{ refCount - 4 }}
        </span>
      </div>

      <span
        class="absolute top-1.5 right-1.5 rounded-sm border border-border bg-panel px-1.5 text-micro text-muted"
      >
        {{ roleLabel }}
      </span>
      <span
        v-if="character.archived"
        class="absolute top-1.5 left-1.5 rounded-sm border border-warning-border bg-warning-bg px-1.5 text-micro text-warning"
      >
        архив
      </span>
    </div>

    <div class="flex flex-col gap-1 p-2.5">
      <h3 class="truncate text-sm font-medium">{{ character.name }}</h3>
      <p v-if="character.description" class="line-clamp-2 text-micro text-muted">
        {{ character.description }}
      </p>

      <div v-if="character.tags?.length" class="flex flex-wrap gap-1">
        <span
          v-for="t in character.tags.slice(0, 4)"
          :key="t"
          class="rounded-sm border border-border bg-panel px-1.5 text-micro text-subtle"
        >
          {{ t }}
        </span>
        <span
          v-if="character.tags.length > 4"
          class="rounded-sm border border-border bg-panel px-1.5 text-micro text-subtle"
        >
          +{{ character.tags.length - 4 }}
        </span>
      </div>

      <span class="tnum font-mono text-micro text-subtle">{{ refCount }} референсов</span>
    </div>
  </NuxtLink>
</template>
