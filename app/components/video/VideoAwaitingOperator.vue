<script setup lang="ts">
import { formatMoney } from '~~/shared/utils/money'
import type { VideoGenerationStep } from '~~/shared/types/video'
import type { StepwiseApprovalAction } from '~~/shared/types/edit-console'
import { VIDEO_STEP_IS_CHEAP, VIDEO_STEP_LABELS } from './VideoStatusMap'
import { approveStep, consoleErrorText } from './edit-console-api'

/**
 * Ролик стоит в `awaiting_operator` и ждёт решения.
 *
 * Важное отличие от «идёт генерация»: прогона за роликом нет вовсе — шаг
 * доведён до конца, блокировка отпущена, процесс завершён. Поэтому баннер не
 * анимируется и не показывает прогресс: показывать нечего, ждут человека.
 *
 * Макет: design-preview/catalog/09-edit-console.dc.html (секция «Ждём оператора»).
 */
const props = defineProps<{
  videoId: number
  awaitingStepKey: string | null | undefined
  steps?: VideoGenerationStep[]
}>()

const emit = defineEmits<{ changed: [] }>()

const toast = useToast()

const stepLabel = computed(() =>
  props.awaitingStepKey ? (VIDEO_STEP_LABELS[props.awaitingStepKey] ?? props.awaitingStepKey) : null)

const stepRow = computed(() =>
  props.steps?.find(s => s.stepKey === props.awaitingStepKey) ?? null)

/** Перегенерация платного шага снова заплатит — это надо сказать до нажатия. */
const regenerateCosts = computed(() =>
  props.awaitingStepKey ? VIDEO_STEP_IS_CHEAP[props.awaitingStepKey] !== true : false)

const regenerateCost = computed(() => {
  const estimate = stepRow.value?.estimatedCost
  return estimate != null && estimate > 0 ? formatMoney(estimate) : null
})

const busy = ref<StepwiseApprovalAction | null>(null)
const error = ref('')
const showReject = ref(false)

async function run(action: StepwiseApprovalAction) {
  busy.value = action
  error.value = ''
  try {
    await approveStep($fetch, props.videoId, action)
    if (action === 'approve') toast.success('Шаг принят — прогон продолжается')
    if (action === 'regenerate') toast.success('Шаг уходит на перегенерацию')
    if (action === 'reject') toast.info('Ролик отклонён')
    showReject.value = false
    emit('changed')
  }
  catch (e) {
    error.value = consoleErrorText(e, 'Не удалось передать решение')
  }
  finally {
    busy.value = null
  }
}
</script>

<template>
  <div role="alert" class="overflow-hidden rounded-lg border border-warning-border bg-warning-bg">
    <div class="flex items-start gap-2.5 p-3.5">
      <Icon name="mingcute:pause-line" class="mt-0.5 shrink-0 text-lg text-warning" />
      <div class="min-w-0 flex-1">
        <div class="font-medium text-warning">Ролик ждёт вашего решения</div>
        <p class="mt-1 max-w-[720px] text-sm text-muted">
          <template v-if="stepLabel">Шаг «{{ stepLabel }}» закончен. </template>
          Прогон не идёт, блокировка снята, время не тикает. «Принять» запускает новый
          прогон со следующего шага; «Перегенерировать» переделывает этот же шаг заново.
        </p>

        <div class="mt-2.5 flex flex-wrap items-center gap-1.5">
          <UiButton variant="primary" :loading="busy === 'approve'" @click="run('approve')">
            Принять и продолжить
          </UiButton>
          <UiButton :loading="busy === 'regenerate'" @click="run('regenerate')">
            Перегенерировать шаг<template v-if="regenerateCost"> · {{ regenerateCost }}</template>
          </UiButton>
          <span class="flex-1" />
          <UiButton variant="danger" @click="showReject = true">Отклонить ролик</UiButton>
        </div>

        <p
          v-if="error"
          class="mt-2.5 flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
        >
          <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
          {{ error }}
        </p>
      </div>
    </div>

    <p class="border-t border-warning-border px-3.5 py-2 text-micro text-muted">
      <template v-if="regenerateCosts">
        Шаг «{{ stepLabel }}» обращается к платной модели — перегенерация спишет
        <template v-if="regenerateCost">около {{ regenerateCost }}</template>
        <template v-else>деньги повторно</template>.
      </template>
      <template v-else>
        Шаг «{{ stepLabel }}» бесплатный — перегенерация ничего не спишет.
      </template>
      Автопродолжения по таймауту нет: ролик будет ждать столько, сколько нужно.
    </p>

    <UiModal :open="showReject" title="Отклонить ролик?" size="sm" @close="showReject = false">
      <p class="text-sm text-muted">
        Ролик перейдёт в «Отменён» и дальше по шагам не пойдёт. Уже потраченное не вернётся,
        но и новых списаний не будет.
      </p>
      <template #footer>
        <UiButton variant="ghost" @click="showReject = false">Отмена</UiButton>
        <UiButton variant="danger" :loading="busy === 'reject'" @click="run('reject')">
          Отклонить
        </UiButton>
      </template>
    </UiModal>
  </div>
</template>
