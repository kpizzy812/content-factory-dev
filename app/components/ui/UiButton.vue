<script setup lang="ts">
/**
 * Кнопка дизайн-системы. Источник: design-preview/_system/blocks/Button.html
 *
 * Заливка акцентом идёт с почти чёрным текстом (--color-on-accent), а не с белым:
 * янтарь при своей светлоте не проходит 4.5:1 с белым ни в одной из тем.
 */
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

const props = withDefaults(defineProps<{
  variant?: Variant
  size?: Size
  loading?: boolean
  disabled?: boolean
  iconOnly?: boolean
  type?: 'button' | 'submit'
}>(), {
  variant: 'secondary',
  size: 'sm',
  type: 'button',
})

const isInert = computed(() => props.disabled || props.loading)

const sizing = computed(() => {
  if (props.iconOnly) {
    return props.size === 'md' ? 'h-8 w-8 justify-center' : 'h-7 w-7 justify-center'
  }
  return props.size === 'md' ? 'h-8 px-3.5 text-base' : 'h-7 px-[11px] text-sm'
})

const tone = computed(() => {
  if (props.disabled) {
    return props.variant === 'ghost'
      ? 'bg-transparent text-subtle'
      : 'bg-neutral-bg text-subtle'
  }
  switch (props.variant) {
    case 'primary':
      return 'bg-accent text-on-accent hover:bg-accent-hover active:bg-accent-active'
    case 'ghost':
      return 'bg-transparent text-muted hover:bg-raised hover:text-fg'
    case 'danger':
      return 'bg-danger-bg text-danger border border-danger-border hover:bg-danger hover:text-inverse'
    default:
      return 'bg-card text-fg border border-border hover:bg-raised hover:border-subtle'
  }
})
</script>

<template>
  <button
    :type="type"
    :disabled="isInert"
    class="inline-flex items-center gap-[7px] rounded-md font-medium whitespace-nowrap transition-colors duration-(--duration-fast) ease-out"
    :class="[
      sizing,
      tone,
      disabled ? 'cursor-not-allowed' : loading ? 'cursor-progress opacity-85' : 'cursor-pointer',
    ]"
  >
    <Icon v-if="loading" name="mingcute:loading-line" class="animate-spin text-[14px]" />
    <slot />
  </button>
</template>
