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

const isFullScriptOpen = ref(false)
const regeneratingBlock = ref<string | null>(null)
const isImprovingStyle = ref(false)
const copySuccess = ref<string | null>(null)

async function handleRegenerate(blockType: string) {
  regeneratingBlock.value = blockType
  try {
    await regenerateBlock(props.scenarioId, props.variant.id, blockType)
    emit('regenerated')
  } catch {
    // ошибка
  } finally {
    regeneratingBlock.value = null
  }
}

async function handleImproveStyle() {
  isImprovingStyle.value = true
  try {
    await improveVisualStyle(props.scenarioId, props.variant.id)
    emit('regenerated')
  } catch {
    // ошибка
  } finally {
    isImprovingStyle.value = false
  }
}

function copyToClipboard(text: string, label: string) {
  navigator.clipboard.writeText(text)
  copySuccess.value = label
  setTimeout(() => { copySuccess.value = null }, 2000)
}

const visualStyle = computed(() => props.variant.visualStyleStructured)
</script>

<template>
  <div class="card bg-base-100 shadow-sm">
    <div class="card-body p-4 gap-4">
      <!-- Хук -->
      <div>
        <div class="flex items-center gap-2 mb-2">
          <Icon name="mingcute:flash-line" class="text-warning text-lg" />
          <span class="font-semibold text-sm text-base-content">Хук</span>
          <div class="ml-auto flex gap-1">
            <button
              class="btn btn-ghost btn-xs"
              title="Копировать"
              @click="copyToClipboard(variant.hook, 'hook')"
            >
              <Icon :name="copySuccess === 'hook' ? 'mingcute:check-line' : 'mingcute:copy-2-line'" class="text-xs" />
            </button>
            <button
              v-if="can('canRunAgent')"
              class="btn btn-ghost btn-xs"
              title="Перегенерировать хук"
              :disabled="!!regeneratingBlock"
              @click="handleRegenerate('hook')"
            >
              <span v-if="regeneratingBlock === 'hook'" class="loading loading-spinner loading-xs" />
              <Icon v-else name="mingcute:refresh-2-line" class="text-xs" />
            </button>
          </div>
        </div>
        <div class="bg-base-200 rounded-lg p-3 text-sm text-base-content/80 whitespace-pre-wrap">
          {{ variant.hook }}
        </div>
      </div>

      <!-- Основная часть -->
      <div>
        <div class="flex items-center gap-2 mb-2">
          <Icon name="mingcute:text-line" class="text-info text-lg" />
          <span class="font-semibold text-sm text-base-content">Основная часть</span>
          <div class="ml-auto flex gap-1">
            <button
              class="btn btn-ghost btn-xs"
              title="Копировать"
              @click="copyToClipboard(variant.body, 'body')"
            >
              <Icon :name="copySuccess === 'body' ? 'mingcute:check-line' : 'mingcute:copy-2-line'" class="text-xs" />
            </button>
            <button
              v-if="can('canRunAgent')"
              class="btn btn-ghost btn-xs"
              :disabled="!!regeneratingBlock"
              title="Перегенерировать"
              @click="handleRegenerate('body')"
            >
              <span v-if="regeneratingBlock === 'body'" class="loading loading-spinner loading-xs" />
              <Icon v-else name="mingcute:refresh-2-line" class="text-xs" />
            </button>
          </div>
        </div>
        <p class="text-sm text-base-content/80 whitespace-pre-wrap">
          {{ variant.body }}
        </p>
      </div>

      <!-- CTA -->
      <div>
        <div class="flex items-center gap-2 mb-2">
          <Icon name="mingcute:horn-line" class="text-success text-lg" />
          <span class="font-semibold text-sm text-base-content">Призыв к действию</span>
          <div class="ml-auto flex gap-1">
            <button
              class="btn btn-ghost btn-xs"
              title="Копировать"
              @click="copyToClipboard(variant.cta, 'cta')"
            >
              <Icon :name="copySuccess === 'cta' ? 'mingcute:check-line' : 'mingcute:copy-2-line'" class="text-xs" />
            </button>
            <button
              v-if="can('canRunAgent')"
              class="btn btn-ghost btn-xs"
              :disabled="!!regeneratingBlock"
              title="Перегенерировать"
              @click="handleRegenerate('cta')"
            >
              <span v-if="regeneratingBlock === 'cta'" class="loading loading-spinner loading-xs" />
              <Icon v-else name="mingcute:refresh-2-line" class="text-xs" />
            </button>
          </div>
        </div>
        <p class="text-sm text-base-content/80 whitespace-pre-wrap">
          {{ variant.cta }}
        </p>
      </div>

      <!-- Визуальный стиль -->
      <div>
        <div class="flex items-center gap-2 mb-2">
          <Icon name="mingcute:palette-line" class="text-secondary text-lg" />
          <span class="font-semibold text-sm text-base-content">Визуальный стиль</span>
          <div class="ml-auto flex gap-1">
            <button
              class="btn btn-ghost btn-xs"
              title="Копировать"
              @click="copyToClipboard(variant.visualStyleText, 'vs')"
            >
              <Icon :name="copySuccess === 'vs' ? 'mingcute:check-line' : 'mingcute:copy-2-line'" class="text-xs" />
            </button>
            <button
              v-if="can('canRunAgent')"
              class="btn btn-ghost btn-xs"
              :disabled="!!regeneratingBlock"
              title="Перегенерировать стиль"
              @click="handleRegenerate('visualStyle')"
            >
              <span v-if="regeneratingBlock === 'visualStyle'" class="loading loading-spinner loading-xs" />
              <Icon v-else name="mingcute:refresh-2-line" class="text-xs" />
            </button>
            <button
              v-if="can('canRunAgent') && visualStyle"
              class="btn btn-ghost btn-xs"
              :disabled="isImprovingStyle"
              title="Улучшить промпт"
              @click="handleImproveStyle"
            >
              <span v-if="isImprovingStyle" class="loading loading-spinner loading-xs" />
              <Icon v-else name="mingcute:magic-1-line" class="text-xs" />
            </button>
          </div>
        </div>

        <!-- Структурированный visual style -->
        <div v-if="visualStyle" class="space-y-2">
          <!-- Палитра -->
          <div v-if="visualStyle.colors?.length" class="flex items-center gap-2">
            <span class="text-xs text-base-content/50">Палитра:</span>
            <div class="flex gap-1">
              <div
                v-for="color in visualStyle.colors"
                :key="color"
                class="w-5 h-5 rounded-sm border border-base-300 cursor-pointer"
                :style="{ backgroundColor: color }"
                :title="color"
                @click="copyToClipboard(color, color)"
              />
            </div>
          </div>
          <!-- Атмосфера -->
          <div v-if="visualStyle.atmosphere">
            <span class="text-xs text-base-content/50">Атмосфера:</span>
            <p class="text-sm text-base-content/80">{{ visualStyle.atmosphere }}</p>
          </div>
          <!-- Персонаж -->
          <div v-if="visualStyle.character">
            <span class="text-xs text-base-content/50">Персонаж:</span>
            <p class="text-sm text-base-content/80">{{ visualStyle.character }}</p>
          </div>
          <!-- Style Prompt -->
          <div v-if="visualStyle.stylePrompt" class="mt-2">
            <div class="flex items-center gap-1">
              <span class="text-xs text-base-content/50">Style Prompt:</span>
              <button
                class="btn btn-ghost btn-xs"
                title="Копировать промпт"
                @click="copyToClipboard(visualStyle.improvedPrompt || visualStyle.stylePrompt, 'prompt')"
              >
                <Icon :name="copySuccess === 'prompt' ? 'mingcute:check-line' : 'mingcute:copy-2-line'" class="text-xs" />
              </button>
            </div>
            <code class="text-xs bg-base-200 p-2 rounded block mt-1">
              {{ visualStyle.improvedPrompt || visualStyle.stylePrompt }}
            </code>
          </div>
        </div>

        <!-- Fallback: текстовый стиль -->
        <p v-else class="text-sm text-base-content/80 whitespace-pre-wrap">
          {{ variant.visualStyleText }}
        </p>
      </div>

      <!-- Tone profile -->
      <div v-if="variant.toneProfile" class="text-xs text-base-content/50 flex items-center gap-1">
        <Icon name="mingcute:voice-line" class="text-sm" />
        Тон: {{ variant.toneProfile }}
      </div>

      <!-- Полный текст (Collapse) -->
      <div class="collapse collapse-arrow bg-base-200">
        <input v-model="isFullScriptOpen" type="checkbox">
        <div class="collapse-title font-semibold text-sm">
          <Icon name="mingcute:document-line" class="text-base-content/60" />
          Полный текст сценария
          <button
            class="btn btn-ghost btn-xs ml-2"
            title="Копировать весь текст"
            @click.stop="copyToClipboard(variant.fullScript, 'full')"
          >
            <Icon :name="copySuccess === 'full' ? 'mingcute:check-line' : 'mingcute:copy-2-line'" class="text-xs" />
          </button>
        </div>
        <div class="collapse-content">
          <p class="text-sm text-base-content/80 whitespace-pre-wrap">
            {{ variant.fullScript }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
