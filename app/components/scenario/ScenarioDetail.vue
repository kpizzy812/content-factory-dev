<script setup lang="ts">
import type { VisualStyleStructured } from '~~/shared/types/scenario'

const props = defineProps<{
  scenarioId: number
  variant: {
    id: number
    hook: string
    body: string
    cta: string
    visualStyleText: string
    visualStyleStructured: VisualStyleStructured | null
    fullScript: string
    toneProfile?: string | null
    rationale?: string | null
  }
}>()

const emit = defineEmits<{ regenerated: [] }>()

const { can } = usePermissions()
const { regenerateBlock, improveVisualStyle } = useScenarioActions()
const toast = useToast()

const isFullScriptOpen = ref(false)
const regeneratingBlock = ref<string | null>(null)
const isImprovingStyle = ref(false)
const copied = ref<string | null>(null)

async function handleRegenerate(blockType: string) {
  regeneratingBlock.value = blockType
  try {
    await regenerateBlock(props.scenarioId, props.variant.id, blockType)
    emit('regenerated')
  }
  catch {
    toast.error('Не удалось перегенерировать блок')
  }
  finally {
    regeneratingBlock.value = null
  }
}

async function handleImproveStyle() {
  isImprovingStyle.value = true
  try {
    await improveVisualStyle(props.scenarioId, props.variant.id)
    emit('regenerated')
  }
  catch {
    toast.error('Не удалось улучшить промпт')
  }
  finally {
    isImprovingStyle.value = false
  }
}

function copy(text: string, key: string) {
  navigator.clipboard.writeText(text)
  copied.value = key
  setTimeout(() => { copied.value = null }, 2000)
}

const visualStyle = computed(() => props.variant.visualStyleStructured)

// Текстовые блоки одинаковы по устройству — различаются только подписью и иконкой.
const TEXT_BLOCKS = [
  { key: 'hook', label: 'Хук', icon: 'mingcute:flash-line', tone: 'text-warning', boxed: true },
  { key: 'body', label: 'Основная часть', icon: 'mingcute:text-line', tone: 'text-info', boxed: false },
  { key: 'cta', label: 'Призыв к действию', icon: 'mingcute:horn-line', tone: 'text-success', boxed: false },
] as const

function blockText(key: 'hook' | 'body' | 'cta') {
  return props.variant[key]
}
</script>

<template>
  <section class="flex flex-col gap-4 rounded-lg border border-border bg-panel p-3.5">
    <div v-for="b in TEXT_BLOCKS" :key="b.key">
      <div class="mb-1.5 flex items-center gap-2">
        <Icon :name="b.icon" class="text-base" :class="b.tone" />
        <h3 class="text-sm font-medium">{{ b.label }}</h3>
        <span class="flex-1" />
        <UiButton icon-only variant="ghost" :aria-label="`Скопировать: ${b.label}`" @click="copy(blockText(b.key), b.key)">
          <Icon :name="copied === b.key ? 'mingcute:check-line' : 'mingcute:copy-2-line'" />
        </UiButton>
        <UiActionMenu
          v-if="can('canRunAgent')"
          :items="[{
            key: 'regen',
            label: `Перегенерировать: ${b.label.toLowerCase()}`,
            icon: 'mingcute:refresh-2-line',
            cost: 'платно',
            disabled: !!regeneratingBlock,
          }]"
          @select="handleRegenerate(b.key)"
        />
      </div>

      <div v-if="regeneratingBlock === b.key" class="flex items-center gap-2 text-sm text-muted">
        <Icon name="mingcute:loading-line" class="animate-spin" />
        Перегенерируем
      </div>
      <div
        v-else
        class="text-sm whitespace-pre-wrap"
        :class="b.boxed && 'rounded-md bg-surface p-3'"
      >
        {{ blockText(b.key) }}
      </div>
    </div>

    <!-- Визуальный стиль -->
    <div>
      <div class="mb-1.5 flex items-center gap-2">
        <Icon name="mingcute:palette-line" class="text-base text-accent" />
        <h3 class="text-sm font-medium">Визуальный стиль</h3>
        <span class="flex-1" />
        <UiButton icon-only variant="ghost" aria-label="Скопировать визуальный стиль" @click="copy(variant.visualStyleText, 'vs')">
          <Icon :name="copied === 'vs' ? 'mingcute:check-line' : 'mingcute:copy-2-line'" />
        </UiButton>
        <UiActionMenu
          v-if="can('canRunAgent')"
          :items="[
            { key: 'regen', label: 'Перегенерировать стиль', icon: 'mingcute:refresh-2-line', cost: 'платно', disabled: !!regeneratingBlock },
            ...(visualStyle ? [{ key: 'improve', label: 'Улучшить промпт', icon: 'mingcute:magic-1-line', cost: 'платно', disabled: isImprovingStyle }] : []),
          ]"
          @select="$event === 'improve' ? handleImproveStyle() : handleRegenerate('visualStyle')"
        />
      </div>

      <div v-if="regeneratingBlock === 'visualStyle' || isImprovingStyle" class="flex items-center gap-2 text-sm text-muted">
        <Icon name="mingcute:loading-line" class="animate-spin" />
        {{ isImprovingStyle ? 'Улучшаем промпт' : 'Перегенерируем' }}
      </div>

      <div v-else-if="visualStyle" class="flex flex-col gap-2">
        <div v-if="visualStyle.colors?.length" class="flex items-center gap-2">
          <span class="text-[11.5px] text-muted">Палитра</span>
          <div class="flex gap-1">
            <button
              v-for="color in visualStyle.colors"
              :key="color"
              type="button"
              class="size-5 cursor-pointer rounded-sm border border-border"
              :style="{ backgroundColor: color }"
              :title="`${color} — скопировать`"
              :aria-label="`Скопировать цвет ${color}`"
              @click="copy(color, color)"
            />
          </div>
        </div>

        <UiKeyValue
          :items="[
            { label: 'Атмосфера', value: visualStyle.atmosphere, mono: false },
            { label: 'Персонаж', value: visualStyle.character, mono: false },
          ]"
        />

        <div v-if="visualStyle.stylePrompt">
          <div class="mb-1 flex items-center gap-1.5">
            <span class="text-[11.5px] text-muted">Промпт стиля</span>
            <UiButton
              icon-only
              variant="ghost"
              aria-label="Скопировать промпт стиля"
              @click="copy(visualStyle.improvedPrompt || visualStyle.stylePrompt, 'prompt')"
            >
              <Icon :name="copied === 'prompt' ? 'mingcute:check-line' : 'mingcute:copy-2-line'" />
            </UiButton>
          </div>
          <code class="block rounded-md bg-surface p-2 font-mono text-micro text-muted">
            {{ visualStyle.improvedPrompt || visualStyle.stylePrompt }}
          </code>
        </div>
      </div>

      <p v-else class="text-sm whitespace-pre-wrap">{{ variant.visualStyleText }}</p>
    </div>

    <div v-if="variant.toneProfile" class="flex items-center gap-1.5 text-micro text-subtle">
      <Icon name="mingcute:voice-line" />
      Тон: {{ variant.toneProfile }}
    </div>

    <!-- Полный текст -->
    <div class="overflow-hidden rounded-md border border-border">
      <div class="flex items-center gap-2 bg-card px-2.5 py-1.5">
        <button
          type="button"
          class="flex flex-1 cursor-pointer items-center gap-1.5 text-sm font-medium"
          :aria-expanded="isFullScriptOpen"
          @click="isFullScriptOpen = !isFullScriptOpen"
        >
          <Icon
            name="mingcute:right-line"
            class="transition-transform duration-(--duration-fast)"
            :class="isFullScriptOpen && 'rotate-90'"
          />
          Полный текст сценария
        </button>
        <UiButton icon-only variant="ghost" aria-label="Скопировать весь текст" @click.stop="copy(variant.fullScript, 'full')">
          <Icon :name="copied === 'full' ? 'mingcute:check-line' : 'mingcute:copy-2-line'" />
        </UiButton>
      </div>
      <p v-if="isFullScriptOpen" class="px-2.5 py-2 text-sm whitespace-pre-wrap">
        {{ variant.fullScript }}
      </p>
    </div>
  </section>
</template>
