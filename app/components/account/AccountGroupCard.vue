<script setup lang="ts">
defineProps<{
  group: {
    id: number
    name: string
    members: {
      id: number
      socialAccount: {
        id: number
        platform: string
        displayName: string
        status: string
      }
    }[]
  }
}>()

defineEmits<{
  edit: []
  delete: []
}>()

const platformIcons: Record<string, string> = {
  youtube: 'mingcute:youtube-line',
  tiktok: 'mingcute:tiktok-line',
  instagram: 'mingcute:instagram-line',
}
</script>

<template>
  <div class="card bg-base-100 shadow-sm">
    <div class="card-body p-4 gap-3">
      <!-- Заголовок -->
      <div class="flex items-center justify-between">
        <h3 class="font-semibold text-base-content">{{ group.name }}</h3>
        <span class="badge badge-ghost badge-sm">
          {{ group.members.length }} аккаунтов
        </span>
      </div>

      <!-- Список аккаунтов (мини) -->
      <div v-if="group.members.length > 0" class="flex flex-wrap gap-1">
        <span
          v-for="member in group.members.slice(0, 5)"
          :key="member.id"
          class="badge badge-sm badge-outline gap-1"
        >
          <Icon
            :name="platformIcons[member.socialAccount.platform] ?? 'mingcute:share-2-line'"
            class="text-xs"
          />
          {{ member.socialAccount.displayName }}
        </span>
        <span
          v-if="group.members.length > 5"
          class="badge badge-sm badge-ghost"
        >
          +{{ group.members.length - 5 }}
        </span>
      </div>

      <!-- Действия -->
      <div class="card-actions justify-end">
        <button class="btn btn-sm btn-ghost gap-1" @click="$emit('edit')">
          <Icon name="mingcute:edit-line" class="text-sm" />
          Изменить
        </button>
        <button class="btn btn-sm btn-error btn-outline gap-1" @click="$emit('delete')">
          <Icon name="mingcute:delete-2-line" class="text-sm" />
          Удалить
        </button>
      </div>
    </div>
  </div>
</template>
