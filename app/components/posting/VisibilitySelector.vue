<script setup lang="ts">
/**
 * Селектор видимости публикации YouTube — radio group + warning UX.
 *
 * Принципы безопасности:
 *   - НЕТ ДЕФОЛТА: visibility=null означает "оператор ещё не выбрал".
 *     Форма остаётся невалидной пока выбор не сделан (fail-safe).
 *   - public — самый опасный сценарий: badge + alert-warning + красная подсветка.
 *   - unlisted/private — относительно безопасные, нейтральные подсветки.
 *
 * v-model:visibility (YoutubeVisibility | null)
 */
import type { YoutubeVisibility } from "~~/shared/types/posting-youtube"

const props = defineProps<{
  visibility: YoutubeVisibility | null
  disabled?: boolean
}>()

const emit = defineEmits<{
  "update:visibility": [v: YoutubeVisibility]
}>()

interface Option {
  value: YoutubeVisibility
  label: string
  description: string
  icon: string
  radioClass: string
  badgeClass?: string
  badgeText?: string
}

const options: Option[] = [
  {
    value: "private",
    label: "Приватно",
    description: "Только владелец канала и приглашённые",
    icon: "mingcute:lock-line",
    radioClass: "radio-warning",
  },
  {
    value: "unlisted",
    label: "По ссылке",
    description: "Только по прямой ссылке, не в поиске",
    icon: "mingcute:link-line",
    radioClass: "radio-info",
  },
  {
    value: "public",
    label: "Публично",
    description: "Доступно всем — видео уйдёт в открытый доступ сразу",
    icon: "mingcute:earth-line",
    radioClass: "radio-error",
    badgeClass: "badge-error",
    badgeText: "Публикация",
  },
]

function select(value: YoutubeVisibility) {
  if (props.disabled) return
  emit("update:visibility", value)
}
</script>

<template>
  <div class="space-y-2">
    <div
      v-if="visibility === null"
      role="alert"
      class="alert alert-info alert-soft py-2 text-xs"
    >
      <Icon name="mingcute:information-line" class="text-sm shrink-0" />
      <span>Выберите видимость публикации — обязательное поле YouTube.</span>
    </div>

    <div class="grid gap-2">
      <label
        v-for="opt in options"
        :key="opt.value"
        class="label cursor-pointer justify-start gap-3 p-2 rounded-box border transition"
        :class="[
          visibility === opt.value
            ? opt.value === 'public'
              ? 'bg-error/10 border-error/30'
              : opt.value === 'unlisted'
                ? 'bg-info/10 border-info/30'
                : 'bg-warning/10 border-warning/30'
            : 'border-base-300 hover:border-base-content/20',
          disabled ? 'opacity-50 cursor-not-allowed' : '',
        ]"
      >
        <input
          type="radio"
          class="radio radio-sm"
          :class="opt.radioClass"
          :checked="visibility === opt.value"
          :disabled="disabled"
          @change="select(opt.value)"
        />
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1.5">
            <Icon :name="opt.icon" class="text-sm" />
            <span class="font-medium text-sm">{{ opt.label }}</span>
            <span
              v-if="opt.badgeText"
              class="badge badge-xs gap-1"
              :class="opt.badgeClass"
            >
              {{ opt.badgeText }}
            </span>
          </div>
          <div class="text-xs text-base-content/60 mt-0.5">
            {{ opt.description }}
          </div>
        </div>
      </label>
    </div>

    <div
      v-if="visibility === 'public'"
      role="alert"
      class="alert alert-warning alert-soft py-2 text-xs"
    >
      <Icon name="mingcute:warning-line" class="text-sm shrink-0" />
      <span>
        Видео уйдёт в открытый доступ сразу после публикации. Убедитесь что
        контент готов к публичному показу.
      </span>
    </div>
  </div>
</template>
