<script setup lang="ts">
const props = defineProps<{
  appId: number
}>()

const { connectAccount } = useAccountActions()

const isOpen = ref(false)
const dropdownRef = ref<HTMLElement | null>(null)

const platforms = [
  { value: 'youtube', label: 'YouTube', icon: 'mingcute:youtube-line' },
  { value: 'tiktok', label: 'TikTok', icon: 'mingcute:tiktok-line' },
  { value: 'instagram', label: 'Instagram', icon: 'mingcute:instagram-line' },
]

function handleConnect(platform: string) {
  isOpen.value = false
  connectAccount(platform, props.appId)
}

function onClickOutside(e: MouseEvent) {
  if (dropdownRef.value && !dropdownRef.value.contains(e.target as Node)) {
    isOpen.value = false
  }
}

onMounted(() => document.addEventListener('click', onClickOutside))
onUnmounted(() => document.removeEventListener('click', onClickOutside))
</script>

<template>
  <div ref="dropdownRef" class="relative inline-block">
    <button class="btn btn-primary btn-sm gap-1" @click.stop="isOpen = !isOpen">
      <Icon name="mingcute:add-line" />
      Подключить аккаунт
    </button>
    <ul
      v-show="isOpen"
      class="absolute right-0 mt-1 menu bg-base-100 rounded-box z-10 w-52 p-2 shadow-lg border border-base-300"
    >
      <li v-for="p in platforms" :key="p.value">
        <button class="gap-2" @click="handleConnect(p.value)">
          <Icon :name="p.icon" class="text-lg" />
          {{ p.label }}
        </button>
      </li>
    </ul>
  </div>
</template>
