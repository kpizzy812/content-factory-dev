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
  { value: 'portrait', label: '9:16 Вертикальное', desc: 'TikTok, Reels, Shorts' },
  { value: 'landscape', label: '16:9 Горизонтальное', desc: 'YouTube, Facebook' },
]

const qualities = [
  { value: 'low', label: 'Низкое', desc: 'Быстрее, дешевле' },
  { value: 'medium', label: 'Среднее', desc: 'Баланс' },
  { value: 'high', label: 'Высокое', desc: 'Лучшее качество' },
]

const platforms = [
  { value: '', label: 'Без привязки' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'instagram', label: 'Instagram Reels' },
  { value: 'youtube', label: 'YouTube Shorts' },
]

// Автосинхронизация длительности музыки с общей длительностью видео
watch(() => config.value.clipDuration, (val) => {
  config.value.musicDuration = val * 3
}, { immediate: true })

const musicMoods = [
  'energetic upbeat',
  'calm ambient',
  'cinematic epic',
  'happy pop',
  'dark dramatic',
  'chill lofi',
]
</script>

<template>
  <div class="space-y-4">
    <h4 class="text-sm font-semibold">Настройки генерации</h4>

    <!-- Format -->
    <div class="form-control">
      <label class="label"><span class="label-text text-xs">Формат видео</span></label>
      <div class="flex gap-2">
        <label
          v-for="f in formats"
          :key="f.value"
          class="flex-1 cursor-pointer"
        >
          <input
            v-model="config.format"
            type="radio"
            :value="f.value"
            class="hidden peer"
          />
          <div class="border border-base-300 rounded-lg p-3 peer-checked:border-primary peer-checked:bg-primary/5 transition-colors">
            <div class="flex items-center gap-2">
              <Icon :name="f.value === 'portrait' ? 'mingcute:cellphone-line' : 'mingcute:tv-2-line'" />
              <span class="text-sm font-medium">{{ f.label }}</span>
            </div>
            <p class="text-xs text-base-content/50 mt-1">{{ f.desc }}</p>
          </div>
        </label>
      </div>
    </div>

    <!-- Target platform -->
    <div class="form-control">
      <label class="label"><span class="label-text text-xs">Целевая платформа</span></label>
      <select v-model="config.targetPlatform" class="select select-sm">
        <option v-for="p in platforms" :key="p.value" :value="p.value">{{ p.label }}</option>
      </select>
    </div>

    <!-- Clip duration -->
    <div class="form-control">
      <label class="label"><span class="label-text text-xs">Длительность каждой сцены</span></label>
      <div class="flex items-center gap-3">
        <input
          v-model.number="config.clipDuration"
          type="range"
          min="3"
          max="15"
          step="1"
          class="range range-sm range-primary flex-1"
        />
        <span class="text-sm font-mono w-10 text-center">{{ config.clipDuration }}с</span>
      </div>
      <p class="text-xs text-base-content/50 mt-1">
        Итого: 3 сцены × {{ config.clipDuration }}с = <strong>~{{ config.clipDuration * 3 }}с</strong> готового видео
      </p>
    </div>

    <!-- Image count -->
    <div class="form-control">
      <label class="label"><span class="label-text text-xs">Количество изображений</span></label>
      <div class="flex items-center gap-3">
        <input
          v-model.number="config.imageCount"
          type="number"
          min="1"
          max="10"
          step="1"
          class="input input-sm w-24"
        />
        <span class="text-xs text-base-content/50">от 1 до 10</span>
      </div>
      <p class="text-xs text-base-content/50 mt-1">
        Изображения используются как превью для видео
      </p>
    </div>

    <!-- Subtitles -->
    <div class="form-control">
      <label class="label cursor-pointer justify-start gap-3">
        <input v-model="config.subtitlesEnabled" type="checkbox" class="toggle toggle-sm toggle-primary" />
        <span class="label-text text-sm">Субтитры</span>
      </label>
    </div>

    <!-- Music -->
    <div class="form-control">
      <label class="label cursor-pointer justify-start gap-3">
        <input v-model="config.musicEnabled" type="checkbox" class="toggle toggle-sm toggle-primary" />
        <span class="label-text text-sm">Фоновая музыка</span>
      </label>
    </div>

    <template v-if="config.musicEnabled">
      <div class="form-control pl-4">
        <label class="label"><span class="label-text text-xs">Настроение музыки</span></label>
        <select v-model="config.musicMood" class="select select-sm">
          <option v-for="mood in musicMoods" :key="mood" :value="mood">{{ mood }}</option>
        </select>
      </div>
      <p class="text-xs text-base-content/50 pl-4">
        Длительность музыки подстроится под видео (~{{ config.clipDuration * 3 }}с)
      </p>
    </template>

    <!-- Quality -->
    <div class="form-control">
      <label class="label"><span class="label-text text-xs">Качество рендера</span></label>
      <div class="flex gap-2">
        <label
          v-for="q in qualities"
          :key="q.value"
          class="flex-1 cursor-pointer"
        >
          <input
            v-model="config.renderQuality"
            type="radio"
            :value="q.value"
            class="hidden peer"
          />
          <div class="border border-base-300 rounded-lg p-2 text-center peer-checked:border-primary peer-checked:bg-primary/5 transition-colors">
            <span class="text-sm font-medium">{{ q.label }}</span>
            <p class="text-xs text-base-content/50">{{ q.desc }}</p>
          </div>
        </label>
      </div>
    </div>
  </div>
</template>
