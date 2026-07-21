<script setup lang="ts">
const props = defineProps<{
  guideKey: string
  title: string
  steps: string[]
  tips?: string[]
}>()

const storageKey = computed(() => `guide-${props.guideKey}`)
const isOpen = ref(false)

onMounted(() => {
  const saved = localStorage.getItem(storageKey.value)
  if (saved === 'open' || saved === 'closed') {
    isOpen.value = saved === 'open'
    return
  }
  const isMobile = window.matchMedia('(max-width: 640px)').matches
  isOpen.value = !isMobile
})

function toggle() {
  isOpen.value = !isOpen.value
  localStorage.setItem(storageKey.value, isOpen.value ? 'open' : 'closed')
}
</script>

<template>
  <div
    class="collapse collapse-arrow bg-info/10 border border-info/20 rounded-box"
    :class="{ 'collapse-open': isOpen, 'collapse-close': !isOpen }"
  >
    <div class="collapse-title font-semibold text-info cursor-pointer flex items-center gap-2" @click="toggle">
      <Icon name="mingcute:book-2-line" class="text-lg" />
      {{ title }}
    </div>
    <div class="collapse-content text-sm text-base-content/80">
      <ol class="list-decimal list-inside space-y-1 mt-1">
        <li v-for="(step, i) in steps" :key="i">
          {{ step }}
        </li>
      </ol>
      <div v-if="tips && tips.length > 0" class="mt-3 flex flex-col gap-1">
        <p
          v-for="(tip, i) in tips"
          :key="i"
          class="flex items-start gap-1.5 text-info"
        >
          <Icon name="mingcute:bulb-line" class="text-base shrink-0 mt-0.5" />
          <span>{{ tip }}</span>
        </p>
      </div>
    </div>
  </div>
</template>
