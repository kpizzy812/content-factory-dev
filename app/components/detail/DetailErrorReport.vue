<script setup lang="ts">
/**
 * Отчёт об упавшей генерации. Источник: design-preview/catalog/03-detail-video.dc.html
 *
 * Не просто красный бейдж: на каком шаге, человеческое сообщение, технические
 * детали под разворотом, сколько уже потрачено и цена повтора — решение о
 * перезапуске денежное.
 *
 * Повтор предлагается с правильного шага, а не с текущего: если речь короче
 * видеодорожки, перезапуск lip-sync упадёт снова.
 */
import { formatMoney } from '~~/shared/utils/money'

defineProps<{
  stepLabel: string
  message: string
  details?: string | null
  spent: number
  /** Шаг, с которого повтор имеет смысл, и его цена. */
  retryFromLabel?: string
  retryCost?: number | null
  retrying?: boolean
  /** Отменять нечего, когда запуск уже остановился. */
  cancellable?: boolean
}>()

const emit = defineEmits<{ retryFrom: [], retryAll: [], cancel: [] }>()

const showDetails = ref(false)
</script>

<template>
  <div class="rounded-lg border border-danger-border bg-danger-bg p-3.5">
    <div class="flex items-start gap-2.5">
      <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0 text-lg text-danger" />
      <div class="min-w-0 flex-1">
        <div class="font-medium text-danger">Генерация упала на шаге «{{ stepLabel }}»</div>
        <p class="mt-1 text-sm text-muted">{{ message }}</p>

        <button
          v-if="details"
          type="button"
          class="mt-1.5 cursor-pointer text-[11.5px] text-subtle hover:text-muted"
          @click="showDetails = !showDetails"
        >
          {{ showDetails ? 'Скрыть технические детали' : 'Показать технические детали' }}
        </button>
        <pre
          v-if="showDetails && details"
          class="mt-1.5 max-h-40 overflow-auto rounded-sm bg-surface p-2 font-mono text-[11px] text-muted"
        >{{ details }}</pre>

        <div class="mt-2.5 flex flex-wrap items-center gap-1.5">
          <UiButton v-if="retryFromLabel" variant="primary" :loading="retrying" @click="emit('retryFrom')">
            Повторить с «{{ retryFromLabel }}»
            <span v-if="retryCost != null" class="font-mono text-micro">· ~{{ formatMoney(retryCost) }}</span>
          </UiButton>
          <UiButton :loading="retrying" @click="emit('retryAll')">Повторить всё</UiButton>
          <UiButton v-if="cancellable" variant="ghost" @click="emit('cancel')">Отменить</UiButton>

          <span class="tnum ml-auto font-mono text-sm text-subtle">
            уже потрачено {{ formatMoney(spent) }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
