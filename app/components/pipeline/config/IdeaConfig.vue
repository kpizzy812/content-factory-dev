<script setup lang="ts">
const props = defineProps<{
  config: Record<string, any>
}>()

const emit = defineEmits<{
  update: [key: string, value: any]
}>()

const modes = [
  { value: 'input', label: 'Из потока', icon: 'mingcute:route-line', description: 'Анализирует URL из предыдущего блока. Подключите после Трендвотчера — блок автоматически найдёт URL в данных.' },
  { value: 'url', label: 'По URL', icon: 'mingcute:link-line', description: 'Анализирует один конкретный URL видео. Подходит для ручного тестирования или статической ссылки.' },
  { value: 'fetch', label: 'Из базы', icon: 'mingcute:inbox-line', description: 'Загружает ранее проанализированные идеи из базы данных. Полезно для повторного использования в новых сценариях.' },
] as const

const statusOptions = [
  { value: 'ready', label: 'Готовые к использованию' },
  { value: 'pending', label: 'Ожидающие обработки' },
  { value: 'completed', label: 'Завершённые' },
] as const

const currentMode = computed(() => {
  const m = modes.find(m => m.value === props.config.mode)
  return m ?? modes[0]
})
</script>

<template>
  <!-- Mode selector -->
  <fieldset class="fieldset">
    <legend class="fieldset-legend">Режим работы</legend>
    <div class="flex gap-1">
      <button
        v-for="m in modes"
        :key="m.value"
        type="button"
        class="btn btn-xs gap-1"
        :class="(config.mode || 'input') === m.value ? 'btn-primary' : 'btn-ghost'"
        @click="emit('update', 'mode', m.value)"
      >
        <Icon :name="m.icon" class="text-xs" />
        {{ m.label }}
      </button>
    </div>
    <div class="rounded-box bg-info/10 border border-info/20 p-2 text-[10px] text-base-content/60 mt-1.5">
      <Icon name="mingcute:information-line" class="inline mr-0.5 text-info" />
      {{ currentMode.description }}
    </div>
  </fieldset>

  <!-- INPUT mode settings -->
  <template v-if="(config.mode || 'input') === 'input'">
    <fieldset class="fieldset">
      <legend class="fieldset-legend">Поле с URL (необязательно)</legend>
      <input
        :value="config.urlField || ''"
        type="text"
        class="input input-sm w-full"
        placeholder="Авто: sourceUrl, videoUrl, url"
        @input="emit('update', 'urlField', ($event.target as HTMLInputElement).value)"
      />
      <SharedFieldHint text="Имя поля во входных данных, содержащего URL. Если пусто — блок ищет автоматически в trends[].sourceUrl, videoUrl, url." />
    </fieldset>

    <fieldset class="fieldset">
      <legend class="fieldset-legend">Лимит</legend>
      <input
        :value="config.limit || 5"
        type="number"
        class="input input-sm w-full"
        min="1"
        max="20"
        @input="emit('update', 'limit', Number(($event.target as HTMLInputElement).value))"
      />
      <SharedFieldHint text="Максимум URL для обработки за один запуск (1-20). Каждый URL = один вызов AI-анализа." />
    </fieldset>

    <fieldset class="fieldset">
      <legend class="fieldset-legend">Язык анализа</legend>
      <select
        class="select select-sm w-full"
        :value="config.language || 'EN'"
        @change="emit('update', 'language', ($event.target as HTMLSelectElement).value)"
      >
        <option value="EN">EN — English</option>
        <option value="RU">RU — Русский</option>
        <option value="ES">ES — Español</option>
        <option value="DE">DE — Deutsch</option>
        <option value="FR">FR — Français</option>
      </select>
    </fieldset>

    <!-- Data flow hint -->
    <div class="rounded-box bg-base-200/50 p-2.5 text-[10px] text-base-content/50 space-y-1">
      <div class="font-semibold text-base-content/70">Пример цепочки:</div>
      <div class="flex items-center gap-1 flex-wrap">
        <span class="badge badge-info badge-xs">Трендвотчер</span>
        <Icon name="mingcute:arrow-right-line" class="text-[10px]" />
        <span class="badge badge-primary badge-xs">Идея (из потока)</span>
        <Icon name="mingcute:arrow-right-line" class="text-[10px]" />
        <span class="badge badge-warning badge-xs">Сценарии</span>
      </div>
      <div>Трендвотчер находит тренды с URL → Идея анализирует каждый → CreativeBrief передаётся в Сценарии</div>
    </div>
  </template>

  <!-- URL mode settings -->
  <template v-else-if="(config.mode || 'input') === 'url'">
    <fieldset class="fieldset">
      <legend class="fieldset-legend">URL видео</legend>
      <input
        :value="config.sourceUrl || ''"
        type="url"
        class="input input-sm w-full"
        placeholder="https://tiktok.com/@user/video/123"
        @input="emit('update', 'sourceUrl', ($event.target as HTMLInputElement).value)"
      />
      <SharedFieldHint text="Ссылка на видео для анализа. TikTok, Instagram, YouTube." />
    </fieldset>

    <fieldset class="fieldset">
      <legend class="fieldset-legend">Язык анализа</legend>
      <select
        class="select select-sm w-full"
        :value="config.language || 'EN'"
        @change="emit('update', 'language', ($event.target as HTMLSelectElement).value)"
      >
        <option value="EN">EN — English</option>
        <option value="RU">RU — Русский</option>
        <option value="ES">ES — Español</option>
        <option value="DE">DE — Deutsch</option>
        <option value="FR">FR — Français</option>
      </select>
    </fieldset>
  </template>

  <!-- FETCH mode settings -->
  <template v-else>
    <fieldset class="fieldset">
      <legend class="fieldset-legend">Статус идей</legend>
      <select
        class="select select-sm w-full"
        :value="config.ideaStatus || 'ready'"
        @change="emit('update', 'ideaStatus', ($event.target as HTMLSelectElement).value)"
      >
        <option v-for="s in statusOptions" :key="s.value" :value="s.value">{{ s.label }}</option>
      </select>
      <SharedFieldHint text="Какие идеи загружать из базы. «Готовые» — прошли анализ и готовы к генерации сценариев." />
    </fieldset>

    <fieldset class="fieldset">
      <legend class="fieldset-legend">Лимит</legend>
      <input
        :value="config.limit || 5"
        type="number"
        class="input input-sm w-full"
        min="1"
        max="20"
        @input="emit('update', 'limit', Number(($event.target as HTMLInputElement).value))"
      />
      <SharedFieldHint text="Максимальное количество идей для загрузки (1-20)." />
    </fieldset>
  </template>

  <!-- Output format hint -->
  <div class="rounded-box border border-base-300 p-2 text-[10px] text-base-content/40 space-y-0.5">
    <div class="font-medium text-base-content/60">Выходные данные:</div>
    <div><code class="text-[9px]">ideas[]</code> — массив проанализированных идей с CreativeBrief</div>
    <div><code class="text-[9px]">count</code> — количество идей</div>
  </div>
</template>
