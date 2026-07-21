<script setup lang="ts">
import type { Character, CharacterReferenceImage } from '~~/shared/types/character'
import { CHARACTER_ROLE_LABELS } from '~~/shared/types/character'

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
    class="card bg-base-100 shadow-sm hover:shadow-md transition-shadow border border-base-300 overflow-hidden"
  >
    <div class="aspect-[4/3] bg-base-200 relative">
      <img
        v-if="primary"
        :src="primary"
        :alt="character.name"
        class="w-full h-full object-cover"
      />
      <div v-else class="w-full h-full flex items-center justify-center text-base-content/30">
        <Icon name="mingcute:user-3-line" class="size-12" />
      </div>

      <div v-if="extra.length" class="absolute bottom-1 left-1 right-1 flex gap-1">
        <img
          v-for="r in extra"
          :key="r.id"
          :src="r.fileUrl"
          :alt="r.kind"
          class="w-8 h-8 rounded object-cover border-2 border-base-100 shadow"
        />
        <span
          v-if="refCount > 4"
          class="w-8 h-8 rounded bg-base-100/90 border-2 border-base-100 shadow flex items-center justify-center text-xs font-semibold"
        >
          +{{ refCount - 4 }}
        </span>
      </div>

      <span class="absolute top-1 right-1 badge badge-sm badge-neutral">{{ roleLabel }}</span>
      <span v-if="character.archived" class="absolute top-1 left-1 badge badge-sm badge-warning">архив</span>
    </div>

    <div class="p-3 space-y-1">
      <h3 class="font-semibold text-sm line-clamp-1">{{ character.name }}</h3>
      <p v-if="character.description" class="text-xs text-base-content/70 line-clamp-2">
        {{ character.description }}
      </p>
      <div v-if="character.tags?.length" class="flex flex-wrap gap-1 pt-1">
        <span v-for="t in character.tags.slice(0, 4)" :key="t" class="badge badge-xs badge-ghost">{{ t }}</span>
        <span v-if="character.tags.length > 4" class="badge badge-xs badge-ghost">+{{ character.tags.length - 4 }}</span>
      </div>
      <div class="flex items-center justify-between pt-1 text-xs text-base-content/50">
        <span class="flex items-center gap-1">
          <Icon name="mingcute:pic-2-line" class="size-3" />
          {{ refCount }} {{ refCount === 1 ? 'референс' : 'референсов' }}
        </span>
      </div>
    </div>
  </NuxtLink>
</template>
