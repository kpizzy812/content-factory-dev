<script setup lang="ts">
/** Общая часть ассета в карточке ролика и в ответе прогресса. */
interface FrameAsset {
  id: number
  type: string
  prompt: string | null
  fileUrl: string | null
  order: number
}

/**
 * Результаты шагов генерации: кадры, промты к ним, клипы и музыка.
 *
 * Промт лежит рядом со своим кадром, а не отдельным списком: их сопоставляют
 * друг с другом каждый раз, когда разбираются, почему картинка вышла не та.
 */
const props = defineProps<{
  assets: FrameAsset[]
  /** Приложение для сохранения промта в избранное. */
  appId?: number | null
}>()

const images = computed(() => props.assets.filter(a => a.type === 'image' && a.fileUrl))
const prompts = computed(() => props.assets.filter(a => a.type === 'image' && a.prompt))
const clips = computed(() => props.assets.filter(a => a.type === 'clip'))
const music = computed(() => props.assets.filter(a => a.type === 'music'))

const lightboxIndex = ref<number | null>(null)

/**
 * Пропавшие файлы отмечаем сами, а не общим плейсхолдером из `app/utils`:
 * тот нарисован светлой картинкой и в тёмной теме бьёт по глазам.
 */
const missing = ref(new Set<number>())

function downloadImage(asset: FrameAsset) {
  if (!asset.fileUrl) return
  const a = document.createElement('a')
  a.href = `/api/files/${asset.fileUrl}`
  a.download = `image_${asset.order + 1}.png`
  a.click()
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <UiEmptyState
      v-if="!images.length && !prompts.length && !clips.length"
      title="Кадров пока нет"
      description="Они появятся после шага «Генерация изображений»."
    />

    <section v-if="images.length">
      <h3 class="mb-2 text-micro tracking-[.06em] text-subtle uppercase">
        Кадры · {{ images.length }}
      </h3>
      <div class="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
        <div v-for="(asset, i) in images" :key="asset.id" class="group relative">
          <button
            type="button"
            class="block aspect-square w-full cursor-pointer overflow-hidden rounded-md border border-border bg-surface"
            :aria-label="`Кадр ${asset.order + 1}`"
            @click="lightboxIndex = i"
          >
            <span
              v-if="missing.has(asset.id)"
              class="flex size-full flex-col items-center justify-center gap-1 text-subtle"
            >
              <Icon name="mingcute:pic-line" class="text-lg" />
              <span class="font-mono text-micro">нет файла</span>
            </span>
            <img
              v-else
              :src="`/api/files/${asset.fileUrl}`"
              alt=""
              class="size-full object-cover"
              @error="missing.add(asset.id)"
            >
          </button>
          <UiButton
            icon-only
            variant="ghost"
            class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            aria-label="Скачать кадр"
            @click.stop="downloadImage(asset)"
          >
            <Icon name="mingcute:download-2-line" />
          </UiButton>
        </div>
      </div>
    </section>

    <section v-if="prompts.length">
      <h3 class="mb-2 text-micro tracking-[.06em] text-subtle uppercase">
        Промты · {{ prompts.length }}
      </h3>
      <div class="flex flex-col gap-2">
        <article v-for="asset in prompts" :key="asset.id" class="rounded-md border border-border bg-card p-2.5">
          <div class="mb-1 flex items-center gap-2">
            <span class="font-mono text-micro text-subtle">сцена {{ asset.order + 1 }}</span>
            <span class="flex-1" />
            <FavoritePromptButton
              :prompt-text="asset.prompt!"
              :app-id="appId ?? null"
              :source-video-asset-id="asset.id"
            />
          </div>
          <p class="text-sm whitespace-pre-line">{{ asset.prompt }}</p>
        </article>
      </div>
    </section>

    <section v-if="clips.length || music.length" class="flex flex-wrap gap-1.5">
      <span
        v-for="asset in clips"
        :key="asset.id"
        class="inline-flex h-[22px] items-center gap-1.5 rounded-sm border border-border bg-card px-2 text-sm text-muted"
      >
        <Icon name="mingcute:film-line" />
        клип {{ asset.order + 1 }}
      </span>
      <span
        v-for="asset in music"
        :key="asset.id"
        class="inline-flex h-[22px] items-center gap-1.5 rounded-sm border border-border bg-card px-2 text-sm text-muted"
      >
        <Icon name="mingcute:music-2-line" />
        музыка
      </span>
    </section>

    <VideoImageLightbox
      v-if="lightboxIndex !== null"
      :images="images"
      :initial-index="lightboxIndex"
      @close="lightboxIndex = null"
    />
  </div>
</template>
