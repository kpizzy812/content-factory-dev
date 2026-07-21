<script setup lang="ts">
import type { DriveCredential } from '~/composables/useGoogleDrive'

defineProps<{
  credentials: DriveCredential[]
  selectedCredentialId: number | null
  testingCredentialId: number | null
}>()
const emit = defineEmits<{
  add: []
  test: [id: number]
  revoke: [id: number]
  delete: [id: number]
  selected: [id: number]
}>()
</script>

<template>
  <section class="space-y-3">
    <header class="flex items-center justify-between gap-2">
      <div>
        <h2 class="text-xl font-bold">Подключённые аккаунты</h2>
        <p class="text-sm text-base-content/70">
          Подключено аккаунтов: {{ credentials.length }}
        </p>
      </div>
      <button class="btn btn-sm btn-primary" @click="emit('add')">
        <Icon name="mingcute:add-line" class="h-4 w-4" />
        Подключить аккаунт
      </button>
    </header>

    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <DriveCredentialCard
        v-for="cred in credentials"
        :key="cred.id"
        :credential="cred"
        :is-selected="cred.id === selectedCredentialId"
        :is-testing="cred.id === testingCredentialId"
        @test="emit('test', $event)"
        @revoke="emit('revoke', $event)"
        @delete="emit('delete', $event)"
        @selected="emit('selected', $event)"
      />
    </div>
  </section>
</template>
