<script setup lang="ts">
const { items, dismiss } = useToast()

function alertClass(variant: 'success' | 'error' | 'info' | 'warning'): string {
  switch (variant) {
    case 'success': return 'alert alert-success alert-soft'
    case 'error': return 'alert alert-error alert-soft'
    case 'warning': return 'alert alert-warning alert-soft'
    case 'info': return 'alert alert-info alert-soft'
  }
}

function iconName(variant: 'success' | 'error' | 'info' | 'warning'): string {
  switch (variant) {
    case 'success': return 'mingcute:check-circle-line'
    case 'error': return 'mingcute:warning-line'
    case 'warning': return 'mingcute:alert-line'
    case 'info': return 'mingcute:information-line'
  }
}
</script>

<template>
  <ClientOnly>
    <Teleport to="body">
      <div class="toast toast-end toast-bottom z-[100]">
        <div
          v-for="item in items"
          :key="item.id"
          :class="alertClass(item.variant)"
          class="text-sm cursor-pointer min-w-56 max-w-sm"
          role="status"
          @click="dismiss(item.id)"
        >
          <Icon :name="iconName(item.variant)" class="shrink-0" />
          <span class="break-words">{{ item.text }}</span>
        </div>
      </div>
    </Teleport>
  </ClientOnly>
</template>
