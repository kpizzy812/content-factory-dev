<script setup lang="ts">
const config = defineModel<{
  format: string
  subtitlesEnabled: boolean
  musicEnabled: boolean
  musicMood: string
  musicDuration: number
  clipDuration: number
  imageCount: number
  renderQuality: string
  targetPlatform: string
}>({
  default: () => ({
    format: 'portrait',
    subtitlesEnabled: true,
    musicEnabled: true,
    musicMood: 'energetic upbeat',
    musicDuration: 15,
    clipDuration: 5,
    imageCount: 3,
    renderQuality: 'medium',
    targetPlatform: '',
  }),
})

const formats = [
  { value: 'portrait', label: '9:16 вертикальное', desc: 'TikTok, Reels, Shorts', icon: 'mingcute:cellphone-line' },
  { value: 'landscape', label: '16:9 горизонтальное', desc: 'YouTube, Facebook', icon: 'mingcute:tv-2-line' },
]

const qualities = [
  { value: 'low', label: 'Низкое', desc: 'быстрее и дешевле' },
  { value: 'medium', label: 'Среднее', desc: 'баланс' },
  { value: 'high', label: 'Высокое', desc: 'дороже и дольше' },
]

const platforms = [
  { value: '', label: 'Без привязки' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'instagram', label: 'Instagram Reels' },
  { value: 'youtube', label: 'YouTube Shorts' },
]

const musicMoods = [
  'energetic upbeat',
  'calm ambient',
  'cinematic epic',
  'happy pop',
  'dark dramatic',
  'chill lofi',
]

// Длительность музыки идёт за длительностью ролика: три сцены по clipDuration.
watch(() => config.value.clipDuration, (val) => {
  config.value.musicDuration = val * 3
}, { immediate: true })
</script>

<template>
  <div class="flex flex-col gap-3.5">
    <UiField label="Формат ролика">
      <div class="flex gap-2">
        <button
          v-for="f in formats"
          :key="f.value"
          type="button"
          class="flex-1 cursor-pointer rounded-md border p-2.5 text-left"
          :class="config.format === f.value
            ? 'border-accent bg-accent-bg'
            : 'border-border bg-card hover:border-subtle'"
          :aria-pressed="config.format === f.value"
          @click="config.format = f.value"
        >
          <span class="flex items-center gap-2">
            <Icon :name="f.icon" />
            <span class="text-sm font-medium">{{ f.label }}</span>
          </span>
          <span class="mt-0.5 block text-micro text-subtle">{{ f.desc }}</span>
        </button>
      </div>
    </UiField>

    <UiField label="Целевая платформа">
      <UiSelect v-model="config.targetPlatform" :options="platforms" />
    </UiField>

    <UiField
      label="Длительность сцены"
      :hint="`Три сцены по ${config.clipDuration} с — около ${config.clipDuration * 3} с готового ролика`"
    >
      <div class="flex items-center gap-3">
        <input
          v-model.number="config.clipDuration"
          type="range"
          min="3"
          max="15"
          step="1"
          class="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-neutral-bg accent-(--color-accent)"
        >
        <span class="tnum w-10 text-center font-mono text-sm">{{ config.clipDuration }} с</span>
      </div>
    </UiField>

    <UiField label="Кадров на ролик" hint="Изображения идут в клипы и превью, от 1 до 10">
      <UiInput v-model.number="config.imageCount" type="number" class="w-24" mono />
    </UiField>

    <UiToggle v-model="config.subtitlesEnabled" label="Субтитры" />
    <UiToggle v-model="config.musicEnabled" label="Фоновая музыка" />

    <UiField
      v-if="config.musicEnabled"
      label="Настроение музыки"
      :hint="`Длительность подстроится под ролик — около ${config.clipDuration * 3} с`"
    >
      <UiSelect
        v-model="config.musicMood"
        :options="musicMoods.map(m => ({ value: m, label: m }))"
      />
    </UiField>

    <UiField label="Качество рендера">
      <div class="flex gap-2">
        <button
          v-for="q in qualities"
          :key="q.value"
          type="button"
          class="flex-1 cursor-pointer rounded-md border p-2 text-center"
          :class="config.renderQuality === q.value
            ? 'border-accent bg-accent-bg'
            : 'border-border bg-card hover:border-subtle'"
          :aria-pressed="config.renderQuality === q.value"
          @click="config.renderQuality = q.value"
        >
          <span class="block text-sm font-medium">{{ q.label }}</span>
          <span class="block text-micro text-subtle">{{ q.desc }}</span>
        </button>
      </div>
    </UiField>
  </div>
</template>
