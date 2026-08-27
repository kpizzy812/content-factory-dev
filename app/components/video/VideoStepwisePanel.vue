<script setup lang="ts">
import type { StepwiseState } from '~~/shared/types/edit-console'
import { VIDEO_STEP_LABELS } from './VideoStatusMap'
import {
  stepwiseChoice,
  stepwiseOverrideValue,
  STEPWISE_SOURCE_LABELS,
  type StepwiseChoice,
} from './edit-console-model'
import { consoleErrorText, setStepwise } from './edit-console-api'

/**
 * Пошаговый режим ролика.
 *
 * Переключатель на три положения, а не чекбокс: `null` — законное значение
 * «наследовать монтажный профиль», и сервер отличает его от явного «выключить».
 * Свести это к двум состояниям значило бы потерять разницу между «профиль решает»
 * и «на этом ролике выключено».
 *
 * Макет: design-preview/catalog/09-edit-console.dc.html (секции «Консоль» и
 * «Ждём оператора»).
 */
const props = defineProps<{
  videoId: number
  /** Переопределение на ролике: `Video.stepwiseApproval`. */
  override: boolean | null | undefined
  /** Значение из монтажного профиля — по нему считается «как в профиле». */
  profileDefault?: boolean | null
  awaitingStepKey?: string | null
}>()

const emit = defineEmits<{ changed: [] }>()

const toast = useToast()

const local = ref<boolean | null>(props.override ?? null)
watch(() => props.override, value => { local.value = value ?? null })

const choice = computed<StepwiseChoice>(() => stepwiseChoice(local.value))

const source = computed(() => (local.value === null ? 'profile' : 'video'))
const enabled = computed(() => (local.value === null ? props.profileDefault === true : local.value))

const saving = ref(false)
const error = ref('')

const CHOICES: Array<{ key: StepwiseChoice, label: string }> = [
  { key: 'inherit', label: 'Как в профиле' },
  { key: 'on', label: 'Включить' },
  { key: 'off', label: 'Выключить' },
]

async function pick(next: StepwiseChoice) {
  if (next === choice.value || saving.value) return
  const value = stepwiseOverrideValue(next)
  saving.value = true
  error.value = ''
  try {
    const result = await setStepwise($fetch, props.videoId, value)
    const state = (result as { data?: StepwiseState })?.data ?? null
    local.value = state ? state.stepwiseApproval : value
    toast.success(
      (state?.enabled ?? enabled.value)
        ? 'Ролик будет останавливаться после каждого шага'
        : 'Ролик пойдёт целиком, без остановок',
    )
    emit('changed')
  }
  catch (e) {
    error.value = consoleErrorText(e, 'Не удалось изменить пошаговый режим')
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="overflow-hidden rounded-lg border border-border bg-panel">
    <header class="flex items-center gap-2.5 border-b border-border px-3 py-2.5">
      <h2 class="text-base font-semibold">Пошаговый режим</h2>
      <span class="flex-1" />
      <span
        class="inline-flex h-5 items-center rounded-sm border px-1.5 text-micro"
        :class="source === 'video'
          ? 'border-warning-border bg-warning-bg text-warning'
          : 'border-neutral-border bg-neutral-bg text-neutral'"
      >
        {{ STEPWISE_SOURCE_LABELS[source] }}
      </span>
    </header>

    <div class="p-3">
      <div role="radiogroup" aria-label="Пошаговый режим" class="flex gap-0.5 rounded-md border border-border bg-card p-0.5">
        <button
          v-for="item in CHOICES"
          :key="item.key"
          type="button"
          role="radio"
          :aria-checked="choice === item.key"
          :disabled="saving"
          class="h-[26px] flex-1 rounded-sm text-sm"
          :class="choice === item.key
            ? (item.key === 'on' ? 'bg-accent font-medium text-on-accent' : 'bg-raised text-fg')
            : 'text-muted hover:text-fg'"
          @click="pick(item.key)"
        >
          {{ item.label }}
        </button>
      </div>

      <div v-if="awaitingStepKey" class="mt-2.5 flex items-center gap-2 text-micro text-muted">
        <span class="size-1.5 shrink-0 rounded-full bg-warning" />
        Стоим на шаге
        <span class="font-mono text-fg">{{ VIDEO_STEP_LABELS[awaitingStepKey] ?? awaitingStepKey }}</span>
      </div>

      <p class="mt-2.5 text-micro leading-relaxed text-muted">
        <template v-if="enabled">
          Ролик останавливается после каждого шага и ждёт решения. Прогон при этом
          завершается, блокировка снимается — ожидание ничего не занимает.
          Автопродолжения по таймауту нет.
        </template>
        <template v-else>
          Прогон идёт целиком. Включите, чтобы ролик останавливался после каждого шага
          и ждал вашего решения.
        </template>
      </p>

      <p v-if="awaitingStepKey" class="mt-2 text-micro leading-relaxed text-subtle">
        Переключатель ролик из ожидания не выведет: из него выводит только решение по шагу.
      </p>

      <p
        v-if="error"
        role="alert"
        class="mt-2.5 flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
      >
        <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
        {{ error }}
      </p>
    </div>
  </section>
</template>
